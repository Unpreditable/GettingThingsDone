import type { TaskRecord } from "./TaskParser";

/** Why an open task can't be done yet. */
export interface WaitingInfo {
  /** The 🛫 date, set only while it is after today. */
  startsOn: Date | null;
  /** Open tasks whose 🆔 matches one of this task's ⛔ ids, in ⛔ order. */
  blockedBy: TaskRecord[];
  /** True when at least one ⛔ id matches no indexed task. Such an id doesn't
   *  block: its task may be outside the panel's scope, deleted, or mistyped. */
  missingDependency: boolean;
}

/**
 * The waiting state of every open task that has one, keyed by task id. Each
 * task is judged on its own fields: a subtask doesn't inherit its parent's.
 *
 * Blocking follows Tasks: a task waits while any task it depends on is still
 * open, and a done or cancelled one no longer counts.
 */
export function computeWaiting(tasks: TaskRecord[], now: Date): Map<string, WaitingInfo> {
  const byTasksId = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (task.tasksId === null) continue;
    const carriers = byTasksId.get(task.tasksId);
    if (carriers) carriers.push(task);
    else byTasksId.set(task.tasksId, [task]);
  }

  const result = new Map<string, WaitingInfo>();
  for (const task of tasks) {
    if (task.isCompleted) continue;

    const startsOn = task.startDate && task.startDate.getTime() > now.getTime() ? task.startDate : null;
    const blockedBy: TaskRecord[] = [];
    let missingDependency = false;
    for (const id of task.dependsOn) {
      const carriers = byTasksId.get(id);
      if (!carriers) {
        missingDependency = true;
        continue;
      }
      for (const blocker of carriers) {
        if (blocker !== task && !blocker.isCompleted && !blockedBy.includes(blocker)) blockedBy.push(blocker);
      }
    }

    if (startsOn || blockedBy.length > 0 || missingDependency) {
      result.set(task.id, { startsOn, blockedBy, missingDependency });
    }
  }
  return result;
}

/** A missing dependency alone leaves the row as it is. */
export function isDimmed(waiting: WaitingInfo): boolean {
  return waiting.startsOn !== null || waiting.blockedBy.length > 0;
}
