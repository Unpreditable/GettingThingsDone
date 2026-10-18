import { scanTasksMetadata, foldTasksFields } from "../src/integrations/TasksPluginParser";

/** Convenience: scan + fold in one call, as parseFile will do. */
function fields(text: string) {
  return foldTasksFields(scanTasksMetadata(text));
}

describe("due and done dates", () => {
  it("parses a valid due date", () => {
    const d = fields("- [ ] Task 📅 2026-02-18").dueDate;
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(1);
    expect(d!.getDate()).toBe(18);
  });

  it("returns null for lines without a date", () => {
    expect(fields("- [ ] Task without date").dueDate).toBeNull();
  });

  it("returns null for invalid dates", () => {
    expect(fields("- [ ] Task 📅 not-a-date").dueDate).toBeNull();
  });

  it("parses a completion date", () => {
    const d = fields("- [x] Done ✅ 2026-02-17").completedAt;
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(17);
  });
});

describe("scanTasksMetadata", () => {
  it("parses every field on the TODO repro line", () => {
    const f = fields("Test 2 ⏫ 🔁 every week 🏁 delete 🛫 2026-10-11 ⏳ 2026-10-11");
    expect(f.priority).toBe("high");
    expect(f.recurrence).toBe("every week");
    expect(f.onCompletion).toBe("delete");
    expect(f.startDate!.getFullYear()).toBe(2026);
    expect(f.startDate!.getMonth()).toBe(9); // October, 0-indexed
    expect(f.startDate!.getDate()).toBe(11);
    expect(f.scheduledDate!.getDate()).toBe(11);
  });

  it("terminates a recurrence value at every other marker in turn", () => {
    const cases: Array<[string, string]> = [
      ["Task 🔁 every week 📅 2026-03-01", "every week"],
      ["Task 🔁 every week ✅ 2026-03-01", "every week"],
      ["Task 🔁 every week ⏳ 2026-03-01", "every week"],
      ["Task 🔁 every week 🛫 2026-03-01", "every week"],
      ["Task 🔁 every week ➕ 2026-03-01", "every week"],
      ["Task 🔁 every week ❌ 2026-03-01", "every week"],
      ["Task 🔁 every week 🔺", "every week"],
      ["Task 🔁 every week ⏫", "every week"],
      ["Task 🔁 every week 🔼", "every week"],
      ["Task 🔁 every week 🔽", "every week"],
      ["Task 🔁 every week ⏬", "every week"],
      ["Task 🔁 every week 🏁 delete", "every week"],
      ["Task 🔁 every week 🆔 ab12", "every week"],
      ["Task 🔁 every week ⛔ cd34", "every week"],
    ];
    for (const [input, expected] of cases) {
      expect(fields(input).recurrence).toBe(expected);
    }
  });

  it("parses all five priority levels", () => {
    expect(fields("Task 🔺").priority).toBe("highest");
    expect(fields("Task ⏫").priority).toBe("high");
    expect(fields("Task 🔼").priority).toBe("medium");
    expect(fields("Task 🔽").priority).toBe("low");
    expect(fields("Task ⏬").priority).toBe("lowest");
    expect(fields("Task").priority).toBeNull();
  });

  it("rejects a date marker whose value does not parse", () => {
    const spans = scanTasksMetadata("Pay rent 📅 soon");
    expect(spans).toHaveLength(0);
    expect(foldTasksFields(spans).dueDate).toBeNull();
  });

  it("rejects a calendar-invalid date", () => {
    expect(scanTasksMetadata("Task 📅 2026-13-45")).toHaveLength(0);
  });

  it("rejects a day-of-month that doesn't exist, rather than rolling it over", () => {
    const spans = scanTasksMetadata("Task 📅 2026-02-30");
    expect(spans).toHaveLength(0);
    expect(foldTasksFields(spans).dueDate).toBeNull();
  });

  it("rejects a 31st in a 30-day month, rather than rolling it over", () => {
    const spans = scanTasksMetadata("Task 📅 2026-04-31");
    expect(spans).toHaveLength(0);
    expect(foldTasksFields(spans).dueDate).toBeNull();
  });

  it("accepts a real leap day", () => {
    const f = fields("Task 📅 2028-02-29");
    expect(f.dueDate).not.toBeNull();
    expect(f.dueDate!.getFullYear()).toBe(2028);
    expect(f.dueDate!.getMonth()).toBe(1);
    expect(f.dueDate!.getDate()).toBe(29);
  });

  it("rejects a marker with an empty free-text value", () => {
    expect(scanTasksMetadata("Task 🔁")).toHaveLength(0);
    expect(scanTasksMetadata("Task 🏁")).toHaveLength(0);
  });

  it("still uses a rejected marker as a boundary", () => {
    const f = fields("Review 🔁 every week 📅 soon");
    expect(f.recurrence).toBe("every week");
    expect(f.dueDate).toBeNull();
  });

  it("keeps the first value when a marker repeats", () => {
    const spans = scanTasksMetadata("Task 📅 2026-01-01 📅 2026-02-01");
    expect(spans).toHaveLength(2);
    expect(foldTasksFields(spans).dueDate!.getMonth()).toBe(0); // January
  });

  it("does not assume canonical marker order", () => {
    const f = fields("Task ⏳ 2026-05-05 ⏫ 📅 2026-06-06");
    expect(f.scheduledDate!.getMonth()).toBe(4);
    expect(f.priority).toBe("high");
    expect(f.dueDate!.getMonth()).toBe(5);
  });

  it("ignores unrecognized emoji", () => {
    expect(scanTasksMetadata("Buy 🍎 apples")).toHaveLength(0);
  });

  it("scans id and depends-on without producing fields", () => {
    const spans = scanTasksMetadata("Task 🆔 ab12 ⛔ cd34,ef56");
    expect(spans.map((s) => s.field)).toEqual(["id", "dependsOn"]);
    expect(spans[1].value).toBe("cd34,ef56");
  });

  it("reports spans that cover marker and value", () => {
    const spans = scanTasksMetadata("Pay rent 🛫 2026-10-11");
    expect(spans).toHaveLength(1);
    expect("Pay rent 🛫 2026-10-11".slice(spans[0].start, spans[0].end)).toBe("🛫 2026-10-11");
  });
});

