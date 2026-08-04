import { purgeAgedEntries, reconcileDanglingEntries } from "../src/core/OrderPurge";
import { computeOrderKeys } from "../src/core/TaskOrder";
import type { OrderState } from "../src/core/OrderMigration";
import type { TaskRecord } from "../src/core/TaskParser";

const NOW = new Date("2026-08-02T14:00:00");
const TODAY_MIDNIGHT = new Date("2026-08-02T00:00:00").getTime();
const YESTERDAY = new Date("2026-08-01T23:00:00").getTime();

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

function entryFor(task: TaskRecord, tasks: TaskRecord[]) {
  return computeOrderKeys(tasks).get(task.id)!;
}

function state(partial: Partial<OrderState> = {}): OrderState {
  return { taskOrder: {}, completionSeen: {}, ...partial };
}

describe("purgeAgedEntries", () => {
  it("keeps an open task's entry", () => {
    const task = makeTask({ id: "a", text: "Open" });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [task],
      NOW
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([entry]);
  });

  it("keeps a task whose completion this session witnessed", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: new Date(TODAY_MIDNIGHT) });
    const entry = entryFor(task, [task]);

    const { state: after } = purgeAgedEntries(
      state({
        taskOrder: { today: [entry] },
        completionSeen: { [`a.md::${entry.key}`]: TODAY_MIDNIGHT + 1000 },
      }),
      [task],
      NOW
    );

    expect(after.taskOrder.today).toEqual([entry]);
  });

  it("purges a ✅-dated task this session never witnessed (a reload dropped the record)", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: new Date(TODAY_MIDNIGHT) });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [task],
      NOW
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([]);
  });

  it("purges a task completed before today (✅ date is yesterday)", () => {
    const task = makeTask({
      id: "a",
      text: "Done",
      isCompleted: true,
      completedAt: new Date("2026-08-01T00:00:00"),
    });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [task],
      NOW
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([]);
  });

  it("keeps a dateless completion witnessed today via completionSeen", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: null });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({
        taskOrder: { today: [entry] },
        completionSeen: { [`a.md::${entry.key}`]: TODAY_MIDNIGHT + 1000 },
      }),
      [task],
      NOW
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([entry]);
  });

  it("purges a dateless completion with no record at all (unwitnessed → aged)", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: null });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [task],
      NOW
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([]);
  });

  it("keeps an entry whose task is not in the index (never purge on a partial view)", () => {
    const entry = { file: "unloaded.md", key: "k:0" };

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [],
      NOW
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([entry]);
  });

  it("drops completionSeen records older than today", () => {
    const { state: after, changed } = purgeAgedEntries(
      state({ completionSeen: { "a.md::old:0": YESTERDAY, "a.md::new:0": TODAY_MIDNIGHT } }),
      [],
      NOW
    );

    expect(changed).toBe(true);
    expect(after.completionSeen).toEqual({ "a.md::new:0": TODAY_MIDNIGHT });
  });

  it("leaves legacy flat-string entries untouched", () => {
    const before = state({ taskOrder: { today: ["legacy:0" as unknown as never] } });

    const { state: after, changed } = purgeAgedEntries(before, [], NOW);

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual(["legacy:0"]);
  });
});

describe("reconcileDanglingEntries", () => {
  const always = () => true;
  const never = () => false;

  it("purges an entry whose file no longer exists", () => {
    const entry = { file: "gone.md", key: "k:0" };

    const { state: after, changed } = reconcileDanglingEntries(
      state({ taskOrder: { today: [entry] }, completionSeen: { "gone.md::k:0": 1 } }),
      [],
      never,
      always
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([]);
    expect(after.completionSeen).toEqual({});
  });

  it("purges an entry whose file is in scope and fully parsed but contains no match", () => {
    const task = makeTask({ id: "a", filePath: "a.md", text: "Still here" });
    const stale = { file: "a.md", key: "gone:0" };

    const { state: after, changed } = reconcileDanglingEntries(
      state({ taskOrder: { today: [entryFor(task, [task]), stale] } }),
      [task],
      always,
      always
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([entryFor(task, [task])]);
  });

  it("keeps an out-of-scope entry dormant — narrowing scope is not deletion", () => {
    const entry = { file: "excluded.md", key: "k:0" };

    const { state: after, changed } = reconcileDanglingEntries(
      state({ taskOrder: { today: [entry] }, completionSeen: { "excluded.md::k:0": 1 } }),
      [],
      always,
      never
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([entry]);
    expect(after.completionSeen).toEqual({ "excluded.md::k:0": 1 });
  });

  it("still purges a dormant out-of-scope entry once its file is truly deleted", () => {
    const entry = { file: "excluded.md", key: "k:0" };

    const { state: after } = reconcileDanglingEntries(
      state({ taskOrder: { today: [entry] } }),
      [],
      never,
      never
    );

    expect(after.taskOrder.today).toEqual([]);
  });

  it("leaves legacy flat-string entries untouched", () => {
    const before = state({ taskOrder: { today: ["legacy:0" as unknown as never] } });

    const { state: after, changed } = reconcileDanglingEntries(before, [], never, always);

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual(["legacy:0"]);
  });
});
