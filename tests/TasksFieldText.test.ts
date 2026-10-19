import { parseFile } from "../src/core/TaskParser";
import { formatTasksFields } from "../src/core/TasksFieldText";
import type { PlacementInfo } from "../src/core/TasksFieldText";
import type { DueStatus } from "../src/core/DueStatus";
import type { WaitingInfo } from "../src/core/Waiting";
import { DEFAULT_BUCKETS } from "../src/settings";

const onTrack: DueStatus = { kind: "on-track", diffDays: 3 };
const overdue: DueStatus = { kind: "overdue", diffDays: -2 };

const today = DEFAULT_BUCKETS.find((b) => b.id === "today")!;
const someday = DEFAULT_BUCKETS.find((b) => b.id === "someday")!;

/** Automatic, unflagged — the placement most tasks are in. */
const UNPLACED: PlacementInfo = { autoPlacedFrom: null, pinnedIn: null, misfiledIn: null };

function rowsFor(
  line: string,
  status: DueStatus | null = null,
  placement: PlacementInfo = UNPLACED
) {
  return formatTasksFields(parseFile("test.md", line)[0], status, placement);
}

describe("formatTasksFields", () => {
  it("returns no rows for a task with no Tasks metadata", () => {
    expect(rowsFor("- [ ] Buy milk")).toEqual([]);
  });

  it("emits rows in the documented order", () => {
    // Completed, and carrying a ✅ date: with an open task the done row never
    // appears, so the ✅/🏁 pair could be emitted in either order undetected.
    const line =
      "- [x] Everything 📅 2026-08-07 🔺 🔁 every week ⏳ 2026-08-05 " +
      "🛫 2026-08-03 ➕ 2026-07-01 ❌ 2026-08-06 ✅ 2026-08-04 🏁 delete";
    const emojis = rowsFor(line, onTrack).map((r) => r.emoji);
    expect(emojis).toEqual(["📅", "🔺", "🔁", "⏳", "🛫", "➕", "❌", "✅", "🏁"]);
  });

  it("omits absent fields", () => {
    const rows = rowsFor("- [ ] Weekly review 🔁 every week");
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe("🔁");
    expect(rows[0].text).toBe("Repeats every week");
  });

  it("labels each priority level with its own emoji", () => {
    expect(rowsFor("- [ ] T 🔺")[0]).toEqual({ emoji: "🔺", text: "Highest" });
    expect(rowsFor("- [ ] T ⏫")[0]).toEqual({ emoji: "⏫", text: "High" });
    expect(rowsFor("- [ ] T 🔼")[0]).toEqual({ emoji: "🔼", text: "Medium" });
    expect(rowsFor("- [ ] T 🔽")[0]).toEqual({ emoji: "🔽", text: "Low" });
    expect(rowsFor("- [ ] T ⏬")[0]).toEqual({ emoji: "⏬", text: "Lowest" });
  });

  it("uses 📅 for the due row when the task is on track", () => {
    expect(rowsFor("- [ ] Pay rent 📅 2026-08-07", onTrack)[0].emoji).toBe("📅");
  });

  it("lets the overdue flag supersede 📅", () => {
    const row = rowsFor("- [ ] Pay rent 📅 2026-08-07", overdue)[0];
    expect(row.emoji).toBeUndefined();
    expect(row.icon).toBe("alert-triangle");
    // Carried as data, so a glyph change can't silently break the colour.
    expect(row.tone).toBe("overdue");
  });

  it("emits no due row when there is no due status", () => {
    expect(rowsFor("- [ ] Pay rent 📅 2026-08-07", null)).toEqual([]);
  });

  it("emits a done row for a completed task", () => {
    const rows = rowsFor("- [x] Shipped ✅ 2026-08-04");
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe("✅");
    expect(rows[0].text).toMatch(/^Done /);
  });

  it("emits an on-completion row", () => {
    expect(rowsFor("- [ ] T 🏁 delete")[0]).toEqual({
      emoji: "🏁",
      text: "On completion: delete",
    });
  });
});

