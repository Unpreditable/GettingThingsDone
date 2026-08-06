import { formatDueLine } from "../src/core/DueStatusText";
import { DEFAULT_BUCKETS } from "../src/settings";

const today = DEFAULT_BUCKETS.find((b) => b.id === "today")!;
const thisWeek = DEFAULT_BUCKETS.find((b) => b.id === "this-week")!;

describe("formatDueLine", () => {
  it("counts the days for an on-track task due later", () => {
    expect(formatDueLine(new Date(2026, 7, 7), { kind: "on-track", diffDays: 3 }))
      .toBe("Due in 3 days (Fri, Aug 7)");
  });

  it("says tomorrow rather than 'in 1 day'", () => {
    expect(formatDueLine(new Date(2026, 7, 5), { kind: "on-track", diffDays: 1 }))
      .toBe("Due tomorrow (Wed, Aug 5)");
  });

  it("shows a bare date for an on-track task whose date has passed", () => {
    // Completed and To Review tasks are never flagged, so they land on the on-track
    // branch with a negative diffDays. No relative phrase, no overdue wording.
    expect(formatDueLine(new Date(2026, 7, 1), { kind: "on-track", diffDays: -3 }))
      .toBe("Due Sat, Aug 1");
  });

  it("says 'today' instead of a date when the task is due today", () => {
    expect(formatDueLine(new Date(2026, 7, 4), { kind: "on-track", diffDays: 0 }))
      .toBe("Due today");
  });

  it("counts the days for an overdue task", () => {
    expect(formatDueLine(new Date(2026, 7, 1), { kind: "overdue", diffDays: -3 }))
      .toBe("Due Sat, Aug 1 (3 days overdue)");
  });

  it("uses the singular for one day overdue", () => {
    expect(formatDueLine(new Date(2026, 7, 3), { kind: "overdue", diffDays: -1 }))
      .toBe("Due Mon, Aug 3 (1 day overdue)");
  });

  it("names the destination bucket for a misfiled task due today", () => {
    expect(formatDueLine(new Date(2026, 7, 4), { kind: "misfiled", diffDays: 0, belongsIn: today }))
      .toBe("Due today (belongs in Today)");
  });

  it("names the destination bucket for a misfiled task due later", () => {
    expect(formatDueLine(new Date(2026, 7, 8), { kind: "misfiled", diffDays: 4, belongsIn: thisWeek }))
      .toBe("Due Sat, Aug 8 (belongs in This Week)");
  });
});
