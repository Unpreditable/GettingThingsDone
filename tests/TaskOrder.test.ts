import { computeOrderKeys, applyManualOrder, mapToOrderKeys, purgeOrderKey } from "../src/core/TaskOrder";
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
  it("gives the same key for a task whose lineNumber shifts but text/filePath stay the same", () => {
    const before = makeTask({ id: "a", lineNumber: 2, text: "Buy milk" });
    const after = makeTask({ id: "a-shifted", lineNumber: 5, text: "Buy milk" });

    const keysBefore = computeOrderKeys([before]);
    const keysAfter = computeOrderKeys([after]);

    expect(keysBefore.get("a")).toBe(keysAfter.get("a-shifted"));
  });

  it("gives different keys to two tasks with identical text in the same file, by occurrence order", () => {
    const first = makeTask({ id: "a", lineNumber: 0, text: "Buy milk" });
    const second = makeTask({ id: "b", lineNumber: 3, text: "Buy milk" });

    const keys = computeOrderKeys([first, second]);

    expect(keys.get("a")).not.toBe(keys.get("b"));
  });

  it("gives different keys to same-text tasks in different files", () => {
    const a = makeTask({ id: "a", filePath: "one.md", text: "Buy milk" });
    const b = makeTask({ id: "b", filePath: "two.md", text: "Buy milk" });

    const keys = computeOrderKeys([a, b]);

    expect(keys.get("a")).not.toBe(keys.get("b"));
  });

  it("distinguishes same-text tasks by due date instead of falling back to line-order occurrence", () => {
    const withDate = makeTask({ id: "a", lineNumber: 0, text: "Foo", dueDate: new Date("2026-08-01") });
    const noDate = makeTask({ id: "b", lineNumber: 1, text: "Foo" });

    const keysBefore = computeOrderKeys([noDate, withDate]);
    const savedKeyForB = keysBefore.get("b")!;

    // Simulate the bug scenario: a same-text due-dated task is later inserted
    // ABOVE the already-ordered plain task, flipping which one is "first" by
    // line number. With the fix, keys are due-date-based, not occurrence-based,
    // so this reordering must not change which task the saved key resolves to.
    const withDateShifted = makeTask({ id: "a", lineNumber: 0, text: "Foo", dueDate: new Date("2026-08-01") });
    const noDateShifted = makeTask({ id: "b", lineNumber: 5, text: "Foo" });
    const keysAfter = computeOrderKeys([withDateShifted, noDateShifted]);

    expect(keysAfter.get("b")).toBe(savedKeyForB);
    expect(keysAfter.get("a")).not.toBe(savedKeyForB);
  });

  it("keeps the same key across a tag change (bucket assignment in inline-tag mode is stored as a tag)", () => {
    // A cross-bucket move rewrites this task's tag as part of the write, before
    // TaskIndex's async reindex catches up. If tags were part of the key, the
    // freshly-saved order key (computed pre-reindex, old tag) would never match
    // the key computed on the next render (post-reindex, new tag) — the task
    // would look "new" and fall back to appending at the end of the bucket.
    const before = makeTask({ id: "a", text: "Foo", tags: ["gtd/today"] });
    const after = makeTask({ id: "a", text: "Foo", tags: ["gtd/someday"] });

    const keysBefore = computeOrderKeys([before]);
    const keysAfter = computeOrderKeys([after]);

    expect(keysBefore.get("a")).toBe(keysAfter.get("a"));
  });

  it("keeps the same key across an inline field change (bucket assignment in inline-field mode)", () => {
    const before = makeTask({ id: "a", text: "Foo", inlineField: "today" });
    const after = makeTask({ id: "a", text: "Foo", inlineField: "someday" });

    const keysBefore = computeOrderKeys([before]);
    const keysAfter = computeOrderKeys([after]);

    expect(keysBefore.get("a")).toBe(keysAfter.get("a"));
  });

  it("keeps the same key across a completion toggle (isCompleted/completedAt excluded)", () => {
    const open = makeTask({ id: "a", text: "Foo", isCompleted: false, completedAt: null });
    const done = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: new Date("2026-07-22") });

    const keysOpen = computeOrderKeys([open]);
    const keysDone = computeOrderKeys([done]);

    expect(keysOpen.get("a")).toBe(keysDone.get("a"));
  });
});

describe("applyManualOrder", () => {
  it("reorders tasks to match savedOrder", () => {
    const a = makeTask({ id: "a", text: "A" });
    const b = makeTask({ id: "b", text: "B" });
    const c = makeTask({ id: "c", text: "C" });
    const orderKeys = computeOrderKeys([a, b, c]);
    const savedOrder = [orderKeys.get("c")!, orderKeys.get("a")!, orderKeys.get("b")!];

    const result = applyManualOrder([a, b, c], orderKeys, savedOrder);

    expect(result.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("appends tasks with no saved key at the end, in original order", () => {
    const a = makeTask({ id: "a", text: "A" });
    const b = makeTask({ id: "b", text: "B" });
    const c = makeTask({ id: "c", text: "C" });
    const orderKeys = computeOrderKeys([a, b, c]);
    const savedOrder = [orderKeys.get("b")!];

    const result = applyManualOrder([a, b, c], orderKeys, savedOrder);

    expect(result.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("ignores stale keys that no longer match any task", () => {
    const a = makeTask({ id: "a", text: "A" });
    const orderKeys = computeOrderKeys([a]);
    const savedOrder = ["stale-key-123", orderKeys.get("a")!];

    const result = applyManualOrder([a], orderKeys, savedOrder);

    expect(result.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("mapToOrderKeys", () => {
  it("resolves task ids to their order keys", () => {
    const a = makeTask({ id: "a", text: "A" });
    const b = makeTask({ id: "b", text: "B" });
    const orderKeys = computeOrderKeys([a, b]);

    const result = mapToOrderKeys(["b", "a"], orderKeys);

    expect(result).toEqual([orderKeys.get("b"), orderKeys.get("a")]);
  });

  it("drops ids that don't resolve to a key", () => {
    const a = makeTask({ id: "a", text: "A" });
    const orderKeys = computeOrderKeys([a]);

    const result = mapToOrderKeys(["a", "unknown-id"], orderKeys);

    expect(result).toEqual([orderKeys.get("a")]);
  });
});

describe("purgeOrderKey", () => {
  it("removes a key from every bucket that has it", () => {
    const taskOrder = {
      today: ["keyA", "keyB"],
      "this-week": ["keyC", "keyA"],
      someday: ["keyD"],
    };

    const { taskOrder: result, changed } = purgeOrderKey(taskOrder, "keyA");

    expect(changed).toBe(true);
    expect(result).toEqual({
      today: ["keyB"],
      "this-week": ["keyC"],
      someday: ["keyD"],
    });
  });

  it("reports changed: false and leaves buckets untouched when the key isn't found anywhere", () => {
    const taskOrder = { today: ["keyA", "keyB"] };

    const { taskOrder: result, changed } = purgeOrderKey(taskOrder, "keyZ");

    expect(changed).toBe(false);
    expect(result).toEqual({ today: ["keyA", "keyB"] });
  });

  it("does not mutate the input record", () => {
    const taskOrder = { today: ["keyA", "keyB"] };

    purgeOrderKey(taskOrder, "keyA");

    expect(taskOrder).toEqual({ today: ["keyA", "keyB"] });
  });
});