describe("placement rows", () => {
  const pinned: PlacementInfo = { autoPlacedFrom: null, pinnedIn: someday, misfiledIn: null };
  const autoByScheduled: PlacementInfo = { autoPlacedFrom: "scheduled", pinnedIn: null, misfiledIn: null };

  it("names the bucket a pinned task is held in", () => {
    const rows = rowsFor("- [ ] Call the accountant", null, pinned);
    expect(rows).toEqual([{ icon: "pin", text: "Pinned to Someday / Maybe" }]);
  });

  it("says nothing about an automatic task with no dates", () => {
    expect(rowsFor("- [ ] Call the accountant", null, UNPLACED)).toEqual([]);
  });

  // The bucket is already visible in the header above, so the popover marks the
  // date driving the placement instead of restating it.
  it("marks the winning date row rather than adding one", () => {
    const rows = rowsFor("- [ ] Pay bill 📅 2026-09-01 ⏳ 2026-08-25", onTrack, autoByScheduled);
    const due = rows.find((r) => r.emoji === "📅")!;
    const scheduled = rows.find((r) => r.emoji === "⏳")!;
    expect(scheduled.marker).toBe("zap");
    expect(due.marker).toBeUndefined();
  });

  it("moves the marker to 📅 when the due date is the one planning the task", () => {
    const rows = rowsFor("- [ ] Pay bill 📅 2026-09-01 ⏳ 2026-08-25", onTrack, {
      ...autoByScheduled,
      autoPlacedFrom: "due",
    });
    expect(rows.find((r) => r.emoji === "📅")!.marker).toBe("zap");
    expect(rows.find((r) => r.emoji === "⏳")!.marker).toBeUndefined();
  });

  it("shows overdue and misfiled together, which one line could not", () => {
    const rows = rowsFor("- [ ] Pay bill 📅 2026-08-01 ⏳ 2026-08-25", overdue, {
      autoPlacedFrom: null,
      pinnedIn: someday,
      misfiledIn: today,
    });
    expect(rows.slice(0, 3)).toEqual([
      { icon: "pin", text: "Pinned to Someday / Maybe" },
      { icon: "flag", tone: "misfiled", text: "Belongs in Today" },
      { icon: "alert-triangle", tone: "overdue", text: "Due Sat, Aug 1 (2 days overdue)" },
    ]);
  });

  it("puts placement rows above the date rows they explain", () => {
    const rows = rowsFor("- [ ] Pay bill 📅 2026-09-01", onTrack, pinned);
    expect(rows[0].icon).toBe("pin");
    expect(rows[1].emoji).toBe("📅");
  });
});

describe("formatTasksFields — waiting rows", () => {
  const NOT_WAITING: WaitingInfo = { startsOn: null, blockedBy: [], missingDependency: false };
  const blocker = (text: string) => parseFile("b.md", `- [ ] ${text} 🆔 x`)[0];

  function rowsWaiting(line: string, waiting: WaitingInfo, placement: PlacementInfo = UNPLACED) {
    return formatTasksFields(parseFile("test.md", line)[0], onTrack, placement, waiting);
  }

  it("puts the snail row directly above the start date row", () => {
    const rows = rowsWaiting("- [ ] T 🔁 every week 🛫 2026-10-20 ➕ 2026-10-01", {
      ...NOT_WAITING,
      startsOn: new Date(2026, 9, 20),
    });
    const start = rows.findIndex((r) => r.emoji === "🛫");
    expect(rows[start - 1]).toEqual({ icon: "snail", text: "Can't start yet" });
    expect(rows[start + 1].emoji).toBe("➕");
  });

  it("names each open blocker, after the misfiled row and before the due row", () => {
    const rows = rowsWaiting(
      "- [ ] T 📅 2026-10-25",
      { ...NOT_WAITING, blockedBy: [blocker("A"), blocker("B")] },
      { ...UNPLACED, misfiledIn: today }
    );
    expect(rows.map((r) => r.icon ?? r.emoji)).toEqual(["flag", "construction", "construction", "📅"]);
    expect(rows[1]).toEqual({ icon: "construction", text: "Blocked by: (x) A", truncate: true });
    expect(rows[2].text).toBe("Blocked by: (x) B");
  });

  it("shows a blocker's link text, not its brackets", () => {
    const rows = rowsWaiting("- [ ] T", { ...NOT_WAITING, blockedBy: [blocker("Read [[Spec|the spec]]")] });
    expect(rows[0].text).toBe("Blocked by: (x) Read the spec");
  });

  it("hides the global filter text in a blocker's name", () => {
    const task = parseFile("test.md", "- [ ] T")[0];
    const waiting = { ...NOT_WAITING, blockedBy: [blocker("todo Write docs")] };
    const rows = formatTasksFields(task, onTrack, UNPLACED, waiting, ["todo"]);
    expect(rows[0].text).toBe("Blocked by: (x) Write docs");
  });

  it("shows just the id for a blocker with no text", () => {
    const rows = rowsWaiting("- [ ] T", { ...NOT_WAITING, blockedBy: [blocker("")] });
    expect(rows[0].text).toBe("Blocked by: (x)");
  });

  it("says when a dependency isn't found, after any blocked rows", () => {
    const rows = rowsWaiting("- [ ] T", { ...NOT_WAITING, blockedBy: [blocker("A")], missingDependency: true });
    expect(rows[1]).toEqual({ icon: "badge-alert", text: "Depends on task not found in scope" });
  });

  it("adds nothing without a waiting state", () => {
    const line = "- [ ] T 🛫 2026-10-20";
    expect(formatTasksFields(parseFile("test.md", line)[0], null, UNPLACED, null)).toEqual(rowsFor(line));
  });
});
