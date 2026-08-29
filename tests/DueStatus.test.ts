import {
  computeDueStatus,
  computeMisplacement,
  dayKey,
  diffInDays,
  matchesRule,
  msUntilNextMidnight,
} from "../src/core/DueStatus";
import { DEFAULT_BUCKETS, WEEK_STARTS } from "../src/settings";
import type { DateRangeRule, PlanBy, WeekStart } from "../src/settings";
import type { TaskRecord } from "../src/core/TaskParser";

// Monday Feb 23, 2026. Feb 2026 has 28 days, so Feb 28 is 5 days out,
// Mar 1 is 6 days out and Mar 31 is 36 days out.
const MONDAY = new Date(2026, 1, 23);

function due(days: number): Date {
  const d = new Date(MONDAY);
  d.setDate(d.getDate() + days);
  return d;
}

function match(rule: DateRangeRule, days: number, weekStart: WeekStart = "monday"): boolean {
  return matchesRule(rule, due(days), MONDAY, weekStart);
}

describe("diffInDays", () => {
  it("ignores clock time on both sides", () => {
    const a = new Date(2026, 1, 24, 23, 59);
    const b = new Date(2026, 1, 23, 0, 1);
    expect(diffInDays(a, b)).toBe(1);
  });

  it("is negative for past dates", () => {
    expect(diffInDays(due(-3), MONDAY)).toBe(-3);
  });
});

describe("matchesRule", () => {
  it("today claims today and everything past", () => {
    expect(match({ type: "today" }, 0)).toBe(true);
    expect(match({ type: "today" }, -1)).toBe(true);
    expect(match({ type: "today" }, 1)).toBe(false);
  });

  it("this-week claims tomorrow through Sunday", () => {
    const rule: DateRangeRule = { type: "this-week" };
    expect(match(rule, 0)).toBe(false);
    expect(match(rule, 1)).toBe(true);
    expect(match(rule, 6)).toBe(true); // Sunday Mar 1
    expect(match(rule, 7)).toBe(false);
  });

  it("next-week claims next Monday through the following Sunday", () => {
    const rule: DateRangeRule = { type: "next-week" };
    expect(match(rule, 6)).toBe(false);
    expect(match(rule, 7)).toBe(true);
    expect(match(rule, 13)).toBe(true);
    expect(match(rule, 14)).toBe(false);
  });

  it("this-month claims tomorrow through the end of the month", () => {
    const rule: DateRangeRule = { type: "this-month" };
    expect(match(rule, 0)).toBe(false);
    expect(match(rule, 1)).toBe(true);
    expect(match(rule, 5)).toBe(true); // Feb 28
    expect(match(rule, 6)).toBe(false); // Mar 1
  });

  it("next-month claims the whole of the following calendar month", () => {
    const rule: DateRangeRule = { type: "next-month" };
    expect(match(rule, 5)).toBe(false);
    expect(match(rule, 6)).toBe(true); // Mar 1
    expect(match(rule, 36)).toBe(true); // Mar 31
    expect(match(rule, 37)).toBe(false);
  });

  it("within-days claims 1 through N", () => {
    const rule: DateRangeRule = { type: "within-days", days: 3 };
    expect(match(rule, 0)).toBe(false);
    expect(match(rule, 1)).toBe(true);
    expect(match(rule, 3)).toBe(true);
    expect(match(rule, 4)).toBe(false);
  });

  it("within-days-range claims from through to, with no off-by-one at the start", () => {
    const rule: DateRangeRule = { type: "within-days-range", from: 5, to: 10 };
    expect(match(rule, 4)).toBe(false);
    expect(match(rule, 5)).toBe(true);
    expect(match(rule, 10)).toBe(true);
    expect(match(rule, 11)).toBe(false);
  });

  it("beyond-days claims everything past N", () => {
    const rule: DateRangeRule = { type: "beyond-days", days: 30 };
    expect(match(rule, 30)).toBe(false);
    expect(match(rule, 31)).toBe(true);
  });
});

// Feb 22–28 2026 is a full Sunday–Saturday week, so `new Date(2026, 1, 22 + dow)`
// is a day whose getDay() is exactly `dow`.
const WEEK_OF_FEB_22 = 22;

function dayWithDow(dow: number): Date {
  return new Date(2026, 1, WEEK_OF_FEB_22 + dow);
}

