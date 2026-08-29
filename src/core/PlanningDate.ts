import type { PlanBy } from "../settings";
import type { TaskRecord } from "./TaskParser";

/**
 * The date a task is planned by. `source` is what the popover marks, so it must
 * stay stable: "earliest" prefers 📅 on a tie for that reason.
 */
export interface PlanningDate {
  date: Date;
  source: "due" | "scheduled";
}

/**
 * Which date governs a task. Placement, the misfiled flag, ordering and the
 * order key must all read this rather than re-derive it, or they drift apart on
 * the overlapping bucket ranges.
 *
 * Null sends the task to To Review: either the mode ignores dates, or the task
 * lacks the field the mode asks for.
 */
export function planningDate(task: TaskRecord, planBy: PlanBy): PlanningDate | null {
  const due = task.dueDate;
  const scheduled = task.scheduledDate;

  switch (planBy) {
    case "manual":
      return null;

    case "due-only":
      return due ? { date: due, source: "due" } : null;

    case "scheduled-only":
      return scheduled ? { date: scheduled, source: "scheduled" } : null;

    case "due-first":
      if (due) return { date: due, source: "due" };
      return scheduled ? { date: scheduled, source: "scheduled" } : null;

    case "scheduled-first":
      if (scheduled) return { date: scheduled, source: "scheduled" };
      return due ? { date: due, source: "due" } : null;

    case "earliest":
      if (due && scheduled) {
        return scheduled.getTime() < due.getTime()
          ? { date: scheduled, source: "scheduled" }
          : { date: due, source: "due" };
      }
      if (due) return { date: due, source: "due" };
      return scheduled ? { date: scheduled, source: "scheduled" } : null;
  }
}