describe("Dataview-format fields", () => {
  it("reads every date key, in square and round brackets", () => {
    for (const [open, close] of [["[", "]"], ["(", ")"]]) {
      const f = fields(
        `Task ${open}due:: 2026-10-20${close} ${open}scheduled:: 2026-10-21${close} ` +
        `${open}start:: 2026-10-22${close} ${open}created:: 2026-10-23${close} ` +
        `${open}completion:: 2026-10-24${close} ${open}cancelled:: 2026-10-25${close}`
      );
      expect(f.dueDate!.getDate()).toBe(20);
      expect(f.scheduledDate!.getDate()).toBe(21);
      expect(f.startDate!.getDate()).toBe(22);
      expect(f.createdDate!.getDate()).toBe(23);
      expect(f.completedAt!.getDate()).toBe(24);
      expect(f.cancelledDate!.getDate()).toBe(25);
    }
  });

  it("reads priority, repeat and on-completion values", () => {
    for (const level of ["highest", "high", "medium", "low", "lowest"]) {
      expect(fields(`Task [priority:: ${level}]`).priority).toBe(level);
    }
    const f = fields("Task (repeat:: every week) [onCompletion:: delete]");
    expect(f.recurrence).toBe("every week");
    expect(f.onCompletion).toBe("delete");
  });

  it("reads id and depends-on", () => {
    const spans = scanTasksMetadata("Task [id:: ab12] [dependsOn:: cd34, ef56]");
    expect(spans.map((s) => [s.field, s.value])).toEqual([["id", "ab12"], ["dependsOn", "cd34,ef56"]]);
  });

  it("accepts no space after the colons", () => {
    expect(fields("Task [due::2026-10-20]").dueDate!.getDate()).toBe(20);
  });

  it("reports a span that covers the whole field, brackets included", () => {
    const text = "Pay rent (due:: 2026-10-20) now";
    const [span] = scanTasksMetadata(text);
    expect(text.slice(span.start, span.end)).toBe("(due:: 2026-10-20)");
  });

  it("rejects a field whose value does not parse", () => {
    expect(scanTasksMetadata("Task [due:: soon]")).toHaveLength(0);
    expect(scanTasksMetadata("Task [due:: 2026-02-30]")).toHaveLength(0);
    expect(scanTasksMetadata("Task [due:: 2026-10-20 or so]")).toHaveLength(0);
    expect(scanTasksMetadata("Task [priority:: urgent]")).toHaveLength(0);
    expect(scanTasksMetadata("Task [repeat:: ]")).toHaveLength(0);
  });

  it("ignores keys Tasks does not define, and keys in another case", () => {
    expect(scanTasksMetadata("Task [gtd:: today] [horizon:: 2026-10-20]")).toHaveLength(0);
    expect(scanTasksMetadata("Task [Due:: 2026-10-20]")).toHaveLength(0);
  });

  it("ends a recurrence emoji's value at a bracket field", () => {
    expect(fields("Task 🔁 every week (due:: 2026-10-20)").recurrence).toBe("every week");
    expect(fields("Task 🔁 every week (due:: soon)").recurrence).toBe("every week");
  });

  it("does not read an emoji inside a bracket value as a marker", () => {
    const f = fields("Task [repeat:: every week 📅 2026-10-20]");
    expect(f.recurrence).toBe("every week 📅 2026-10-20");
    expect(f.dueDate).toBeNull();
  });

  it("skips the key it is told to ignore, in any case", () => {
    expect(scanTasksMetadata("Task [repeat:: today]", [], "Repeat")).toHaveLength(0);
    expect(fields("Task [due:: 2026-10-20]").dueDate).not.toBeNull();
  });
});

