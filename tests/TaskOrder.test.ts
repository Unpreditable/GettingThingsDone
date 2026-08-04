import {
  computeOrderKeys,
  computeLegacyOrderKeys,
  applyManualOrder,
  mapToOrderEntries,
  purgeOrderEntry,
  entryId,
  isOrderEntry,
  completionClock,
} from "../src/core/TaskOrder";
import type { OrderEntry } from "../src/core/TaskOrder";
import type { TaskRecord } from "../src/core/TaskParser";

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "1",
    filePath: "test.md",
    lineNumber: 0,
    rawLine: "- [ ] Test task",
    text: "Test task",
    isCompleted: false,
    completedAt: null,
    dueDate: null,
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...overrides,
  };
}

describe("computeOrderKeys", () => {
  it("gives the same entry for a task whose lineNumber shifts but text/filePath stay the same", () => {
    const before = makeTask({ id: "a", lineNumber: 2, text: "Buy milk" });
    const after = makeTask({ id: "a-shifted", lineNumber: 5, text: "Buy milk" });

    expect(computeOrderKeys([before]).get("a")).toEqual(
      computeOrderKeys([after]).get("a-shifted")
    );
  });

  it("gives different keys to two tasks with identical text in the same file, by occurrence order", () => {
    const first = makeTask({ id: "a", lineNumber: 0, text: "Buy milk" });
    const second = makeTask({ id: "b", lineNumber: 3, text: "Buy milk" });

    const keys = computeOrderKeys([first, second]);

    expect(keys.get("a")!.key).not.toBe(keys.get("b")!.key);
  });

  it("gives same-text tasks in different files the SAME key but different file fields", () => {
    // The file path deliberately no longer enters the hash — that is what
    // makes a rename an in-place `file` rewrite instead of a rehash.
    const a = makeTask({ id: "a", filePath: "one.md", text: "Buy milk" });
    const b = makeTask({ id: "b", filePath: "two.md", text: "Buy milk" });

    const keys = computeOrderKeys([a, b]);

    expect(keys.get("a")!.key).toBe(keys.get("b")!.key);
    expect(keys.get("a")!.file).toBe("one.md");
    expect(keys.get("b")!.file).toBe("two.md");
    expect(entryId(keys.get("a")!)).not.toBe(entryId(keys.get("b")!));
  });

  it("counts occurrences per file, not globally", () => {
    const a = makeTask({ id: "a", filePath: "one.md", lineNumber: 0, text: "Foo" });
    const b = makeTask({ id: "b", filePath: "two.md", lineNumber: 0, text: "Foo" });
    const c = makeTask({ id: "c", filePath: "two.md", lineNumber: 1, text: "Foo" });

    const keys = computeOrderKeys([a, b, c]);

    expect(keys.get("a")!.key).toBe(keys.get("b")!.key);
    expect(keys.get("c")!.key).not.toBe(keys.get("b")!.key);
  });

  it("distinguishes same-text tasks by due date instead of falling back to line-order occurrence", () => {
    const withDate = makeTask({ id: "a", lineNumber: 0, text: "Foo", dueDate: new Date("2026-08-01") });
    const noDate = makeTask({ id: "b", lineNumber: 1, text: "Foo" });

    const savedForB = computeOrderKeys([noDate, withDate]).get("b")!;

    const withDateShifted = makeTask({ id: "a", lineNumber: 0, text: "Foo", dueDate: new Date("2026-08-01") });
    const noDateShifted = makeTask({ id: "b", lineNumber: 5, text: "Foo" });
    const keysAfter = computeOrderKeys([withDateShifted, noDateShifted]);

    expect(keysAfter.get("b")).toEqual(savedForB);
    expect(keysAfter.get("a")).not.toEqual(savedForB);
  });

  it("keeps the same entry across a tag change (bucket assignment in inline-tag mode is stored as a tag)", () => {
    const before = makeTask({ id: "a", text: "Foo", tags: ["gtd/today"] });
    const after = makeTask({ id: "a", text: "Foo", tags: ["gtd/someday"] });

    expect(computeOrderKeys([before]).get("a")).toEqual(computeOrderKeys([after]).get("a"));
  });

  it("keeps the same entry across an inline field change (bucket assignment in inline-field mode)", () => {
    const before = makeTask({ id: "a", text: "Foo", inlineField: "today" });
    const after = makeTask({ id: "a", text: "Foo", inlineField: "someday" });

    expect(computeOrderKeys([before]).get("a")).toEqual(computeOrderKeys([after]).get("a"));
  });

  it("keeps the same entry across a completion toggle (isCompleted/completedAt excluded)", () => {
    const open = makeTask({ id: "a", text: "Foo", isCompleted: false, completedAt: null });
    const done = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: new Date("2026-07-22") });

    expect(computeOrderKeys([open]).get("a")).toEqual(computeOrderKeys([done]).get("a"));
  });
});

