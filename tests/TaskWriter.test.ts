import { findTaskLine, moveTaskToBucket, toggleTaskCompletion, confirmTaskPlacement, toggleTaskLine } from "../src/core/TaskWriter";
import { DEFAULT_SETTINGS } from "../src/settings";
import { TFile } from "obsidian";
import type { TaskRecord } from "../src/core/TaskParser";
import type { BucketConfig } from "../src/settings";

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

const todayBucket: BucketConfig = {
  id: "today",
  name: "Today",
  emoji: "⚡",
  dateRangeRule: { type: "today" },
  quickMoveTargets: [],
  showInStatusBar: false,
};

function makeMockApp(fileContent: string, filePath = "test.md") {
  let storedContent = fileContent;
  const file = makeTFile(filePath);

  return {
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => (path === filePath ? file : null),
        read: jest.fn(async () => storedContent),
        modify: jest.fn(async (_f: any, content: string) => {
          storedContent = content;
        }),
        process: jest.fn(async (_f: any, cb: (content: string) => string) => {
          storedContent = cb(storedContent);
        }),
      },
    } as any,
    getContent: () => storedContent,
    file,
  };
}

describe("findTaskLine", () => {
  it("returns lineNumber when it matches rawLine", () => {
    const lines = ["- [ ] First", "- [ ] Second", "- [ ] Third"];
    const task = makeTask({ lineNumber: 1, rawLine: "- [ ] Second" });
    expect(findTaskLine(lines, task)).toBe(1);
  });

  it("falls back to scanning when lineNumber doesn't match", () => {
    const lines = ["new line inserted", "- [ ] First", "- [ ] Second"];
    const task = makeTask({ lineNumber: 0, rawLine: "- [ ] Second" });
    expect(findTaskLine(lines, task)).toBe(2);
  });

  it("returns -1 when rawLine not found at all", () => {
    const lines = ["- [ ] Other task"];
    const task = makeTask({ lineNumber: 5, rawLine: "- [ ] Missing" });
    expect(findTaskLine(lines, task)).toBe(-1);
  });

  it("handles lineNumber beyond file length", () => {
    const lines = ["- [ ] Only line"];
    const task = makeTask({ lineNumber: 100, rawLine: "- [ ] Only line" });
    expect(findTaskLine(lines, task)).toBe(0);
  });
});

describe("moveTaskToBucket", () => {
  const settings = { ...DEFAULT_SETTINGS, storageMode: "inline-tag" as const, tagPrefix: "gtd" };

  it("adds a tag when moving to a bucket (inline-tag mode)", async () => {
    const { app, getContent } = makeMockApp("- [ ] Test task");
    const task = makeTask();
    const result = await moveTaskToBucket(app, task, todayBucket, settings);
    expect(result.success).toBe(true);
    expect(getContent()).toContain("#gtd/today");
  });

  it("adds an inline field when moving (inline-field mode)", async () => {
    const fieldSettings = { ...settings, storageMode: "inline-field" as const };
    const { app, getContent } = makeMockApp("- [ ] Test task");
    const task = makeTask();
    const result = await moveTaskToBucket(app, task, todayBucket, fieldSettings);
    expect(result.success).toBe(true);
    expect(getContent()).toContain("[gtd:: today]");
  });

  it("removes tag when target is null (move to To Review)", async () => {
    const { app, getContent } = makeMockApp("- [ ] Test task #gtd/today");
    const task = makeTask({ rawLine: "- [ ] Test task #gtd/today" });
    const result = await moveTaskToBucket(app, task, null, settings);
    expect(result.success).toBe(true);
    expect(getContent()).not.toContain("#gtd");
  });

  it("fails when file not found", async () => {
    const { app } = makeMockApp("- [ ] Test task");
    const task = makeTask({ filePath: "nonexistent.md" });
    const result = await moveTaskToBucket(app, task, todayBucket, settings);
    expect(result.success).toBe(false);
    expect(result.error).toContain("File not found");
  });

  it("fails when rawLine not found (stale index)", async () => {
    const { app } = makeMockApp("- [ ] Different content");
    const task = makeTask({ rawLine: "- [ ] Original content" });
    const result = await moveTaskToBucket(app, task, todayBucket, settings);
    expect(result.success).toBe(false);
    expect(result.error).toContain("stale index");
  });

  it("replaces existing tag when moving between buckets", async () => {
    const { app, getContent } = makeMockApp("- [ ] Task #gtd/someday");
    const task = makeTask({ rawLine: "- [ ] Task #gtd/someday" });
    const result = await moveTaskToBucket(app, task, todayBucket, settings);
    expect(result.success).toBe(true);
    expect(getContent()).toContain("#gtd/today");
    expect(getContent()).not.toContain("#gtd/someday");
  });

  it("modifies only the target line in multi-line files", async () => {
    const content = "- [ ] First task\n- [ ] Target task\n- [ ] Third task";
    const { app, getContent } = makeMockApp(content);
    const task = makeTask({ lineNumber: 1, rawLine: "- [ ] Target task" });
    await moveTaskToBucket(app, task, todayBucket, settings);
    const lines = getContent().split("\n");
    expect(lines[0]).toBe("- [ ] First task");
    expect(lines[1]).toContain("#gtd/today");
    expect(lines[2]).toBe("- [ ] Third task");
  });
});

