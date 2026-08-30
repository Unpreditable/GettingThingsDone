import { TaskIndex } from "../src/core/TaskIndex";
import { TFile } from "obsidian";
import type { PathEntry, TaskScope } from "../src/settings";

function makeTFile(path: string) {
  return new (TFile as any)(path, "md", path.replace(".md", ""));
}

/**
 * Minimal fake App/Plugin — same pattern as TaskWriter.test.ts's makeMockApp,
 * extended with the metadataCache/vault event registration TaskIndex needs.
 * Not the real Obsidian mock classes (those are empty stubs); this models
 * just enough surface for TaskIndex's own logic to run against.
 */
function makeMockEnv(initialFiles: Record<string, string>) {
  const contents = new Map<string, string>(Object.entries(initialFiles));
  const tfiles = new Map<string, TFile>();
  for (const path of contents.keys()) tfiles.set(path, makeTFile(path));

  let changedCb: ((file: TFile, data: string) => void) | null = null;
  const vaultCbs = new Map<string, (file: TFile, oldPath?: string) => void>();

  const app = {
    vault: {
      getMarkdownFiles: () => Array.from(tfiles.values()),
      getAbstractFileByPath: (path: string) => tfiles.get(path) ?? null,
      cachedRead: async (file: TFile) => contents.get(file.path) ?? "",
      on: (event: string, cb: (file: TFile, oldPath?: string) => void) => {
        vaultCbs.set(event, cb);
        return {};
      },
    },
    metadataCache: {
      on: (event: string, cb: (file: TFile, data: string) => void) => {
        if (event === "changed") changedCb = cb;
        return {};
      },
    },
  } as any;

  const plugin = { registerEvent: (_ref: any) => {} } as any;

  return {
    app,
    plugin,
    /** Simulates a file write followed by Obsidian's own async metadataCache
     * "changed" event firing for it (what happens on disk edits we didn't
     * make ourselves, or the redundant event after ones we did). */
    fireChanged(path: string, content: string) {
      contents.set(path, content);
      if (!tfiles.has(path)) tfiles.set(path, makeTFile(path));
      changedCb?.(tfiles.get(path)!, content);
    },
    setContentSilently(path: string, content: string) {
      contents.set(path, content);
    },
    /** Simulates a file appearing in the vault with content already in it —
     *  copied in from outside, synced, or written by another plugin. */
    async fireCreated(path: string, content: string) {
      contents.set(path, content);
      tfiles.set(path, makeTFile(path));
      await (vaultCbs.get("create") as any)?.(tfiles.get(path)!);
    },
    async fireRename(oldPath: string, newPath: string) {
      const content = contents.get(oldPath) ?? "";
      contents.delete(oldPath);
      tfiles.delete(oldPath);
      contents.set(newPath, content);
      tfiles.set(newPath, makeTFile(newPath));
      await (vaultCbs.get("rename") as any)?.(tfiles.get(newPath)!, oldPath);
    },
  };
}

const vaultScope: TaskScope = { type: "vault", ignored: [] };

