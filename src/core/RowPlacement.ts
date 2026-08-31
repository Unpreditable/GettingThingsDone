/**
 * How one task row presents itself inside a bucket's rendered list: how deep
 * it sits, and whether its parent is a row the reader can actually see.
 *
 * Depth is a fact about the task tree, so it is counted over the tree and is
 * unaffected by which rows happen to be on screen — a grandchild stays two
 * levels in whether or not its parent is rendered. Attachment is the opposite:
 * it is a fact about the *list*, so it is decided purely by what is rendered.
 * The ↖ badge exists for the gap between the two.
 *
 * Lives here rather than in TaskItem.svelte so it can be unit-tested.
 */

import { TaskRecord } from "./TaskParser";

export interface RowPlacement {
  /** Indent steps to draw, counting ancestors that belong to this bucket. */
  indentLevel: number;
  /**
   * True when the task has a parent that is not among this bucket's rendered
   * rows — it is in another bucket, or it is here but hidden (completed and
   * aged out, dismissed, filtered away by a search). The row is then indented
   * under whatever precedes it, which is not its parent, so it needs the badge.
   */
  detachedParent: boolean;
}

export interface RowContext {
  /** Every known task, not just this bucket's — parents are looked up by id. */
  allTasks: Map<string, TaskRecord>;
  /** taskId → the bucket that task belongs to, rendered or not. */
  taskBucket: Map<string, string>;
  /** The bucket whose list is being rendered. */
  bucketId: string;
  /** Ids of the rows this bucket is actually rendering right now. */
  visibleIds: ReadonlySet<string>;
}

export function placeRow(task: TaskRecord, ctx: RowContext): RowPlacement {
  return {
    indentLevel: indentLevelOf(task, ctx),
    detachedParent: task.parentId !== null && !ctx.visibleIds.has(task.parentId),
  };
}

/**
 * Ancestors of `task` that belong to this bucket. The walk climbs past an
 * ancestor filed elsewhere rather than stopping there: the levels above it
 * still describe how deep the task sits in its own tree.
 */
function indentLevelOf(task: TaskRecord, ctx: RowContext): number {
  let level = 0;
  let cur: TaskRecord | undefined = task;
  const seen = new Set<string>([task.id]);

  while (cur?.parentId) {
    const parent = ctx.allTasks.get(cur.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    if (ctx.taskBucket.get(parent.id) === ctx.bucketId) level++;
    cur = parent;
  }

  return level;
}
