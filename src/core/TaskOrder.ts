import { TaskRecord } from "./TaskParser";

export function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

/**
 * Content used to distinguish tasks with identical visible text: due date,
 * but NOT tags/inlineField/isCompleted/completedAt. Tags and inlineField are
 * excluded deliberately, not just for parsimony: bucket assignment itself is
 * stored as a tag (inline-tag mode) or inline field (inline-field mode), so a
 * cross-bucket move rewrites exactly that data. computeOrderKeys is called
 * once right after the write (before TaskIndex's async reindex has caught
 * up, still seeing the old tag/field) and again on the next render (after
 * reindex, seeing the new one) — including them here made a moved task hash
 * differently between those two calls, so its freshly-saved order key never
 * matched on the next render and it fell back to "no saved key, append at
 * the end" every time. isCompleted/completedAt are excluded for the same
 * reason: they flip on every checkbox toggle and must not perturb order.
 */
function disambiguator(task: TaskRecord): string {
  const due = task.dueDate ? task.dueDate.toISOString() : "";
  return `${task.text}|${due}`;
}

/**
 * Stable identity for persisting a task's manual bucket-order position across
 * reindexes. Unlike TaskRecord.id (hash of filePath+lineNumber+text), this
 * excludes lineNumber so it survives unrelated line churn elsewhere in the
 * file. Tasks that still collide after including due date/tags/inline field
 * (genuinely identical content) are disambiguated by their occurrence order
 * (first gets :0, second gets :1, ...).
 */
export function computeOrderKeys(tasks: TaskRecord[]): Map<string, string> {
  const byFile = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (!byFile.has(task.filePath)) byFile.set(task.filePath, []);
    byFile.get(task.filePath)!.push(task);
  }

  const result = new Map<string, string>();
  for (const [filePath, fileTasks] of byFile) {
    const sorted = [...fileTasks].sort((a, b) => a.lineNumber - b.lineNumber);
    const occurrenceCount = new Map<string, number>();
    for (const task of sorted) {
      const disambig = disambiguator(task);
      const count = occurrenceCount.get(disambig) ?? 0;
      occurrenceCount.set(disambig, count + 1);
      result.set(task.id, `${hashString(`${filePath}:${disambig}`)}:${count}`);
    }
  }
  return result;
}

/**
 * Sorts `tasks` to match `savedOrder` (order keys in the desired sequence).
 * Tasks with no match in `savedOrder` — new tasks, or stale/unmatched keys —
 * are appended at the end in their original relative order.
 */
export function applyManualOrder(
  tasks: TaskRecord[],
  orderKeys: Map<string, string>,
  savedOrder: string[]
): TaskRecord[] {
  const byKey = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const key = orderKeys.get(task.id);
    if (key) byKey.set(key, task);
  }

  const result: TaskRecord[] = [];
  const used = new Set<string>();
  for (const key of savedOrder) {
    const task = byKey.get(key);
    if (task && !used.has(task.id)) {
      result.push(task);
      used.add(task.id);
    }
  }
  for (const task of tasks) {
    if (!used.has(task.id)) result.push(task);
  }
  return result;
}

/** Resolves task ids to their stable order keys, dropping any that don't resolve. */
export function mapToOrderKeys(taskIds: string[], orderKeys: Map<string, string>): string[] {
  return taskIds
    .map((id) => orderKeys.get(id))
    .filter((k): k is string => k !== undefined);
}

/**
 * Removes `key` from every bucket's array in `taskOrder`. Returns a new
 * record (does not mutate the input) and whether anything changed.
 */
export function purgeOrderKey(
  taskOrder: Record<string, string[]>,
  key: string
): { taskOrder: Record<string, string[]>; changed: boolean } {
  let changed = false;
  const result: Record<string, string[]> = {};
  for (const [bucketId, saved] of Object.entries(taskOrder)) {
    if (saved.includes(key)) {
      result[bucketId] = saved.filter((k) => k !== key);
      changed = true;
    } else {
      result[bucketId] = saved;
    }
  }
  return { taskOrder: result, changed };
}
