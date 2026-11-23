import type { BucketGroup } from "../BucketManager";
import type { TaskRecord } from "../TaskParser";

export type Indicator =
  | { kind: "up" | "down"; by: number }
  | { kind: "bucket-up" | "bucket-down"; fromBucketId: string };

export interface PlanSummary {
  /** Task id → indicator. */
  indicators: Record<string, Indicator>;
  /** Bucket id → open-task counts, only where they differ. */
  deltas: Record<string, { from: number; to: number }>;
  /** For "Apply N changes". */
  count: number;
}

/**
 * Indices into `seq` (a permutation of 0..n-1) of the increasing subsequence
 * that keeps the most entries unmarked, and among those the most entries that
 * are not `preferMarked`: when two tasks traded places, the mark goes to the
 * one the plan changed. O(n log n), with a Fenwick tree of prefix maxima.
 */
function keptInOrder(seq: number[], preferMarked: boolean[]): Set<number> {
  const n = seq.length;
  // Length first, untouched tasks second: n + 1 outweighs any number of tie-breaks.
  const weight = (i: number) => n + 1 + (preferMarked[i] ? 0 : 1);
  const tree: { best: number; at: number }[] = Array.from({ length: n + 1 }, () => ({ best: 0, at: -1 }));
  const prev: number[] = seq.map(() => -1);
  const total: number[] = seq.map(() => 0);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let at = -1;
    for (let k = seq[i]; k > 0; k -= k & -k) {
      if (tree[k].best > best) ({ best, at } = tree[k]);
    }
    total[i] = best + weight(i);
    prev[i] = at;
    for (let k = seq[i] + 1; k <= n; k += k & -k) {
      if (total[i] > tree[k].best) tree[k] = { best: total[i], at: i };
    }
  }
  let end = -1;
  for (let i = 0; i < n; i++) if (end === -1 || total[i] > total[end]) end = i;
  const kept = new Set<number>();
  for (let i = end; i !== -1; i = prev[i]) kept.add(i);
  return kept;
}

function visibleTasks(group: BucketGroup): TaskRecord[] {
  const hidden = new Set(group.agedCompletedTaskIds);
  return group.tasks.filter((task) => !hidden.has(task.id));
}

/**
 * Marks only the tasks that really moved. Within a bucket, siblings (tasks
 * sharing a parent there, or top-level ones) are compared as one list, so a
 * subtask that moves along with its parent keeps its place among its siblings
 * and gets no mark.
 */
export function computeIndicators(
  realGroups: BucketGroup[],
  planned: BucketGroup[],
  changedTaskIds: Set<string>
): PlanSummary {
  const realBucket = new Map<string, number>();
  realGroups.forEach((group, i) => {
    for (const task of visibleTasks(group)) {
      realBucket.set(task.id, i);
    }
  });
  const bucketIndex = new Map(planned.map((group, i) => [group.bucketId, i]));

  const indicators: Record<string, Indicator> = {};
  const plannedBucketOf = new Map<string, string>();

  for (const group of planned) {
    const tasks = visibleTasks(group);
    const inGroup = new Set(tasks.map((task) => task.id));
    for (const task of tasks) plannedBucketOf.set(task.id, group.bucketId);
    const here = bucketIndex.get(group.bucketId)!;
    const realGroup = realGroups.find((g) => g.bucketId === group.bucketId);
    const realIndex = new Map((realGroup ? visibleTasks(realGroup) : []).map((task, i) => [task.id, i]));

    const siblings = new Map<string, TaskRecord[]>();
    for (const task of tasks) {
      const from = realBucket.get(task.id);
      if (from !== undefined && from !== here) {
        indicators[task.id] = {
          kind: here < from ? "bucket-up" : "bucket-down",
          fromBucketId: realGroups[from].bucketId,
        };
        continue;
      }
      if (from === undefined) continue;
      const parent = task.parentId && inGroup.has(task.parentId) ? task.parentId : "";
      if (!siblings.has(parent)) siblings.set(parent, []);
      siblings.get(parent)!.push(task);
    }

    for (const list of siblings.values()) {
      const realOrder = [...list].sort((a, b) => realIndex.get(a.id)! - realIndex.get(b.id)!);
      const realPos = new Map(realOrder.map((task, i) => [task.id, i]));
      const seq = list.map((task) => realPos.get(task.id)!);
      const kept = keptInOrder(seq, list.map((task) => changedTaskIds.has(task.id)));
      list.forEach((task, i) => {
        if (kept.has(i)) return;
        const was = seq[i];
        indicators[task.id] = { kind: i < was ? "up" : "down", by: Math.abs(was - i) };
      });
    }
  }

  // A subtask that jumped buckets along with its parent is marked by the parent alone.
  for (const group of planned) {
    for (const task of group.tasks) {
      const own = indicators[task.id];
      if (!own || (own.kind !== "bucket-up" && own.kind !== "bucket-down") || !task.parentId) continue;
      const parentMark = indicators[task.parentId];
      if (parentMark && plannedBucketOf.get(task.parentId) === group.bucketId) delete indicators[task.id];
    }
  }

  const deltas: Record<string, { from: number; to: number }> = {};
  const openCount = (group: BucketGroup | undefined) =>
    group ? group.tasks.filter((task) => !task.isCompleted).length : 0;
  for (const group of planned) {
    const from = openCount(realGroups.find((g) => g.bucketId === group.bucketId));
    const to = openCount(group);
    if (from !== to) deltas[group.bucketId] = { from, to };
  }

  const counted = new Set([...Object.keys(indicators), ...changedTaskIds]);
  return { indicators, deltas, count: counted.size };
}
