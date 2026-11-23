import { planNotes, indicatorMark } from "../src/core/plan/PlanNotes";
import type { PlanFields } from "../src/core/plan/PlanFields";

const names: Record<string, string> = { today: "☀️ Today", "this-week": "📅 This Week" };
const bucketName = (id: string) => names[id] ?? id;
const fields = (f: Partial<PlanFields>): PlanFields => ({ bucket: null, due: null, scheduled: null, ...f });

it("marks each kind of indicator", () => {
  expect(indicatorMark({ kind: "up", by: 2 })).toBe("↑2");
  expect(indicatorMark({ kind: "down", by: 3 })).toBe("↓3");
  expect(indicatorMark({ kind: "bucket-up", fromBucketId: "today" })).toBe("⇑");
  expect(indicatorMark({ kind: "bucket-down", fromBucketId: "today" })).toBe("⇓");
});

it("names the bucket a moved task was in, after its mark", () => {
  const notes = planNotes({ kind: "bucket-down", fromBucketId: "today" }, fields({ bucket: "today" }), fields({ bucket: "this-week" }), bucketName);
  expect(notes).toEqual(["⇓ Was in ☀️ Today"]);
});

it("says how far a task moved within its bucket", () => {
  expect(planNotes({ kind: "up", by: 2 }, fields({}), fields({}), bucketName)).toEqual(["↑2 Moved up 2"]);
  expect(planNotes({ kind: "down", by: 1 }, fields({}), fields({}), bucketName)).toEqual(["↓1 Moved down 1"]);
});

it("names the old pin when the task stays in its bucket", () => {
  expect(planNotes(null, fields({}), fields({ bucket: "today" }), bucketName)).toEqual(["Was unpinned"]);
  expect(planNotes(null, fields({ bucket: "today" }), fields({}), bucketName)).toEqual(["Was pinned to ☀️ Today"]);
});

it("names the old dates", () => {
  const notes = planNotes(null, fields({ due: "2026-12-01" }), fields({ due: "2026-12-03", scheduled: "2026-12-02" }), bucketName);
  expect(notes).toEqual(["Was due Tue, Dec 1", "Had no scheduled date"]);
  expect(planNotes(null, fields({ scheduled: "2026-12-01" }), fields({}), bucketName)).toEqual(["Was scheduled Tue, Dec 1"]);
  expect(planNotes(null, fields({}), fields({ due: "2026-12-01" }), bucketName)).toEqual(["Had no due date"]);
});

it("a date change that moved the task gets its bucket line too", () => {
  const notes = planNotes(
    { kind: "bucket-up", fromBucketId: "this-week" },
    fields({ due: "2026-12-05" }),
    fields({ due: "2026-12-01" }),
    bucketName
  );
  expect(notes).toEqual(["⇑ Was in 📅 This Week", "Was due Sat, Dec 5"]);
});

it("an unchanged task has no lines", () => {
  expect(planNotes(null, fields({ bucket: "today" }), fields({ bucket: "today" }), bucketName)).toEqual([]);
});
