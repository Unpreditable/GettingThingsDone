import { applyTaskDiff, pairFileTasks, renameFileInState } from "../OrderMigration";
import type { TaskDiff } from "../OrderMigration";
import type { TaskRecord } from "../TaskParser";
import { computeOrderKeys, entryId } from "../TaskOrder";
import type { OrderEntry } from "../TaskOrder";
import { activeOrderKeyScheme } from "../../settings";
import type { PluginSettings } from "../../settings";
import { readPlanFields } from "./PlanFields";
import type { PlanFields } from "./PlanFields";
import type { Conflict, DroppedChange, Plan, PlannedChange, PlanSnapshot } from "./Plan";

const FIELDS = ["bucket", "due", "scheduled"] as const;

function hashOf(id: string): string {
  const key = id.slice(id.lastIndexOf("::") + 2);
  return key.split(":")[0];
}

function renameIds<T>(record: Record<string, T>, map: (id: string) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(record)) out[map(id)] = value;
  return out;
}

/** Rewrites every id and every snapshot's order through `mapId` and `mapOrder`. */
function rekeyPlan(
  plan: Plan,
  mapId: (id: string) => string,
  mapOrder: (taskOrder: Record<string, OrderEntry[]>) => Record<string, OrderEntry[]>
): Plan {
  const snapshot = (s: PlanSnapshot): PlanSnapshot => ({
    changes: renameIds(s.changes, mapId),
    taskOrder: mapOrder(s.taskOrder),
  });
  return {
    ...plan,
    current: snapshot(plan.current),
    past: plan.past.map(snapshot),
    future: plan.future.map(snapshot),
    originals: plan.originals.map(mapId),
    lost: plan.lost.map(mapId),
    conflicts: plan.conflicts.map((c) => ({ ...c, entryId: mapId(c.entryId) })),
  };
}

function withoutFields(change: PlannedChange, real: PlanFields): PlannedChange | null {
  const out: PlannedChange = { ...change };
  for (const field of FIELDS) {
    if (field in out && out[field] === real[field]) delete out[field];
  }
  if (!("bucket" in out)) delete out.unpinnedByDate;
  return FIELDS.some((field) => field in out) ? out : null;
}

function dropChanges(plan: Plan, drops: DroppedChange[]): Plan {
  if (drops.length === 0) return plan;
  const changes = { ...plan.current.changes };
  const lost = [...plan.lost];
  for (const drop of drops) {
    delete changes[drop.entryId];
    if (!lost.includes(drop.entryId)) lost.push(drop.entryId);
  }
  const gone = new Set(drops.map((d) => d.entryId));
  return {
    ...plan,
    current: { ...plan.current, changes },
    dropped: [...plan.dropped, ...drops],
    lost,
    conflicts: plan.conflicts.filter((c) => !gone.has(c.entryId)),
  };
}

/**
 * Follows one file's re-parse: planned changes and the order copies move to
 * the tasks' new keys, a note edit to a field the plan also changed opens a
 * conflict, and a planned task that can't be paired loses its change.
 */
export function syncFileChange(
  plan: Plan,
  filePath: string,
  oldTasks: TaskRecord[],
  newTasks: TaskRecord[],
  settings: PluginSettings
): Plan {
  const scheme = activeOrderKeyScheme(settings);
  const { pairs, unpairedOld } = pairFileTasks(oldTasks, newTasks, scheme);
  const idOf = (key: string) => `${filePath}::${key}`;

  const oldKeys = computeOrderKeys(oldTasks, scheme);
  const drops: DroppedChange[] = [];
  for (const task of unpairedOld) {
    const key = oldKeys.get(task.id)?.key;
    const id = key === undefined ? undefined : idOf(key);
    if (id && id in plan.current.changes) {
      drops.push({ entryId: id, hash: hashOf(id), text: task.text, change: plan.current.changes[id] });
    }
  }
  let next = dropChanges(plan, drops);

  const diff: TaskDiff = { rekeys: [], completed: [], reopened: [] };
  const rekey = new Map<string, string>();
  for (const pair of pairs) {
    if (pair.fromKey === pair.toKey) continue;
    diff.rekeys.push({ from: pair.fromKey, to: pair.toKey });
    rekey.set(idOf(pair.fromKey), idOf(pair.toKey));
  }
  if (rekey.size > 0) {
    next = rekeyPlan(
      next,
      (id) => rekey.get(id) ?? id,
      (taskOrder) => applyTaskDiff({ taskOrder, completionSeen: {} }, filePath, diff, 0).state.taskOrder
    );
  }

  const changes = { ...next.current.changes };
  const conflicts = [...next.conflicts];
  let touched = false;
  for (const pair of pairs) {
    const id = idOf(pair.toKey);
    const change = changes[id];
    if (!change) continue;
    const was = readPlanFields(pair.from.rawLine, settings);
    const now = readPlanFields(pair.to.rawLine, settings);
    const open = (field: Conflict["field"]) => {
      if (conflicts.some((c) => c.entryId === id && c.field === field)) return;
      conflicts.push({ entryId: id, field, text: pair.to.text, file: filePath });
    };
    const remaining = withoutFields(change, now);
    if ("bucket" in change && was.bucket !== now.bucket && remaining && "bucket" in remaining) open("bucket");
    for (const field of ["due", "scheduled"] as const) {
      if (field in change && was[field] !== now[field] && remaining && field in remaining) open(field);
    }
    if (remaining === null) delete changes[id];
    else changes[id] = remaining;
    touched = true;
  }
  if (!touched && conflicts.length === next.conflicts.length) return next;
  return { ...next, current: { ...next.current, changes }, conflicts };
}

export function syncRename(plan: Plan, oldPath: string, newPath: string): Plan {
  const prefix = `${oldPath}::`;
  return rekeyPlan(
    plan,
    (id) => (id.startsWith(prefix) ? `${newPath}::${id.slice(prefix.length)}` : id),
    (taskOrder) => renameFileInState({ taskOrder, completionSeen: {} }, oldPath, newPath).state.taskOrder
  );
}

/**
 * Drops changes whose task is no longer indexed (its note was deleted or left
 * the scope), then revives any dropped change whose task has come back, on
 * the first matching task with no change of its own.
 */
export function reconcilePlan(
  plan: Plan,
  orderKeys: Map<string, OrderEntry>,
  textOf: (entryId: string) => string
): { plan: Plan; dropped: DroppedChange[]; revived: DroppedChange[] } {
  const present = new Set<string>();
  for (const entry of orderKeys.values()) present.add(entryId(entry));

  const dropped: DroppedChange[] = Object.entries(plan.current.changes)
    .filter(([id]) => !present.has(id))
    .map(([id, change]) => ({ entryId: id, hash: hashOf(id), text: textOf(id), change }));
  let next = dropChanges(plan, dropped);

  const revived: DroppedChange[] = [];
  if (next.dropped.length > 0) {
    const changes = { ...next.current.changes };
    const remaining: DroppedChange[] = [];
    for (const drop of next.dropped) {
      const target = [...present].find((id) => hashOf(id) === drop.hash && !(id in changes));
      if (target) {
        changes[target] = drop.change;
        revived.push(drop);
      } else {
        remaining.push(drop);
      }
    }
    if (revived.length > 0) next = { ...next, current: { ...next.current, changes }, dropped: remaining };
  }
  return { plan: next, dropped, revived };
}

export function syncPurge(
  plan: Plan,
  purge: (taskOrder: Record<string, OrderEntry[]>) => Record<string, OrderEntry[]>
): Plan {
  return { ...plan, current: { ...plan.current, taskOrder: purge(plan.current.taskOrder) } };
}
