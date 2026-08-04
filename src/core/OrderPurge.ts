import { TaskRecord } from "./TaskParser";
import { computeOrderKeys, entryId, isOrderEntry, isRecurring, wasCompletionWitnessed } from "./TaskOrder";
import type { OrderEntry } from "./TaskOrder";
import type { OrderState } from "./OrderMigration";

function startOfDay(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function indexByEntryId(tasks: TaskRecord[]): Map<string, { task: TaskRecord; entry: OrderEntry }> {
  const entries = computeOrderKeys(tasks);
  const result = new Map<string, { task: TaskRecord; entry: OrderEntry }>();
  for (const task of tasks) {
    const entry = entries.get(task.id);
    if (entry) result.set(entryId(entry), { task, entry });
  }
  return result;
}

/**
 * Releases positions held by completions that are no longer "today". Runs on
 * every index change, riding on work that already happens — no timer. An
 * entry is only purged when its task is actually present in the index, so a
 * partially-loaded vault can never cause a loss. A completed task with no
 * clock at all (completion never witnessed by this plugin, no ✅ date) counts
 * as aged, which is what stops it lingering forever.
 */
export function purgeAgedEntries(
  state: OrderState,
  tasks: TaskRecord[],
  now: Date
): { state: OrderState; changed: boolean } {
  const midnight = startOfDay(now);
  const byId = indexByEntryId(tasks);
  let changed = false;

  const taskOrder: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(state.taskOrder)) {
    const kept = entries.filter((entry) => {
      if (!isOrderEntry(entry)) return true;
      const found = byId.get(entryId(entry));
      if (!found || !found.task.isCompleted) return true;
      // Same rule the panel renders by: a completed task keeps its slot only
      // while it is still on screen, i.e. while this session witnessed it.
      return !isRecurring(found.task) && wasCompletionWitnessed(entry, state.completionSeen, midnight);
    });
    if (kept.length !== entries.length) changed = true;
    taskOrder[bucketId] = kept;
  }

  const completionSeen: Record<string, number> = {};
  for (const [id, at] of Object.entries(state.completionSeen)) {
    if (at >= midnight) completionSeen[id] = at;
    else changed = true;
  }

  return { state: { taskOrder, completionSeen }, changed };
}

/**
 * Drops entries whose task is genuinely gone. Only safe once initialScan has
 * resolved, since it needs a complete view of every scoped file. An entry
 * whose file exists but is OUT OF SCOPE is kept dormant: narrowing scope is
 * reversible and must never be treated as a deletion. Dormant entries still
 * go when their file is really deleted.
 */
export function reconcileDanglingEntries(
  state: OrderState,
  tasks: TaskRecord[],
  fileExists: (path: string) => boolean,
  inScope: (path: string) => boolean
): { state: OrderState; changed: boolean } {
  const byId = indexByEntryId(tasks);
  let changed = false;

  const isDangling = (file: string, id: string): boolean => {
    if (!fileExists(file)) return true;
    if (!inScope(file)) return false;
    return !byId.has(id);
  };

  const taskOrder: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(state.taskOrder)) {
    const kept = entries.filter(
      (entry) => !isOrderEntry(entry) || !isDangling(entry.file, entryId(entry))
    );
    if (kept.length !== entries.length) changed = true;
    taskOrder[bucketId] = kept;
  }

  const completionSeen: Record<string, number> = {};
  for (const [id, at] of Object.entries(state.completionSeen)) {
    const separator = id.lastIndexOf("::");
    const file = separator === -1 ? id : id.slice(0, separator);
    if (isDangling(file, id)) changed = true;
    else completionSeen[id] = at;
  }

  return { state: { taskOrder, completionSeen }, changed };
}
