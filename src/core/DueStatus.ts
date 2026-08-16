import type { BucketConfig, DateRangeRule, PlanBy } from "../settings";
import type { TaskRecord } from "./TaskParser";
import { planningDate } from "./PlanningDate";

/** Whole-day difference between two dates, ignoring clock time. */
export function diffInDays(date: Date, now: Date): number {
  const d = new Date(date);
  const n = new Date(now);
  d.setHours(0, 0, 0, 0);
  n.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - n.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Whether `rule` claims `dueDate`. This is the single source of truth for
 * both auto-placement and the misfiled flag. They used to be two separate
 * switches over the same eight rule types, maintained by hand, and they
 * drifted: a task due today filed in This Week was reported as "overdue".
 */
export function matchesRule(rule: DateRangeRule, dueDate: Date, now: Date): boolean {
  const diff = diffInDays(dueDate, now);
  const day = now.getDay();

  switch (rule.type) {
    case "today":
      return diff <= 0;

    case "this-week": {
      const daysToSunday = day === 0 ? 0 : 7 - day;
      return diff >= 1 && diff <= daysToSunday;
    }

    case "next-week": {
      const daysToNextMonday = day === 0 ? 1 : 8 - day;
      return diff >= daysToNextMonday && diff <= daysToNextMonday + 6;
    }

    case "this-month": {
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return diff >= 1 && diff <= diffInDays(endOfMonth, now);
    }

    case "next-month": {
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      return diff >= diffInDays(startOfNextMonth, now) && diff <= diffInDays(endOfNextMonth, now);
    }

    case "within-days":
      return diff >= 1 && diff <= rule.days;

    case "within-days-range":
      return diff >= rule.from && diff <= rule.to;

    case "beyond-days":
      return diff > rule.days;

    // Only meaningful on the last bucket, autoAssign being first-match-wins.
    case "catch-all":
      return true;
  }
}

export type DueStatus =
  | { kind: "overdue"; diffDays: number }
  | { kind: "on-track"; diffDays: number };

/**
 * How a task stands against its 📅 due date, ignoring `planBy` on purpose: a ⏳
 * that has come and gone means the task is being handled early, which is what
 * scheduling it was for.
 */
export function computeDueStatus(task: TaskRecord, now: Date): DueStatus | null {
  const dueDate = task.dueDate;
  if (!dueDate) return null;

  const diffDays = diffInDays(dueDate, now);
  if (task.isCompleted) return { kind: "on-track", diffDays };

  return diffDays < 0 ? { kind: "overdue", diffDays } : { kind: "on-track", diffDays };
}

/**
 * The bucket a task should be in but isn't.
 *
 * Walks the buckets in the same first-match order autoAssign does, over the same
 * planning date. Bucket ranges overlap (This Month's contains This Week's), so
 * any second ordering here would contradict where the task was actually placed.
 *
 * `autoIdx < curIdx` rather than `!==`: pulling a task forward into a sooner
 * bucket is a choice, not a mistake.
 */
export function computeMisplacement(
  task: TaskRecord,
  currentBucketId: string,
  buckets: BucketConfig[],
  planBy: PlanBy,
  now: Date
): BucketConfig | null {
  if (task.isCompleted) return null;

  const plan = planningDate(task, planBy);
  if (!plan) return null;

  // To Review already means "needs attention", so a badge saying so inside it
  // is redundant. It isn't in settings.buckets, which also makes this the
  // catch-all for a bucket id that no longer exists.
  const curIdx = buckets.findIndex((b) => b.id === currentBucketId);
  if (curIdx === -1) return null;

  const autoIdx = buckets.findIndex(
    (b) => b.dateRangeRule && matchesRule(b.dateRangeRule, plan.date, now)
  );
  return autoIdx !== -1 && autoIdx < curIdx ? buckets[autoIdx] : null;
}

/** Local calendar day as YYYY-MM-DD — the day a render is valid for. */
export function dayKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Wall-clock milliseconds until one second past the next local midnight.
 * Built from date parts rather than by adding 24h so it stays correct across
 * DST transitions, where a local day can be 23 or 25 hours long.
 */
export function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  return next.getTime() - now.getTime();
}
