import { groupTasksIntoBuckets, TO_REVIEW_ID } from "../src/core/BucketManager";
import { DEFAULT_SETTINGS, DEFAULT_BUCKETS } from "../src/settings";
import type { TaskRecord } from "../src/core/TaskParser";

// Use a fixed Monday so calendar-aware week boundaries are predictable
const FIXED_MONDAY = new Date("2026-02-23T00:00:00"); // Monday Feb 23, 2026

jest.mock("../src/integrations/TasksPluginParser", () => ({
  today: () => new Date("2026-02-23T00:00:00"),
  parseDueDate: jest.fn((line: string) => {
    const match = line.match(/\u{1F4C5} (\d{4}-\d{2}-\d{2})/u);
    if (!match) return null;
    const [y, m, d] = match[1].split("-").map(Number);
    return new Date(y, m - 1, d);
  }),
}));

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
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

function daysFromMonday(days: number): Date {
  const d = new Date(FIXED_MONDAY);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe("groupTasksIntoBuckets", () => {
  const settings = { ...DEFAULT_SETTINGS, buckets: DEFAULT_BUCKETS };

  it("puts unassigned tasks without date into To Review", () => {
    const task = makeTask({});
    const groups = groupTasksIntoBuckets([task], settings);
    const review = groups.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.tasks).toHaveLength(1);
    expect(review.tasks[0]).toBe(task);
  });

  it("puts task due today (Mon Feb 23) into Today bucket", () => {
    const task = makeTask({ dueDate: daysFromMonday(0) }); // Feb 23 = diffDays 0
    const groups = groupTasksIntoBuckets([task], settings);
    const todayGroup = groups.find((g) => g.bucketId === "today")!;
    expect(todayGroup.tasks).toHaveLength(1);
  });

  it("puts task due yesterday into Today bucket (stale)", () => {
    const task = makeTask({ dueDate: daysFromMonday(-1) }); // Feb 22 = diffDays -1
    const groups = groupTasksIntoBuckets([task], settings);
    const todayGroup = groups.find((g) => g.bucketId === "today")!;
    expect(todayGroup.tasks).toHaveLength(1);
    expect(todayGroup.staleTaskIds).toContain(task.id);
  });

  it("puts task due Tuesday (Feb 24, diffDays=1) into This Week bucket", () => {
    // Mon Feb 23 → daysToSunday = 7-1 = 6, so diffDays 1–6 is this-week
    const task = makeTask({ dueDate: daysFromMonday(1) });
    const groups = groupTasksIntoBuckets([task], settings);
    const thisWeek = groups.find((g) => g.bucketId === "this-week")!;
    expect(thisWeek.tasks).toHaveLength(1);
  });

  it("puts task due Sunday (Mar 1, diffDays=6) into This Week bucket", () => {
    const task = makeTask({ dueDate: daysFromMonday(6) });
    const groups = groupTasksIntoBuckets([task], settings);
    const thisWeek = groups.find((g) => g.bucketId === "this-week")!;
    expect(thisWeek.tasks).toHaveLength(1);
  });

  it("puts task due next Monday (Mar 2, diffDays=7) into Next Week bucket", () => {
    // daysToNextMonday = 8 - 1 = 7, next-week: diffDays 7–13
    const task = makeTask({ dueDate: daysFromMonday(7) });
    const groups = groupTasksIntoBuckets([task], settings);
    const nextWeek = groups.find((g) => g.bucketId === "next-week")!;
    expect(nextWeek.tasks).toHaveLength(1);
  });

  it("puts task due next Sunday (Mar 8, diffDays=13) into Next Week bucket", () => {
    const task = makeTask({ dueDate: daysFromMonday(13) });
    const groups = groupTasksIntoBuckets([task], settings);
    const nextWeek = groups.find((g) => g.bucketId === "next-week")!;
    expect(nextWeek.tasks).toHaveLength(1);
  });

  it("puts task with #gtd/someday tag into Someday bucket", () => {
    const taskSettingsWithTag = {
      ...settings,
      storageMode: "inline-tag" as const,
      tagPrefix: "gtd",
    };
    const task = makeTask({
      rawLine: "- [ ] Test task #gtd/someday",
      tags: ["gtd/someday"],
    });
    const groups = groupTasksIntoBuckets([task], taskSettingsWithTag);
    const someday = groups.find((g) => g.bucketId === "someday")!;
    expect(someday.tasks).toHaveLength(1);
  });

  it("marks stale This Week task when date is today or past", () => {
    // This Week requires diffDays >= 1; diffDays 0 = stale when explicitly in this-week
    // Simulate explicit assignment to this-week with today's date (stale)
    const taskSettingsWithTag = {
      ...settings,
      storageMode: "inline-tag" as const,
      tagPrefix: "gtd",
    };
    const task = makeTask({
      dueDate: daysFromMonday(0), // today
      rawLine: "- [ ] Task \u{1F4C5} 2026-02-23 #gtd/this-week",
      tags: ["gtd/this-week"],
    });
    const groups = groupTasksIntoBuckets([task], taskSettingsWithTag);
    const thisWeek = groups.find((g) => g.bucketId === "this-week")!;
    expect(thisWeek.tasks).toHaveLength(1);
    expect(thisWeek.staleTaskIds).toContain(task.id);
  });

  it("tracks auto-placed tasks in autoPlacedTaskIds", () => {
    const task = makeTask({ dueDate: daysFromMonday(1) }); // tomorrow = this-week
    const groups = groupTasksIntoBuckets([task], settings);
    const thisWeek = groups.find((g) => g.bucketId === "this-week")!;
    expect(thisWeek.autoPlacedTaskIds).toContain(task.id);
  });

  it("does not mark explicitly assigned tasks as auto-placed", () => {
    const taskSettingsWithTag = {
      ...settings,
      storageMode: "inline-tag" as const,
      tagPrefix: "gtd",
    };
    const task = makeTask({
      dueDate: daysFromMonday(1),
      rawLine: "- [ ] Task \u{1F4C5} 2026-02-24 #gtd/this-week",
      tags: ["gtd/this-week"],
    });
    const groups = groupTasksIntoBuckets([task], taskSettingsWithTag);
    const thisWeek = groups.find((g) => g.bucketId === "this-week")!;
    expect(thisWeek.tasks).toHaveLength(1);
    expect(thisWeek.autoPlacedTaskIds).not.toContain(task.id);
  });

  it("returns groups in correct order (To Review first)", () => {
    const groups = groupTasksIntoBuckets([], settings);
    expect(groups[0].bucketId).toBe(TO_REVIEW_ID);
    expect(groups[1].bucketId).toBe("today");
  });

  it("readTasksPlugin=false: tasks with dueDate go to To Review (no auto-assign)", () => {
    const settingsNoPlugin = { ...settings, readTasksPlugin: false };
    const task = makeTask({ dueDate: daysFromMonday(1) });
    const groups = groupTasksIntoBuckets([task], settingsNoPlugin);
    const review = groups.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.tasks).toHaveLength(1);
  });
});

