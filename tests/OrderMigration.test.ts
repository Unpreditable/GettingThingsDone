import { diffFileTasks, applyTaskDiff, renameFileInState, migrateOrderFormat } from "../src/core/OrderMigration";
import type { OrderState } from "../src/core/OrderMigration";
import { computeOrderKeys, computeLegacyOrderKeys } from "../src/core/TaskOrder";
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
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...overrides,
  };
}

function keyOf(task: TaskRecord): string {
  return computeOrderKeys([task]).get(task.id)!.key;
}

describe("diffFileTasks", () => {
  it("reports nothing when the file is unchanged (tier 1)", () => {
    const task = makeTask({ id: "a", text: "Buy milk" });

    expect(diffFileTasks([task], [task])).toEqual({
      rekeys: [],
      completedWithoutDate: [],
      reopened: [],
    });
  });

  it("pairs an in-place text edit by line number (tier 2)", () => {
    const before = makeTask({ id: "a", lineNumber: 3, text: "Buy milk" });
    const after = makeTask({ id: "a2", lineNumber: 3, text: "Buy oat milk" });

    const diff = diffFileTasks([before], [after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("pairs an in-place due-date edit by line number (tier 2)", () => {
    const before = makeTask({ id: "a", lineNumber: 0, text: "Ship it", dueDate: new Date("2026-08-01") });
    const after = makeTask({ id: "a2", lineNumber: 0, text: "Ship it", dueDate: new Date("2026-08-09") });

    const diff = diffFileTasks([before], [after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("does not pair an unchanged task's line-mate (tier 1 wins before tier 2)", () => {
    const keep = makeTask({ id: "k", lineNumber: 0, text: "Keep" });
    const before = makeTask({ id: "a", lineNumber: 1, text: "Old" });
    const after = makeTask({ id: "a2", lineNumber: 1, text: "New" });

    const diff = diffFileTasks([keep, before], [keep, after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("pairs a sole leftover on each side even when the line number moved (tier 3)", () => {
    const before = makeTask({ id: "a", lineNumber: 1, text: "Buy milk" });
    const after = makeTask({ id: "a2", lineNumber: 7, text: "Buy oat milk" });

    const diff = diffFileTasks([before], [after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("degrades to add/delete when two unmatched tasks on each side are ambiguous", () => {
    const oldA = makeTask({ id: "a", lineNumber: 0, text: "Old A" });
    const oldB = makeTask({ id: "b", lineNumber: 1, text: "Old B" });
    const newA = makeTask({ id: "c", lineNumber: 5, text: "New A" });
    const newB = makeTask({ id: "d", lineNumber: 9, text: "New B" });

    const diff = diffFileTasks([oldA, oldB], [newA, newB]);

    expect(diff.rekeys).toEqual([]);
  });

  it("treats a pure addition as new, with no rekey", () => {
    const existing = makeTask({ id: "a", lineNumber: 0, text: "Existing" });
    const added = makeTask({ id: "b", lineNumber: 1, text: "Added" });

    expect(diffFileTasks([existing], [existing, added]).rekeys).toEqual([]);
  });

  it("treats a pure deletion as gone, with no rekey", () => {
    const kept = makeTask({ id: "a", lineNumber: 0, text: "Kept" });
    const removed = makeTask({ id: "b", lineNumber: 1, text: "Removed" });

    expect(diffFileTasks([kept, removed], [kept]).rekeys).toEqual([]);
  });

  it("records a dateless open → completed transition", () => {
    const before = makeTask({ id: "a", text: "Foo", isCompleted: false });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });

    const diff = diffFileTasks([before], [after]);

    expect(diff.completedWithoutDate).toEqual([keyOf(after)]);
    expect(diff.reopened).toEqual([]);
  });

  it("records nothing when the completed line carries a ✅ date", () => {
    const before = makeTask({ id: "a", text: "Foo", isCompleted: false });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: new Date("2026-08-02") });

    expect(diffFileTasks([before], [after]).completedWithoutDate).toEqual([]);
  });

  it("records a completed → open transition", () => {
    const before = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: false });

    const diff = diffFileTasks([before], [after]);

    expect(diff.reopened).toEqual([keyOf(after)]);
    expect(diff.completedWithoutDate).toEqual([]);
  });

  it("records a completion transition on a paired edit, under the NEW key", () => {
    const before = makeTask({ id: "a", lineNumber: 2, text: "Old text", isCompleted: false });
    const after = makeTask({ id: "b", lineNumber: 2, text: "New text", isCompleted: true, completedAt: null });

    const diff = diffFileTasks([before], [after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
    expect(diff.completedWithoutDate).toEqual([keyOf(after)]);
  });

  it("does not record a completion for a task that was already completed when first seen", () => {
    const done = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });

    expect(diffFileTasks([], [done]).completedWithoutDate).toEqual([]);
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
      { rekeys: [{ from: "old:0", to: "new:0" }], completedWithoutDate: [], reopened: [] },
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
      { rekeys: [{ from: "old:0", to: "new:0" }], completedWithoutDate: [], reopened: [] },
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
      { rekeys: [{ from: "old:0", to: "new:0" }], completedWithoutDate: [], reopened: [] },
      NOW
    );

    expect(after.completionSeen).toEqual({ "a.md::new:0": 555 });
  });

  it("records `now` for a witnessed dateless completion", () => {
    const { state: after, changed } = applyTaskDiff(
      state(),
      "a.md",
      { rekeys: [], completedWithoutDate: ["k:0"], reopened: [] },
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
      { rekeys: [], completedWithoutDate: [], reopened: ["k:0"] },
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
      { rekeys: [], completedWithoutDate: [], reopened: [] },
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
      { rekeys: [{ from: "legacy:0", to: "new:0" }], completedWithoutDate: [], reopened: [] },
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

describe("migrateOrderFormat", () => {
  const taskA = makeTask({ id: "a", filePath: "a.md", lineNumber: 0, text: "Alpha" });
  const taskB = makeTask({ id: "b", filePath: "a.md", lineNumber: 1, text: "Beta" });
  const tasks = [taskA, taskB];

  function legacyKey(task: TaskRecord): string {
    return computeLegacyOrderKeys(tasks).get(task.id)!;
  }

  function entryFor(task: TaskRecord) {
    return computeOrderKeys(tasks).get(task.id)!;
  }

  it("rewrites matching flat keys to structured entries at the same positions", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [legacyKey(taskB), legacyKey(taskA)] },
      tasks
    );

    expect(changed).toBe(true);
    expect(taskOrder.today).toEqual([entryFor(taskB), entryFor(taskA)]);
  });

  it("drops flat keys that match no task in the vault", () => {
    const { taskOrder } = migrateOrderFormat(
      { today: ["9999999:0", legacyKey(taskA)] },
      tasks
    );

    expect(taskOrder.today).toEqual([entryFor(taskA)]);
  });

  it("leaves already-migrated entries untouched and reports changed: false", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [entryFor(taskA), entryFor(taskB)] },
      tasks
    );

    expect(changed).toBe(false);
    expect(taskOrder.today).toEqual([entryFor(taskA), entryFor(taskB)]);
  });

  it("handles a mixed bucket, migrating only the flat keys", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [entryFor(taskA), legacyKey(taskB)] },
      tasks
    );

    expect(changed).toBe(true);
    expect(taskOrder.today).toEqual([entryFor(taskA), entryFor(taskB)]);
  });

  it("preserves empty buckets", () => {
    const { taskOrder } = migrateOrderFormat({ today: [], someday: [] }, tasks);
    expect(taskOrder).toEqual({ today: [], someday: [] });
  });
});
