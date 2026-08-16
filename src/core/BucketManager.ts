/**
 * Assignment priority (highest first):
 *   1. Storage-mode assignment (inline-tag or inline-field) — a "pinned" task
 *   2. Auto-assignment from the task's planning date (see core/PlanningDate.ts)
 *      matching a bucket's dateRangeRule
 *   3. No assignment → "to-review" system bucket
 *
 * Only a pin writes to the file. Auto-assignment is re-derived every pass, which
 * is what lets a dated task migrate between buckets as its date approaches.
 */

import { TaskRecord, getTagValue, getInlineFieldValue } from "./TaskParser";
import { BucketConfig, PluginSettings } from "../settings";
import { today } from "../integrations/TasksPluginParser";
import { t } from "../i18n/i18n";
import { computeOrderKeys, applyManualOrder, wasCompletionWitnessed, isRecurring } from "./TaskOrder";
import { computeDueStatus, computeMisplacement, matchesRule } from "./DueStatus";
import type { DueStatus } from "./DueStatus";
import { planningDate } from "./PlanningDate";

export const TO_REVIEW_ID = "to-review";

export interface BucketGroup {
  bucketId: string;
  name: string;
  emoji: string;
  tasks: TaskRecord[];
  /** 📅 status for every task in this group carrying a due date, keyed by task
   *  id. On-track entries are included: the popover shows a due line for any
   *  dated task, not only flagged ones. */
  dueStatuses: Record<string, DueStatus>;
  /** For tasks filed later than their planning date warrants: the bucket they
   *  belong in. Separate from dueStatuses because both can apply to one task. */
  misfiledIn: Record<string, BucketConfig>;
  /** Which date field placed each auto-placed task, keyed by task id. */
  autoPlacedFrom: Record<string, "due" | "scheduled">;
  /** Completed tasks the panel hides: anything whose completion this session
   *  didn't witness, plus every completed recurrence (already replaced). */
  agedCompletedTaskIds: string[];
  isSystem: boolean;
}

export function groupTasksIntoBuckets(
  tasks: TaskRecord[],
  settings: PluginSettings
): BucketGroup[] {
  const now = today();

  const bucketMap = new Map<string, BucketGroup>();

  bucketMap.set(TO_REVIEW_ID, {
    bucketId: TO_REVIEW_ID,
    name: t("buckets.toReview"),
    emoji: settings.toReviewEmoji,
    tasks: [],
    dueStatuses: {},
    misfiledIn: {},
    autoPlacedFrom: {},
    agedCompletedTaskIds: [],
    isSystem: true,
  });

  for (const b of settings.buckets) {
    bucketMap.set(b.id, {
      bucketId: b.id,
      name: b.name,
      emoji: b.emoji,
      tasks: [],
      dueStatuses: {},
      misfiledIn: {},
      autoPlacedFrom: {},
      agedCompletedTaskIds: [],
      isSystem: false,
    });
  }

  // Sort parents before children so inheritance works in a single pass
  const sorted = [...tasks].sort((a, b) => {
    if (a.filePath < b.filePath) return -1;
    if (a.filePath > b.filePath) return 1;
    return a.lineNumber - b.lineNumber;
  });

  const effectiveBucket = new Map<string, string | null>();
  const autoPlacedFrom = new Map<string, "due" | "scheduled">();

  for (const task of sorted) {
    const manualId = resolveManualAssignment(task, settings);
    if (manualId) {
      effectiveBucket.set(task.id, manualId);
      continue;
    }

    const plan = planningDate(task, settings.planBy);
    if (plan) {
      const autoId = autoAssign(plan.date, settings.buckets, now);
      if (autoId) {
        effectiveBucket.set(task.id, autoId);
        autoPlacedFrom.set(task.id, plan.source);
        continue;
      }
    }

    if (task.parentId !== null) {
      effectiveBucket.set(task.id, effectiveBucket.get(task.parentId) ?? null);
    } else {
      effectiveBucket.set(task.id, null);
    }
  }

  for (const task of tasks) {
    const bucketId = effectiveBucket.get(task.id) ?? null;
    const group =
      (bucketId !== null ? bucketMap.get(bucketId) : undefined) ??
      bucketMap.get(TO_REVIEW_ID)!;

    group.tasks.push(task);

    const source = autoPlacedFrom.get(task.id);
    if (source) group.autoPlacedFrom[task.id] = source;

    const status = computeDueStatus(task, now);
    if (status) group.dueStatuses[task.id] = status;

    const belongsIn = computeMisplacement(task, group.bucketId, settings.buckets, settings.planBy, now);
    if (belongsIn) group.misfiledIn[task.id] = belongsIn;
  }

  const orderKeys = computeOrderKeys(tasks);
  const completionSeen = settings.completionSeen ?? {};
  for (const group of bucketMap.values()) {
    const saved = settings.taskOrder?.[group.bucketId];
    if (saved && saved.length > 0) {
      group.tasks = applyManualOrder(group.tasks, orderKeys, saved);
    }
    group.tasks = regroupByHierarchy(group.tasks);

    for (const task of group.tasks) {
      if (!task.isCompleted) continue;
      // A completed recurrence is always hidden: Tasks has already put its
      // next occurrence in the list, so showing both is a confusing duplicate.
      if (isRecurring(task) || !wasCompletionWitnessed(orderKeys.get(task.id), completionSeen, now.getTime())) {
        group.agedCompletedTaskIds.push(task.id);
      }
    }
  }

  const result: BucketGroup[] = [bucketMap.get(TO_REVIEW_ID)!];
  for (const b of settings.buckets) {
    result.push(bucketMap.get(b.id)!);
  }

  return result;
}

