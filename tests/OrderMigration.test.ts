import { diffFileTasks, diffForEdit, applyTaskDiff, renameFileInState, migrateOrderFormat } from "../src/core/OrderMigration";
import type { OrderState } from "../src/core/OrderMigration";
import { computeOrderKeys, computeLegacyOrderKeys } from "../src/core/TaskOrder";
import { parseFile } from "../src/core/TaskParser";
import type { TaskRecord } from "../src/core/TaskParser";

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "1",
    filePath: "a.md",
    lineNumber: 0,
    rawLine: "- [ ] Test task",
    text: "Test task",
    isCompleted: false,
    completedAt: null,
    dueDate: null,
    priority: null,
    recurrence: null,
    scheduledDate: null,
    startDate: null,
    createdDate: null,
    cancelledDate: null,
    onCompletion: null,
    blockId: null,
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...overrides,
  };
}

function keyOf(task: TaskRecord): string {
  return computeOrderKeys([task], "due-only").get(task.id)!.key;
}

describe("diffFileTasks", () => {
  it("reports nothing when the file is unchanged (tier 1)", () => {
    const task = makeTask({ id: "a", text: "Buy milk" });

    expect(diffFileTasks([task], [task], "due-only")).toEqual({
      rekeys: [],
      completed: [],
      reopened: [],
    });
  });

  it("pairs an in-place text edit by line number (tier 2)", () => {
    const before = makeTask({ id: "a", lineNumber: 3, text: "Buy milk" });
    const after = makeTask({ id: "a2", lineNumber: 3, text: "Buy oat milk" });

    const diff = diffFileTasks([before], [after], "due-only");

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("pairs an in-place due-date edit by line number (tier 2)", () => {
    const before = makeTask({ id: "a", lineNumber: 0, text: "Ship it", dueDate: new Date("2026-08-01") });
    const after = makeTask({ id: "a2", lineNumber: 0, text: "Ship it", dueDate: new Date("2026-08-09") });

    const diff = diffFileTasks([before], [after], "due-only");

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("does not pair an unchanged task's line-mate (tier 1 wins before tier 2)", () => {
    const keep = makeTask({ id: "k", lineNumber: 0, text: "Keep" });
    const before = makeTask({ id: "a", lineNumber: 1, text: "Old" });
    const after = makeTask({ id: "a2", lineNumber: 1, text: "New" });

    const diff = diffFileTasks([keep, before], [keep, after], "due-only");

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("pairs a sole leftover on each side even when the line number moved (tier 3)", () => {
    const before = makeTask({ id: "a", lineNumber: 1, text: "Buy milk" });
    const after = makeTask({ id: "a2", lineNumber: 7, text: "Buy oat milk" });

    const diff = diffFileTasks([before], [after], "due-only");

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("degrades to add/delete when two unmatched tasks on each side are ambiguous", () => {
    const oldA = makeTask({ id: "a", lineNumber: 0, text: "Old A" });
    const oldB = makeTask({ id: "b", lineNumber: 1, text: "Old B" });
    const newA = makeTask({ id: "c", lineNumber: 5, text: "New A" });
    const newB = makeTask({ id: "d", lineNumber: 9, text: "New B" });

    const diff = diffFileTasks([oldA, oldB], [newA, newB], "due-only");

    expect(diff.rekeys).toEqual([]);
  });

  it("treats a pure addition as new, with no rekey", () => {
    const existing = makeTask({ id: "a", lineNumber: 0, text: "Existing" });
    const added = makeTask({ id: "b", lineNumber: 1, text: "Added" });

    expect(diffFileTasks([existing], [existing, added], "due-only").rekeys).toEqual([]);
  });

  it("treats a pure deletion as gone, with no rekey", () => {
    const kept = makeTask({ id: "a", lineNumber: 0, text: "Kept" });
    const removed = makeTask({ id: "b", lineNumber: 1, text: "Removed" });

    expect(diffFileTasks([kept, removed], [kept], "due-only").rekeys).toEqual([]);
  });

  it("records a dateless open → completed transition", () => {
    const before = makeTask({ id: "a", text: "Foo", isCompleted: false });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });

    const diff = diffFileTasks([before], [after], "due-only");

    expect(diff.completed).toEqual([keyOf(after)]);
    expect(diff.reopened).toEqual([]);
  });

  it("records the transition even when the completed line carries a ✅ date", () => {
    // Visibility keys off "did this session watch it happen", not the date,
    // so a dated completion needs a record just as much as a dateless one.
    const before = makeTask({ id: "a", text: "Foo", isCompleted: false });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: new Date("2026-08-02") });

    expect(diffFileTasks([before], [after], "due-only").completed).toEqual([keyOf(after)]);
  });

  it("records a completed → open transition", () => {
    const before = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: false });

    const diff = diffFileTasks([before], [after], "due-only");

    expect(diff.reopened).toEqual([keyOf(after)]);
    expect(diff.completed).toEqual([]);
  });

  it("records a completion transition on a paired edit, under the NEW key", () => {
    const before = makeTask({ id: "a", lineNumber: 2, text: "Old text", isCompleted: false });
    const after = makeTask({ id: "b", lineNumber: 2, text: "New text", isCompleted: true, completedAt: null });

    const diff = diffFileTasks([before], [after], "due-only");

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
    expect(diff.completed).toEqual([keyOf(after)]);
  });

  it("does not record a completion for a task that was already completed when first seen", () => {
    const done = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });

    expect(diffFileTasks([], [done], "due-only").completed).toEqual([]);
  });
});

