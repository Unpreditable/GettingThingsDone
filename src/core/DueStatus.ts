import type { BucketConfig, DateRangeRule } from "../settings";
import type { TaskRecord } from "./TaskParser";

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
  }
}

export type DueStatus =
  | { kind: "overdue"; diffDays: number }
  | { kind: "misfiled"; diffDays: number; belongsIn: BucketConfig }
  | { kind: "on-track"; diffDays: number };

/**
 * Which flag, if any, a dated task earns in the bucket it currently sits in.
 * Returns null for a task with no due date — there is nothing to say about it.
 *
 * "Misfiled" means a bucket EARLIER in the user's list already claims this
 * due date, so the task is filed later than the date warrants. Deliberately
 * pulling a task forward into a sooner bucket is a choice, not a mistake, so
 * the comparison is `autoIdx < curIdx` rather than `autoIdx !== curIdx`.
 *
 * Bucket order is the tie-break because ranges deliberately overlap (This
 * Month's range contains This Week's). Reusing autoAssign's own first-match
 * ordering is what guarantees this flag can never contradict the auto-placed
 * badge on the same row.
 */
export function computeDueStatus(
  task: TaskRecord,
  currentBucketId: string,
  buckets: BucketConfig[],
  now: Date
): DueStatus | null {
  const dueDate = task.dueDate;
  if (!dueDate) return null;

  const diffDays = diffInDays(dueDate, now);
  if (task.isCompleted) return { kind: "on-track", diffDays };

  // To Review already means "needs attention", so a badge saying so inside it
  // is redundant. It isn't in settings.buckets, which also makes this the
  // catch-all for a bucket id that no longer exists.
  const curIdx = buckets.findIndex((b) => b.id === currentBucketId);
  if (curIdx === -1) return { kind: "on-track", diffDays };

  if (diffDays < 0) return { kind: "overdue", diffDays };

  const autoIdx = buckets.findIndex(
    (b) => b.dateRangeRule && matchesRule(b.dateRangeRule, dueDate, now)
  );
  if (autoIdx !== -1 && autoIdx < curIdx) {
    return { kind: "misfiled", diffDays, belongsIn: buckets[autoIdx] };
  }

  return { kind: "on-track", diffDays };
}
