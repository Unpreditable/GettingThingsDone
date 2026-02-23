import { migrateStorageMode } from "../src/core/StorageMigrator";
import { DEFAULT_SETTINGS, DEFAULT_BUCKETS } from "../src/settings";
import { TFile } from "obsidian";
import type { TaskRecord } from "../src/core/TaskParser";

function makeTFile(path: string) {
  return new (TFile as any)(path, "md", path.replace(".md", ""));
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "1",
    filePath: "test.md",
    lineNumber: 0,
    rawLine: "- [ ] Test task",
    text: "Test task",
    isCompleted: false,
    completedAt: null,
    dueDate: null,
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...overrides,
  };
}

function makeMockApp(files: Record<string, string>) {
  const storage: Record<string, string> = { ...files };

  return {
    app: {
      vault: {
        getAbstractFileByPath: (path: string) =>
          path in storage ? makeTFile(path) : null,
        read: jest.fn(async (file: any) => storage[file.path]),
        modify: jest.fn(async (file: any, content: string) => {
          storage[file.path] = content;
        }),
        process: jest.fn(async (file: any, cb: (content: string) => string) => {
          storage[file.path] = cb(storage[file.path]);
        }),
      },
    } as any,
    getContent: (path: string) => storage[path],
  };
}

describe("migrateStorageMode", () => {
  const baseBuckets = DEFAULT_BUCKETS;

  it("migrates inline-tag to inline-field", async () => {
    const content = "- [ ] Task #gtd/today";
    const { app, getContent } = makeMockApp({ "test.md": content });
    const task = makeTask({ rawLine: content });
    const toSettings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-field" as const,
      tagPrefix: "gtd",
      buckets: baseBuckets,
    };

    await migrateStorageMode(app, [task], "inline-tag", toSettings);

    expect(getContent("test.md")).toContain("[gtd:: today]");
    expect(getContent("test.md")).not.toContain("#gtd/today");
  });

  it("migrates inline-field to inline-tag", async () => {
    const content = "- [ ] Task [gtd:: this-week]";
    const { app, getContent } = makeMockApp({ "test.md": content });
    const task = makeTask({ rawLine: content });
    const toSettings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-tag" as const,
      tagPrefix: "gtd",
      buckets: baseBuckets,
    };

    await migrateStorageMode(app, [task], "inline-field", toSettings);

    expect(getContent("test.md")).toContain("#gtd/this-week");
    expect(getContent("test.md")).not.toContain("[gtd::");
  });

  it("does nothing when from and to modes are the same", async () => {
    const content = "- [ ] Task #gtd/today";
    const { app, getContent } = makeMockApp({ "test.md": content });
    const task = makeTask({ rawLine: content });
    const toSettings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-tag" as const,
      tagPrefix: "gtd",
      buckets: baseBuckets,
    };

    await migrateStorageMode(app, [task], "inline-tag", toSettings);

    expect(getContent("test.md")).toBe(content);
    expect(app.vault.process).not.toHaveBeenCalled();
  });

  it("skips tasks with unrecognized bucket IDs", async () => {
    const content = "- [ ] Task #gtd/deleted-bucket";
    const { app, getContent } = makeMockApp({ "test.md": content });
    const task = makeTask({ rawLine: content });
    const toSettings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-field" as const,
      tagPrefix: "gtd",
      buckets: baseBuckets,
    };

    await migrateStorageMode(app, [task], "inline-tag", toSettings);

    expect(getContent("test.md")).toBe(content);
  });

  it("skips tasks without any bucket assignment", async () => {
    const content = "- [ ] Plain task";
    const { app, getContent } = makeMockApp({ "test.md": content });
    const task = makeTask({ rawLine: content });
    const toSettings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-field" as const,
      tagPrefix: "gtd",
      buckets: baseBuckets,
    };

    await migrateStorageMode(app, [task], "inline-tag", toSettings);

    expect(getContent("test.md")).toBe(content);
  });

  it("handles stale lines gracefully (counts as failed)", async () => {
    const content = "- [ ] Changed content";
    const { app, getContent } = makeMockApp({ "test.md": content });
    const task = makeTask({ rawLine: "- [ ] Original #gtd/today" });
    const toSettings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-field" as const,
      tagPrefix: "gtd",
      buckets: baseBuckets,
    };

    await migrateStorageMode(app, [task], "inline-tag", toSettings);

    expect(getContent("test.md")).toBe(content);
  });

  it("migrates multiple tasks across multiple files", async () => {
    const { app, getContent } = makeMockApp({
      "a.md": "- [ ] Task A #gtd/today",
      "b.md": "- [ ] Task B #gtd/someday",
    });
    const tasks = [
      makeTask({ id: "1", filePath: "a.md", rawLine: "- [ ] Task A #gtd/today" }),
      makeTask({ id: "2", filePath: "b.md", rawLine: "- [ ] Task B #gtd/someday" }),
    ];
    const toSettings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-field" as const,
      tagPrefix: "gtd",
      buckets: baseBuckets,
    };

    await migrateStorageMode(app, tasks, "inline-tag", toSettings);

    expect(getContent("a.md")).toContain("[gtd:: today]");
    expect(getContent("b.md")).toContain("[gtd:: someday]");
  });

  it("only modifies the correct line in a multi-line file", async () => {
    const content = "- [ ] First\n- [ ] Target #gtd/today\n- [ ] Third";
    const { app, getContent } = makeMockApp({ "test.md": content });
    const task = makeTask({
      lineNumber: 1,
      rawLine: "- [ ] Target #gtd/today",
    });
    const toSettings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-field" as const,
      tagPrefix: "gtd",
      buckets: baseBuckets,
    };

    await migrateStorageMode(app, [task], "inline-tag", toSettings);

    const lines = getContent("test.md").split("\n");
    expect(lines[0]).toBe("- [ ] First");
    expect(lines[1]).toContain("[gtd:: today]");
    expect(lines[2]).toBe("- [ ] Third");
  });
});
