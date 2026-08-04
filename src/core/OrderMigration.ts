import { TaskRecord } from "./TaskParser";
import { computeOrderKeys, computeLegacyOrderKeys, isOrderEntry } from "./TaskOrder";
import type { OrderEntry } from "./TaskOrder";

/**
 * What changed in one file between two parses. All values are bare order
 * keys, never entries: a diff is always scoped to a single file, so the
 * `file` half of an entry is implied by the caller.
 */
export interface TaskDiff {
  /** In-place edits: the task kept its position, its content key changed. */
  rekeys: Array<{ from: string; to: string }>;
  /** Keys that went open → completed, whether or not a ✅ date was written. */
  completed: string[];
  /** Keys that went completed → open. */
  reopened: string[];
}

/**
 * Tiered pairing of an old and new parse of the same file. Tier 1: keys that
 * match on both sides are unchanged. Tier 2: an unmatched old and unmatched
 * new task on the same line number is an in-place edit. Tier 3: exactly one
 * leftover on each side, anywhere in the file, is an edit too. Anything more
 * ambiguous degrades to add/delete — a wrong pairing would silently move
 * someone else's task, which is worse than losing one position.
 */
export function diffFileTasks(oldTasks: TaskRecord[], newTasks: TaskRecord[]): TaskDiff {
  const oldByKey = keyTasks(oldTasks);
  const newByKey = keyTasks(newTasks);

  const diff: TaskDiff = { rekeys: [], completed: [], reopened: [] };

  const unmatchedOld = new Map(oldByKey);
  const unmatchedNew = new Map(newByKey);

  for (const [key, newTask] of newByKey) {
    const oldTask = oldByKey.get(key);
    if (!oldTask) continue;
    unmatchedOld.delete(key);
    unmatchedNew.delete(key);
    recordCompletion(diff, oldTask, newTask, key);
  }

  for (const [newKey, newTask] of [...unmatchedNew]) {
    for (const [oldKey, oldTask] of unmatchedOld) {
      if (oldTask.lineNumber !== newTask.lineNumber) continue;
      pair(diff, oldKey, oldTask, newKey, newTask);
      unmatchedOld.delete(oldKey);
      unmatchedNew.delete(newKey);
      break;
    }
  }

  if (unmatchedOld.size === 1 && unmatchedNew.size === 1) {
    const [oldKey, oldTask] = [...unmatchedOld][0];
    const [newKey, newTask] = [...unmatchedNew][0];
    pair(diff, oldKey, oldTask, newKey, newTask);
  }

  return diff;
}

function keyTasks(tasks: TaskRecord[]): Map<string, TaskRecord> {
  const entries = computeOrderKeys(tasks);
  const result = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const entry = entries.get(task.id);
    if (entry) result.set(entry.key, task);
  }
  return result;
}

function pair(
  diff: TaskDiff,
  oldKey: string,
  oldTask: TaskRecord,
  newKey: string,
  newTask: TaskRecord
): void {
  diff.rekeys.push({ from: oldKey, to: newKey });
  recordCompletion(diff, oldTask, newTask, newKey);
}

function recordCompletion(
  diff: TaskDiff,
  oldTask: TaskRecord,
  newTask: TaskRecord,
  key: string
): void {
  if (!oldTask.isCompleted && newTask.isCompleted) {
    diff.completed.push(key);
  } else if (oldTask.isCompleted && !newTask.isCompleted) {
    diff.reopened.push(key);
  }
}

/** The two data.json fields this plugin migrates and purges together. */
export interface OrderState {
  taskOrder: Record<string, OrderEntry[]>;
  completionSeen: Record<string, number>;
}

/**
 * Folds one file's diff into saved order: rekeyed entries are rewritten
 * where they sit (position untouched), and witnessed completion transitions
 * are recorded or cleared. `now` is injected so this stays pure.
 */
