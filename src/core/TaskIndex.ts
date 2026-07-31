import { App, TFile, Plugin } from "obsidian";
import { parseFile, TaskRecord } from "./TaskParser";
import { TaskScope } from "../settings";
import { hashString } from "./TaskOrder";

type ChangeCallback = (allTasks: TaskRecord[]) => void;

export class TaskIndex {
  private index = new Map<string, TaskRecord[]>();
  /** Last-seen content hash per file, used to skip re-parsing when Obsidian's
   * own async metadataCache "changed" event reports content we've already
   * indexed (e.g. via reindexFileSilently right after our own write) —
   * content-verified, not timing-based, so a genuine concurrent change is
   * never masked: it simply won't match the cached hash. */
  private contentHashes = new Map<string, string>();
  private listeners: ChangeCallback[] = [];

  constructor(
    private app: App,
    private plugin: Plugin,
    private getScope: () => TaskScope
  ) {}

  async initialScan(): Promise<void> {
    this.index.clear();
    this.contentHashes.clear();
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
      this.app.metadataCache.on("changed", (file, data) => {
        if (this.isInScope(file)) {
          const hash = hashString(data);
          if (this.contentHashes.get(file.path) === hash) return;
          this.contentHashes.set(file.path, hash);
          const tasks = parseFile(file.path, data);
          this.index.set(file.path, tasks);
          this.emit();
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          if (this.index.has(file.path)) {
            this.index.delete(file.path);
            this.contentHashes.delete(file.path);
            this.emit();
          }
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const wasIndexed = this.index.has(oldPath);
        if (wasIndexed) {
          this.index.delete(oldPath);
          this.contentHashes.delete(oldPath);
        }
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
    await this.reindexFileSilently(filePath);
    this.emit();
  }

  /**
   * Same as reindexFile but without notifying listeners — for callers that
   * need the index caught up before making further changes (e.g. computing
   * order keys) and will trigger their own single refresh once everything
   * is settled, rather than causing an intermediate render with stale order.
   */
  async reindexFileSilently(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.indexFile(file);
    }
  }

  private async indexFile(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      this.index.delete(file.path);
      this.contentHashes.delete(file.path);
      return;
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      this.contentHashes.set(file.path, hashString(content));
      const tasks = parseFile(file.path, content);
      this.index.set(file.path, tasks);
    } catch {
      this.index.delete(file.path);
      this.contentHashes.delete(file.path);
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