function matchOn(rule: DateRangeRule, days: number, now: Date, weekStart: WeekStart): boolean {
  const target = new Date(now);
  target.setDate(target.getDate() + days);
  return matchesRule(rule, target, now, weekStart);
}

describe("matchesRule week boundaries", () => {
  const thisWeek: DateRangeRule = { type: "this-week" };
  const nextWeek: DateRangeRule = { type: "next-week" };

  describe.each(WEEK_STARTS)("with the week starting on %s", (weekStart) => {
    const startIdx = WEEK_STARTS.indexOf(weekStart);

    it.each([0, 1, 2, 3, 4, 5, 6])("bounds both week rules when today is day %i", (dow) => {
      const now = dayWithDow(dow);
      const daysToWeekEnd = 6 - ((dow - startIdx + 7) % 7);

      // this-week runs tomorrow through the last day of the current week.
      expect(matchOn(thisWeek, 0, now, weekStart)).toBe(false);
      expect(matchOn(thisWeek, daysToWeekEnd, now, weekStart)).toBe(daysToWeekEnd >= 1);
      expect(matchOn(thisWeek, daysToWeekEnd + 1, now, weekStart)).toBe(false);

      // next-week picks up exactly where this-week stops, and spans seven days.
      expect(matchOn(nextWeek, daysToWeekEnd, now, weekStart)).toBe(false);
      expect(matchOn(nextWeek, daysToWeekEnd + 1, now, weekStart)).toBe(true);
      expect(matchOn(nextWeek, daysToWeekEnd + 7, now, weekStart)).toBe(true);
      expect(matchOn(nextWeek, daysToWeekEnd + 8, now, weekStart)).toBe(false);
    });

    it("claims nothing for this-week on the last day of the week", () => {
      // The day before the start day is the week's last day.
      const now = dayWithDow((startIdx + 6) % 7);
      for (let diff = 1; diff <= 7; diff++) {
        expect(matchOn(thisWeek, diff, now, weekStart)).toBe(false);
      }
      // Tomorrow is the first day of the next week, so next-week takes it.
      expect(matchOn(nextWeek, 1, now, weekStart)).toBe(true);
    });
  });

  // The rules were hardcoded to a Monday-start week before the setting existed.
  // This pins the new arithmetic to the old formula so the default cannot drift.
  it.each([0, 1, 2, 3, 4, 5, 6])("reproduces the old Monday-only formula on day %i", (dow) => {
    const now = dayWithDow(dow);
    const daysToSunday = dow === 0 ? 0 : 7 - dow;
    const daysToNextMonday = dow === 0 ? 1 : 8 - dow;

    for (let diff = -2; diff <= 20; diff++) {
      expect(matchOn(thisWeek, diff, now, "monday")).toBe(diff >= 1 && diff <= daysToSunday);
      expect(matchOn(nextWeek, diff, now, "monday")).toBe(
        diff >= daysToNextMonday && diff <= daysToNextMonday + 6
      );
    }
  });
});

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

function status(days: number, overrides: Partial<TaskRecord> = {}) {
  return computeDueStatus(makeTask({ dueDate: due(days), ...overrides }), MONDAY);
}

/** Misplacement against the default buckets, planning by 📅 unless told otherwise. */
function misplaced(
  bucketId: string,
  overrides: Partial<TaskRecord>,
  planBy: PlanBy = "due-only"
) {
  return computeMisplacement(
    makeTask(overrides), bucketId, DEFAULT_BUCKETS, planBy, MONDAY, "monday"
  );
}

describe("computeDueStatus", () => {
  it("returns null for a task with no due date", () => {
    expect(computeDueStatus(makeTask({}), MONDAY)).toBeNull();
  });

  it("flags a past due date as overdue", () => {
    expect(status(-3)).toEqual({ kind: "overdue", diffDays: -3 });
  });

  it("leaves a task due today on track", () => {
    expect(status(0)).toEqual({ kind: "on-track", diffDays: 0 });
  });

  it("never flags a completed task", () => {
    expect(status(-10, { isCompleted: true })).toEqual({ kind: "on-track", diffDays: -10 });
  });

  it("ignores the scheduled date entirely", () => {
    const scheduledLongPast = makeTask({ dueDate: due(5), scheduledDate: due(-30) });
    expect(computeDueStatus(scheduledLongPast, MONDAY)).toEqual({ kind: "on-track", diffDays: 5 });
  });

  it("reports overdue from 📅 even when a later ⏳ is driving placement", () => {
    const task = makeTask({ dueDate: due(-2), scheduledDate: due(9) });
    expect(computeDueStatus(task, MONDAY)).toEqual({ kind: "overdue", diffDays: -2 });
  });
});

