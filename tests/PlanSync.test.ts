import { syncFileChange, syncRename, reconcilePlan, syncPurge } from "../src/core/plan/PlanSync";
import { startPlan, planStep, undo } from "../src/core/plan/Plan";
import type { Plan, PlannedChange } from "../src/core/plan/Plan";
import { readPlanFields } from "../src/core/plan/PlanFields";
import { parseFile } from "../src/core/TaskParser";
import type { TaskRecord } from "../src/core/TaskParser";
import { computeOrderKeys, entryId } from "../src/core/TaskOrder";
import type { OrderEntry } from "../src/core/TaskOrder";
import { DEFAULT_SETTINGS, activeOrderKeyScheme } from "../src/settings";

const settings = DEFAULT_SETTINGS;
const scheme = activeOrderKeyScheme(settings);

function keysOf(tasks: TaskRecord[]): Map<string, OrderEntry> {
  return computeOrderKeys(tasks, scheme);
}
function entryOf(tasks: TaskRecord[], i: number): OrderEntry {
  return keysOf(tasks).get(tasks[i].id)!;
}
function idOf(tasks: TaskRecord[], i: number): string {
  return entryId(entryOf(tasks, i));
}
function step(tasks: TaskRecord[], i: number, change: PlannedChange) {
  return { [idOf(tasks, i)]: { change, real: readPlanFields(tasks[i].rawLine, settings) } };
}
/** A plan over `tasks` with one planned change on task `i`. */
function planWith(tasks: TaskRecord[], i: number, change: PlannedChange, order: Record<string, OrderEntry[]> = {}): Plan {
  const ids = tasks.map((_, j) => idOf(tasks, j));
  return planStep(startPlan(order, ids), { changes: step(tasks, i, change) });
}
const noText = () => "";

it("a text edit carries the planned change to the new key", () => {
  const before = parseFile("a.md", "- [ ] one #gtd/today");
  const after = parseFile("a.md", "- [ ] one! #gtd/today");
  const next = syncFileChange(planWith(before, 0, { bucket: "this-week" }), "a.md", before, after, settings);
  expect(next.current.changes).toEqual({ [idOf(after, 0)]: { bucket: "this-week" } });
  expect(next.originals).toEqual([idOf(after, 0)]);
  expect(next.conflicts).toEqual([]);
});

it("a bucket tag typed in the note conflicts with a planned bucket", () => {
  const before = parseFile("a.md", "- [ ] one #gtd/today");
  const after = parseFile("a.md", "- [ ] one #gtd/someday");
  const next = syncFileChange(planWith(before, 0, { bucket: "this-week" }), "a.md", before, after, settings);
  expect(next.conflicts).toEqual([{ entryId: idOf(after, 0), field: "bucket", text: "one", file: "a.md" }]);
  expect(next.current.changes[idOf(after, 0)]).toEqual({ bucket: "this-week" });
});

it("a note edit that agrees with the plan is no conflict, and the change is no longer needed", () => {
  const before = parseFile("a.md", "- [ ] one #gtd/today");
  const after = parseFile("a.md", "- [ ] one #gtd/this-week");
  const next = syncFileChange(planWith(before, 0, { bucket: "this-week" }), "a.md", before, after, settings);
  expect(next.conflicts).toEqual([]);
  expect(next.current.changes).toEqual({});
});

it("a date typed in the note conflicts only when the plan changed a date", () => {
  const before = parseFile("a.md", "- [ ] one #gtd/today 📅 2026-11-12");
  const after = parseFile("a.md", "- [ ] one #gtd/today 📅 2026-11-13");
  const bucketOnly = syncFileChange(planWith(before, 0, { bucket: "this-week" }), "a.md", before, after, settings);
  expect(bucketOnly.conflicts).toEqual([]);
  const dated = syncFileChange(planWith(before, 0, { due: "2026-11-20" }), "a.md", before, after, settings);
  expect(dated.conflicts).toEqual([{ entryId: idOf(after, 0), field: "due", text: "one", file: "a.md" }]);
});

it("the same conflict is not listed twice", () => {
  const v1 = parseFile("a.md", "- [ ] one #gtd/today");
  const v2 = parseFile("a.md", "- [ ] one #gtd/someday");
  const v3 = parseFile("a.md", "- [ ] one #gtd/next-week");
  let next = syncFileChange(planWith(v1, 0, { bucket: "this-week" }), "a.md", v1, v2, settings);
  next = syncFileChange(next, "a.md", v2, v3, settings);
  expect(next.conflicts).toHaveLength(1);
});