describe("TaskIndex", () => {
  it("initialScan indexes all in-scope files and notifies listeners once", async () => {
    const { app, plugin } = makeMockEnv({ "a.md": "- [ ] Task A", "b.md": "- [ ] Task B" });
    const index = new TaskIndex(app, plugin, () => vaultScope);

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    await index.initialScan();

    expect(index.getAllTasks().map((t) => t.text).sort()).toEqual(["Task A", "Task B"]);
    expect(notifyCount).toBe(1);
  });

  it("indexes a file that appears in the vault after the initial scan", async () => {
    const { app, plugin, fireCreated } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    await fireCreated("copied-in.md", "- [ ] Task B");

    expect(index.getAllTasks().map((t) => t.text).sort()).toEqual(["Task A", "Task B"]);
    expect(notifyCount).toBe(1);
  });

  it("ignores create events fired before the first scan", async () => {
    // Obsidian replays "create" for every existing file at vault load, and
    // registration happens before the first scan. Acting on those would index
    // the whole vault one emit at a time.
    const { app, plugin, fireCreated } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    await fireCreated("b.md", "- [ ] Task B");
    expect(notifyCount).toBe(0);

    // The scan that follows still picks it up, so nothing is lost.
    await index.initialScan();
    expect(index.getAllTasks().map((t) => t.text).sort()).toEqual(["Task A", "Task B"]);
    expect(notifyCount).toBe(1);
  });

  it("ignores a created file that is out of scope", async () => {
    const scope: TaskScope = { type: "paths", included: [{ type: "file", path: "a.md" }] };
    const { app, plugin, fireCreated } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => scope);
    index.registerVaultEvents();
    await index.initialScan();

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    await fireCreated("elsewhere.md", "- [ ] Task B");

    expect(index.getAllTasks().map((t) => t.text)).toEqual(["Task A"]);
    expect(notifyCount).toBe(0);
  });

  it("reindexFileSilently updates the index WITHOUT notifying listeners", async () => {
    const { app, plugin, setContentSilently } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    await index.initialScan();

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    setContentSilently("a.md", "- [ ] Task A\n- [ ] Task A2");
    await index.reindexFileSilently("a.md");

    expect(index.getAllTasks().map((t) => t.text).sort()).toEqual(["Task A", "Task A2"]);
    expect(notifyCount).toBe(0);
  });

  it("reindexFile updates the index AND notifies listeners", async () => {
    const { app, plugin, setContentSilently } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    await index.initialScan();

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    setContentSilently("a.md", "- [ ] Task A\n- [ ] Task A2");
    await index.reindexFile("a.md");

    expect(index.getAllTasks().map((t) => t.text).sort()).toEqual(["Task A", "Task A2"]);
    expect(notifyCount).toBe(1);
  });

  it("skips re-parsing and does not notify when the async 'changed' event reports content already indexed (e.g. right after our own reindexFileSilently)", async () => {
    const { app, plugin, fireChanged, setContentSilently } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    const newContent = "- [ ] Task A\n- [ ] Task A2";
    // The write already landed on disk; we catch up immediately (what
    // handleMove does after a move), so the index already has newContent.
    setContentSilently("a.md", newContent);
    await index.reindexFileSilently("a.md");

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    // Obsidian's own async metadataCache event catches up moments later,
    // reporting the exact same content we already processed.
    fireChanged("a.md", newContent);

    expect(notifyCount).toBe(0);
    expect(index.getAllTasks().map((t) => t.text).sort()).toEqual(["Task A", "Task A2"]);
  });

  it("still reprocesses and notifies when the 'changed' event reports genuinely different content", async () => {
    const { app, plugin, fireChanged } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    fireChanged("a.md", "- [ ] Task A\n- [ ] Task A2\n- [ ] Task A3");

    expect(notifyCount).toBe(1);
    expect(index.getAllTasks().map((t) => t.text).sort()).toEqual(["Task A", "Task A2", "Task A3"]);
  });

  it("hands onFileReplaced the previous parse alongside the new one", async () => {
    const { app, plugin, fireChanged } = makeMockEnv({ "a.md": "- [ ] Old text" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    const seen: Array<{ path: string; old: string[]; next: string[] }> = [];
    index.onFileReplaced((path, oldTasks, newTasks) => {
      seen.push({
        path,
        old: oldTasks.map((t) => t.text),
        next: newTasks.map((t) => t.text),
      });
    });

    fireChanged("a.md", "- [ ] New text");

    expect(seen).toEqual([{ path: "a.md", old: ["Old text"], next: ["New text"] }]);
  });

  it("does not fire onFileReplaced when the changed event reports already-indexed content", async () => {
    const { app, plugin, fireChanged } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    let calls = 0;
    index.onFileReplaced(() => calls++);

    fireChanged("a.md", "- [ ] Task A");

    expect(calls).toBe(0);
  });

  it("notifies rename listeners before applying the scope check", async () => {
    let scopePaths: PathEntry[] = [{ type: "file", path: "old.md" }];
    const { app, plugin, fireRename } = makeMockEnv({ "old.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => ({ type: "paths", included: scopePaths }));
    index.registerVaultEvents();
    await index.initialScan();

    index.onRename((oldPath, newPath) => {
      scopePaths = scopePaths.map((e) => (e.path === oldPath ? { ...e, path: newPath } : e));
    });

    await fireRename("old.md", "new.md");

    expect(index.getAllTasks().map((t) => t.filePath)).toEqual(["new.md"]);
  });

  it("still fires onChange listeners when an onFileReplaced listener throws", async () => {
    const { app, plugin, fireChanged } = makeMockEnv({ "a.md": "- [ ] Old text" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    index.onFileReplaced(() => {
      throw new Error("boom");
    });

    let notifyCount = 0;
    index.onChange(() => notifyCount++);

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    fireChanged("a.md", "- [ ] New text");
    errorSpy.mockRestore();

    expect(notifyCount).toBe(1);
    expect(index.getAllTasks().map((t) => t.text)).toEqual(["New text"]);
  });

  it("still updates the index for the renamed file when an onRename listener throws", async () => {
    const { app, plugin, fireRename } = makeMockEnv({ "old.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    index.onRename(() => {
      throw new Error("boom");
    });

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await fireRename("old.md", "new.md");
    errorSpy.mockRestore();

    expect(index.getAllTasks().map((t) => t.filePath)).toEqual(["new.md"]);
  });

  it("reindexFile fires onFileReplaced with the previous parse, so a caller catching the index up after its own write still gets the diff", async () => {
    // handleToggle re-indexes after writing, which primes contentHashes and
    // makes Obsidian's later metadataCache event a no-op. If this path stayed
    // silent, that write's completion transition would never be witnessed.
    const { app, plugin, setContentSilently } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    const seen: Array<{ old: string[]; next: string[] }> = [];
    index.onFileReplaced((_path, oldTasks, newTasks) => {
      seen.push({ old: oldTasks.map((t) => t.rawLine), next: newTasks.map((t) => t.rawLine) });
    });

    setContentSilently("a.md", "- [x] Task A");
    await index.reindexFile("a.md");

    expect(seen).toEqual([{ old: ["- [ ] Task A"], next: ["- [x] Task A"] }]);
  });

  it("reindexFileSilently also fires onFileReplaced (it suppresses onChange, not the diff)", async () => {
    const { app, plugin, setContentSilently } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    let replaced = 0;
    let changed = 0;
    index.onFileReplaced(() => replaced++);
    index.onChange(() => changed++);

    setContentSilently("a.md", "- [x] Task A");
    await index.reindexFileSilently("a.md");

    expect([replaced, changed]).toEqual([1, 0]);
  });

  it("returns an unsubscribe function from onFileReplaced", async () => {
    const { app, plugin, fireChanged } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    let calls = 0;
    const off = index.onFileReplaced(() => calls++);
    off();

    fireChanged("a.md", "- [ ] Task B");

    expect(calls).toBe(0);
  });
});
