import { isInsertionAllowed, enclosingBlockRoot } from "../src/core/DragConstraints";
import type { BucketTree } from "../src/core/DragConstraints";
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
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...o,
  };
}

/**
 * Builds a BucketTree from a compact `id: parentId` spec. Every task lands in
 * `bucket` unless listed in `elsewhere`, which is how a family that straddles
 * two buckets is expressed.
 */
function tree(
  spec: Record<string, string | null>,
  opts: { bucketId?: string; elsewhere?: Record<string, string> } = {}
): BucketTree {
  const bucketId = opts.bucketId ?? "today";
  const allTasks = new Map<string, TaskRecord>();
  const taskBucket = new Map<string, string>();
  for (const [id, parentId] of Object.entries(spec)) {
    allTasks.set(id, makeTask({ id, text: id, parentId }));
    taskBucket.set(id, opts.elsewhere?.[id] ?? bucketId);
  }
  for (const [id, parentId] of Object.entries(spec)) {
    if (parentId) allTasks.get(parentId)!.childIds.push(id);
  }
  return { allTasks, taskBucket, bucketId };
}

// G
//   P
//     C1
//     C2
//   U
// Rendered contiguously as: G, P, C1, C2, U
const family = tree({ G: null, P: "G", C1: "P", C2: "P", U: "G" });

describe("enclosingBlockRoot", () => {
  it("returns the deepest subtree the insertion point falls inside", () => {
    // Between two siblings: the cut is inside their parent's block.
    expect(enclosingBlockRoot("C1", "C2", family)).toBe("P");
  });

  it("returns the parent when the point is between a parent and its first child", () => {
    expect(enclosingBlockRoot("P", "C1", family)).toBe("P");
  });

  it("returns the grandparent at the seam between two of its children's blocks", () => {
    // C2 ends P's block; U starts the next one. Only a child of G belongs here.
    expect(enclosingBlockRoot("C2", "U", family)).toBe("G");
  });

  it("returns null between two unrelated roots", () => {
    const roots = tree({ A: null, B: null });
    expect(enclosingBlockRoot("A", "B", roots)).toBeNull();
  });

  it("ignores ancestry that leaves the bucket", () => {
    // P and U both descend from G, but G renders in another bucket, so within
    // this bucket they are independent roots and the seam is unconstrained.
    const split = tree({ G: null, P: "G", U: "G" }, { elsewhere: { G: "someday" } });
    expect(enclosingBlockRoot("P", "U", split)).toBeNull();
  });
});

describe("isInsertionAllowed", () => {
  it("blocks an uncle dropped between two of its nieces", () => {
    // The bug: U and the nieces share a group root (G), which the old
    // group-root check read as "same family, allow it".
    expect(isInsertionAllowed("U", "C1", "C2", family)).toBe(false);
  });

  it("blocks a parent dropped between two of its own children", () => {
    expect(isInsertionAllowed("P", "C1", "C2", family)).toBe(false);
  });

  it("blocks a grandparent dropped between two of its grandchildren", () => {
    expect(isInsertionAllowed("G", "C1", "C2", family)).toBe(false);
  });

  it("blocks an uncle dropped between a parent and its first child", () => {
    expect(isInsertionAllowed("U", "P", "C1", family)).toBe(false);
  });

  it("blocks a cut inside a deeper nephew block", () => {
    // G > P > {C1 > {GC1a, GC1b}, C2}. C2 is a sibling of C1, so it may move
    // within P's block — but not into the middle of C1's own block.
    const deep = tree({ G: null, P: "G", C1: "P", GC1a: "C1", GC1b: "C1", C2: "P" });
    expect(isInsertionAllowed("C2", "C1", "GC1a", deep)).toBe(false);
  });

  it("allows a child reordered ahead of its sibling's whole block", () => {
    // G > P > {C1 > {GC1a, GC1b}, C2}, rendered G,P,C1,GC1a,GC1b,C2.
    // Moving C2 to be P's first child lands it between P and C1.
    const deep = tree({ G: null, P: "G", C1: "P", GC1a: "C1", GC1b: "C1", C2: "P" });
    expect(isInsertionAllowed("C2", "P", "C1", deep)).toBe(true);
  });

  it("allows a child of the grandparent at the seam between its siblings' blocks", () => {
    // G > {P > {C1, C2}, U, V}, rendered G,P,C1,C2,U,V. V is a sibling of P
    // and U, so the seam where P's block ends is a legal home for it.
    const twoUncles = tree({ G: null, P: "G", C1: "P", C2: "P", U: "G", V: "G" });
    expect(isInsertionAllowed("V", "C2", "U", twoUncles)).toBe(true);
  });

  it("allows any task between two unrelated roots", () => {
    const roots = tree({ A: null, B: null, X: null });
    expect(isInsertionAllowed("X", "A", "B", roots)).toBe(true);
  });

  it("allows insertion at either end of the list", () => {
    expect(isInsertionAllowed("U", null, "G", family)).toBe(true);
    expect(isInsertionAllowed("U", "C2", null, family)).toBe(true);
  });

  it("allows a stranger where the shared ancestor renders in another bucket", () => {
    const split = tree({ G: null, P: "G", U: "G", X: null }, { elsewhere: { G: "someday" } });
    expect(isInsertionAllowed("X", "P", "U", split)).toBe(true);
  });
});
