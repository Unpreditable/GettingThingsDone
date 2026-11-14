import { dropDateOptions, effectiveRange, landsIn, pickDays } from "../src/core/DropDates";
import { dayKey } from "../src/core/DueStatus";
import { parseFile } from "../src/core/TaskParser";
import { DEFAULT_BUCKETS, DEFAULT_SETTINGS } from "../src/settings";

// Wed 11 Nov 2026
const now = new Date(2026, 10, 11);

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("effectiveRange", () => {
  it("Today's range is today alone", () => {
    expect(effectiveRange("today", DEFAULT_BUCKETS, now, "monday")!.map(dayKey)).toEqual(["2026-11-11"]);
  });

  it("This Week runs from tomorrow to Sunday", () => {
    expect(effectiveRange("this-week", DEFAULT_BUCKETS, now, "monday")!.map(dayKey))
      .toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });

  it("effectiveRange excludes days an earlier bucket takes", () => {
    const days = effectiveRange("this-month", DEFAULT_BUCKETS, now, "monday")!.map(dayKey);
    expect(days[0]).toBe("2026-11-23"); // after This Week and Next Week
    expect(days.at(-1)).toBe("2026-11-30");
  });

  it("a catch-all bucket has no range", () => {
    expect(effectiveRange("someday", DEFAULT_BUCKETS, now, "monday")).toBeNull();
  });

  it("a bucket without a rule has no range", () => {
    const buckets = [...DEFAULT_BUCKETS, { ...DEFAULT_BUCKETS[0], id: "waiting", dateRangeRule: null }];
    expect(effectiveRange("waiting", buckets, now, "monday")).toBeNull();
  });
});

describe("pickDays", () => {
  it("pickDays takes the seven positions of a long range", () => {
    const days = Array.from({ length: 21 }, (_, i) => new Date(2026, 10, 12 + i));
    expect(pickDays(days).map((d) => d.getDate())).toEqual([12, 13, 17, 22, 27, 1, 2]);
  });

  const range = (n: number) => Array.from({ length: n }, (_, i) => new Date(2026, 10, 1 + i));

  it("pickDays offers every day of a week-long range", () => {
    expect(pickDays(range(7)).map((d) => d.getDate())).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("pickDays offers five days of an eight-day range", () => {
    expect(pickDays(range(8)).map((d) => d.getDate())).toEqual([1, 2, 5, 7, 8]);
  });

  it("pickDays offers six days of a nine-day range", () => {
    expect(pickDays(range(9)).map((d) => d.getDate())).toEqual([1, 2, 4, 6, 8, 9]);
  });

  it("pickDays leaves out no day, or at least three", () => {
    for (let n = 1; n <= 60; n++) {
      const missing = n - pickDays(range(n)).length;
      expect([n, missing === 0 || missing >= 3]).toEqual([n, true]);
    }
  });

  it("pickDays collapses repeats in a short range", () => {
    const days = [new Date(2026, 10, 12), new Date(2026, 10, 13)];
    expect(pickDays(days).map((d) => d.getDate())).toEqual([12, 13]);
  });
});

describe("dropDateOptions", () => {
  it("dropDateOptions writes the field Plan by reads", () => {
    const [task] = parseFile("a.md", "- [ ] a");
    expect(dropDateOptions(task, "this-week", { ...DEFAULT_SETTINGS, planBy: "due-first" }, now)!.field).toBe("due");
    expect(dropDateOptions(task, "this-week", { ...DEFAULT_SETTINGS, planBy: "scheduled-first" }, now)!.field).toBe("scheduled");
  });

  it("dropDateOptions keeps the field a task is already planned by", () => {
    const [task] = parseFile("a.md", "- [ ] a ⏳ 2026-11-11");
    expect(dropDateOptions(task, "this-week", { ...DEFAULT_SETTINGS, planBy: "due-first" }, now)!.field).toBe("scheduled");
  });

  it("dropDateOptions is null under manual", () => {
    const [task] = parseFile("a.md", "- [ ] a");
    expect(dropDateOptions(task, "this-week", { ...DEFAULT_SETTINGS, planBy: "manual" }, now)).toBeNull();
  });

  it("dropDateOptions is null for a closed task", () => {
    const [task] = parseFile("a.md", "- [x] a");
    expect(dropDateOptions(task, "this-week", DEFAULT_SETTINGS, now)).toBeNull();
  });

  it("dropDateOptions leaves out days the other date would override under earliest", () => {
    // due 2026-11-12 (This Week) is the planning date; re-dating it to Next Week lets scheduled 2026-11-13 win
    const [task] = parseFile("a.md", "- [ ] a 📅 2026-11-12 ⏳ 2026-11-13");
    expect(dropDateOptions(task, "next-week", { ...DEFAULT_SETTINGS, planBy: "earliest" }, now)).toBeNull();
  });

  it("dropDateOptions gives the range for Custom…", () => {
    const [task] = parseFile("a.md", "- [ ] a");
    expect(dropDateOptions(task, "this-week", DEFAULT_SETTINGS, now)!.range).toEqual({ from: "2026-11-12", to: "2026-11-15" });
  });

  it("dropDateOptions offers the picked days of the range", () => {
    const [task] = parseFile("a.md", "- [ ] a");
    expect(dropDateOptions(task, "this-week", DEFAULT_SETTINGS, now)!.days)
      .toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });

  it("dropDateOptions offers Custom… only when some day of the range is left out", () => {
    const [task] = parseFile("a.md", "- [ ] a");
    expect(dropDateOptions(task, "this-week", DEFAULT_SETTINGS, now)!.offersCustom).toBe(false);
    // This Month is 23–30 Nov: eight days, five of them offered.
    expect(dropDateOptions(task, "this-month", DEFAULT_SETTINGS, now)!.offersCustom).toBe(true);
  });

  it("landsIn accepts a day inside the bucket and rejects one outside it", () => {
    const [task] = parseFile("a.md", "- [ ] a");
    expect(landsIn(task, "scheduled", "2026-11-13", "this-week", DEFAULT_SETTINGS, now)).toBe(true);
    expect(landsIn(task, "scheduled", "2026-11-17", "this-week", DEFAULT_SETTINGS, now)).toBe(false);
  });

  it("dropDateOptions is null for To Review", () => {
    const [task] = parseFile("a.md", "- [ ] a");
    expect(dropDateOptions(task, "to-review", DEFAULT_SETTINGS, now)).toBeNull();
  });
});
