import { TaskIndex } from "../src/core/TaskIndex";
import { TFile } from "obsidian";
import type { TaskScope } from "../src/settings";

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

  const app = {
    vault: {
      getMarkdownFiles: () => Array.from(tfiles.values()),
      getAbstractFileByPath: (path: string) => tfiles.get(path) ?? null,
      cachedRead: async (file: TFile) => contents.get(file.path) ?? "",
      on: (_event: string, _cb: any) => ({}),
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
  };
}

const vaultScope: TaskScope = { type: "vault" };

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
});
