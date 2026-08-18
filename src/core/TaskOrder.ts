import { TaskRecord } from "./TaskParser";
import type { PlanBy } from "../settings";
import { planningDate } from "./PlanningDate";

/**
 * Which date the key hashes. "dual-date" is the pre-planBy scheme, kept so
 * migrateOrderKeys can recognise entries written before this release.
 */
export type OrderKeyScheme = PlanBy | "dual-date";

export function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

/**
 * Content used to distinguish tasks with identical visible text.
 *
 * HARD INVARIANT: only fields this plugin's own actions NEVER write may appear
 * here. Every field below is read-only today — no GTD-Tasks action mutates a
 * priority, a recurrence rule, or any date but 📅 — but that is incidental to
 * current scope, not structural. Adding a write path for one of them (a "bump
 * priority" quick action, say) reintroduces the bug fixed on 2026-07-22:
 * `tags`/`inlineField` were in this hash while `moveTaskToBucket` writes
 * exactly those, so computeOrderKeys — called once right after the write, with
 * TaskIndex's async reindex not yet caught up, and again on the next render
 * after it has — produced two different keys for the same task. Its
 * freshly-saved key never matched, and every cross-bucket drop landed at the
 * bucket's end. Check this invariant before adding anything here.
 *
 * isCompleted/completedAt are excluded for the same reason: they flip on every
 * checkbox toggle and must not perturb order.
 *
 * Each extra is key-prefixed so a priority of "high" cannot collide with a
 * recurrence rule reading "high".
 *
 * Only the PLANNING date is hashed, so editing a date the active planBy
 * ignores leaves the key alone. The cost is that under a mode yielding no
 * planning date, tasks sharing text fall through to the occurrence index.
 */
function disambiguator(task: TaskRecord, scheme: OrderKeyScheme): string {
  const dual = scheme === "dual-date";
  const keyDate = dual ? task.dueDate : planningDate(task, scheme)?.date ?? null;
  const base = `${task.text}|${keyDate ? keyDate.toISOString() : ""}`;
  const extras = [
    task.priority && `p:${task.priority}`,
    task.recurrence && `r:${task.recurrence}`,
    dual && task.scheduledDate && `s:${task.scheduledDate.toISOString()}`,
    task.startDate && `b:${task.startDate.toISOString()}`,
    task.createdDate && `c:${task.createdDate.toISOString()}`,
    task.cancelledDate && `x:${task.cancelledDate.toISOString()}`,
    task.blockId && `i:${task.blockId}`,
  ].filter((e): e is string => Boolean(e));
  return extras.length > 0 ? `${base}|${extras.join("|")}` : base;
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
  scheme: OrderKeyScheme,
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
      const disambig = disambiguator(task, scheme);
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
export function computeOrderKeys(
  tasks: TaskRecord[],
  scheme: OrderKeyScheme
): Map<string, OrderEntry> {
  const result = new Map<string, OrderEntry>();
  forEachWithOccurrence(tasks, scheme, (task, disambig, occurrence) => {
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
  forEachWithOccurrence(tasks, "dual-date", (task, disambig, occurrence) => {
    result.set(task.id, `${hashString(`${task.filePath}:${disambig}`)}:${occurrence}`);
  });
  return result;
}

/**
 * Where each task sits in the first saved array that mentions it, as one
 * ascending sequence across all buckets. Same-dated arrivals sort by this, so
 * a group dragged into an order in one bucket reaches the next one intact.
 *
 * The sequence is global rather than per-bucket to keep the comparator
 * transitive: ranking each task independently by (bucket, position) would not
 * be a total order once a task appears in two arrays.
 */
export function computeArrivalRanks(
  orderEntries: Map<string, OrderEntry>,
  taskOrder: Record<string, OrderEntry[]>
): Map<string, number> {
  const taskIdByEntry = new Map<string, string>();
  for (const [taskId, entry] of orderEntries) taskIdByEntry.set(entryId(entry), taskId);

  const ranks = new Map<string, number>();
  let next = 0;
  for (const saved of Object.values(taskOrder)) {
    for (const entry of saved) {
      if (!isOrderEntry(entry)) continue;
      const taskId = taskIdByEntry.get(entryId(entry));
      if (taskId === undefined || ranks.has(taskId)) continue;
      ranks.set(taskId, next++);
    }
  }
  return ranks;
}

/**
 * Places the tasks `savedOrder` names, then merges the rest in by planning
 * date: an arrival lands after the last SLOT holding a date on or before its
 * own. On a date-sorted list that is "before the first later task"; on a
 * hand-dragged one it degrades to an append, rather than hoisting the arrival
 * above a later task it postdates. Undated tasks go last.
 *
 * Nothing here writes. A bucket nobody has dragged holds no saved order at
 * all, and stays that way — it is re-merged from dates on every render.
 */
export function applyManualOrder(
  tasks: TaskRecord[],
  orderEntries: Map<string, OrderEntry>,
  savedOrder: OrderEntry[],
  planBy: PlanBy,
  arrivalRanks: Map<string, number> = new Map()
): TaskRecord[] {
  const byEntry = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const entry = orderEntries.get(task.id);
    if (entry) byEntry.set(entryId(entry), task);
  }

  const placed: TaskRecord[] = [];
  const used = new Set<string>();
  for (const entry of savedOrder) {
    if (!isOrderEntry(entry)) continue;
    const task = byEntry.get(entryId(entry));
    if (task && !used.has(task.id)) {
      placed.push(task);
      used.add(task.id);
    }
  }

  const dateOf = (task: TaskRecord): number | null =>
    planningDate(task, planBy)?.date.getTime() ?? null;

  // Sorted by date, each carrying the running maximum slot seen so far — that
  // running maximum is what makes a scrambled list append.
  const anchors: Array<{ date: number; upTo: number }> = [];
  for (let i = 0; i < placed.length; i++) {
    const date = dateOf(placed[i]);
    if (date !== null) anchors.push({ date, upTo: i });
  }
  anchors.sort((a, b) => a.date - b.date);
  let running = -1;
  for (const anchor of anchors) {
    running = Math.max(running, anchor.upTo);
    anchor.upTo = running;
  }

  const slotFor = (date: number): number => {
    let lo = 0;
    let hi = anchors.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].date <= date) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found === -1 ? 0 : anchors[found].upTo + 1;
  };

  const arriving = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => !used.has(task.id))
    .map(({ task, index }) => {
      const date = dateOf(task);
      return { task, index, date, slot: date === null ? placed.length : slotFor(date) };
    });

  arriving.sort((a, b) => {
    if (a.slot !== b.slot) return a.slot - b.slot;
    if (a.date === null || b.date === null) {
      if (a.date !== b.date) return a.date === null ? 1 : -1;
    } else if (a.date !== b.date) {
      return a.date - b.date;
    }
    const rankA = arrivalRanks.get(a.task.id);
    const rankB = arrivalRanks.get(b.task.id);
    if (rankA === undefined || rankB === undefined) {
      if (rankA !== rankB) return rankA === undefined ? 1 : -1;
    } else if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.index - b.index;
  });

  const result: TaskRecord[] = [];
  let cursor = 0;
  for (const arrival of arriving) {
    while (cursor < arrival.slot && cursor < placed.length) result.push(placed[cursor++]);
    result.push(arrival.task);
  }
  while (cursor < placed.length) result.push(placed[cursor++]);
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
