import { parseFile, getTagValue, setTagValue, getInlineFieldValue, setInlineFieldValue, setSimpleTag } from "../src/core/TaskParser";

describe("parseFile", () => {
  it("parses simple unchecked tasks", () => {
    const content = "- [ ] Buy milk\n- [ ] Write report";
    const tasks = parseFile("test.md", content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].text).toBe("Buy milk");
    expect(tasks[0].isCompleted).toBe(false);
    expect(tasks[0].lineNumber).toBe(0);
  });

  it("parses completed tasks", () => {
    const content = "- [x] Done task\n- [X] Also done";
    const tasks = parseFile("test.md", content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].isCompleted).toBe(true);
    expect(tasks[1].isCompleted).toBe(true);
  });

  it("ignores non-task lines", () => {
    const content = "# Header\nSome paragraph\n- [ ] Real task\n- Not a task";
    const tasks = parseFile("test.md", content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("Real task");
  });

  it("extracts due date", () => {
    const content = "- [ ] Task with date 📅 2026-02-18";
    const tasks = parseFile("test.md", content);
    expect(tasks[0].dueDate).not.toBeNull();
    expect(tasks[0].dueDate!.getFullYear()).toBe(2026);
    expect(tasks[0].dueDate!.getMonth()).toBe(1); // 0-indexed
    expect(tasks[0].dueDate!.getDate()).toBe(18);
  });

  it("strips metadata from text", () => {
    const content = "- [ ] Buy milk 📅 2026-02-18 #gtd/today [horizon:: today]";
    const tasks = parseFile("test.md", content);
    expect(tasks[0].text).toBe("Buy milk");
  });

  it("extracts tags", () => {
    const content = "- [ ] Task #someday #project/alpha";
    const tasks = parseFile("test.md", content);
    expect(tasks[0].tags).toContain("someday");
    expect(tasks[0].tags).toContain("project/alpha");
  });

  it("extracts inline field", () => {
    const content = "- [ ] Task [horizon:: next-week]";
    const tasks = parseFile("test.md", content);
    expect(tasks[0].inlineField).toBe("next-week");
  });

  it("handles numbered lists", () => {
    const content = "1. [ ] Numbered task";
    const tasks = parseFile("test.md", content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("Numbered task");
  });

  it("preserves rawLine exactly", () => {
    const line = "  - [ ] Indented task 📅 2026-03-01";
    const tasks = parseFile("test.md", line);
    expect(tasks[0].rawLine).toBe(line);
  });
});

describe("getTagValue / setTagValue", () => {
  it("reads a gtd tag", () => {
    expect(getTagValue("- [ ] Task #gtd/today", "gtd")).toBe("today");
    expect(getTagValue("- [ ] Task #gtd/next-week", "gtd")).toBe("next-week");
    expect(getTagValue("- [ ] Task without tag", "gtd")).toBeNull();
  });

  it("sets a gtd tag on a line without one", () => {
    const result = setTagValue("- [ ] Task", "gtd", "today");
    expect(result).toContain("#gtd/today");
  });

  it("replaces an existing gtd tag", () => {
    const result = setTagValue("- [ ] Task #gtd/today", "gtd", "next-week");
    expect(result).not.toContain("#gtd/today");
    expect(result).toContain("#gtd/next-week");
  });

  it("removes a gtd tag when value is null", () => {
    const result = setTagValue("- [ ] Task #gtd/today", "gtd", null);
    expect(result).not.toContain("#gtd");
  });
});

describe("getInlineFieldValue / setInlineFieldValue", () => {
  it("reads an inline field", () => {
    expect(getInlineFieldValue("- [ ] Task [horizon:: today]", "horizon")).toBe("today");
    expect(getInlineFieldValue("- [ ] Task", "horizon")).toBeNull();
  });

  it("sets an inline field on a line without one", () => {
    const result = setInlineFieldValue("- [ ] Task", "horizon", "next-week");
    expect(result).toContain("[horizon:: next-week]");
  });

  it("replaces an existing inline field", () => {
    const result = setInlineFieldValue("- [ ] Task [horizon:: today]", "horizon", "someday");
    expect(result).not.toContain("today");
    expect(result).toContain("[horizon:: someday]");
  });

  it("removes an inline field when value is null", () => {
    const result = setInlineFieldValue("- [ ] Task [horizon:: today]", "horizon", null);
    expect(result).not.toContain("[horizon::");
  });
});

describe("setSimpleTag", () => {
  it("adds a tag", () => {
    const result = setSimpleTag("- [ ] Task", "someday", true);
    expect(result).toContain("#someday");
  });

  it("removes a tag", () => {
    const result = setSimpleTag("- [ ] Task #someday", "someday", false);
    expect(result).not.toContain("#someday");
  });

  it("does not duplicate an existing tag", () => {
    const result = setSimpleTag("- [ ] Task #someday", "someday", true);
    const count = (result.match(/#someday/g) ?? []).length;
    expect(count).toBe(1);
  });
});
