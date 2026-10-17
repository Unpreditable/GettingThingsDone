import type { WeekStart } from "../settings";
import { weekStartIndex } from "../settings";
import type { TaskRecord } from "./TaskParser";
import { statusSymbol } from "./TaskParser";
import { diffInDays } from "./DueStatus";

export type ReportRange = "today" | "yesterday" | "this-week" | "last-week";

export const REPORT_RANGES: readonly ReportRange[] = ["today", "yesterday", "this-week", "last-week"];

export interface ReportEntry {
  task: TaskRecord;
  /** The ✅ date, or the ❌ date of a cancelled task, at midnight. */
  date: Date;
  cancelled: boolean;
}

export interface ReportDay {
  date: Date;
  entries: ReportEntry[];
  /** Entries that are not cancelled. */
  completed: number;
}

export interface WeekPoint {
  start: Date;
  /** Completions in the week, cancelled tasks excluded. */
  count: number;
  /** The week holding `now`, which is still in progress. */
  current: boolean;
}

export interface CompletionReport {
  /** Each range's entries, newest day first, cancelled tasks included. */
  ranges: Record<ReportRange, ReportEntry[]>;
  /** Oldest first; the last one is the current week. */
  weeks: WeekPoint[];
  /** Done tasks with no ✅ date, which no range can hold. */
  undated: number;
}

export const REPORT_WEEKS = 10;

/**
 * Everything the completion report shows, read from the dates on the task
 * lines alone: the plugin keeps no history, so a task without a ✅ (or ❌) date
 * cannot be placed on a day and is only counted in `undated`.
 */
export function buildCompletionReport(
  tasks: TaskRecord[],
  now: Date,
  weekStart: WeekStart
): CompletionReport {
  const sinceWeekStart = (now.getDay() - weekStartIndex(weekStart) + 7) % 7;
  const ranges: Record<ReportRange, ReportEntry[]> = {
    today: [],
    yesterday: [],
    "this-week": [],
    "last-week": [],
  };
  const counts = new Array<number>(REPORT_WEEKS).fill(0);
  let undated = 0;

  // Paired with the day offset so the sort below needs no date maths.
  const dated: [ReportEntry, number][] = [];
  for (const task of tasks) {
    if (!task.isCompleted) continue;
    const cancelled = statusSymbol(task.rawLine) === "-";
    const date = cancelled ? task.cancelledDate : task.completedAt;
    if (!date) {
      if (!cancelled) undated++;
      continue;
    }
    const midnight = new Date(date);
    midnight.setHours(0, 0, 0, 0);
    dated.push([{ task, date: midnight, cancelled }, diffInDays(midnight, now)]);
  }
  // Stable, so tasks done on the same day keep their file order.
  dated.sort((a, b) => b[1] - a[1]);

  for (const [entry, diff] of dated) {
    if (diff === 0) ranges.today.push(entry);
    if (diff === -1) ranges.yesterday.push(entry);

    // Days from the start of the current week: 0–6 is this week, -7…-1 last week.
    const offset = diff + sinceWeekStart;
    if (offset >= 0 && offset <= 6) ranges["this-week"].push(entry);
    if (offset >= -7 && offset <= -1) ranges["last-week"].push(entry);

    const weeksAgo = -Math.floor(offset / 7);
    if (!entry.cancelled && weeksAgo >= 0 && weeksAgo < REPORT_WEEKS) {
      counts[REPORT_WEEKS - 1 - weeksAgo]++;
    }
  }

  const weeks = counts.map((count, i) => {
    // setDate rather than adding milliseconds, so a daylight-saving change
    // in between doesn't knock the start off midnight.
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - sinceWeekStart - 7 * (REPORT_WEEKS - 1 - i));
    return { start, count, current: i === REPORT_WEEKS - 1 };
  });

  return { ranges, weeks, undated };
}

/** Consecutive entries on the same day, in the order given. */
export function groupByDay(entries: ReportEntry[]): ReportDay[] {
  const days: ReportDay[] = [];
  for (const entry of entries) {
    let last = days[days.length - 1];
    if (!last || last.date.getTime() !== entry.date.getTime()) {
      last = { date: entry.date, entries: [], completed: 0 };
      days.push(last);
    }
    last.entries.push(entry);
    if (!entry.cancelled) last.completed++;
  }
  return days;
}
