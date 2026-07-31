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
