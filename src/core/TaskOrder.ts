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
 * A saved order position. The file path is stored beside the key rather than
 * hashed into it: that is what turns a file rename into an in-place field
 * rewrite instead of a rehash of every entry belonging to that file.
 */
export interface OrderEntry {
  file: string;
  /** hash(text|dueDate) + ":" + occurrence index within the file. */
  key: string;
}

/** `${file}::${key}` — the identity used to key completionSeen records. */
export function entryId(entry: OrderEntry): string {
  return `${entry.file}::${entry.key}`;
}

export function sameEntry(a: OrderEntry, b: OrderEntry): boolean {
  return a.file === b.file && a.key === b.key;
}

/**
 * Guards against pre-0.2 data.json content, where each saved position was a
 * flat string. Those survive in memory until migrateOrderFormat runs at
 * startup reconciliation, so every consumer must tolerate them.
 */
export function isOrderEntry(value: unknown): value is OrderEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OrderEntry).file === "string" &&
    typeof (value as OrderEntry).key === "string"
  );
}

/**
 * Walks tasks grouped by file in line order, handing each one its
 * disambiguator and the running occurrence index for that disambiguator.
 * Shared by the current and legacy key formats so the two can never drift
 * on occurrence counting.
 */
function forEachWithOccurrence(
  tasks: TaskRecord[],
  cb: (task: TaskRecord, disambig: string, occurrence: number) => void
): void {
  const byFile = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (!byFile.has(task.filePath)) byFile.set(task.filePath, []);
    byFile.get(task.filePath)!.push(task);
  }

  for (const fileTasks of byFile.values()) {
    const sorted = [...fileTasks].sort((a, b) => a.lineNumber - b.lineNumber);
    const occurrenceCount = new Map<string, number>();
    for (const task of sorted) {
      const disambig = disambiguator(task);
      const count = occurrenceCount.get(disambig) ?? 0;
      occurrenceCount.set(disambig, count + 1);
      cb(task, disambig, count);
    }
  }
}

/**
 * Stable identity for persisting a task's manual bucket-order position across
 * reindexes. Excludes lineNumber so it survives unrelated line churn, and
 * excludes the file path from the hash so a rename is a field rewrite. Tasks
 * that still collide (genuinely identical content in one file) are
 * disambiguated by their occurrence order (first gets :0, second :1, ...).
 */
export function computeOrderKeys(tasks: TaskRecord[]): Map<string, OrderEntry> {
  const result = new Map<string, OrderEntry>();
  forEachWithOccurrence(tasks, (task, disambig, occurrence) => {
    result.set(task.id, {
      file: task.filePath,
      key: `${hashString(disambig)}:${occurrence}`,
    });
  });
  return result;
}

/**
 * The pre-0.2 key format: file path folded into the hash, stored as a bare
 * string. Used only by migrateOrderFormat, to match saved flat keys against
 * the tasks currently in the vault.
 */
export function computeLegacyOrderKeys(tasks: TaskRecord[]): Map<string, string> {
  const result = new Map<string, string>();
  forEachWithOccurrence(tasks, (task, disambig, occurrence) => {
    result.set(task.id, `${hashString(`${task.filePath}:${disambig}`)}:${occurrence}`);
  });
  return result;
}

/**
 * Sorts `tasks` to match `savedOrder`. Tasks with no match — new tasks, or
 * stale/unmatched entries — are appended at the end in their original
 * relative order.
 */
export function applyManualOrder(
  tasks: TaskRecord[],
  orderEntries: Map<string, OrderEntry>,
  savedOrder: OrderEntry[]
): TaskRecord[] {
  const byEntry = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const entry = orderEntries.get(task.id);
    if (entry) byEntry.set(entryId(entry), task);
  }

  const result: TaskRecord[] = [];
  const used = new Set<string>();
  for (const entry of savedOrder) {
    if (!isOrderEntry(entry)) continue;
    const task = byEntry.get(entryId(entry));
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

/** Resolves task ids to their order entries, dropping any that don't resolve. */
export function mapToOrderEntries(
  taskIds: string[],
  orderEntries: Map<string, OrderEntry>
): OrderEntry[] {
  return taskIds
    .map((id) => orderEntries.get(id))
    .filter((e): e is OrderEntry => e !== undefined);
}

/**
 * Removes `entry` from every bucket's array in `taskOrder`. Returns a new
 * record (does not mutate the input) and whether anything changed.
 */
export function purgeOrderEntry(
  taskOrder: Record<string, OrderEntry[]>,
  entry: OrderEntry
): { taskOrder: Record<string, OrderEntry[]>; changed: boolean } {
  let changed = false;
  const result: Record<string, OrderEntry[]> = {};
  for (const [bucketId, saved] of Object.entries(taskOrder)) {
    const filtered = saved.filter((e) => !(isOrderEntry(e) && sameEntry(e, entry)));
    if (filtered.length !== saved.length) {
      changed = true;
      result[bucketId] = filtered;
    } else {
      result[bucketId] = saved;
    }
  }
  return { taskOrder: result, changed };
}

/**
 * Whether this plugin watched the task get completed during the running
 * session. `completionSeen` is deliberately never written to data.json, so
 * after a reload this is false for everything and no completed task shows.
 *
 * The ✅ date is NOT consulted: it records the day, not the session, so it
 * cannot tell a completion the user just performed from one they performed
 * this morning before restarting Obsidian.
 */
export function wasCompletionWitnessed(
  entry: OrderEntry | undefined,
  completionSeen: Record<string, number>,
  midnight: number
): boolean {
  if (entry === undefined) return false;
  const seen = completionSeen[entryId(entry)];
  // The midnight bound still applies: a session left running overnight should
  // let yesterday's completions go, not hold them until the app restarts.
  return typeof seen === "number" && seen >= midnight;
}

/** A completed recurrence has already been replaced by its next occurrence. */
export function isRecurring(task: TaskRecord): boolean {
  return task.recurrence !== null;
}