describe("computeLegacyOrderKeys", () => {
  it("folds the file path into the hash, so same-text tasks in different files differ", () => {
    const a = makeTask({ id: "a", filePath: "one.md", text: "Buy milk" });
    const b = makeTask({ id: "b", filePath: "two.md", text: "Buy milk" });

    const keys = computeLegacyOrderKeys([a, b]);

    expect(keys.get("a")).not.toBe(keys.get("b"));
  });

  it("returns flat strings, not entries", () => {
    const a = makeTask({ id: "a", text: "Buy milk" });
    expect(typeof computeLegacyOrderKeys([a]).get("a")).toBe("string");
  });

  it("uses the same occurrence counting as computeOrderKeys", () => {
    const first = makeTask({ id: "a", lineNumber: 0, text: "Foo" });
    const second = makeTask({ id: "b", lineNumber: 1, text: "Foo" });

    const legacy = computeLegacyOrderKeys([first, second]);
    const current = computeOrderKeys([first, second]);

    expect(legacy.get("a")!.endsWith(":0")).toBe(true);
    expect(legacy.get("b")!.endsWith(":1")).toBe(true);
    expect(current.get("a")!.key.endsWith(":0")).toBe(true);
    expect(current.get("b")!.key.endsWith(":1")).toBe(true);
  });
});

describe("entryId / sameEntry / isOrderEntry", () => {
  it("builds an id from file and key", () => {
    expect(entryId({ file: "notes/a.md", key: "123:0" })).toBe("notes/a.md::123:0");
  });

  it("accepts a structured entry and rejects a legacy flat string", () => {
    expect(isOrderEntry({ file: "a.md", key: "1:0" })).toBe(true);
    expect(isOrderEntry("123456:0")).toBe(false);
    expect(isOrderEntry(null)).toBe(false);
    expect(isOrderEntry({ file: "a.md" })).toBe(false);
  });
});

