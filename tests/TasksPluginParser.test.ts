import { parseDueDate, parseCompletionDate, setDueDate, formatDate } from "../src/integrations/TasksPluginParser";

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

describe("setDueDate", () => {
  it("adds a due date when none exists", () => {
    const result = setDueDate("- [ ] Task", new Date("2026-02-18T00:00:00"));
    expect(result).toContain("📅 2026-02-18");
  });

  it("replaces an existing due date", () => {
    const result = setDueDate("- [ ] Task 📅 2026-01-01", new Date("2026-02-18T00:00:00"));
    expect(result).toContain("📅 2026-02-18");
    expect(result).not.toContain("2026-01-01");
  });

  it("removes a due date when null is passed", () => {
    const result = setDueDate("- [ ] Task 📅 2026-01-01", null);
    expect(result).not.toContain("📅");
    expect(result).not.toContain("2026-01-01");
  });

  it("does not add extra whitespace when removing", () => {
    const result = setDueDate("- [ ] Task 📅 2026-01-01", null);
    expect(result).toBe("- [ ] Task");
  });
});

describe("formatDate", () => {
  it("pads single-digit month and day", () => {
    expect(formatDate(new Date("2026-01-05T00:00:00"))).toBe("2026-01-05");
  });

  it("handles December", () => {
    expect(formatDate(new Date("2026-12-31T00:00:00"))).toBe("2026-12-31");
  });
});