/**
 * Re-flattens `tasks` (already in the desired top-level order — e.g. from
 * applyManualOrder) so each task's same-bucket descendants render
 * immediately after it, recursively. This is the render-time backstop for
 * parent/child contiguity: BucketGroup.svelte's onAdd/onUpdate handlers
 * already reattach a moved parent's children into the captured order at
 * drop time for SAME-bucket drags, but a CROSS-bucket move can't do that —
 * an auto-inherited child (no explicit assignment, inheriting its parent's
 * effective bucket) only starts appearing in the target bucket once the
 * file write is reindexed, a beat after the drop's own synchronous DOM
 * event, so there's no drag event to hook for it. This pass is also
 * defense-in-depth for anything else that could leave taskOrder
 * inconsistent with the tree (entries saved before this fix shipped, a
 * hand-edited data.json, a future bulk-move feature). A child whose parent
 * ISN'T in `tasks` (assigned to a different bucket) is untouched and
 * renders as its own independent root.
 */
export function regroupByHierarchy(tasks: TaskRecord[]): TaskRecord[] {
  const taskIds = new Set(tasks.map((t) => t.id));
  const childrenOf = new Map<string, TaskRecord[]>();

  for (const task of tasks) {
    if (task.parentId && taskIds.has(task.parentId)) {
      if (!childrenOf.has(task.parentId)) childrenOf.set(task.parentId, []);
      childrenOf.get(task.parentId)!.push(task);
    }
  }

  const roots = tasks.filter((t) => !t.parentId || !taskIds.has(t.parentId));

  const result: TaskRecord[] = [];
  const visit = (task: TaskRecord) => {
    result.push(task);
    for (const child of childrenOf.get(task.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);

  return result;
}

function resolveManualAssignment(
  task: TaskRecord,
  settings: PluginSettings
): string | null {
  const { storageMode, tagPrefix, buckets } = settings;

  if (storageMode === "inline-tag") {
    const val = getTagValue(task.rawLine, tagPrefix);
    if (val && buckets.some((b) => b.id === val)) return val;
  } else if (storageMode === "inline-field") {
    const val = getInlineFieldValue(task.rawLine, tagPrefix);
    if (val && buckets.some((b) => b.id === val)) return val;
  }

  return null;
}

/**
 * Where a task's planning date would put it right now. Null means unpinning
 * would do nothing, so the panel offers no unpin item at all.
 */
export function autoBucketFor(
  task: TaskRecord,
  settings: PluginSettings,
  now: Date = today()
): BucketConfig | null {
  const plan = planningDate(task, settings.planBy);
  if (!plan) return null;
  const id = autoAssign(plan.date, settings.buckets, now);
  return id ? settings.buckets.find((b) => b.id === id) ?? null : null;
}

function autoAssign(
  date: Date,
  buckets: BucketConfig[],
  now: Date
): string | null {
  const match = buckets.find(
    (b) => b.dateRangeRule && matchesRule(b.dateRangeRule, date, now)
  );
  return match ? match.id : null;
}