const NOW = 1_800_000_000_000;

function state(partial: Partial<OrderState> = {}): OrderState {
  return { taskOrder: {}, completionSeen: {}, ...partial };
}

describe("applyTaskDiff", () => {
  it("rewrites a rekeyed entry in place, keeping its position", () => {
    const before = state({
      taskOrder: {
        today: [
          { file: "a.md", key: "k1:0" },
          { file: "a.md", key: "old:0" },
          { file: "a.md", key: "k3:0" },
        ],
      },
    });

    const { state: after, changed } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [{ from: "old:0", to: "new:0" }], completed: [], reopened: [] },
      NOW
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([
      { file: "a.md", key: "k1:0" },
      { file: "a.md", key: "new:0" },
      { file: "a.md", key: "k3:0" },
    ]);
  });

  it("leaves a same-key entry belonging to a different file alone", () => {
    const before = state({ taskOrder: { today: [{ file: "b.md", key: "old:0" }] } });

    const { state: after, changed } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [{ from: "old:0", to: "new:0" }], completed: [], reopened: [] },
      NOW
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([{ file: "b.md", key: "old:0" }]);
  });

  it("moves a completionSeen record onto the new key", () => {
    const before = state({ completionSeen: { "a.md::old:0": 555 } });

    const { state: after } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [{ from: "old:0", to: "new:0" }], completed: [], reopened: [] },
      NOW
    );

    expect(after.completionSeen).toEqual({ "a.md::new:0": 555 });
  });

  it("records `now` for a witnessed dateless completion", () => {
    const { state: after, changed } = applyTaskDiff(
      state(),
      "a.md",
      { rekeys: [], completed: ["k:0"], reopened: [] },
      NOW
    );

    expect(changed).toBe(true);
    expect(after.completionSeen).toEqual({ "a.md::k:0": NOW });
  });

  it("deletes the record when a task is reopened", () => {
    const before = state({ completionSeen: { "a.md::k:0": 555 } });

    const { state: after, changed } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [], completed: [], reopened: ["k:0"] },
      NOW
    );

    expect(changed).toBe(true);
    expect(after.completionSeen).toEqual({});
  });

  it("reports changed: false for an empty diff and does not mutate the input", () => {
    const before = state({
      taskOrder: { today: [{ file: "a.md", key: "k:0" }] },
      completionSeen: { "a.md::k:0": 1 },
    });

    const { changed } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [], completed: [], reopened: [] },
      NOW
    );

    expect(changed).toBe(false);
    expect(before.taskOrder.today).toEqual([{ file: "a.md", key: "k:0" }]);
    expect(before.completionSeen).toEqual({ "a.md::k:0": 1 });
  });

  it("leaves legacy flat-string entries untouched", () => {
    const before = state({ taskOrder: { today: ["legacy:0" as unknown as never] } });

    const { state: after } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [{ from: "legacy:0", to: "new:0" }], completed: [], reopened: [] },
      NOW
    );

    expect(after.taskOrder.today).toEqual(["legacy:0"]);
  });
});

