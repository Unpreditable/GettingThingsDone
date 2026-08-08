import { parseFile } from "../src/core/TaskParser";
import { formatTasksFields } from "../src/core/TasksFieldText";
import type { DueStatus } from "../src/core/DueStatus";

const onTrack: DueStatus = { kind: "on-track", diffDays: 3 };
const overdue: DueStatus = { kind: "overdue", diffDays: -2 };

function rowsFor(line: string, status: DueStatus | null = null) {
  return formatTasksFields(parseFile("test.md", line)[0], status);
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
    expect(rowsFor("- [ ] Pay rent 📅 2026-08-07", overdue)[0].emoji).toBe("❢");
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
