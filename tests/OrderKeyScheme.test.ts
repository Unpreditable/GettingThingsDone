import { computeOrderKeys, entryId } from "../src/core/TaskOrder";
import { migrateOrderKeys } from "../src/core/OrderMigration";
import type { OrderState } from "../src/core/OrderMigration";
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

const withBothDates = makeTask({
  id: "a",
  text: "Pay the bill",
  dueDate: new Date(2026, 8, 1),
  scheduledDate: new Date(2026, 7, 25),
});

const scheduledMovedLater = makeTask({
  ...withBothDates,
  id: "a2",
  scheduledDate: new Date(2026, 7, 28),
});

function key(task: TaskRecord, scheme: Parameters<typeof computeOrderKeys>[1]): string {
  return computeOrderKeys([task], scheme).get(task.id)!.key;
}

describe("order keys hash the planning date", () => {
  it("ignores an edit to a date the active mode does not plan by", () => {
    expect(key(scheduledMovedLater, "due-only")).toBe(key(withBothDates, "due-only"));
  });

  it("changes when the date the active mode plans by moves", () => {
    expect(key(scheduledMovedLater, "scheduled-first")).not.toBe(
      key(withBothDates, "scheduled-first")
    );
  });

  it("gives one task different keys under modes that pick different dates", () => {
    expect(key(withBothDates, "due-only")).not.toBe(key(withBothDates, "scheduled-only"));
  });

  it("still re-keys on any date edit under the pre-release dual-date scheme", () => {
    expect(key(scheduledMovedLater, "dual-date")).not.toBe(key(withBothDates, "dual-date"));
  });

  it("falls back to text alone when the mode yields no planning date", () => {
    const noDates = makeTask({ id: "b", text: "Pay the bill" });

    expect(key(withBothDates, "manual")).toBe(key(noDates, "manual"));
  });
});

describe("migrateOrderKeys", () => {
  const tasks = [withBothDates];

  function stateWith(scheme: Parameters<typeof computeOrderKeys>[1]): OrderState {
    const entry = computeOrderKeys(tasks, scheme).get("a")!;
    return { taskOrder: { today: [entry] }, completionSeen: { [entryId(entry)]: 123 } };
  }

  it("rewrites saved entries into the new scheme", () => {
    const expected = computeOrderKeys(tasks, "scheduled-first").get("a")!;

    const { state, changed } = migrateOrderKeys(
      stateWith("dual-date"),
      tasks,
      "dual-date",
      "scheduled-first"
    );

    expect(changed).toBe(true);
    expect(state.taskOrder.today).toEqual([expected]);
  });

  it("carries completionSeen across with the entry", () => {
    const expected = computeOrderKeys(tasks, "scheduled-first").get("a")!;

    const { state } = migrateOrderKeys(
      stateWith("dual-date"),
      tasks,
      "dual-date",
      "scheduled-first"
    );

    expect(state.completionSeen).toEqual({ [entryId(expected)]: 123 });
  });

  it("reports no change when the scheme is unchanged", () => {
    const before = stateWith("scheduled-first");

    const { state, changed } = migrateOrderKeys(before, tasks, "scheduled-first", "scheduled-first");

    expect(changed).toBe(false);
    expect(state).toEqual(before);
  });

  it("keeps an entry it cannot map, rather than dropping a dormant position", () => {
    // An out-of-scope file's entries survive on purpose: narrowing scope is
    // reversible and must never read as a deletion.
    const dormant = { file: "out-of-scope.md", key: "999:0" };
    const before: OrderState = { taskOrder: { today: [dormant] }, completionSeen: {} };

    const { state } = migrateOrderKeys(before, tasks, "dual-date", "scheduled-first");

    expect(state.taskOrder.today).toEqual([dormant]);
  });

  it("preserves bucket keys with nothing to migrate", () => {
    const { state } = migrateOrderKeys(
      { taskOrder: { today: [], someday: [] }, completionSeen: {} },
      tasks,
      "dual-date",
      "due-only"
    );

    expect(state.taskOrder).toEqual({ today: [], someday: [] });
  });
});