describe("renameFileInState", () => {
  it("rewrites the file field of the renamed file's entries, keeping positions", () => {
    const before = state({
      taskOrder: {
        today: [
          { file: "old.md", key: "k1:0" },
          { file: "other.md", key: "k2:0" },
          { file: "old.md", key: "k3:0" },
        ],
      },
    });

    const { state: after, changed } = renameFileInState(before, "old.md", "new.md");

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([
      { file: "new.md", key: "k1:0" },
      { file: "other.md", key: "k2:0" },
      { file: "new.md", key: "k3:0" },
    ]);
  });

  it("rewrites completionSeen keys for the renamed file only", () => {
    const before = state({
      completionSeen: { "old.md::k:0": 1, "other.md::k:0": 2 },
    });

    const { state: after } = renameFileInState(before, "old.md", "new.md");

    expect(after.completionSeen).toEqual({ "new.md::k:0": 1, "other.md::k:0": 2 });
  });

  it("reports changed: false when the renamed file has no saved order", () => {
    const before = state({ taskOrder: { today: [{ file: "other.md", key: "k:0" }] } });

    expect(renameFileInState(before, "old.md", "new.md").changed).toBe(false);
  });
});

describe("legacy key format (pinned against the shipped pre-upgrade build)", () => {
  // These strings were produced by actually RUNNING computeOrderKeys from
  // commit 6e21fac — the last build before structured entries — not by
  // re-deriving them from computeLegacyOrderKeys. Without this pin, the
  // migration tests below would only prove we are self-consistent: a wrong
  // transcription of the old format would pass every one of them and still
  // orphan every real user's saved order on upgrade.
  const REAL_LEGACY_KEYS: Array<[string, string, string | null, string]> = [
    ["Inbox.md", "Buy milk", null, "2078015980:0"],
    ["Inbox.md", "Buy milk", null, "2078015980:1"],
    ["Inbox.md", "Call Bob", "2026-08-09T00:00:00Z", "1757815861:0"],
    ["Work/Notes.md", "Buy milk", null, "1301982511:0"],
    ["Work/Notes.md", "Ship it", null, "1812805701:0"],
  ];

  it("computeLegacyOrderKeys reproduces the shipped format exactly", () => {
    const tasks = REAL_LEGACY_KEYS.map(([filePath, text, due], i) =>
      makeTask({
        id: `t${i}`,
        filePath,
        lineNumber: i,
        text,
        dueDate: due ? new Date(due) : null,
      })
    );

    const produced = computeLegacyOrderKeys(tasks);

    expect(REAL_LEGACY_KEYS.map((_, i) => produced.get(`t${i}`))).toEqual(
      REAL_LEGACY_KEYS.map(([, , , key]) => key)
    );
  });

  it("migrates those real keys onto the right tasks", () => {
    const tasks = REAL_LEGACY_KEYS.map(([filePath, text, due], i) =>
      makeTask({
        id: `t${i}`,
        filePath,
        lineNumber: i,
        text,
        dueDate: due ? new Date(due) : null,
      })
    );
    // A saved order in the old format, deliberately not in file order.
    const savedOrder = ["1812805701:0", "2078015980:1", "1757815861:0"];

    const { taskOrder, changed } = migrateOrderFormat({ today: savedOrder }, tasks, "due-only");
    const current = computeOrderKeys(tasks, "due-only");

    expect(changed).toBe(true);
    expect(taskOrder.today).toEqual([
      current.get("t4"), // Ship it, Work/Notes.md
      current.get("t1"), // the SECOND "Buy milk" in Inbox.md
      current.get("t2"), // Call Bob
    ]);
  });
});

describe("migrateOrderFormat", () => {
  const taskA = makeTask({ id: "a", filePath: "a.md", lineNumber: 0, text: "Alpha" });
  const taskB = makeTask({ id: "b", filePath: "a.md", lineNumber: 1, text: "Beta" });
  const tasks = [taskA, taskB];

  function legacyKey(task: TaskRecord): string {
    return computeLegacyOrderKeys(tasks).get(task.id)!;
  }

  function entryFor(task: TaskRecord) {
    return computeOrderKeys(tasks, "due-only").get(task.id)!;
  }

  it("rewrites matching flat keys to structured entries at the same positions", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [legacyKey(taskB), legacyKey(taskA)] },
      tasks,
      "due-only"
    );

    expect(changed).toBe(true);
    expect(taskOrder.today).toEqual([entryFor(taskB), entryFor(taskA)]);
  });

  it("drops flat keys that match no task in the vault", () => {
    const { taskOrder } = migrateOrderFormat(
      { today: ["9999999:0", legacyKey(taskA)] },
      tasks,
      "due-only"
    );

    expect(taskOrder.today).toEqual([entryFor(taskA)]);
  });

  it("leaves already-migrated entries untouched and reports changed: false", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [entryFor(taskA), entryFor(taskB)] },
      tasks,
      "due-only"
    );

    expect(changed).toBe(false);
    expect(taskOrder.today).toEqual([entryFor(taskA), entryFor(taskB)]);
  });

  it("handles a mixed bucket, migrating only the flat keys", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [entryFor(taskA), legacyKey(taskB)] },
      tasks,
      "due-only"
    );

    expect(changed).toBe(true);
    expect(taskOrder.today).toEqual([entryFor(taskA), entryFor(taskB)]);
  });

  it("preserves empty buckets", () => {
    const { taskOrder } = migrateOrderFormat({ today: [], someday: [] }, tasks, "due-only");
    expect(taskOrder).toEqual({ today: [], someday: [] });
  });
});

