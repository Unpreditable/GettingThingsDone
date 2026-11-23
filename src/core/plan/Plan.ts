import { purgeOrderEntry } from "../TaskOrder";
import type { OrderEntry } from "../TaskOrder";
import type { PlanFields } from "./PlanFields";

export type PlannedChange = Partial<PlanFields> & {
  /** The bucket change came from a date pick that unpins; "Revert: date" undoes it too. */
  unpinnedByDate?: true;
};

export interface PlanSnapshot {
  /** Entry id → change. */
  changes: Record<string, PlannedChange>;
  /** A full copy of the saved order, keyed by the real tasks' keys. */
  taskOrder: Record<string, OrderEntry[]>;
}

export interface DroppedChange {
  entryId: string;
  hash: string;
  text: string;
  change: PlannedChange;
}

export interface Conflict {
  entryId: string;
  field: "bucket" | "due" | "scheduled";
  text: string;
  file: string;
}

export interface Plan {
  current: PlanSnapshot;
  past: PlanSnapshot[];
  future: PlanSnapshot[];
  /** Entry ids present when the plan started, carried through rekeys: the tasks Revert can link back to. */
  originals: string[];
  dropped: DroppedChange[];
  /** Entry ids the plan lost (dropped, or a conflict answered "use the note's version"): undo stops at them. */
  lost: string[];
  conflicts: Conflict[];
}

export interface PlanStep {
  /** Per entry: the change to merge in, and the real fields to compare against. */
  changes?: Record<string, { change: PlannedChange; real: PlanFields }>;
  /** Removes this entry from every bucket's order before `order` is written (a cross-bucket move). */
  purge?: OrderEntry;
  order?: { bucketId: string; entries: OrderEntry[] };
}

export const HISTORY_LIMIT = 100;

const FIELDS = ["bucket", "due", "scheduled"] as const;

function copyOrder(taskOrder: Record<string, OrderEntry[]>): Record<string, OrderEntry[]> {
  const copy: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(taskOrder)) copy[bucketId] = [...entries];
  return copy;
}

/** JSON with sorted object keys, so two equal values always compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}

function hasField(change: PlannedChange): boolean {
  return FIELDS.some((field) => field in change);
}

export function startPlan(taskOrder: Record<string, OrderEntry[]>, entryIds: string[]): Plan {
  return {
    current: { changes: {}, taskOrder: copyOrder(taskOrder) },
    past: [],
    future: [],
    originals: [...entryIds],
    dropped: [],
    lost: [],
    conflicts: [],
  };
}

/** The snapshot after merging `step`, or the same object when nothing changed. */
function applyStep(snapshot: PlanSnapshot, step: PlanStep): PlanSnapshot {
  const changes = { ...snapshot.changes };
  for (const [id, { change, real }] of Object.entries(step.changes ?? {})) {
    const merged: PlannedChange = { ...changes[id], ...change };
    if ("bucket" in change && !change.unpinnedByDate) delete merged.unpinnedByDate;
    for (const field of FIELDS) {
      if (field in merged && merged[field] === real[field]) delete merged[field];
    }
    if (!("bucket" in merged)) delete merged.unpinnedByDate;
    if (hasField(merged)) changes[id] = merged;
    else delete changes[id];
  }

  let taskOrder = snapshot.taskOrder;
  if (step.purge) taskOrder = purgeOrderEntry(taskOrder, step.purge).taskOrder;
  if (step.order) taskOrder = { ...taskOrder, [step.order.bucketId]: [...step.order.entries] };

  const next = { changes, taskOrder };
  return canonical(next) === canonical(snapshot) ? snapshot : next;
}

/** One undo step. Clears redo. */
export function planStep(plan: Plan, step: PlanStep): Plan {
  return planSteps(plan, [step]);
}

/** Several steps as one undo step, such as a parent dragged with its pinned subtasks. */
export function planSteps(plan: Plan, steps: PlanStep[]): Plan {
  const next = steps.reduce(applyStep, plan.current);
  if (next === plan.current) return plan;
  return {
    ...plan,
    current: next,
    past: [...plan.past, plan.current].slice(-HISTORY_LIMIT),
    future: [],
  };
}

export function undoBlocked(plan: Plan): boolean {
  const previous = plan.past[plan.past.length - 1];
  if (!previous) return false;
  return plan.lost.some(
    (id) => canonical(previous.changes[id] ?? null) !== canonical(plan.current.changes[id] ?? null)
  );
}

export function undo(plan: Plan): Plan {
  if (plan.past.length === 0 || undoBlocked(plan)) return plan;
  return {
    ...plan,
    current: plan.past[plan.past.length - 1],
    past: plan.past.slice(0, -1),
    future: [plan.current, ...plan.future],
  };
}

export function redo(plan: Plan): Plan {
  if (plan.future.length === 0) return plan;
  return {
    ...plan,
    current: plan.future[0],
    past: [...plan.past, plan.current].slice(-HISTORY_LIMIT),
    future: plan.future.slice(1),
  };
}

export function canRevert(plan: Plan, entryId: string): { bucket: boolean; date: boolean } {
  const change = plan.current.changes[entryId];
  if (!change || !plan.originals.includes(entryId)) return { bucket: false, date: false };
  return {
    bucket: "bucket" in change && !change.unpinnedByDate,
    date: "due" in change || "scheduled" in change,
  };
}

/** Puts the real value back, as one undo step. A bucket a date pick unpinned goes back with the date. */
export function revert(plan: Plan, entryId: string, what: "bucket" | "date", real: PlanFields): Plan {
  const existing = plan.current.changes[entryId];
  if (!existing) return plan;
  const change: PlannedChange =
    what === "bucket"
      ? { bucket: real.bucket }
      : {
          due: real.due,
          scheduled: real.scheduled,
          ...(existing.unpinnedByDate ? { bucket: real.bucket } : {}),
        };
  return planStep(plan, { changes: { [entryId]: { change, real } } });
}

/** Not an undo step. "note" drops the plan's field and marks the task lost; "plan" keeps it. */
export function answerConflict(plan: Plan, conflict: Conflict, choice: "note" | "plan"): Plan {
  const conflicts = plan.conflicts.filter(
    (c) => !(c.entryId === conflict.entryId && c.field === conflict.field)
  );
  if (choice === "plan") return { ...plan, conflicts };

  const changes = { ...plan.current.changes };
  const existing = changes[conflict.entryId];
  if (existing) {
    const change: PlannedChange = { ...existing };
    if (conflict.field === "bucket") {
      delete change.bucket;
      delete change.unpinnedByDate;
    } else {
      delete change[conflict.field];
    }
    if (hasField(change)) changes[conflict.entryId] = change;
    else delete changes[conflict.entryId];
  }
  return {
    ...plan,
    current: { ...plan.current, changes },
    lost: plan.lost.includes(conflict.entryId) ? plan.lost : [...plan.lost, conflict.entryId],
    conflicts,
  };
}
