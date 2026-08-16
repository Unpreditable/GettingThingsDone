import { App, TFile, Plugin } from "obsidian";
import { parseFile, TaskRecord } from "./TaskParser";
import { TaskScope, isPathInScope } from "../settings";
import { hashString } from "./TaskOrder";

type ChangeCallback = (allTasks: TaskRecord[]) => void;
type FileReplacedCallback = (
  filePath: string,
  oldTasks: TaskRecord[],
  newTasks: TaskRecord[]
) => void;
type RenameCallback = (oldPath: string, newPath: string) => void;

export class TaskIndex {
  private index = new Map<string, TaskRecord[]>();
  /** Last-seen content hash per file, used to skip re-parsing when Obsidian's
   * own async metadataCache "changed" event reports content we've already
   * indexed (e.g. via reindexFileSilently right after our own write) —
   * content-verified, not timing-based, so a genuine concurrent change is
   * never masked: it simply won't match the cached hash. */
  private contentHashes = new Map<string, string>();
  private listeners: ChangeCallback[] = [];
  private fileReplacedListeners: FileReplacedCallback[] = [];
  private renameListeners: RenameCallback[] = [];
  /** Whether initialScan has run. Gates the "create" handler — see below. */
  private hasScanned = false;

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
    this.hasScanned = true;
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

  /**
   * Fires when an external edit replaces a file's parse, with the parse it
   * replaced. Consumers diff the two to migrate saved order through in-place
   * edits and to witness completion transitions. Fires before onChange, so
   * the refresh that follows already sees migrated order.
   */
  onFileReplaced(cb: FileReplacedCallback): () => void {
    this.fileReplacedListeners.push(cb);
    return () => {
      const idx = this.fileReplacedListeners.indexOf(cb);
      if (idx !== -1) this.fileReplacedListeners.splice(idx, 1);
    };
  }

  /**
   * Fires at the very top of the rename handler — before the new path is
   * scope-checked — so a listener can update a "specific files" scope list
   * and keep the file indexed across the rename.
   */
  onRename(cb: RenameCallback): () => void {
    this.renameListeners.push(cb);
    return () => {
      const idx = this.renameListeners.indexOf(cb);
      if (idx !== -1) this.renameListeners.splice(idx, 1);
    };
  }

  registerVaultEvents(): void {
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file, data) => {
        if (this.isInScope(file)) {
          const hash = hashString(data);
          if (this.contentHashes.get(file.path) === hash) return;
          this.contentHashes.set(file.path, hash);
          const oldTasks = this.index.get(file.path) ?? [];
          const tasks = parseFile(file.path, data);
          this.index.set(file.path, tasks);
          this.notifyFileReplaced(file.path, oldTasks, tasks);
          this.emit();
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("create", async (file) => {
        if (!(file instanceof TFile)) return;
        // Obsidian replays "create" for every existing file when the vault
        // loads, and registerVaultEvents runs before the first scan. Waiting
        // for the scan avoids indexing the whole vault one emit at a time —
        // the scan itself covers everything that existed before it.
        if (!this.hasScanned) return;
        if (!this.isInScope(file)) return;
        await this.indexFile(file);
        this.emit();
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
        // Same containment as the "changed" handler above: a throwing
        // listener must not abort the rest of the rename handling, or the
        // renamed file is left stale in the index.
        for (const cb of this.renameListeners) {
          try {
            cb(oldPath, file.path);
          } catch (e) {
            console.error("GTD Tasks: onRename listener threw", e);
          }
        }
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
      const oldTasks = this.index.get(file.path) ?? [];
      const tasks = parseFile(file.path, content);
      this.index.set(file.path, tasks);
      // Priming contentHashes above makes Obsidian's own later "changed"
      // event a no-op for this content, so this is the only chance to
      // report the replacement — a caller catching the index up after its
      // own write must still get the diff.
      this.notifyFileReplaced(file.path, oldTasks, tasks);
    } catch {
      this.index.delete(file.path);
      this.contentHashes.delete(file.path);
    }
  }

  /**
   * A listener that throws must not abort the caller — in the "changed"
   * handler that would skip emit(), recur on every subsequent edit, and
   * leave the panel stuck stale until Obsidian restarts.
   */
  private notifyFileReplaced(
    filePath: string,
    oldTasks: TaskRecord[],
    newTasks: TaskRecord[]
  ): void {
    for (const cb of this.fileReplacedListeners) {
      try {
        cb(filePath, oldTasks, newTasks);
      } catch (e) {
        console.error("GTD Tasks: onFileReplaced listener threw", e);
      }
    }
  }

  private isInScope(file: TFile): boolean {
    return file.extension === "md" && isPathInScope(file.path, this.getScope());
  }

  private getScopedFiles(): TFile[] {
    const scope = this.getScope();
    return this.app.vault.getMarkdownFiles().filter((f) => isPathInScope(f.path, scope));
  }

  private emit(): void {
    const tasks = this.getAllTasks();
    for (const cb of this.listeners) cb(tasks);
  }
}
