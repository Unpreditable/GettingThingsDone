import { dateEntries, datePresets } from "../src/core/DateMenu";
import type { DateEntry } from "../src/core/DateMenu";
import type { PlanBy } from "../src/settings";
import type { TaskRecord } from "../src/core/TaskParser";

const OCT_10 = new Date(2026, 9, 10);
const OCT_12 = new Date(2026, 9, 12);

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
    tasksId: null,
    dependsOn: [],
    blockId: null,
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...overrides,
  };
}

const change = (field: DateEntry["field"], unpins: boolean): DateEntry => ({ kind: "change", field, unpins });
const set = (field: DateEntry["field"], unpins: boolean): DateEntry => ({ kind: "set", field, unpins });

describe("dateEntries", () => {
  const both = makeTask({ dueDate: OCT_12, scheduledDate: OCT_10 });

  it("unpins through the due date under due-first", () => {
    expect(dateEntries(both, "due-first", true)).toEqual([change("due", true), change("scheduled", false)]);
  });

  it("unpins through the scheduled date under scheduled-first", () => {
    expect(dateEntries(both, "scheduled-first", true)).toEqual([change("due", false), change("scheduled", true)]);
  });

  it("unpins through the earlier date under earliest", () => {
    expect(dateEntries(both, "earliest", true)).toEqual([change("due", false), change("scheduled", true)]);
  });

  it("never unpins a task that isn't pinned", () => {
    expect(dateEntries(both, "due-first", false)).toEqual([change("due", false), change("scheduled", false)]);
  });

  it("offers Set due next to a scheduled date that due-only ignores", () => {
    const task = makeTask({ scheduledDate: OCT_10 });
    expect(dateEntries(task, "due-only", true)).toEqual([change("scheduled", false), set("due", true)]);
  });

  it("offers Set scheduled next to a due date that scheduled-only ignores", () => {
    const task = makeTask({ dueDate: OCT_12 });
    expect(dateEntries(task, "scheduled-only", false)).toEqual([change("due", false), set("scheduled", false)]);
  });

  it.each<[PlanBy, DateEntry["field"]]>([
    ["due-only", "due"],
    ["due-first", "due"],
    ["scheduled-only", "scheduled"],
    ["scheduled-first", "scheduled"],
    ["earliest", "scheduled"],
  ])("sets the date %s implies on a dateless task", (mode, field) => {
    expect(dateEntries(makeTask({}), mode, false)).toEqual([set(field, false)]);
  });

  it("offers nothing under manual", () => {
    expect(dateEntries(both, "manual", true)).toEqual([]);
    expect(dateEntries(makeTask({}), "manual", false)).toEqual([]);
  });

  it("offers nothing on done or cancelled tasks", () => {
    expect(dateEntries(makeTask({ rawLine: "- [x] Done", dueDate: OCT_12 }), "due-first", false)).toEqual([]);
    expect(dateEntries(makeTask({ rawLine: "- [-] Cancelled", dueDate: OCT_12 }), "due-first", false)).toEqual([]);
  });

  it("offers entries on an in-progress task", () => {
    expect(dateEntries(makeTask({ rawLine: "- [/] Going", dueDate: OCT_12 }), "due-first", false)).toEqual([
      change("due", false),
    ]);
  });
});

describe("datePresets", () => {
  const MONDAY = 1;
  const SUNDAY = 0;
  const rows = (today: Date, weekStart: number, current: Date | null = null) =>
    datePresets(today, weekStart, current).map((p) => [p.id, p.key]);

  it("collapses start of next week into tomorrow on a Sunday with Monday weeks", () => {
    expect(rows(new Date(2026, 9, 18), MONDAY)).toEqual([
      ["today", "2026-10-18"],
      ["tomorrow", "2026-10-19"],
      ["inOneWeek", "2026-10-25"],
      ["inTwoWeeks", "2026-11-01"],
    ]);
  });

  it("keeps in 1 week over start of next week on the week's first day", () => {
    expect(rows(new Date(2026, 9, 19), MONDAY)).toEqual([
      ["today", "2026-10-19"],
      ["tomorrow", "2026-10-20"],
      ["inOneWeek", "2026-10-26"],
      ["inTwoWeeks", "2026-11-02"],
    ]);
  });

  it("shows all five mid-week", () => {
    expect(rows(new Date(2026, 9, 21), MONDAY)).toEqual([
      ["today", "2026-10-21"],
      ["tomorrow", "2026-10-22"],
      ["startOfNextWeek", "2026-10-26"],
      ["inOneWeek", "2026-10-28"],
      ["inTwoWeeks", "2026-11-04"],
    ]);
  });

  it("follows a Sunday week start", () => {
    expect(rows(new Date(2026, 9, 18), SUNDAY)).toEqual([
      ["today", "2026-10-18"],
      ["tomorrow", "2026-10-19"],
      ["inOneWeek", "2026-10-25"],
      ["inTwoWeeks", "2026-11-01"],
    ]);
  });

  it("hides the row equal to the current date", () => {
    const ids = rows(new Date(2026, 9, 21), MONDAY, new Date(2026, 9, 22)).map(([id]) => id);
    expect(ids).toEqual(["today", "startOfNextWeek", "inOneWeek", "inTwoWeeks"]);
  });

  it("crosses a year boundary", () => {
    const last = rows(new Date(2026, 11, 28), MONDAY).pop();
    expect(last).toEqual(["inTwoWeeks", "2027-01-11"]);
  });

  it("returns local-midnight dates matching their keys", () => {
    const [today] = datePresets(new Date(2026, 9, 21, 15, 30), MONDAY, null);
    expect(today.date).toEqual(new Date(2026, 9, 21));
  });
});
