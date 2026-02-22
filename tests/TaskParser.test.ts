import { parseFile, buildTaskHierarchy, getTagValue, setTagValue, getInlineFieldValue, setInlineFieldValue, setSimpleTag } from "../src/core/TaskParser";

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

describe("indentLevel and buildTaskHierarchy", () => {
  it("assigns indentLevel 0 to top-level tasks", () => {
    const tasks = parseFile("test.md", "- [ ] Top level\n- [ ] Another top");
    expect(tasks[0].indentLevel).toBe(0);
    expect(tasks[1].indentLevel).toBe(0);
  });

  it("assigns indentLevel 1 to tasks indented with 2 spaces", () => {
    const tasks = parseFile("test.md", "- [ ] Parent\n  - [ ] Child");
    expect(tasks[0].indentLevel).toBe(0);
    expect(tasks[1].indentLevel).toBe(1);
  });

  it("assigns indentLevel 1 to tasks indented with a tab", () => {
    const tasks = parseFile("test.md", "- [ ] Parent\n\t- [ ] Child");
    expect(tasks[1].indentLevel).toBe(1);
  });

  it("assigns indentLevel 2 to grandchild tasks", () => {
    const tasks = parseFile("test.md", "- [ ] Root\n  - [ ] Child\n    - [ ] Grandchild");
    expect(tasks[0].indentLevel).toBe(0);
    expect(tasks[1].indentLevel).toBe(1);
    expect(tasks[2].indentLevel).toBe(2);
  });

  it("links parent and child IDs for a single parent-child pair", () => {
    const tasks = parseFile("test.md", "- [ ] Parent\n  - [ ] Child");
    expect(tasks[0].parentId).toBeNull();
    expect(tasks[0].childIds).toContain(tasks[1].id);
    expect(tasks[1].parentId).toBe(tasks[0].id);
    expect(tasks[1].childIds).toHaveLength(0);
  });

  it("links grandchild through the chain", () => {
    const tasks = parseFile("test.md", "- [ ] Root\n  - [ ] Child\n    - [ ] Grandchild");
    expect(tasks[1].parentId).toBe(tasks[0].id);
    expect(tasks[2].parentId).toBe(tasks[1].id);
    expect(tasks[0].childIds).toContain(tasks[1].id);
    expect(tasks[1].childIds).toContain(tasks[2].id);
  });

  it("handles multiple top-level tasks each with their own child", () => {
    const content = "- [ ] Parent A\n  - [ ] Child A\n- [ ] Parent B\n  - [ ] Child B";
    const tasks = parseFile("test.md", content);
    expect(tasks[0].childIds).toContain(tasks[1].id);
    expect(tasks[1].parentId).toBe(tasks[0].id);
    expect(tasks[2].childIds).toContain(tasks[3].id);
    expect(tasks[3].parentId).toBe(tasks[2].id);
    expect(tasks[0].parentId).toBeNull();
    expect(tasks[2].parentId).toBeNull();
  });

  it("top-level tasks have no parentId even after a subtask block", () => {
    const content = "- [ ] Parent\n  - [ ] Child\n- [ ] Sibling";
    const tasks = parseFile("test.md", content);
    // 'Sibling' is at depth 0, not a child of Parent
    expect(tasks[2].parentId).toBeNull();
    expect(tasks[0].childIds).not.toContain(tasks[2].id);
  });

  it("buildTaskHierarchy works across multiple files", () => {
    const t1 = {
      id: "a1", filePath: "a.md", lineNumber: 0, indentLevel: 0,
      rawLine: "- [ ] A root", text: "A root", isCompleted: false,
      completedAt: null, dueDate: null, tags: [], inlineField: null,
      parentId: null, childIds: [],
    };
    const t2 = {
      id: "a2", filePath: "a.md", lineNumber: 1, indentLevel: 1,
      rawLine: "  - [ ] A child", text: "A child", isCompleted: false,
      completedAt: null, dueDate: null, tags: [], inlineField: null,
      parentId: null, childIds: [],
    };
    const t3 = {
      id: "b1", filePath: "b.md", lineNumber: 0, indentLevel: 0,
      rawLine: "- [ ] B root", text: "B root", isCompleted: false,
      completedAt: null, dueDate: null, tags: [], inlineField: null,
      parentId: null, childIds: [],
    };
    buildTaskHierarchy([t1, t2, t3]);
    expect(t2.parentId).toBe("a1");
    expect(t1.childIds).toContain("a2");
    expect(t3.parentId).toBeNull();
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

describe("edge cases", () => {
  it("parseFile returns empty array for empty content", () => {
    expect(parseFile("test.md", "")).toHaveLength(0);
  });

  it("parseFile returns empty array for file with no tasks", () => {
    expect(parseFile("test.md", "# Heading\nJust text\n- No checkbox")).toHaveLength(0);
  });

  it("parses tasks with * list marker", () => {
    const tasks = parseFile("test.md", "* [ ] Star task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("Star task");
  });

  it("parses tasks with + list marker", () => {
    const tasks = parseFile("test.md", "+ [ ] Plus task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("Plus task");
  });

  it("parses tasks with 1) numbering style", () => {
    const tasks = parseFile("test.md", "1) [ ] Paren task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("Paren task");
  });

  it("stripMetadata removes recurrence emoji", () => {
    const tasks = parseFile("test.md", "- [ ] Weekly review 🔁 every week");
    expect(tasks[0].text).toBe("Weekly review");
  });

  it("stripMetadata removes priority emojis", () => {
    const tasks = parseFile("test.md", "- [ ] Urgent task ⏫");
    expect(tasks[0].text).toBe("Urgent task");
  });

  it("extractInlineField returns first field if multiple exist", () => {
    const tasks = parseFile("test.md", "- [ ] Task [project:: alpha] [gtd:: today]");
    expect(tasks[0].inlineField).toBe("alpha");
  });

  it("getTagValue and setTagValue handle regex special chars in prefix", () => {
    expect(getTagValue("- [ ] Task #foo.bar/today", "foo.bar")).toBe("today");
    const result = setTagValue("- [ ] Task", "foo+bar", "today");
    expect(result).toContain("#foo+bar/today");
  });

  it("getInlineFieldValue handles regex special chars in key", () => {
    expect(getInlineFieldValue("- [ ] Task [a.b:: today]", "a.b")).toBe("today");
  });

  it("setInlineFieldValue handles regex special chars in key", () => {
    const result = setInlineFieldValue("- [ ] Task", "a+b", "today");
    expect(result).toContain("[a+b:: today]");
  });

  it("setSimpleTag handles regex special chars in tag", () => {
    const result = setSimpleTag("- [ ] Task", "some.tag", true);
    expect(result).toContain("#some.tag");
    const removed = setSimpleTag(result, "some.tag", false);
    expect(removed).not.toContain("#some.tag");
  });
});
