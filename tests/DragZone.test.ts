import { DRAG_HANDLE_SELECTOR, dragZone, inDragHalf, sortableOptions } from "../src/core/DragZone";
import { MOBILE_DRAG_CHOICES } from "../src/settings";

describe("dragZone", () => {
  it("desktop drags the whole row whatever the setting", () => {
    for (const mode of MOBILE_DRAG_CHOICES) {
      expect(dragZone(mode, false)).toEqual({ kind: "row" });
    }
  });

  it("Whole row on mobile drags the whole row", () => {
    expect(dragZone("whole-row", true)).toEqual({ kind: "row" });
  });

  it("grips and bars on mobile are handles on their side", () => {
    expect(dragZone("right-grip", true)).toEqual({ kind: "handle", side: "right", look: "grip" });
    expect(dragZone("left-grip", true)).toEqual({ kind: "handle", side: "left", look: "grip" });
    expect(dragZone("right-bar", true)).toEqual({ kind: "handle", side: "right", look: "bar" });
    expect(dragZone("left-bar", true)).toEqual({ kind: "handle", side: "left", look: "bar" });
  });

  it("halves on mobile drag on their side", () => {
    expect(dragZone("right-half", true)).toEqual({ kind: "half", side: "right" });
    expect(dragZone("left-half", true)).toEqual({ kind: "half", side: "left" });
  });
});

describe("inDragHalf", () => {
  // A list from x=100 to x=300, split at 200.
  it("the right half drags from the middle rightwards", () => {
    expect(inDragHalf("right", 250, 100, 200)).toBe(true);
    expect(inDragHalf("right", 200, 100, 200)).toBe(true);
    expect(inDragHalf("right", 150, 100, 200)).toBe(false);
  });

  it("the left half drags from the middle leftwards", () => {
    expect(inDragHalf("left", 150, 100, 200)).toBe(true);
    expect(inDragHalf("left", 200, 100, 200)).toBe(true);
    expect(inDragHalf("left", 250, 100, 200)).toBe(false);
  });
});

describe("sortableOptions", () => {
  const list = { getBoundingClientRect: () => ({ left: 100, width: 200 }) } as unknown as HTMLElement;
  const target = {} as HTMLElement;

  it("a whole-row zone sets neither handle nor filter", () => {
    const opts = sortableOptions({ kind: "row" }, list);
    expect(opts.handle).toBeUndefined();
    expect(opts.filter).toBeUndefined();
  });

  it("a handle zone points Sortable at the handle", () => {
    const opts = sortableOptions({ kind: "handle", side: "right", look: "grip" }, list);
    expect(opts.handle).toBe(DRAG_HANDLE_SELECTOR);
    expect(opts.filter).toBeUndefined();
  });

  it("a half zone filters out a drag that starts in the scroll half", () => {
    const opts = sortableOptions({ kind: "half", side: "left" }, list);
    expect(opts.handle).toBeUndefined();
    expect(opts.preventOnFilter).toBe(false);
    const filter = opts.filter as (e: Event, t: HTMLElement) => boolean;
    expect(filter({ clientX: 120 } as unknown as Event, target)).toBe(false);
    expect(filter({ clientX: 280 } as unknown as Event, target)).toBe(true);
  });

  it("a half zone reads a touch event's first touch", () => {
    const filter = sortableOptions({ kind: "half", side: "right" }, list).filter as (
      e: Event,
      t: HTMLElement
    ) => boolean;
    expect(filter({ touches: [{ clientX: 280 }] } as unknown as Event, target)).toBe(false);
    expect(filter({ touches: [{ clientX: 120 }] } as unknown as Event, target)).toBe(true);
  });
});
