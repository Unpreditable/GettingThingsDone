import { buildCompletionReport, groupByDay } from "../src/core/CompletionReport";
import type { TaskRecord } from "../src/core/TaskParser";

// Thursday Oct 15, 2026, mid-afternoon. With a Monday week start, this week is
// Oct 12–18 and last week is Oct 5–11.
const NOW = new Date(2026, 9, 15, 15, 30);

let nextLine = 0;

function day(month: number, date: number): Date {
  return new Date(2026, month - 1, date);
}

function done(date: Date | null, overrides: Partial<TaskRecord> = {}): TaskRecord {
  const lineNumber = nextLine++;
  return {
    id: String(lineNumber),
    filePath: "test.md",
    lineNumber,
    rawLine: "- [x] Task",
    text: "Task",
    isCompleted: true,
    completedAt: date,
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

function cancelled(date: Date | null): TaskRecord {
  return done(null, { rawLine: "- [-] Task", cancelledDate: date });
}

function open(): TaskRecord {
  return done(null, { rawLine: "- [ ] Task", isCompleted: false });
}

describe("buildCompletionReport ranges", () => {
  it("puts a task done today in today and this week only", () => {
    const task = done(day(10, 15));
    const { ranges } = buildCompletionReport([task], NOW, "monday");
    expect(ranges.today.map((e) => e.task)).toEqual([task]);
    expect(ranges.yesterday).toEqual([]);
    expect(ranges["this-week"].map((e) => e.task)).toEqual([task]);
    expect(ranges["last-week"]).toEqual([]);
  });

  it("splits the weeks at the configured week start", () => {
    const sunday = done(day(10, 11));
    const monday = done(day(10, 12));
    const mondayStart = buildCompletionReport([sunday, monday], NOW, "monday").ranges;
    expect(mondayStart["this-week"].map((e) => e.task)).toEqual([monday]);
    expect(mondayStart["last-week"].map((e) => e.task)).toEqual([sunday]);

    const sundayStart = buildCompletionReport([sunday, monday], NOW, "sunday").ranges;
    expect(sundayStart["this-week"].map((e) => e.task)).toEqual([monday, sunday]);
    expect(sundayStart["last-week"]).toEqual([]);
  });

  it("covers last week's first and last day, and nothing either side", () => {
    const tasks = [day(10, 4), day(10, 5), day(10, 11), day(10, 12)].map((d) => done(d));
    const lastWeek = buildCompletionReport(tasks, NOW, "monday").ranges["last-week"];
    expect(lastWeek.map((e) => e.task)).toEqual([tasks[2], tasks[1]]);
  });

  it("lists the newest day first, keeping file order within a day", () => {
    const a = done(day(10, 13));
    const b = done(day(10, 14));
    const c = done(day(10, 13));
    const week = buildCompletionReport([a, b, c], NOW, "monday").ranges["this-week"];
    expect(week.map((e) => e.task)).toEqual([b, a, c]);
  });

  it("dates a cancelled task by its cancelled date and flags it", () => {
    const task = cancelled(day(10, 14));
    const [entry] = buildCompletionReport([task], NOW, "monday").ranges.yesterday;
    expect(entry.cancelled).toBe(true);
    expect(entry.date).toEqual(day(10, 14));
  });

  it("leaves out open tasks and closed tasks without a date", () => {
    const { ranges } = buildCompletionReport([open(), done(null), cancelled(null)], NOW, "monday");
    expect(ranges["this-week"]).toEqual([]);
  });
});

describe("buildCompletionReport undated", () => {
  it("counts done tasks without a done date, but not cancelled ones", () => {
    const report = buildCompletionReport(
      [done(null), done(null), done(day(10, 15)), cancelled(null), open()],
      NOW,
      "monday"
    );
    expect(report.undated).toBe(2);
  });
});

describe("buildCompletionReport weeks", () => {
  it("returns ten weeks, oldest first, ending with the current week", () => {
    const { weeks } = buildCompletionReport([], NOW, "monday");
    expect(weeks).toHaveLength(10);
    expect(weeks[9]).toMatchObject({ start: day(10, 12), current: true });
    expect(weeks[8]).toMatchObject({ start: day(10, 5), current: false });
    expect(weeks[0].start).toEqual(day(8, 10));
  });

  it("counts completions per week and skips cancelled tasks", () => {
    const tasks = [
      done(day(10, 15)),
      done(day(10, 12)),
      done(day(10, 11)),
      cancelled(day(10, 11)),
      done(day(8, 10)),
      done(day(8, 9)), // the week before the oldest point
    ];
    const counts = buildCompletionReport(tasks, NOW, "monday").weeks.map((w) => w.count);
    expect(counts).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  });

  it("ignores done dates after the current week", () => {
    const counts = buildCompletionReport([done(day(10, 19))], NOW, "monday").weeks.map((w) => w.count);
    expect(counts.every((n) => n === 0)).toBe(true);
  });

  it("keeps week starts on midnight across a daylight-saving change", () => {
    // Europe and the US both leave summer time between Oct 25 and Nov 1.
    const later = new Date(2026, 11, 3, 9);
    const { weeks } = buildCompletionReport([], later, "monday");
    for (const w of weeks) {
      expect(w.start.getHours()).toBe(0);
      expect(w.start.getDay()).toBe(1);
    }
  });
});

describe("groupByDay", () => {
  it("groups entries by day and counts only the completed ones", () => {
    const tasks = [done(day(10, 14)), cancelled(day(10, 14)), done(day(10, 13))];
    const groups = groupByDay(buildCompletionReport(tasks, NOW, "monday").ranges["this-week"]);
    expect(groups.map((g) => [g.date, g.entries.length, g.completed])).toEqual([
      [day(10, 14), 2, 1],
      [day(10, 13), 1, 1],
    ]);
  });
});
