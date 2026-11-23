import { conflictWording } from "../src/core/plan/ConflictWording";
import type { Conflict } from "../src/core/plan/Plan";
import type { PlanFields } from "../src/core/plan/PlanFields";

const names: Record<string, string> = { someday: "Someday / Maybe", "this-week": "This Week" };
const bucketName = (id: string) => names[id] ?? id;
const fields = (f: Partial<PlanFields>): PlanFields => ({ bucket: null, due: null, scheduled: null, ...f });
const conflict = (field: Conflict["field"]): Conflict => ({ entryId: "a.md::1:0", field, text: "Call mom", file: "a.md" });

it("names both buckets when the note moved the task", () => {
  expect(conflictWording(conflict("bucket"), fields({ bucket: "someday" }), fields({ bucket: "this-week" }), bucketName)).toEqual({
    message: '"Call mom" moved to Someday / Maybe in its note. Your plan has it in This Week.',
    useNote: "Use Someday / Maybe",
    keepPlan: "Keep This Week",
  });
});

it("offers Unpin when the note dropped the bucket tag", () => {
  expect(conflictWording(conflict("bucket"), fields({}), fields({ bucket: "this-week" }), bucketName)).toEqual({
    message: '"Call mom" was unpinned in its note. Your plan has it in This Week.',
    useNote: "Unpin",
    keepPlan: "Keep This Week",
  });
});

it("says the plan unpins the task when it does", () => {
  expect(conflictWording(conflict("bucket"), fields({ bucket: "someday" }), fields({}), bucketName)).toEqual({
    message: '"Call mom" moved to Someday / Maybe in its note. Your plan unpins it.',
    useNote: "Use Someday / Maybe",
    keepPlan: "Keep unpinned",
  });
});

it("names both due dates when the note changed it", () => {
  expect(conflictWording(conflict("due"), fields({ due: "2026-12-03" }), fields({ due: "2026-12-01" }), bucketName)).toEqual({
    message: '"Call mom" got due date Thu, Dec 3 in its note. Your plan has Tue, Dec 1.',
    useNote: "Use Thu, Dec 3",
    keepPlan: "Keep Tue, Dec 1",
  });
});

it("offers Remove date when the note dropped the scheduled date", () => {
  expect(conflictWording(conflict("scheduled"), fields({}), fields({ scheduled: "2026-12-01" }), bucketName)).toEqual({
    message: '"Call mom" lost its scheduled date in its note. Your plan has Tue, Dec 1.',
    useNote: "Remove date",
    keepPlan: "Keep Tue, Dec 1",
  });
});

it("says the plan removes the date when it does", () => {
  expect(conflictWording(conflict("due"), fields({ due: "2026-12-03" }), fields({}), bucketName)).toEqual({
    message: '"Call mom" got due date Thu, Dec 3 in its note. Your plan removes it.',
    useNote: "Use Thu, Dec 3",
    keepPlan: "Keep no date",
  });
});
