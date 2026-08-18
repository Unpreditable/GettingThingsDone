import { applyManualOrder, computeOrderKeys, computeArrivalRanks } from "../src/core/TaskOrder";
import type { OrderEntry } from "../src/core/TaskOrder";
import type { TaskRecord } from "../src/core/TaskParser";

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

/** A task whose id doubles as its visible text, so order keys stay distinct. */
function dated(id: string, lineNumber: number, day: number | null): TaskRecord {
  return makeTask({
    id,
    text: id,
    lineNumber,
    scheduledDate: day === null ? null : new Date(2026, 7, day),
  });
}

function ids(tasks: TaskRecord[]): string[] {
  return tasks.map((t) => t.id);
}

function entriesFor(tasks: TaskRecord[]): Map<string, OrderEntry> {
  return computeOrderKeys(tasks, "scheduled-first");
}

/** The saved-order array a drag would have written for `tasks`, in that order. */
function savedFor(tasks: TaskRecord[], all: TaskRecord[]): OrderEntry[] {
  const entries = entriesFor(all);
  return tasks.map((t) => entries.get(t.id)!);
}

describe("applyManualOrder — merging arrivals by planning date", () => {
  it("orders a never-dragged bucket purely by planning date", () => {
    const tasks = [dated("a", 0, 21), dated("b", 1, 18), dated("c", 2, 23)];

    const result = applyManualOrder(tasks, entriesFor(tasks), [], "scheduled-first");

    expect(ids(result)).toEqual(["b", "a", "c"]);
  });

  it("breaks a same-date tie with file order when nothing ranks the arrivals", () => {
    const tasks = [dated("a", 0, 21), dated("b", 1, 18), dated("c", 2, 18)];

    const result = applyManualOrder(tasks, entriesFor(tasks), [], "scheduled-first");

    expect(ids(result)).toEqual(["b", "c", "a"]);
  });

  it("puts undated tasks after every dated one", () => {
    const tasks = [dated("a", 0, null), dated("b", 1, 23), dated("c", 2, 18)];

    const result = applyManualOrder(tasks, entriesFor(tasks), [], "scheduled-first");

    expect(ids(result)).toEqual(["c", "b", "a"]);
  });

  it("inserts an arrival after the last stored task dated on or before it", () => {
    const stored = [dated("a", 0, 10), dated("b", 1, 20)];
    const arrival = dated("c", 2, 15);
    const all = [...stored, arrival];

    const result = applyManualOrder(all, entriesFor(all), savedFor(stored, all), "scheduled-first");

    expect(ids(result)).toEqual(["a", "c", "b"]);
  });

  it("puts an arrival earlier than every stored task first", () => {
    const stored = [dated("a", 0, 10), dated("b", 1, 20)];
    const arrival = dated("c", 2, 5);
    const all = [...stored, arrival];

    const result = applyManualOrder(all, entriesFor(all), savedFor(stored, all), "scheduled-first");

    expect(ids(result)).toEqual(["c", "a", "b"]);
  });

  it("appends an arrival later than every stored task", () => {
    const stored = [dated("a", 0, 10), dated("b", 1, 20)];
    const arrival = dated("c", 2, 25);
    const all = [...stored, arrival];

    const result = applyManualOrder(all, entriesFor(all), savedFor(stored, all), "scheduled-first");

    expect(ids(result)).toEqual(["a", "b", "c"]);
  });

  it("appends rather than hoisting when the stored order is hand-scrambled", () => {
    // Stored as [Aug 20, Aug 18] — a drag, not date order. An Aug 19 arrival
    // must land after both, never above the Aug 20 it postdates.
    const a = dated("a", 0, 20);
    const b = dated("b", 1, 18);
    const arrival = dated("c", 2, 19);
    const all = [a, b, arrival];

    const result = applyManualOrder(all, entriesFor(all), savedFor([a, b], all), "scheduled-first");

    expect(ids(result)).toEqual(["a", "b", "c"]);
  });

  it("appends an undated arrival below a stored list", () => {
    const stored = [dated("a", 0, 10), dated("b", 1, 20)];
    const arrival = dated("c", 2, null);
    const all = [...stored, arrival];

    const result = applyManualOrder(all, entriesFor(all), savedFor(stored, all), "scheduled-first");

    expect(ids(result)).toEqual(["a", "b", "c"]);
  });

  it("reads the planning date through planBy, not the raw due date", () => {
    const early = makeTask({ id: "a", text: "a", lineNumber: 0, dueDate: new Date(2026, 7, 25), scheduledDate: new Date(2026, 7, 10) });
    const late = makeTask({ id: "b", text: "b", lineNumber: 1, dueDate: new Date(2026, 7, 12), scheduledDate: new Date(2026, 7, 28) });
    const tasks = [early, late];

    const byScheduled = applyManualOrder(tasks, computeOrderKeys(tasks, "scheduled-first"), [], "scheduled-first");
    const byDue = applyManualOrder(tasks, computeOrderKeys(tasks, "due-only"), [], "due-only");

    expect(ids(byScheduled)).toEqual(["a", "b"]);
    expect(ids(byDue)).toEqual(["b", "a"]);
  });
});

describe("computeArrivalRanks", () => {
  it("orders same-dated arrivals by their position in the bucket they came from", () => {
    // The QA rollover case: dragged into this-week as c, a, b, they must reach
    // today in that order rather than falling back to file order.
    const a = dated("a", 0, 16);
    const b = dated("b", 1, 16);
    const c = dated("c", 2, 16);
    const all = [a, b, c];
    const taskOrder = { "this-week": savedFor([c, a, b], all) };

    const ranks = computeArrivalRanks(entriesFor(all), taskOrder);
    const result = applyManualOrder(all, entriesFor(all), [], "scheduled-first", ranks);

    expect(ids(result)).toEqual(["c", "a", "b"]);
  });

  it("leaves tasks no saved array mentions unranked", () => {
    const a = dated("a", 0, 16);
    const b = dated("b", 1, 16);
    const all = [a, b];

    const ranks = computeArrivalRanks(entriesFor(all), { "this-week": savedFor([b], all) });

    expect(ranks.has("b")).toBe(true);
    expect(ranks.has("a")).toBe(false);
  });

  it("ranks a task by the first saved array that holds it", () => {
    const a = dated("a", 0, 16);
    const b = dated("b", 1, 16);
    const all = [a, b];
    const taskOrder = {
      "this-week": savedFor([b], all),
      "next-week": savedFor([a, b], all),
    };

    const ranks = computeArrivalRanks(entriesFor(all), taskOrder);

    expect(ranks.get("b")!).toBeLessThan(ranks.get("a")!);
  });
});
