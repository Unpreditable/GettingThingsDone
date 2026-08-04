import { groupTasksIntoBuckets, regroupByHierarchy, TO_REVIEW_ID } from "../src/core/BucketManager";
import { DEFAULT_SETTINGS, DEFAULT_BUCKETS } from "../src/settings";
import type { TaskRecord } from "../src/core/TaskParser";
import { computeOrderKeys } from "../src/core/TaskOrder";
import type { OrderEntry } from "../src/core/TaskOrder";

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

  it("auto-assigns by due date with no toggle to gate it", () => {
    const task = makeTask({ dueDate: daysFromMonday(0) });
    const groups = groupTasksIntoBuckets([task], settings);
    expect(groups.find((g) => g.bucketId === "today")!.tasks).toHaveLength(1);
  });

  it("does not auto-assign into a bucket whose dateRangeRule is null", () => {
    const noRuleBuckets = DEFAULT_BUCKETS.map((b) => ({ ...b, dateRangeRule: null }));
    const task = makeTask({ dueDate: daysFromMonday(0) });

    const groups = groupTasksIntoBuckets([task], { ...settings, buckets: noRuleBuckets });

    expect(groups.find((g) => g.bucketId === TO_REVIEW_ID)!.tasks).toHaveLength(1);
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

describe("groupTasksIntoBuckets manual order", () => {
  const settings = { ...DEFAULT_SETTINGS, buckets: DEFAULT_BUCKETS };

  it("reorders a bucket's tasks per settings.taskOrder", () => {
    const a = makeTask({ id: "a", filePath: "x.md", lineNumber: 0, text: "A" });
    const b = makeTask({ id: "b", filePath: "x.md", lineNumber: 1, text: "B" });
    const c = makeTask({ id: "c", filePath: "x.md", lineNumber: 2, text: "C" });

    const unordered = groupTasksIntoBuckets([a, b, c], settings);
    const review = unordered.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);

    const keys = computeOrderKeys([a, b, c]);
    const withOrder = {
      ...settings,
      taskOrder: { [TO_REVIEW_ID]: [keys.get("c")!, keys.get("a")!, keys.get("b")!] },
    };

    const ordered = groupTasksIntoBuckets([a, b, c], withOrder);
    const reviewOrdered = ordered.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(reviewOrdered.tasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("appends a newly-appearing task after the manually ordered ones", () => {
    const a = makeTask({ id: "a", filePath: "x.md", lineNumber: 0, text: "A" });
    const b = makeTask({ id: "b", filePath: "x.md", lineNumber: 1, text: "B" });

    const keys = computeOrderKeys([a]);
    const withOrder = {
      ...settings,
      taskOrder: { [TO_REVIEW_ID]: [keys.get("a")!] },
    };

    const ordered = groupTasksIntoBuckets([a, b], withOrder);
    const review = ordered.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("keeps a moved parent's auto-inherited children contiguous with it, even though only the parent has a saved position", () => {
    const parent = makeTask({ id: "p", filePath: "x.md", lineNumber: 0, text: "Parent" });
    const child1 = makeTask({ id: "c1", filePath: "x.md", lineNumber: 1, text: "Child 1", parentId: "p" });
    const child2 = makeTask({ id: "c2", filePath: "x.md", lineNumber: 2, text: "Child 2", parentId: "p" });
    parent.childIds = ["c1", "c2"];
    const other = makeTask({ id: "o", filePath: "x.md", lineNumber: 3, text: "Other" });

    // Only the parent has an explicit saved order key (simulating: it was
    // dragged into this bucket, children auto-inherited with no saved
    // position of their own).
    const keys = computeOrderKeys([parent, child1, child2, other]);
    const withOrder = {
      ...settings,
      taskOrder: { [TO_REVIEW_ID]: [keys.get("p")!] },
    };

    const grouped = groupTasksIntoBuckets([other, parent, child1, child2], withOrder);
    const review = grouped.find((g) => g.bucketId === TO_REVIEW_ID)!;

    expect(review.tasks.map((t) => t.id)).toEqual(["p", "c1", "c2", "o"]);
  });
});

describe("regroupByHierarchy", () => {
  it("leaves an already-contiguous list unchanged", () => {
    const parent = makeTask({ id: "p", text: "Parent" });
    const child = makeTask({ id: "c", text: "Child", parentId: "p" });
    parent.childIds = ["c"];

    const result = regroupByHierarchy([parent, child]);

    expect(result.map((t) => t.id)).toEqual(["p", "c"]);
  });

  it("pulls scattered children back to immediately after their parent", () => {
    const parent = makeTask({ id: "p", text: "Parent" });
    const other = makeTask({ id: "o", text: "Other" });
    const child1 = makeTask({ id: "c1", text: "Child 1", parentId: "p" });
    const child2 = makeTask({ id: "c2", text: "Child 2", parentId: "p" });
    parent.childIds = ["c1", "c2"];

    // Simulate a cross-bucket move: parent lands at the top (its saved
    // position), children get appended at the bottom (never had a saved
    // position of their own), with an unrelated task in between.
    const result = regroupByHierarchy([parent, other, child1, child2]);

    expect(result.map((t) => t.id)).toEqual(["p", "c1", "c2", "o"]);
  });

  it("preserves each child-group's own relative order when regrouping", () => {
    const parent = makeTask({ id: "p", text: "Parent" });
    const child1 = makeTask({ id: "c1", text: "Child 1", parentId: "p" });
    const child2 = makeTask({ id: "c2", text: "Child 2", parentId: "p" });
    parent.childIds = ["c1", "c2"];

    // child2 currently sits before child1 (e.g. from their own prior manual
    // reorder) — that relative order must survive being pulled next to parent.
    const result = regroupByHierarchy([child2, parent, child1]);

    expect(result.map((t) => t.id)).toEqual(["p", "c2", "c1"]);
  });

  it("treats a child whose parent is absent (assigned to a different bucket) as its own independent root", () => {
    const other = makeTask({ id: "o", text: "Other" });
    // "child"'s parent is NOT in this list — e.g. the parent lives in a
    // different bucket because this child has its own explicit assignment.
    const child = makeTask({ id: "c", text: "Child", parentId: "missing-parent" });

    const result = regroupByHierarchy([child, other]);

    expect(result.map((t) => t.id)).toEqual(["c", "o"]);
  });

  it("handles multi-level nesting (grandparent -> parent -> child), all contiguous", () => {
    const grandparent = makeTask({ id: "gp", text: "Grandparent" });
    const parent = makeTask({ id: "p", text: "Parent", parentId: "gp" });
    const child = makeTask({ id: "c", text: "Child", parentId: "p" });
    grandparent.childIds = ["p"];
    parent.childIds = ["c"];

    // Scattered: parent and child both separated from grandparent and from
    // each other by an unrelated task.
    const other = makeTask({ id: "o", text: "Other" });
    const result = regroupByHierarchy([grandparent, other, parent, child]);

    expect(result.map((t) => t.id)).toEqual(["gp", "p", "c", "o"]);
  });

  it("keeps multiple independent top-level families contiguous, preserving family order", () => {
    const parentA = makeTask({ id: "pa", text: "Parent A" });
    const childA = makeTask({ id: "ca", text: "Child A", parentId: "pa" });
    parentA.childIds = ["ca"];
    const parentB = makeTask({ id: "pb", text: "Parent B" });
    const childB = makeTask({ id: "cb", text: "Child B", parentId: "pb" });
    parentB.childIds = ["cb"];

    const result = regroupByHierarchy([parentA, parentB, childA, childB]);

    expect(result.map((t) => t.id)).toEqual(["pa", "ca", "pb", "cb"]);
  });
});

describe("groupTasksIntoBuckets performance", () => {
  it("stays fast with thousands of tasks in one large, long-lived file", () => {
    // Models a single daily-note-style file accumulating tasks over months —
    // the scenario where a per-refresh cost that scales with total task
    // count (not file count) would actually be felt.
    const taskCount = 5000;
    const tasks: TaskRecord[] = [];

    for (let i = 0; i < taskCount; i++) {
      const isParent = i % 20 === 0;
      const isChild = i % 20 === 1;
      tasks.push(
        makeTask({
          id: `t${i}`,
          filePath: "big-daily-note.md",
          lineNumber: i,
          text: `Task ${i}`,
          isCompleted: i % 3 === 0,
          parentId: isChild ? `t${i - 1}` : null,
          childIds: isParent ? [`t${i + 1}`] : [],
        })
      );
    }

    const bigSettings = {
      ...DEFAULT_SETTINGS,
      buckets: DEFAULT_BUCKETS,
      taskOrder: {} as Record<string, OrderEntry[]>,
    };
    const orderKeys = computeOrderKeys(tasks);
    // A long-lived file accumulates a large manual order over months of use.
    bigSettings.taskOrder[TO_REVIEW_ID] = tasks
      .slice(0, 1000)
      .map((t) => orderKeys.get(t.id)!)
      .reverse();

    const start = performance.now();
    const result = groupTasksIntoBuckets(tasks, bigSettings);
    const elapsed = performance.now() - start;

    expect(result.find((g) => g.bucketId === TO_REVIEW_ID)?.tasks.length).toBe(taskCount);
    // Generous threshold — this guards against an accidental quadratic-time
    // regression (e.g. an O(n^2) lookup creeping into regroupByHierarchy or
    // applyManualOrder), not a tight budget tuned to one specific machine.
    expect(elapsed).toBeLessThan(500);
  });
});
