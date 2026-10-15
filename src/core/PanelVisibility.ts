import type { BucketGroup } from "./BucketManager";
import { hideFilterText } from "./TaskParser";
import type { TaskRecord } from "./TaskParser";

/** The completed tasks a bucket shows: ticked this session, and not dismissed or aged out. */
export function visibleCompleted(group: BucketGroup, untilMidnight: boolean): TaskRecord[] {
  if (!untilMidnight) return [];
  const aged = new Set(group.agedCompletedTaskIds);
  return group.tasks.filter((t) => t.isCompleted && !aged.has(t.id));
}

/** What a bucket lists: its open tasks, and the completed ones still on screen. */
export function shownTasks(group: BucketGroup, untilMidnight: boolean): TaskRecord[] {
  const completed = new Set(visibleCompleted(group, untilMidnight));
  return group.tasks.filter((t) => !t.isCompleted || completed.has(t));
}

export function countShown(groups: BucketGroup[], untilMidnight: boolean): number {
  return groups.reduce((n, g) => n + shownTasks(g, untilMidnight).length, 0);
}

/**
 * The buckets narrowed to the tasks matching a search. A bucket is kept only
 * if it lists one of them: a completed task the panel hides still matches,
 * and would keep its bucket on screen with nothing in it.
 */
export function searchBuckets(
  groups: BucketGroup[],
  query: string,
  hiddenStrings: string[],
  untilMidnight: boolean
): BucketGroup[] {
  if (query === "") return groups;
  const needle = query.toLowerCase();
  return groups
    .map((g) => ({
      ...g,
      tasks: g.tasks.filter((t) => hideFilterText(t.text, hiddenStrings).toLowerCase().includes(needle)),
    }))
    .filter((g) => shownTasks(g, untilMidnight).length > 0);
}