describe("emoji and Dataview on the same line", () => {
  it("takes an emoji field over the Dataview one, wherever each stands", () => {
    expect(fields("Task [due:: 2026-10-01] 📅 2026-10-20").dueDate!.getDate()).toBe(20);
    expect(fields("Task 📅 2026-10-20 [due:: 2026-10-01]").dueDate!.getDate()).toBe(20);
    expect(fields("Task [priority:: low] ⏫").priority).toBe("high");
  });

  it("fills each field from Dataview where no emoji gives it", () => {
    const f = fields("Task 📅 2026-10-20 [scheduled:: 2026-10-22] ⏫ [priority:: low]");
    expect(f.dueDate!.getDate()).toBe(20);
    expect(f.scheduledDate!.getDate()).toBe(22);
    expect(f.priority).toBe("high");
  });

  it("falls back to Dataview when the emoji value is rejected", () => {
    expect(fields("Task 📅 soon [due:: 2026-10-20]").dueDate!.getDate()).toBe(20);
  });

  it("keeps the first Dataview value when a key repeats", () => {
    expect(fields("Task [due:: 2026-10-01] (due:: 2026-10-20)").dueDate!.getDate()).toBe(1);
  });
});

describe("Dataview fields laid out as Tasks also accepts them", () => {
  it("accepts spaces inside a Dataview field's brackets", () => {
    expect(fields("Task [ due:: 2026-10-20 ]").dueDate!.getDate()).toBe(20);
    expect(fields("Task (  priority::  high )").priority).toBe("high");
  });

  it("takes a comma after a Dataview field as part of it", () => {
    const text = "Task [due:: 2026-10-20], [priority:: high] , [repeat:: every week]";
    const spans = scanTasksMetadata(text);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual([
      "[due:: 2026-10-20],",
      "[priority:: high] ,",
      "[repeat:: every week]",
    ]);
  });
});