describe("diffForEdit", () => {
  const keyAt = (tasks: TaskRecord[], line: number) =>
    computeOrderKeys(tasks, "due-only").get(tasks.find((t) => t.lineNumber === line)!.id)!.key;

  it("rekeys an edited line from its old key to its new one", () => {
    const before = parseFile("a.md", "- [ ] First\n- [ ] Buy milk\n- [ ] Last");
    const after = parseFile("a.md", "- [ ] First\n- [ ] Buy oat milk 📅 2026-10-01\n- [ ] Last");

    expect(diffForEdit(before, after, 1, 1, "due-only")).toEqual({
      rekeys: [{ from: keyAt(before, 1), to: keyAt(after, 1) }],
      completed: [],
      reopened: [],
    });
  });

  it("records a completion made in the modal", () => {
    const before = parseFile("a.md", "- [ ] Buy milk");
    const after = parseFile("a.md", "- [x] Buy milk ✅ 2026-09-27");

    const diff = diffForEdit(before, after, 0, 1, "due-only");

    expect(diff.completed).toEqual([keyAt(after, 0)]);
    expect(diff.reopened).toEqual([]);
  });

  it("records a reopen made in the modal", () => {
    const before = parseFile("a.md", "- [x] Buy milk ✅ 2026-09-27");
    const after = parseFile("a.md", "- [ ] Buy milk");

    expect(diffForEdit(before, after, 0, 1, "due-only").reopened).toEqual([keyAt(after, 0)]);
  });

  it("hands the position to the open occurrence when it comes back above the completed one", () => {
    const before = parseFile("a.md", "- [ ] Water plants 🔁 every week 📅 2026-09-24");
    const after = parseFile(
      "a.md",
      "- [ ] Water plants 🔁 every week 📅 2026-10-01\n- [x] Water plants 🔁 every week 📅 2026-09-24 ✅ 2026-09-27"
    );

    expect(diffForEdit(before, after, 0, 2, "due-only")).toEqual({
      rekeys: [{ from: keyAt(before, 0), to: keyAt(after, 0) }],
      completed: [],
      reopened: [],
    });
  });

  it("hands the position to the open occurrence when it comes back below the completed one", () => {
    const before = parseFile("a.md", "- [ ] Water plants 🔁 every week 📅 2026-09-24");
    const after = parseFile(
      "a.md",
      "- [x] Water plants 🔁 every week 📅 2026-09-24 ✅ 2026-09-27\n- [ ] Water plants 🔁 every week 📅 2026-10-01"
    );

    expect(diffForEdit(before, after, 0, 2, "due-only").rekeys).toEqual([
      { from: keyAt(before, 0), to: keyAt(after, 1) },
    ]);
  });

  it("leaves the other tasks in the file out of the diff", () => {
    const before = parseFile("a.md", "- [ ] Buy milk\n- [ ] Call Bob");
    const after = parseFile("a.md", "- [ ] Buy oat milk\n- [ ] Call Bob");

    const diff = diffForEdit(before, after, 0, 1, "due-only");

    expect(diff.rekeys.map((r) => r.from)).toEqual([keyAt(before, 0)]);
  });

  it("reports nothing when the edit leaves the key unchanged", () => {
    const before = parseFile("a.md", "- [ ] Buy milk");
    const after = parseFile("a.md", "- [ ] Buy milk #gtd/today");

    expect(diffForEdit(before, after, 0, 1, "due-only")).toEqual({
      rekeys: [],
      completed: [],
      reopened: [],
    });
  });
});
