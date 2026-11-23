import { startPlan, planStep, planSteps, undo, redo, undoBlocked, revert, canRevert, answerConflict, HISTORY_LIMIT } from "../src/core/plan/Plan";
import type { Conflict } from "../src/core/plan/Plan";
import type { PlanFields } from "../src/core/plan/PlanFields";

const real: PlanFields = { bucket: "today", due: null, scheduled: null };

it("planStep drops a field that equals the real value", () => {
  let plan = startPlan({}, ["a.md::1:0"]);
  plan = planStep(plan, { changes: { "a.md::1:0": { change: { bucket: "week" }, real } } });
  plan = planStep(plan, { changes: { "a.md::1:0": { change: { bucket: "today" }, real } } });
  expect(plan.current.changes).toEqual({});
});

it("undo and redo walk the history", () => {
  let plan = planStep(startPlan({}, ["x::1:0"]), { changes: { "x::1:0": { change: { due: "2026-11-20" }, real } } });
  plan = undo(plan);
  expect(plan.current.changes).toEqual({});
  plan = redo(plan);
  expect(plan.current.changes["x::1:0"]).toEqual({ due: "2026-11-20" });
});

it("a new step clears redo", () => {
  let plan = planStep(startPlan({}, ["x::1:0"]), { changes: { "x::1:0": { change: { due: "2026-11-20" }, real } } });
  plan = undo(plan);
  plan = planStep(plan, { changes: { "x::1:0": { change: { due: "2026-11-21" }, real } } });
  expect(plan.future).toEqual([]);
});

it("undo is blocked at a step touching a lost task", () => {
  let plan = planStep(startPlan({}, ["x::1:0"]), { changes: { "x::1:0": { change: { due: "2026-11-20" }, real } } });
  plan = { ...plan, lost: ["x::1:0"] };
  expect(undoBlocked(plan)).toBe(true);
  expect(undo(plan)).toBe(plan);
});

it("a no-op step adds no history", () => {
  const plan = planStep(startPlan({}, []), { changes: {} });
  expect(plan.past).toHaveLength(0);
});

it("a cross-bucket move purges the entry before writing the new order", () => {
  const entry = { file: "a.md", key: "1:0" };
  let plan = startPlan({ today: [entry], week: [] }, ["a.md::1:0"]);
  plan = planStep(plan, { purge: entry, order: { bucketId: "week", entries: [entry] } });
  expect(plan.current.taskOrder).toEqual({ today: [], week: [entry] });
});

it("startPlan copies the order rather than sharing it", () => {
  const order = { today: [{ file: "a.md", key: "1:0" }] };
  const plan = startPlan(order, []);
  plan.current.taskOrder.today.push({ file: "b.md", key: "2:0" });
  expect(order.today).toHaveLength(1);
});

it("canRevert hides bucket when only a date pick unpinned it", () => {
  const plan = planStep(startPlan({}, ["x::1:0"]), {
    changes: { "x::1:0": { change: { due: "2026-11-20", bucket: null, unpinnedByDate: true }, real } },
  });
  expect(canRevert(plan, "x::1:0")).toEqual({ bucket: false, date: true });
  expect(revert(plan, "x::1:0", "date", real).current.changes).toEqual({});
});

it("a later drag makes the bucket revertable again", () => {
  let plan = planStep(startPlan({}, ["x::1:0"]), {
    changes: { "x::1:0": { change: { due: "2026-11-20", bucket: null, unpinnedByDate: true }, real } },
  });
  plan = planStep(plan, { changes: { "x::1:0": { change: { bucket: "week" }, real } } });
  expect(canRevert(plan, "x::1:0")).toEqual({ bucket: true, date: true });
  expect(revert(plan, "x::1:0", "date", real).current.changes).toEqual({ "x::1:0": { bucket: "week" } });
});

it("canRevert offers nothing for a task added during planning", () => {
  const plan = planStep(startPlan({}, []), { changes: { "new::1:0": { change: { bucket: "week" }, real } } });
  expect(canRevert(plan, "new::1:0")).toEqual({ bucket: false, date: false });
});

it("revert is an undo step", () => {
  let plan = planStep(startPlan({}, ["x::1:0"]), { changes: { "x::1:0": { change: { bucket: "week" }, real } } });
  plan = revert(plan, "x::1:0", "bucket", real);
  expect(plan.current.changes).toEqual({});
  expect(undo(plan).current.changes).toEqual({ "x::1:0": { bucket: "week" } });
});

it("answering a conflict with the note's version drops the field and blocks undo", () => {
  let plan = planStep(startPlan({}, ["x::1:0"]), { changes: { "x::1:0": { change: { bucket: "week", due: "2026-11-20" }, real } } });
  const conflict: Conflict = { entryId: "x::1:0", field: "bucket", text: "a", file: "x" };
  plan = answerConflict({ ...plan, conflicts: [conflict] }, conflict, "note");
  expect(plan.current.changes["x::1:0"]).toEqual({ due: "2026-11-20" });
  expect(plan.conflicts).toEqual([]);
  expect(undoBlocked(plan)).toBe(true);
});

it("keeping the plan only closes the conflict", () => {
  let plan = planStep(startPlan({}, ["x::1:0"]), { changes: { "x::1:0": { change: { bucket: "week" }, real } } });
  const conflict: Conflict = { entryId: "x::1:0", field: "bucket", text: "a", file: "x" };
  const before = plan.current;
  plan = answerConflict({ ...plan, conflicts: [conflict] }, conflict, "plan");
  expect(plan.current).toBe(before);
  expect(plan.conflicts).toEqual([]);
  expect(undoBlocked(plan)).toBe(false);
});

it("history is capped", () => {
  let plan = startPlan({}, []);
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) plan = planStep(plan, { order: { bucketId: "b", entries: [{ file: "f", key: `${i}:0` }] } });
  expect(plan.past).toHaveLength(HISTORY_LIMIT);
});

it("planSteps merges several steps into one undo step", () => {
  let plan = planSteps(startPlan({}, ["p::1:0", "c::2:0"]), [
    { changes: { "p::1:0": { change: { bucket: "week" }, real } } },
    { changes: { "c::2:0": { change: { bucket: "week" }, real } } },
  ]);
  expect(Object.keys(plan.current.changes)).toEqual(["p::1:0", "c::2:0"]);
  expect(plan.past).toHaveLength(1);
  plan = undo(plan);
  expect(plan.current.changes).toEqual({});
  plan = redo(plan);
  expect(Object.keys(plan.current.changes)).toEqual(["p::1:0", "c::2:0"]);
});

it("answering a due date conflict with the note's version keeps the planned scheduled date", () => {
  let plan = planStep(startPlan({}, ["x::1:0"]), {
    changes: { "x::1:0": { change: { due: "2026-11-20", scheduled: "2026-11-18" }, real } },
  });
  const conflict: Conflict = { entryId: "x::1:0", field: "due", text: "a", file: "x" };
  plan = answerConflict({ ...plan, conflicts: [conflict] }, conflict, "note");
  expect(plan.current.changes["x::1:0"]).toEqual({ scheduled: "2026-11-18" });
});