describe("applyManualOrder", () => {
  it("reorders tasks to match savedOrder", () => {
    const a = makeTask({ id: "a", text: "A" });
    const b = makeTask({ id: "b", text: "B" });
    const c = makeTask({ id: "c", text: "C" });
    const entries = computeOrderKeys([a, b, c]);
    const savedOrder = [entries.get("c")!, entries.get("a")!, entries.get("b")!];

    const result = applyManualOrder([a, b, c], entries, savedOrder);

    expect(result.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("appends tasks with no saved entry at the end, in original order", () => {
    const a = makeTask({ id: "a", text: "A" });
    const b = makeTask({ id: "b", text: "B" });
    const c = makeTask({ id: "c", text: "C" });
    const entries = computeOrderKeys([a, b, c]);

    const result = applyManualOrder([a, b, c], entries, [entries.get("b")!]);

    expect(result.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("ignores stale entries that no longer match any task", () => {
    const a = makeTask({ id: "a", text: "A" });
    const entries = computeOrderKeys([a]);
    const savedOrder = [{ file: "gone.md", key: "stale:0" }, entries.get("a")!];

    expect(applyManualOrder([a], entries, savedOrder).map((t) => t.id)).toEqual(["a"]);
  });

  it("does not match an entry whose key is right but whose file is wrong", () => {
    const a = makeTask({ id: "a", filePath: "one.md", text: "A" });
    const entries = computeOrderKeys([a]);
    const wrongFile = { file: "two.md", key: entries.get("a")!.key };

    expect(applyManualOrder([a], entries, [wrongFile]).map((t) => t.id)).toEqual(["a"]);
  });

  it("skips legacy flat-string entries without throwing (pre-migration data.json)", () => {
    const a = makeTask({ id: "a", text: "A" });
    const b = makeTask({ id: "b", text: "B" });
    const entries = computeOrderKeys([a, b]);
    const legacy = "1234:0" as unknown as OrderEntry;

    const result = applyManualOrder([a, b], entries, [legacy, entries.get("b")!]);

    expect(result.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("mapToOrderEntries", () => {
  it("resolves task ids to their entries", () => {
    const a = makeTask({ id: "a", text: "A" });
    const b = makeTask({ id: "b", text: "B" });
    const entries = computeOrderKeys([a, b]);

    expect(mapToOrderEntries(["b", "a"], entries)).toEqual([entries.get("b"), entries.get("a")]);
  });

  it("drops ids that don't resolve to an entry", () => {
    const a = makeTask({ id: "a", text: "A" });
    const entries = computeOrderKeys([a]);

    expect(mapToOrderEntries(["a", "unknown-id"], entries)).toEqual([entries.get("a")]);
  });
});

describe("purgeOrderEntry", () => {
  const entryA = { file: "a.md", key: "kA:0" };
  const entryB = { file: "a.md", key: "kB:0" };
  const entryC = { file: "b.md", key: "kA:0" };

  it("removes an entry from every bucket that has it", () => {
    const taskOrder = {
      today: [entryA, entryB],
      "this-week": [entryC, entryA],
      someday: [entryB],
    };

    const { taskOrder: result, changed } = purgeOrderEntry(taskOrder, entryA);

    expect(changed).toBe(true);
    expect(result).toEqual({
      today: [entryB],
      "this-week": [entryC],
      someday: [entryB],
    });
  });

  it("does not remove a same-key entry that belongs to a different file", () => {
    const { taskOrder: result } = purgeOrderEntry({ today: [entryC] }, entryA);
    expect(result.today).toEqual([entryC]);
  });

  it("reports changed: false and leaves buckets untouched when the entry isn't found anywhere", () => {
    const taskOrder = { today: [entryA, entryB] };

    const { taskOrder: result, changed } = purgeOrderEntry(taskOrder, { file: "z.md", key: "kZ:0" });

    expect(changed).toBe(false);
    expect(result).toEqual({ today: [entryA, entryB] });
  });

  it("does not mutate the input record", () => {
    const taskOrder = { today: [entryA, entryB] };
    purgeOrderEntry(taskOrder, entryA);
    expect(taskOrder).toEqual({ today: [entryA, entryB] });
  });
});

describe("completionClock", () => {
  const entry = { file: "a.md", key: "k:0" };

  it("prefers the ✅ date on the line", () => {
    const at = new Date("2026-08-02T00:00:00");
    const task = makeTask({ isCompleted: true, completedAt: at });

    expect(completionClock(task, entry, { "a.md::k:0": 111 })).toBe(at.getTime());
  });

  it("falls back to the witnessed completionSeen record when there is no date", () => {
    const task = makeTask({ isCompleted: true, completedAt: null });

    expect(completionClock(task, entry, { "a.md::k:0": 999 })).toBe(999);
  });

  it("returns null when there is neither a date nor a record (unwitnessed → aged)", () => {
    const task = makeTask({ isCompleted: true, completedAt: null });

    expect(completionClock(task, entry, {})).toBeNull();
    expect(completionClock(task, undefined, { "a.md::k:0": 999 })).toBeNull();
  });
});
