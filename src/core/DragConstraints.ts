/**
 * Drag-and-drop insertion rules for a bucket list.
 *
 * A bucket renders as a flat list, but `regroupByHierarchy` guarantees it is a
 * *flattened tree*: every task's block — itself plus its same-bucket
 * descendants — occupies one contiguous run. A drop that would split someone
 * else's block is therefore meaningless, since the next render just
 * re-flattens it away, so those drops are rejected while the drag is still in
 * flight.
 *
 * Lives here rather than in BucketGroup.svelte so it can be unit-tested.
 */

import { TaskRecord } from "./TaskParser";

export interface BucketTree {
  /** Every known task, not just this bucket's — parents are looked up by id. */
  allTasks: Map<string, TaskRecord>;
  /** taskId → the bucket that task currently renders in. */
  taskBucket: Map<string, string>;
  /** The bucket the drop is landing in (for a cross-bucket drag, the target). */
  bucketId: string;
}

/**
 * Ancestors of `taskId` inside `bucketId`, nearest first. The walk stops at the
 * first ancestor outside the bucket: a task whose parent renders elsewhere is a
 * root as far as this bucket's list is concerned.
 */
function ancestorsInBucket(taskId: string, tree: BucketTree): string[] {
  const result: string[] = [];
  let cur = tree.allTasks.get(taskId);
  while (cur?.parentId && tree.taskBucket.get(cur.parentId) === tree.bucketId) {
    result.push(cur.parentId);
    cur = tree.allTasks.get(cur.parentId);
  }
  return result;
}

/** Whether `taskId` is a strict descendant of `ancestorId` within the bucket. */
export function isDescendantOf(taskId: string, ancestorId: string, tree: BucketTree): boolean {
  return ancestorsInBucket(taskId, tree).includes(ancestorId);
}

/**
 * The deepest task whose block the gap between `beforeId` and `afterId` falls
 * strictly inside, or null if the gap is at top level.
 *
 * A block is contiguous and starts at its own root, so the gap is inside
 * block(X) exactly when X is an ancestor-or-self of BOTH neighbours. The
 * ancestor-or-self chains are paths to the root, so their intersection is the
 * chain above their lowest common ancestor — and the lowest one is the deepest
 * block being cut, which is the only one worth testing.
 */
export function enclosingBlockRoot(
  beforeId: string,
  afterId: string,
  tree: BucketTree
): string | null {
  const afterChain = new Set([afterId, ...ancestorsInBucket(afterId, tree)]);
  for (const id of [beforeId, ...ancestorsInBucket(beforeId, tree)]) {
    if (afterChain.has(id)) return id;
  }
  return null;
}

/**
 * Whether `draggedId` may be inserted in the gap between `beforeId` and
 * `afterId` (either may be null at the ends of the list).
 *
 * Only a strict descendant of the block being cut may be placed inside it —
 * anyone else would break that block's contiguity. "Strict" is what stops a
 * task being dropped inside its own block: the enclosing root is then the
 * dragged task itself, which is not its own descendant. That covers a parent
 * dropped between its own children, a grandparent dropped between its
 * grandchildren, and an uncle dropped among its nieces (the enclosing block is
 * the nieces' parent, which the uncle does not descend from).
 *
 * This rule governs the gap only. Keeping the dragged task adjacent to its OWN
 * parent's block is a separate constraint, enforced in BucketGroup.svelte where
 * the list indices are available.
 */
export function isInsertionAllowed(
  draggedId: string,
  beforeId: string | null,
  afterId: string | null,
  tree: BucketTree
): boolean {
  if (!beforeId || !afterId) return true;
  const blockRoot = enclosingBlockRoot(beforeId, afterId, tree);
  if (blockRoot === null) return true;
  return isDescendantOf(draggedId, blockRoot, tree);
}
