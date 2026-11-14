import type { BucketConfig, PluginSettings, WeekStart } from "../settings";
import type { DateField } from "./DateMenu";
import type { TaskRecord } from "./TaskParser";
import { parseFile, statusSymbol } from "./TaskParser";
import { dayKey, matchesRule } from "./DueStatus";
import { planningDate } from "./PlanningDate";
import { autoBucketFor, TO_REVIEW_ID } from "./BucketManager";
import { setDateLine } from "./TaskWriter";

export const RANGE_HORIZON_DAYS = 366;

/**
 * Every day from `now` on that auto-placement gives to this bucket, or null when
 * the range has no end. Placement is first-match-wins, so a day an earlier
 * bucket's rule claims is not this bucket's, even if its own rule matches it.
 */
export function effectiveRange(
  bucketId: string,
  buckets: BucketConfig[],
  now: Date,
  weekStart: WeekStart
): Date[] | null {
  const days: Date[] = [];
  for (let i = 0; i <= RANGE_HORIZON_DAYS; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const owner = buckets.find((b) => b.dateRangeRule && matchesRule(b.dateRangeRule, day, now, weekStart));
    if (owner?.id !== bucketId) continue;
    if (i === RANGE_HORIZON_DAYS) return null;
    days.push(day);
  }
  return days.length > 0 ? days : null;
}

/**
 * The days a drop offers, in order. A range of up to seven days offers them all.
 * A longer one offers its start, second day, second-last day and end, and days
 * spread between them: the 25%, middle and 75% days from ten days on. Eight and
 * nine days get fewer, so that at least three are left out: a list missing
 * only one or two days reads as broken rather than as a sample.
 */
export function pickDays(days: Date[]): Date[] {
  const n = days.length;
  if (n <= 7) return days;
  const last = n - 1;
  const inner =
    n === 8
      ? [Math.round(last / 2)]
      : n === 9
        ? [1 + Math.round((last - 2) / 3), 1 + Math.round(((last - 2) * 2) / 3)]
        : [Math.round(last * 0.25), Math.round(last * 0.5), Math.round(last * 0.75)];
  const indices = [0, 1, ...inner, last - 1, last];
  return [...new Set(indices)].sort((a, b) => a - b).map((i) => days[i]);
}

export interface DropDateOptions {
  field: DateField;
  /** YYYY-MM-DD, each checked to land the task in the target bucket. */
  days: string[];
  /** For Custom…: the range's first and last day, YYYY-MM-DD. */
  range: { from: string; to: string };
  /**
   * Whether the menu leaves out some day of the range, so Custom… has something
   * to add. A day left out only for failing to land would be rejected anyway.
   */
  offersCustom: boolean;
}

/** Whether giving the task this date, and no pin, puts it in the bucket. */
export function landsIn(
  task: TaskRecord,
  field: DateField,
  day: string,
  bucketId: string,
  settings: PluginSettings,
  now: Date
): boolean {
  const [dated] = parseFile(task.filePath, setDateLine(task.rawLine, field, day, true, settings));
  return dated !== undefined && autoBucketFor(dated, settings, now)?.id === bucketId;
}

/** Null means: pin, no menu. */
export function dropDateOptions(
  task: TaskRecord,
  targetBucketId: string,
  settings: PluginSettings,
  now: Date
): DropDateOptions | null {
  const { planBy } = settings;
  if (planBy === "manual" || targetBucketId === TO_REVIEW_ID) return null;
  const status = statusSymbol(task.rawLine);
  if (status !== " " && status !== "/") return null;

  const range = effectiveRange(targetBucketId, settings.buckets, now, settings.weekStartsOn);
  if (!range) return null;

  const field: DateField =
    planningDate(task, planBy)?.source ?? (planBy === "due-only" || planBy === "due-first" ? "due" : "scheduled");

  const picked = pickDays(range);
  const days = picked.map(dayKey).filter((day) => landsIn(task, field, day, targetBucketId, settings, now));
  if (days.length === 0) return null;

  return {
    field,
    days,
    range: { from: dayKey(range[0]), to: dayKey(range[range.length - 1]) },
    offersCustom: picked.length < range.length,
  };
}