export function applyTaskDiff(
  state: OrderState,
  filePath: string,
  diff: TaskDiff,
  now: number
): { state: OrderState; changed: boolean } {
  let changed = false;
  const rekeyMap = new Map(diff.rekeys.map((r) => [r.from, r.to]));

  const taskOrder: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(state.taskOrder)) {
    taskOrder[bucketId] = entries.map((entry) => {
      if (!isOrderEntry(entry) || entry.file !== filePath) return entry;
      const to = rekeyMap.get(entry.key);
      if (to === undefined || to === entry.key) return entry;
      changed = true;
      return { file: filePath, key: to };
    });
  }

  const completionSeen = { ...state.completionSeen };
  for (const { from, to } of diff.rekeys) {
    if (from === to) continue;
    const fromId = `${filePath}::${from}`;
    if (fromId in completionSeen) {
      completionSeen[`${filePath}::${to}`] = completionSeen[fromId];
      delete completionSeen[fromId];
      changed = true;
    }
  }
  for (const key of diff.completed) {
    completionSeen[`${filePath}::${key}`] = now;
    changed = true;
  }
  for (const key of diff.reopened) {
    const id = `${filePath}::${key}`;
    if (id in completionSeen) {
      delete completionSeen[id];
      changed = true;
    }
  }

  return { state: { taskOrder, completionSeen }, changed };
}

/**
 * Rewrites the `file` half of every entry belonging to a renamed file, and
 * the matching completionSeen keys. Structurally lossless — nothing is
 * rehashed and no array position moves.
 */
export function renameFileInState(
  state: OrderState,
  oldPath: string,
  newPath: string
): { state: OrderState; changed: boolean } {
  let changed = false;

  const taskOrder: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(state.taskOrder)) {
    taskOrder[bucketId] = entries.map((entry) => {
      if (!isOrderEntry(entry) || entry.file !== oldPath) return entry;
      changed = true;
      return { file: newPath, key: entry.key };
    });
  }

  const completionSeen: Record<string, number> = {};
  const prefix = `${oldPath}::`;
  for (const [id, at] of Object.entries(state.completionSeen)) {
    if (id.startsWith(prefix)) {
      completionSeen[`${newPath}::${id.slice(prefix.length)}`] = at;
      changed = true;
    } else {
      completionSeen[id] = at;
    }
  }

  return { state: { taskOrder, completionSeen }, changed };
}

/**
 * One-time upgrade of pre-0.2 data.json: each saved position used to be a
 * flat `hash(filePath:text|due):occurrence` string. Recomputing both formats
 * for every currently-indexed task gives an exact old→new mapping, so this
 * is lossless for every task still in the vault; genuine orphans are dropped.
 * Must run only after initialScan resolves, or in-scope files that hadn't
 * loaded yet would look like orphans.
 */
export function migrateOrderFormat(
  taskOrder: Record<string, unknown[]>,
  tasks: TaskRecord[]
): { taskOrder: Record<string, OrderEntry[]>; changed: boolean } {
  const legacy = computeLegacyOrderKeys(tasks);
  const current = computeOrderKeys(tasks);

  const byLegacyKey = new Map<string, OrderEntry>();
  for (const task of tasks) {
    const legacyKey = legacy.get(task.id);
    const entry = current.get(task.id);
    if (legacyKey && entry) byLegacyKey.set(legacyKey, entry);
  }

  let changed = false;
  const result: Record<string, OrderEntry[]> = {};
  for (const [bucketId, saved] of Object.entries(taskOrder)) {
    const migrated: OrderEntry[] = [];
    for (const value of saved) {
      if (isOrderEntry(value)) {
        migrated.push(value);
        continue;
      }
      changed = true;
      if (typeof value !== "string") continue;
      const entry = byLegacyKey.get(value);
      if (entry) migrated.push(entry);
    }
    result[bucketId] = migrated;
  }

  return { taskOrder: result, changed };
}