it("an unpairable task's change is dropped and marked lost", () => {
  const before = parseFile("a.md", "- [ ] one\n- [ ] two");
  // Two text lines push everything down and a third task is added: no tier can pair.
  const after = parseFile("a.md", "text\ntext\n- [ ] x\n- [ ] y\n- [ ] z");
  const ids = [idOf(before, 0), idOf(before, 1)];
  const plan = planStep(startPlan({}, ids), {
    changes: { ...step(before, 0, { bucket: "this-week" }), ...step(before, 1, { bucket: "someday" }) },
  });
  const next = syncFileChange(plan, "a.md", before, after, settings);
  expect(next.dropped.map((d) => d.text)).toEqual(["one", "two"]);
  expect(next.dropped[0].change).toEqual({ bucket: "this-week" });
  expect(next.current.changes).toEqual({});
  expect(next.lost).toEqual(expect.arrayContaining(ids));
});

it("syncRename moves changes and order to the new path", () => {
  const tasks = parseFile("a.md", "- [ ] one #gtd/today");
  const entry = entryOf(tasks, 0);
  const plan = planWith(tasks, 0, { bucket: "this-week" }, { "this-week": [entry] });
  const next = syncRename(plan, "a.md", "b.md");
  const moved = `b.md::${entry.key}`;
  expect(next.current.changes).toEqual({ [moved]: { bucket: "this-week" } });
  expect(next.current.taskOrder).toEqual({ "this-week": [{ file: "b.md", key: entry.key }] });
  expect(next.past[0].taskOrder).toEqual({ "this-week": [{ file: "b.md", key: entry.key }] });
  expect(next.originals).toEqual([moved]);
});

it("reconcilePlan drops changes whose task is gone", () => {
  const tasks = parseFile("a.md", "- [ ] one #gtd/today");
  const id = idOf(tasks, 0);
  const { plan, dropped } = reconcilePlan(planWith(tasks, 0, { bucket: "this-week" }), new Map(), () => "one");
  expect(dropped.map((d) => d.text)).toEqual(["one"]);
  expect(plan.current.changes).toEqual({});
  expect(plan.lost).toContain(id);
});

it("reconcilePlan revives a dropped change when its task returns", () => {
  const inA = parseFile("a.md", "- [ ] one #gtd/today");
  const inB = parseFile("b.md", "- [ ] one #gtd/today");
  const gone = reconcilePlan(planWith(inA, 0, { bucket: "this-week" }), new Map(), () => "one").plan;
  const { plan: next, revived } = reconcilePlan(gone, keysOf(inB), noText);
  expect(revived).toHaveLength(1);
  expect(next.current.changes[idOf(inB, 0)]).toEqual({ bucket: "this-week" });
  expect(next.dropped).toEqual([]);
});

it("reconcilePlan does not revive onto a task that has its own change", () => {
  const inA = parseFile("a.md", "- [ ] one #gtd/today");
  const inB = parseFile("b.md", "- [ ] one #gtd/today");
  let plan = reconcilePlan(planWith(inA, 0, { bucket: "this-week" }), new Map(), () => "one").plan;
  plan = planStep(plan, { changes: step(inB, 0, { bucket: "someday" }) });
  const { plan: next, revived } = reconcilePlan(plan, keysOf(inB), noText);
  expect(revived).toEqual([]);
  expect(next.current.changes[idOf(inB, 0)]).toEqual({ bucket: "someday" });
});

it("history snapshots are rekeyed too, so undo after a note edit lands on the right task", () => {
  const before = parseFile("a.md", "- [ ] one #gtd/today\n- [ ] two #gtd/today");
  const after = parseFile("a.md", "- [ ] one! #gtd/today\n- [ ] two #gtd/today");
  const [one, two] = [entryOf(before, 0), entryOf(before, 1)];
  let plan = startPlan({ today: [one, two] }, [entryId(one), entryId(two)]);
  plan = planStep(plan, { order: { bucketId: "today", entries: [two, one] } });
  plan = syncFileChange(plan, "a.md", before, after, settings);
  plan = undo(plan);
  expect(plan.current.taskOrder.today).toEqual([entryOf(after, 0), entryOf(after, 1)]);
});

it("syncPurge runs the purge on the plan's order", () => {
  const plan = startPlan({ today: [{ file: "a.md", key: "1:0" }] }, []);
  const next = syncPurge(plan, () => ({ today: [] }));
  expect(next.current.taskOrder).toEqual({ today: [] });
});
