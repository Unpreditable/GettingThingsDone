/**
 * Maintains a live index of all task records from the configured scope.
 *
 * - Scans on plugin load
 * - Updates on vault modify / create / delete events
 * - Emits change notifications via a callback so the UI can re-render
 */

import { App, TFile, Plugin } from "obsidian";
import { parseFile, TaskRecord } from "./TaskParser";
import { TaskScope } from "../settings";

type ChangeCallback = (allTasks: TaskRecord[]) => void;

export class TaskIndex {
  private index = new Map<string, TaskRecord[]>(); // filePath → tasks
  private listeners: ChangeCallback[] = [];

  constructor(
    private app: App,
    private plugin: Plugin,
    private getScope: () => TaskScope
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Full vault scan — call once on plugin load. */
  async initialScan(): Promise<void> {
    const files = this.getScopedFiles();
    await Promise.all(files.map((f) => this.indexFile(f)));
    this.emit();
  }

  /** Get all task records across all indexed files. */
  getAllTasks(): TaskRecord[] {
    const result: TaskRecord[] = [];
    for (const tasks of this.index.values()) {
      result.push(...tasks);
    }
    return result;
  }

  /** Register a callback invoked whenever the index changes. */
  onChange(cb: ChangeCallback): void {
    this.listeners.push(cb);
  }

  /** Register vault event listeners. Call once after plugin load. */
  registerVaultEvents(): void {
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && this.isInScope(file)) {
          this.indexFile(file).then(() => this.emit());
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && this.isInScope(file)) {
          this.indexFile(file).then(() => this.emit());
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
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        // Always clean up the old path from the index.
        const wasIndexed = this.index.has(oldPath);
        if (wasIndexed) this.index.delete(oldPath);
        // Re-index only if the new path is in scope; otherwise just emit the removal.
        if (this.isInScope(file)) {
          this.indexFile(file).then(() => this.emit());
        } else if (wasIndexed) {
          this.emit();
        }
      })
    );
  }

  /** Re-index a specific file path (e.g. after a write). */
  async reindexFile(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.indexFile(file);
      this.emit();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

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
