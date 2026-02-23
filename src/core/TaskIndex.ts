import { App, TFile, Plugin } from "obsidian";
import { parseFile, TaskRecord } from "./TaskParser";
import { TaskScope } from "../settings";

type ChangeCallback = (allTasks: TaskRecord[]) => void;

export class TaskIndex {
  private index = new Map<string, TaskRecord[]>();
  private listeners: ChangeCallback[] = [];

  constructor(
    private app: App,
    private plugin: Plugin,
    private getScope: () => TaskScope
  ) {}

  async initialScan(): Promise<void> {
    const files = this.getScopedFiles();
    await Promise.all(files.map((f) => this.indexFile(f)));
    this.emit();
  }

  getAllTasks(): TaskRecord[] {
    const result: TaskRecord[] = [];
    for (const tasks of this.index.values()) {
      result.push(...tasks);
    }
    return result;
  }

  onChange(cb: ChangeCallback): () => void {
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  registerVaultEvents(): void {
    this.plugin.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && this.isInScope(file)) {
          await this.indexFile(file);
          this.emit();
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("create", async (file) => {
        if (file instanceof TFile && this.isInScope(file)) {
          await this.indexFile(file);
          this.emit();
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          if (this.index.has(file.path)) {
            this.index.delete(file.path);
            this.emit();
          }
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const wasIndexed = this.index.has(oldPath);
        if (wasIndexed) this.index.delete(oldPath);
        if (this.isInScope(file)) {
          await this.indexFile(file);
          this.emit();
        } else if (wasIndexed) {
          this.emit();
        }
      })
    );
  }

  async reindexFile(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.indexFile(file);
      this.emit();
    }
  }

  private async indexFile(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      this.index.delete(file.path);
      return;
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      const tasks = parseFile(file.path, content);
      this.index.set(file.path, tasks);
    } catch {
      this.index.delete(file.path);
    }
  }

  private isInScope(file: TFile): boolean {
    const scope = this.getScope();
    if (file.extension !== "md") return false;

    switch (scope.type) {
      case "vault":
        return true;
      case "folders":
        return scope.paths.some((p) => file.path.startsWith(p.endsWith("/") ? p : p + "/"));
      case "files":
        return scope.paths.includes(file.path);
    }
  }

  private getScopedFiles(): TFile[] {
    const scope = this.getScope();
    const all = this.app.vault.getMarkdownFiles();

    switch (scope.type) {
      case "vault":
        return all;
      case "folders":
        return all.filter((f) =>
          scope.paths.some((p) =>
            f.path.startsWith(p.endsWith("/") ? p : p + "/")
          )
        );
      case "files":
        return all.filter((f) => scope.paths.includes(f.path));
    }
  }

  private emit(): void {
    const tasks = this.getAllTasks();
    for (const cb of this.listeners) cb(tasks);
  }
}
