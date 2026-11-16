import type { Options } from "sortablejs";
import type { MobileDragBy } from "../settings";

export type DragSide = "left" | "right";

/** Where on a task row a drag can start. */
export type DragZone =
  | { kind: "row" }
  | { kind: "handle"; side: DragSide; look: "grip" | "bar" }
  | { kind: "half"; side: DragSide };

export const DRAG_HANDLE_SELECTOR = ".gtd-drag-handle";

/** The zone for a setting. Desktop always drags the whole row. */
export function dragZone(mode: MobileDragBy, isMobile: boolean): DragZone {
  if (!isMobile) return { kind: "row" };
  switch (mode) {
    case "right-grip":
      return { kind: "handle", side: "right", look: "grip" };
    case "left-grip":
      return { kind: "handle", side: "left", look: "grip" };
    case "right-bar":
      return { kind: "handle", side: "right", look: "bar" };
    case "left-bar":
      return { kind: "handle", side: "left", look: "bar" };
    case "right-half":
      return { kind: "half", side: "right" };
    case "left-half":
      return { kind: "half", side: "left" };
    case "whole-row":
      return { kind: "row" };
  }
}

/** Whether `x` falls in the drag half of a list spanning `left` to `left + width`. The middle counts for both. */
export function inDragHalf(side: DragSide, x: number, left: number, width: number): boolean {
  const middle = left + width / 2;
  return side === "left" ? x <= middle : x >= middle;
}

function clientX(event: Event): number | null {
  const touches = (event as TouchEvent).touches;
  if (touches && touches.length > 0) return touches[0].clientX;
  const x = (event as MouseEvent).clientX;
  return typeof x === "number" ? x : null;
}

/**
 * The Sortable options for a zone. Every key is always present, so passing them
 * to `sortable.option` one by one also clears what the previous zone set.
 */
export function sortableOptions(
  zone: DragZone,
  listEl: HTMLElement
): Pick<Options, "handle" | "filter" | "preventOnFilter"> {
  if (zone.kind === "handle") {
    return { handle: DRAG_HANDLE_SELECTOR, filter: undefined, preventOnFilter: true };
  }
  if (zone.kind === "half") {
    const side = zone.side;
    return {
      handle: undefined,
      // A filtered touch is still a tap: preventOnFilter would swallow the
      // click on the checkbox or the text.
      preventOnFilter: false,
      filter: (event: Event) => {
        const x = clientX(event);
        if (x === null) return false;
        const rect = listEl.getBoundingClientRect();
        return !inDragHalf(side, x, rect.left, rect.width);
      },
    };
  }
  return { handle: undefined, filter: undefined, preventOnFilter: true };
}