describe("toggleTaskLine", () => {
  it("delegates to the Tasks API when present and returns its line", () => {
    const api = {
      executeToggleTaskDoneCommand: jest.fn(() => "- [x] Test task ✅ 2026-08-02"),
    };

    const result = toggleTaskLine("- [ ] Test task", "test.md", false, api);

    expect(api.executeToggleTaskDoneCommand).toHaveBeenCalledWith("- [ ] Test task", "test.md");
    expect(result).toEqual(["- [x] Test task ✅ 2026-08-02"]);
  });

  it("returns both lines when Tasks expands a recurring task into two", () => {
    const api = {
      executeToggleTaskDoneCommand: () => "- [ ] Water plants 🔁 every week 📅 2026-08-09\n- [x] Water plants 🔁 every week 📅 2026-08-02 ✅ 2026-08-02",
    };

    const result = toggleTaskLine("- [ ] Water plants 🔁 every week 📅 2026-08-02", "test.md", false, api);

    expect(result).toHaveLength(2);
  });

  it("returns no lines when Tasks deletes the task on completion", () => {
    const api = { executeToggleTaskDoneCommand: () => "" };

    expect(toggleTaskLine("- [ ] Throwaway 🏁 delete", "test.md", false, api)).toEqual([]);
  });

  it("also delegates when reopening a completed task", () => {
    const api = { executeToggleTaskDoneCommand: jest.fn(() => "- [ ] Test task") };

    expect(toggleTaskLine("- [x] Test task ✅ 2026-08-02", "test.md", true, api)).toEqual([
      "- [ ] Test task",
    ]);
    expect(api.executeToggleTaskDoneCommand).toHaveBeenCalled();
  });

  it("falls back to a minimal flip when the API throws", () => {
    const api = {
      executeToggleTaskDoneCommand: () => {
        throw new Error("boom");
      },
    };

    expect(toggleTaskLine("- [ ] Test task", "test.md", false, api)).toEqual(["- [x] Test task"]);
  });

  it("flips the checkbox and writes no date when Tasks is absent", () => {
    expect(toggleTaskLine("- [ ] Test task", "test.md", false, null)).toEqual(["- [x] Test task"]);
  });

  it("clears the checkbox and strips an existing ✅ date on reopen when Tasks is absent", () => {
    expect(toggleTaskLine("- [x] Test task ✅ 2026-08-02", "test.md", true, null)).toEqual([
      "- [ ] Test task",
    ]);
  });

  it("preserves other metadata on the line in the fallback path", () => {
    expect(toggleTaskLine("- [ ] Test task 📅 2026-08-09 #gtd/today", "test.md", false, null)).toEqual([
      "- [x] Test task 📅 2026-08-09 #gtd/today",
    ]);
  });
});

describe("toggleTaskCompletion", () => {
  it("checks an open task without writing a date (no Tasks plugin)", async () => {
    const { app, getContent } = makeMockApp("- [ ] Test task");
    const task = makeTask({ rawLine: "- [ ] Test task" });

    const result = await toggleTaskCompletion(app, task);

    expect(result.success).toBe(true);
    expect(getContent()).toBe("- [x] Test task");
  });

  it("unchecks a completed task and strips its ✅ date", async () => {
    const { app, getContent } = makeMockApp("- [x] Test task ✅ 2026-08-02");
    const task = makeTask({
      rawLine: "- [x] Test task ✅ 2026-08-02",
      isCompleted: true,
    });

    const result = await toggleTaskCompletion(app, task);

    expect(result.success).toBe(true);
    expect(getContent()).toBe("- [ ] Test task");
  });

  it("fails when file not found", async () => {
    const { app } = makeMockApp("- [ ] Test task");
    const task = makeTask({ filePath: "missing.md" });
    const result = await toggleTaskCompletion(app, task);
    expect(result.success).toBe(false);
  });

  it("fails cleanly when the task line can't be located", async () => {
    const { app } = makeMockApp("- [ ] Something else");
    const task = makeTask({ rawLine: "- [ ] Test task", lineNumber: 5 });

    expect((await toggleTaskCompletion(app, task)).success).toBe(false);
  });
});

describe("confirmTaskPlacement", () => {
  const settings = { ...DEFAULT_SETTINGS, storageMode: "inline-tag" as const, tagPrefix: "gtd" };

  it("writes explicit bucket marker", async () => {
    const { app, getContent } = makeMockApp("- [ ] Task");
    const task = makeTask({ rawLine: "- [ ] Task" });
    const result = await confirmTaskPlacement(app, task, "today", settings);
    expect(result.success).toBe(true);
    expect(getContent()).toContain("#gtd/today");
  });

  it("falls back to null when bucket ID not found", async () => {
    const { app, getContent } = makeMockApp("- [ ] Task #gtd/today");
    const task = makeTask({ rawLine: "- [ ] Task #gtd/today" });
    const result = await confirmTaskPlacement(app, task, "nonexistent", settings);
    expect(result.success).toBe(true);
    expect(getContent()).not.toContain("#gtd");
  });
});
