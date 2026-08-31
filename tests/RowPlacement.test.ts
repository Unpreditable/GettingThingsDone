import { placeRow } from "../src/core/RowPlacement";
import type { RowContext } from "../src/core/RowPlacement";
import type { TaskRecord } from "../src/core/TaskParser";

function makeTask(o: Partial<TaskRecord>): TaskRecord {
  return {
    id: "1",
    filePath: "test.md",
    lineNumber: 0,
    rawLine: "- [ ] Test task",
    text: "Test task",
    isCompleted: false,
    completedAt: null,
    dueDate: null,
    priority: null,
    recurrence: null,
    scheduledDate: null,
    startDate: null,
    createdDate: null,
    cancelledDate: null,
    onCompletion: null,
    blockId: null,
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...o,
  };
}

/**
 * Builds a RowContext from a compact `id: parentId` spec. Every task lands in
 * `bucket` and is rendered, unless listed in `elsewhere` (filed in another
 * bucket) or `hidden` (in this bucket but not currently on screen — completed
 * and aged out, dismissed, or filtered away by a search).
 */
function context(
  spec: Record<string, string | null>,
  opts: { bucketId?: string; elsewhere?: Record<string, string>; hidden?: string[] } = {}
): RowContext {
  const bucketId = opts.bucketId ?? "today";
  const hidden = new Set(opts.hidden ?? []);
  const allTasks = new Map<string, TaskRecord>();
  const taskBucket = new Map<string, string>();
  const visibleIds = new Set<string>();

  for (const [id, parentId] of Object.entries(spec)) {
    allTasks.set(id, makeTask({ id, text: id, parentId }));
    const bucket = opts.elsewhere?.[id] ?? bucketId;
    taskBucket.set(id, bucket);
    if (bucket === bucketId && !hidden.has(id)) visibleIds.add(id);
  }
  for (const [id, parentId] of Object.entries(spec)) {
    // A parentId with no entry of its own is deliberate: it models a parent
    // that has fallen out of the index entirely.
    if (parentId) allTasks.get(parentId)?.childIds.push(id);
  }

  return { allTasks, taskBucket, bucketId, visibleIds };
}

function place(id: string, ctx: RowContext) {
  return placeRow(ctx.allTasks.get(id)!, ctx);
}

// A
//   A1
//   A2
//     A2.1
const family = { A: null, A1: "A", A2: "A", "A2.1": "A2" };

describe("placeRow: indentation", () => {
  it("puts a task with no parent at the left margin", () => {
    expect(place("A", context(family)).indentLevel).toBe(0);
  });

  it("indents a child one step and a grandchild two", () => {
    const ctx = context(family);
    expect(place("A1", ctx).indentLevel).toBe(1);
    expect(place("A2.1", ctx).indentLevel).toBe(2);
  });

  it("keeps a grandchild's depth when its parent is hidden", () => {
    // The bug this module was written for: A2 is completed and aged out, so
    // A2.1 renders directly after A1. Its depth still describes the tree.
    const ctx = context(family, { hidden: ["A2"] });
    expect(place("A2.1", ctx).indentLevel).toBe(2);
  });

  it("does not count an ancestor filed in another bucket", () => {
    const ctx = context(family, { elsewhere: { A2: "someday" } });
    expect(place("A2.1", ctx).indentLevel).toBe(1);
  });

  it("still counts ancestors above one filed in another bucket", () => {
    // A is in this bucket, A2 is not. A2.1 is two levels deep in the tree and
    // one of those levels is drawn here.
    const ctx = context(family, { elsewhere: { A2: "someday" } });
    expect(place("A2.1", ctx).indentLevel).toBe(1);
    expect(place("A1", ctx).indentLevel).toBe(1);
  });

  it("treats a parent missing from the index as the end of the chain", () => {
    const ctx = context({ orphan: "gone" });
    expect(place("orphan", ctx).indentLevel).toBe(0);
  });

  it("terminates on a parent cycle rather than counting forever", () => {
    const ctx = context({ X: "Y", Y: "X" });
    expect(place("X", ctx).indentLevel).toBe(1);
  });
});

describe("placeRow: detached parent", () => {
  it("is false for a root task", () => {
    expect(place("A", context(family)).detachedParent).toBe(false);
  });

  it("is false when the parent is rendered right above", () => {
    const ctx = context(family);
    expect(place("A1", ctx).detachedParent).toBe(false);
    expect(place("A2.1", ctx).detachedParent).toBe(false);
  });

  it("is true when the parent is in this bucket but hidden", () => {
    expect(place("A2.1", context(family, { hidden: ["A2"] })).detachedParent).toBe(true);
  });

  it("is true when the parent is filed in another bucket", () => {
    const ctx = context(family, { elsewhere: { A2: "someday" } });
    expect(place("A2.1", ctx).detachedParent).toBe(true);
  });

  it("is true when the parent is missing from the index entirely", () => {
    expect(place("orphan", context({ orphan: "gone" })).detachedParent).toBe(true);
  });

  it("stays false for siblings of a hidden task", () => {
    // Hiding A2 says nothing about A1, whose own parent is still on screen.
    expect(place("A1", context(family, { hidden: ["A2"] })).detachedParent).toBe(false);
  });

  it("follows the rendered list, not the hiding mechanism", () => {
    // A search that matches A2.1 but not A2 hides the parent exactly as
    // completion does, and the badge has to fire for both.
    const ctx = context(family, { hidden: ["A", "A1", "A2"] });
    expect(place("A2.1", ctx)).toEqual({ indentLevel: 2, detachedParent: true });
  });
});