describe("subtask inheritance", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    buckets: DEFAULT_BUCKETS,
    storageMode: "inline-tag" as const,
    tagPrefix: "gtd",
  };

  it("subtask without own assignment inherits parent's explicit bucket", () => {
    const parent = makeTask({
      id: "parent",
      rawLine: "- [ ] Parent task #gtd/today",
      tags: ["gtd/today"],
      childIds: ["child"],
      indentLevel: 0,
      parentId: null,
    });
    const child = makeTask({
      id: "child",
      lineNumber: 1,
      indentLevel: 1,
      parentId: "parent",
      childIds: [],
    });
    const groups = groupTasksIntoBuckets([parent, child], settings);
    const todayGroup = groups.find((g) => g.bucketId === "today")!;
    const reviewGroup = groups.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(todayGroup.tasks.map((t) => t.id)).toContain("child");
    expect(reviewGroup.tasks.map((t) => t.id)).not.toContain("child");
  });

  it("subtask inherits parent's auto-placed bucket", () => {
    const parent = makeTask({
      id: "parent",
      dueDate: daysFromMonday(1), // tomorrow → this-week
      childIds: ["child"],
      indentLevel: 0,
      parentId: null,
    });
    const child = makeTask({
      id: "child",
      lineNumber: 1,
      indentLevel: 1,
      parentId: "parent",
      childIds: [],
    });
    const groups = groupTasksIntoBuckets([parent, child], settings);
    const thisWeekGroup = groups.find((g) => g.bucketId === "this-week")!;
    const reviewGroup = groups.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(thisWeekGroup.tasks.map((t) => t.id)).toContain("child");
    expect(reviewGroup.tasks.map((t) => t.id)).not.toContain("child");
  });

  it("subtask with its own explicit assignment stays in its own bucket", () => {
    const parent = makeTask({
      id: "parent",
      rawLine: "- [ ] Parent #gtd/today",
      tags: ["gtd/today"],
      childIds: ["child"],
      indentLevel: 0,
      parentId: null,
    });
    const child = makeTask({
      id: "child",
      rawLine: "  - [ ] Child #gtd/this-week",
      tags: ["gtd/this-week"],
      lineNumber: 1,
      indentLevel: 1,
      parentId: "parent",
      childIds: [],
    });
    const groups = groupTasksIntoBuckets([parent, child], settings);
    const todayGroup = groups.find((g) => g.bucketId === "today")!;
    const thisWeekGroup = groups.find((g) => g.bucketId === "this-week")!;
    expect(todayGroup.tasks.map((t) => t.id)).toContain("parent");
    expect(thisWeekGroup.tasks.map((t) => t.id)).toContain("child");
  });

  it("subtask with no parent assignment follows parent to To Review", () => {
    const parent = makeTask({
      id: "parent",
      childIds: ["child"],
      indentLevel: 0,
      parentId: null,
    });
    const child = makeTask({
      id: "child",
      lineNumber: 1,
      indentLevel: 1,
      parentId: "parent",
      childIds: [],
    });
    const groups = groupTasksIntoBuckets([parent, child], settings);
    const reviewGroup = groups.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(reviewGroup.tasks.map((t) => t.id)).toContain("parent");
    expect(reviewGroup.tasks.map((t) => t.id)).toContain("child");
  });

  it("grandchild inherits through chain when neither child nor grandchild has own assignment", () => {
    const root = makeTask({
      id: "root",
      rawLine: "- [ ] Root #gtd/someday",
      tags: ["gtd/someday"],
      childIds: ["mid"],
      indentLevel: 0,
      parentId: null,
    });
    const mid = makeTask({
      id: "mid",
      lineNumber: 1,
      indentLevel: 1,
      parentId: "root",
      childIds: ["leaf"],
    });
    const leaf = makeTask({
      id: "leaf",
      lineNumber: 2,
      indentLevel: 2,
      parentId: "mid",
      childIds: [],
    });
    const groups = groupTasksIntoBuckets([root, mid, leaf], settings);
    const somedayGroup = groups.find((g) => g.bucketId === "someday")!;
    expect(somedayGroup.tasks.map((t) => t.id)).toContain("root");
    expect(somedayGroup.tasks.map((t) => t.id)).toContain("mid");
    expect(somedayGroup.tasks.map((t) => t.id)).toContain("leaf");
  });
});

