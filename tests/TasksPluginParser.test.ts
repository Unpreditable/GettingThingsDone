import { parseDueDate, parseCompletionDate } from "../src/integrations/TasksPluginParser";

describe("parseDueDate", () => {
  it("parses a valid due date", () => {
    const d = parseDueDate("- [ ] Task 📅 2026-02-18");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(1);
    expect(d!.getDate()).toBe(18);
  });

  it("returns null for lines without a date", () => {
    expect(parseDueDate("- [ ] Task without date")).toBeNull();
  });

  it("returns null for invalid dates", () => {
    expect(parseDueDate("- [ ] Task 📅 not-a-date")).toBeNull();
  });
});

describe("parseCompletionDate", () => {
  it("parses a completion date", () => {
    const d = parseCompletionDate("- [x] Done ✅ 2026-02-17");
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(17);
  });
});
