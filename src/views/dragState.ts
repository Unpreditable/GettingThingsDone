import { writable } from "svelte/store";

/**
 * True while any task is being dragged, in any bucket. Shared across all
 * BucketGroup instances (not per-instance state) because a drag reflows
 * sibling rows under the still-stationary cursor — including rows in a
 * DIFFERENT bucket for a cross-bucket drag — which fires a genuine
 * mouseenter on whichever row lands there. TaskItem uses this to suppress
 * its hover tooltip for the duration of the drag, so that reflow doesn't
 * pop up an unrelated task's tooltip mid-drag.
 */
export const isDragging = writable(false);

/**
 * The task a collapsed bucket's header took as a drop, until SortableJS's own
 * drop handling has run. On its way to the header a drag crosses open buckets,
 * and SortableJS moves the row into whichever list it passes, so when the drag
 * ends there it reports a second drop into that list, or a reorder when the
 * only list it crossed was its own. The header's drop event fires first, so
 * the list's onAdd or onUpdate reads this and stands down.
 */
export const headerDrop: { taskId: string | null } = { taskId: null };

/**
 * True while a collapsed bucket's header is the drop target. SortableJS leaves
 * its placeholder in the last list the drag crossed, which a header is not, so
 * the panel hides the placeholder and lets the header's outline show the target.
 */
export const headerDragOver = writable(false);