describe("date range edge cases", () => {
  it("within-days-range rule assigns tasks in range", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      buckets: [
        {
          id: "custom",
          name: "Custom",
          emoji: "🎯",
          dateRangeRule: { type: "within-days-range" as const, from: 5, to: 10 },
          quickMoveTargets: [] as [string?, string?],
          showInStatusBar: false,
        },
      ],
    };
    const inRange = makeTask({ id: "in", dueDate: daysFromMonday(7) });
    const outOfRange = makeTask({ id: "out", dueDate: daysFromMonday(3) });
    const groups = groupTasksIntoBuckets([inRange, outOfRange], settings);
    const custom = groups.find((g) => g.bucketId === "custom")!;
    const review = groups.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(custom.tasks.map((t) => t.id)).toContain("in");
    expect(review.tasks.map((t) => t.id)).toContain("out");
  });

  it("beyond-days rule assigns tasks past threshold", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      buckets: [
        {
          id: "far",
          name: "Far Future",
          emoji: "🌌",
          dateRangeRule: { type: "beyond-days" as const, days: 30 },
          quickMoveTargets: [] as [string?, string?],
          showInStatusBar: false,
        },
      ],
    };
    const far = makeTask({ id: "far", dueDate: daysFromMonday(60) });
    const near = makeTask({ id: "near", dueDate: daysFromMonday(15) });
    const groups = groupTasksIntoBuckets([far, near], settings);
    expect(groups.find((g) => g.bucketId === "far")!.tasks.map((t) => t.id)).toContain("far");
    expect(groups.find((g) => g.bucketId === TO_REVIEW_ID)!.tasks.map((t) => t.id)).toContain("near");
  });

  it("task with unknown bucket tag goes to To Review", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      storageMode: "inline-tag" as const,
      tagPrefix: "gtd",
    };
    const task = makeTask({
      rawLine: "- [ ] Task #gtd/nonexistent",
      tags: ["gtd/nonexistent"],
    });
    const groups = groupTasksIntoBuckets([task], settings);
    const review = groups.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.tasks).toHaveLength(1);
  });

  it("this-month and this-week: first matching bucket wins", () => {
    const settings = { ...DEFAULT_SETTINGS, buckets: DEFAULT_BUCKETS };
    // daysFromMonday(3) = Thursday, diffDays=3 — matches this-week first (bucket order)
    const task = makeTask({ dueDate: daysFromMonday(3) });
    const groups = groupTasksIntoBuckets([task], settings);
    const thisWeek = groups.find((g) => g.bucketId === "this-week")!;
    expect(thisWeek.tasks).toHaveLength(1);
    const thisMonth = groups.find((g) => g.bucketId === "this-month")!;
    expect(thisMonth.tasks).toHaveLength(0);
  });

  it("completed tasks are still bucketed", () => {
    const settings = { ...DEFAULT_SETTINGS, storageMode: "inline-tag" as const, tagPrefix: "gtd" };
    const task = makeTask({
      rawLine: "- [x] Done #gtd/today",
      tags: ["gtd/today"],
      isCompleted: true,
    });
    const groups = groupTasksIntoBuckets([task], settings);
    const todayGroup = groups.find((g) => g.bucketId === "today")!;
    expect(todayGroup.tasks).toHaveLength(1);
  });

  it("empty task list returns all empty bucket groups", () => {
    const groups = groupTasksIntoBuckets([], DEFAULT_SETTINGS);
    expect(groups.length).toBe(DEFAULT_BUCKETS.length + 1);
    for (const g of groups) {
      expect(g.tasks).toHaveLength(0);
    }
  });
});
