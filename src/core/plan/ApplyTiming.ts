/** Each row's arrow turning into a ✓. */
export const MORPH_MS = 300;
/** How long every ✓ stays after the last one appears. */
const HOLD_MS = 500;
/** All ✓ fading out together. */
export const FADE_MS = 200;
/** The strip sliding up. */
export const SLIDE_MS = 200;
/** The fixed parts take 1.2 s, which leaves this much of the 2 s for the stagger. */
const STAGGER_BUDGET_MS = 800;
const MAX_GAP_MS = 100;

export interface ApplyTiming {
  gapMs: number;
  /** When each on-screen row, top to bottom, starts turning into a ✓. */
  checkStartMs: number[];
  fadeAtMs: number;
  slideAtMs: number;
  endMs: number;
}

/** The Apply animation's schedule for this many rows on screen: 2 s at most. */
export function applyTiming(visibleRows: number): ApplyTiming {
  const gapMs = visibleRows > 1 ? Math.min(MAX_GAP_MS, STAGGER_BUDGET_MS / (visibleRows - 1)) : 0;
  const checkStartMs = Array.from({ length: visibleRows }, (_, i) => i * gapMs);
  const fadeAtMs = Math.max(0, visibleRows - 1) * gapMs + MORPH_MS + HOLD_MS;
  const slideAtMs = fadeAtMs + FADE_MS;
  return { gapMs, checkStartMs, fadeAtMs, slideAtMs, endMs: slideAtMs + SLIDE_MS };
}