describe("computeMisplacement", () => {
  it("returns null for a task with no planning date", () => {
    expect(misplaced("this-week", {})).toBeNull();
    expect(misplaced("this-week", { dueDate: due(0) }, "manual")).toBeNull();
  });

  it("says nothing about a task sitting where its date puts it", () => {
    expect(misplaced("today", { dueDate: due(0) })).toBeNull();
  });

  it("flags a task due today but filed in This Week", () => {
    expect(misplaced("this-week", { dueDate: due(0) })?.id).toBe("today");
  });

  it("flags a task filed in This Month that an earlier bucket claims", () => {
    // This Month's own range covers day 3, but This Week claims it first, and
    // first-match order is what autoAssign uses too.
    expect(misplaced("this-month", { dueDate: due(3) })?.id).toBe("this-week");
  });

  it("flags a dated Someday task that a real bucket claims", () => {
    expect(misplaced("someday", { dueDate: due(4) })?.id).toBe("this-week");
  });

  it("leaves a far-future Someday task alone, since the catch-all claims it there", () => {
    expect(misplaced("someday", { dueDate: due(200) })).toBeNull();
  });

  it("stays silent when a task is pulled forward into a sooner bucket", () => {
    // Due Thursday (this-week's range), deliberately moved to Today. That is a
    // choice, not a mistake — hence autoIdx < curIdx rather than !==.
    expect(misplaced("today", { dueDate: due(4) })).toBeNull();
  });

  it("never flags anything in To Review", () => {
    expect(misplaced("to-review", { dueDate: due(0) })).toBeNull();
  });

  it("never flags a completed task", () => {
    expect(misplaced("this-week", { dueDate: due(0), isCompleted: true })).toBeNull();
  });

  it("follows the planning date, not the due date", () => {
    // ⏳ today, 📅 far out, filed in Someday. Planning by ⏳ this is misfiled;
    // planning by 📅 the catch-all claims Someday and it is fine where it is.
    const task = { dueDate: due(200), scheduledDate: due(0) };
    expect(misplaced("someday", task, "scheduled-first")?.id).toBe("today");
    expect(misplaced("someday", task, "due-only")).toBeNull();
  });

  it("can be true at the same time as overdue", () => {
    // 📅 passed (overdue) while ⏳ places it in Today, but it is pinned to
    // Someday (misfiled). The row shows only ❢; the popover shows both.
    const task = makeTask({ dueDate: due(-4), scheduledDate: due(0) });
    expect(computeDueStatus(task, MONDAY)).toEqual({ kind: "overdue", diffDays: -4 });
    expect(computeMisplacement(task, "someday", DEFAULT_BUCKETS, "scheduled-first", MONDAY, "monday")?.id).toBe("today");
  });
});

describe("dayKey", () => {
  it("formats the local calendar day", () => {
    expect(dayKey(new Date(2026, 7, 5, 23, 59))).toBe("2026-08-05");
  });

  it("zero-pads month and day", () => {
    expect(dayKey(new Date(2026, 0, 2, 0, 0))).toBe("2026-01-02");
  });

  it("differs across midnight", () => {
    expect(dayKey(new Date(2026, 7, 5, 23, 59, 59))).not.toBe(dayKey(new Date(2026, 7, 6, 0, 0, 1)));
  });
});

describe("msUntilNextMidnight", () => {
  it("counts the remainder of the day plus a one-second skew", () => {
    const now = new Date(2026, 7, 5, 23, 0, 0);
    expect(msUntilNextMidnight(now)).toBe(60 * 60 * 1000 + 1000);
  });

  it("lands on the next local midnight even across a DST shift", () => {
    // Constructed from wall-clock parts, so this holds in any timezone —
    // including one where Mar 8 2026 is only 23 hours long. Naive
    // now + 86_400_000 arithmetic fails this in a DST zone.
    const now = new Date(2026, 2, 8, 0, 0, 30);
    const landing = new Date(now.getTime() + msUntilNextMidnight(now));
    expect(landing.getDate()).toBe(9);
    expect(landing.getHours()).toBe(0);
    expect(landing.getMinutes()).toBe(0);
  });
});
