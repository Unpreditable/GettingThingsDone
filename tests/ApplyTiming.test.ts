import { applyTiming } from "../src/core/plan/ApplyTiming";

it.each([
  [1, 0, 1200],
  [7, 100, 1800],
  [9, 100, 2000],
  [30, 800 / 29, 2000],
])("%i rows: gap %d ms, total %d ms", (rows, gap, total) => {
  const timing = applyTiming(rows);
  expect(timing.gapMs).toBeCloseTo(gap);
  expect(timing.endMs).toBeCloseTo(total);
});

it("starts each row one gap after the last", () => {
  expect(applyTiming(3).checkStartMs).toEqual([0, 100, 200]);
});

it("no rows on screen still shows the strip for the fixed parts", () => {
  expect(applyTiming(0)).toEqual({ gapMs: 0, checkStartMs: [], fadeAtMs: 800, slideAtMs: 1000, endMs: 1200 });
});

it("never exceeds 2 s", () => {
  for (let n = 1; n < 500; n++) expect(applyTiming(n).endMs).toBeLessThanOrEqual(2000 + 1e-9);
});
