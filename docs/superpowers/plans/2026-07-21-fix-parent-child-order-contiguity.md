# Fix Parent/Child Contiguity Under Manual Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a regression from the drag-order-persistence feature (`docs/superpowers/plans/2026-07-20-persist-task-order.md`): a parent task's same-bucket children can end up scattered away from it after a manual reorder or a cross-bucket move, and the pre-existing drag-time constraints that assumed contiguity then make the parent nearly undraggable ("climbs" toward its stranded children one slot at a time).

**Architecture — three parts, each with a specific, named reason (not a blanket "fix it regardless of why"):**

1. **Fix the capture, not just the render, wherever that's actually possible.** A drag operation only ever moves the *one* DOM row you grabbed — when you drag a parent, its children physically stay put in the DOM. For a **same-bucket** drag this is fully fixable at the moment of capture: `BucketGroup.svelte`'s `onAdd`/`onUpdate` handlers reattach a moved parent's same-bucket children into the captured order immediately, before dispatching, so the saved order is correct by construction — not dependent on a later pass.

2. **Block the one drop position that's never valid: inside your own children.** `onMove`'s existing "don't insert into another family's contiguous block" constraint (Constraint 1) is extended to also cover the case where the dragged task *is* that family's own root — i.e. a parent can't be dropped between two of its own children. The two broad constraints that used to try to keep a parent above *all* its descendants everywhere in the list are removed — they're what caused the "climbs one slot at a time" bug once descendants were scattered, and are no longer needed now that (1) keeps things contiguous going forward and (3) below cleans up whatever's already scattered.

3. **Keep a render-time backstop in `BucketManager` — for a specific, structural reason, not superstition.** For a **cross-bucket** move, part (1) *cannot* work: an auto-inherited child (no explicit assignment of its own, inheriting its parent's effective bucket) only starts appearing in the target bucket once the file write is reindexed — an async event driven by Obsidian's own file-watcher, a beat after the drop's synchronous DOM event. There is no drag event to hook for that child at all. `regroupByHierarchy`, run unconditionally every time buckets are computed, is the only mechanism that can place it correctly. It's also legitimate (if secondary) insurance against anything else that could leave `taskOrder` inconsistent with the tree — entries saved before this fix shipped, a hand-edited `data.json`, a future bulk-move feature.

**Tech Stack:** TypeScript, Svelte 4 (legacy syntax), SortableJS, Jest.

## Design constraints from discussion with the human

- A child task individually assigned to a *different* bucket than its parent (via its own explicit tag/field, already supported by `resolveManualAssignment`/`effectiveBucket` inheritance in `BucketManager.ts`) must keep working exactly as today. A child not present in a given bucket's task list is simply untouched everywhere in this plan.
- When a parent and (some or all of) its children *do* end up in the same bucket, the children must render as a contiguous block immediately after the parent, in their own existing relative order (not arbitrarily rearranged).
- Dragging a parent within its own bucket must never allow dropping it *inside* its own children (live, during the drag — not just corrected after the fact).
- Dragging a parent within its own bucket must carry its children to the new position at drop time, not rely solely on a later pass.

## Global Constraints

- No new markdown syntax written into user files — this is a pure rendering/ordering fix, no `TaskWriter.ts` changes.
- Match existing code style: no comments except where a non-obvious constraint/workaround needs explaining (see the existing tone in `BucketManager.ts` and `BucketGroup.svelte`'s `onMove` handler for reference).
- `isolatedModules: true` in tsconfig — use `import type` for type-only imports (note: sibling files in `src/core/` import `TaskRecord` as a plain, non-`type`-prefixed import — that's the established convention there; match it).
- Tests for pure logic go in `tests/`, matching the existing per-module convention. `BucketGroup.svelte` has no unit tests (established repo convention, confirmed by CLAUDE.md's "Tests" section) — verify Task 3 and Task 4 via `npx tsc -noEmit -skipLibCheck`, `npm run build`, and manual testing (Task 5) instead.
- Do NOT commit — per current project instruction, leave all changes uncommitted in the working tree until the human says otherwise.

---

### Task 1: `regroupByHierarchy` — render-time contiguity backstop

**Files:**
- Modify: `src/core/BucketManager.ts` (add the function, exported, placed after `groupTasksIntoBuckets` and before `resolveManualAssignment`)
- Test: `tests/BucketManager.test.ts` (new `describe("regroupByHierarchy", ...)` block)

**Interfaces:**
- Consumes: `TaskRecord` (from `./TaskParser`, already imported in `BucketManager.ts`).
- Produces: `regroupByHierarchy(tasks: TaskRecord[]): TaskRecord[]`, consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Add this import near the top of `tests/BucketManager.test.ts`, alongside the existing imports:

```ts
import { groupTasksIntoBuckets, regroupByHierarchy, TO_REVIEW_ID } from "../src/core/BucketManager";
```

(This replaces the existing `import { groupTasksIntoBuckets, TO_REVIEW_ID } from "../src/core/BucketManager";` line — just add `regroupByHierarchy` to it.)

Then append this `describe` block at the end of the file:

```ts
describe("regroupByHierarchy", () => {
  it("leaves an already-contiguous list unchanged", () => {
    const parent = makeTask({ id: "p", text: "Parent" });
    const child = makeTask({ id: "c", text: "Child", parentId: "p" });
    parent.childIds = ["c"];

    const result = regroupByHierarchy([parent, child]);

    expect(result.map((t) => t.id)).toEqual(["p", "c"]);
  });

  it("pulls scattered children back to immediately after their parent", () => {
    const parent = makeTask({ id: "p", text: "Parent" });
    const other = makeTask({ id: "o", text: "Other" });
    const child1 = makeTask({ id: "c1", text: "Child 1", parentId: "p" });
    const child2 = makeTask({ id: "c2", text: "Child 2", parentId: "p" });
    parent.childIds = ["c1", "c2"];

    // Simulate a cross-bucket move: parent lands at the top (its saved
    // position), children get appended at the bottom (never had a saved
    // position of their own), with an unrelated task in between.
    const result = regroupByHierarchy([parent, other, child1, child2]);

    expect(result.map((t) => t.id)).toEqual(["p", "c1", "c2", "o"]);
  });

  it("preserves each child-group's own relative order when regrouping", () => {
    const parent = makeTask({ id: "p", text: "Parent" });
    const child1 = makeTask({ id: "c1", text: "Child 1", parentId: "p" });
    const child2 = makeTask({ id: "c2", text: "Child 2", parentId: "p" });
    parent.childIds = ["c1", "c2"];

    // child2 currently sits before child1 (e.g. from their own prior manual
    // reorder) — that relative order must survive being pulled next to parent.
    const result = regroupByHierarchy([child2, parent, child1]);

    expect(result.map((t) => t.id)).toEqual(["p", "c2", "c1"]);
  });

  it("treats a child whose parent is absent (assigned to a different bucket) as its own independent root", () => {
    const other = makeTask({ id: "o", text: "Other" });
    // "child"'s parent is NOT in this list — e.g. the parent lives in a
    // different bucket because this child has its own explicit assignment.
    const child = makeTask({ id: "c", text: "Child", parentId: "missing-parent" });

    const result = regroupByHierarchy([child, other]);

    expect(result.map((t) => t.id)).toEqual(["c", "o"]);
  });

  it("handles multi-level nesting (grandparent -> parent -> child), all contiguous", () => {
    const grandparent = makeTask({ id: "gp", text: "Grandparent" });
    const parent = makeTask({ id: "p", text: "Parent", parentId: "gp" });
    const child = makeTask({ id: "c", text: "Child", parentId: "p" });
    grandparent.childIds = ["p"];
    parent.childIds = ["c"];

    // Scattered: parent and child both separated from grandparent and from
    // each other by an unrelated task.
    const other = makeTask({ id: "o", text: "Other" });
    const result = regroupByHierarchy([grandparent, other, parent, child]);

    expect(result.map((t) => t.id)).toEqual(["gp", "p", "c", "o"]);
  });

  it("keeps multiple independent top-level families contiguous, preserving family order", () => {
    const parentA = makeTask({ id: "pa", text: "Parent A" });
    const childA = makeTask({ id: "ca", text: "Child A", parentId: "pa" });
    parentA.childIds = ["ca"];
    const parentB = makeTask({ id: "pb", text: "Parent B" });
    const childB = makeTask({ id: "cb", text: "Child B", parentId: "pb" });
    parentB.childIds = ["cb"];

    const result = regroupByHierarchy([parentA, parentB, childA, childB]);

    expect(result.map((t) => t.id)).toEqual(["pa", "ca", "pb", "cb"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --testPathPattern=BucketManager`
Expected: FAIL with "regroupByHierarchy is not a function" (or a TypeScript error that it doesn't exist), since the function doesn't exist yet.

- [ ] **Step 3: Implement**

In `src/core/BucketManager.ts`, add this function directly after `groupTasksIntoBuckets`'s closing brace (i.e. right before `function resolveManualAssignment(`):

```ts
/**
 * Re-flattens `tasks` (already in the desired top-level order — e.g. from
 * applyManualOrder) so each task's same-bucket descendants render
 * immediately after it, recursively. This is the render-time backstop for
 * parent/child contiguity: BucketGroup.svelte's onAdd/onUpdate handlers
 * already reattach a moved parent's children into the captured order at
 * drop time for SAME-bucket drags, but a CROSS-bucket move can't do that —
 * an auto-inherited child (no explicit assignment, inheriting its parent's
 * effective bucket) only starts appearing in the target bucket once the
 * file write is reindexed, a beat after the drop's own synchronous DOM
 * event, so there's no drag event to hook for it. This pass is also
 * defense-in-depth for anything else that could leave taskOrder
 * inconsistent with the tree (entries saved before this fix shipped, a
 * hand-edited data.json, a future bulk-move feature). A child whose parent
 * ISN'T in `tasks` (assigned to a different bucket) is untouched and
 * renders as its own independent root.
 */
export function regroupByHierarchy(tasks: TaskRecord[]): TaskRecord[] {
  const taskIds = new Set(tasks.map((t) => t.id));
  const childrenOf = new Map<string, TaskRecord[]>();

  for (const task of tasks) {
    if (task.parentId && taskIds.has(task.parentId)) {
      if (!childrenOf.has(task.parentId)) childrenOf.set(task.parentId, []);
      childrenOf.get(task.parentId)!.push(task);
    }
  }

  const roots = tasks.filter((t) => !t.parentId || !taskIds.has(t.parentId));

  const result: TaskRecord[] = [];
  const visit = (task: TaskRecord) => {
    result.push(task);
    for (const child of childrenOf.get(task.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);

  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --testPathPattern=BucketManager`
Expected: PASS (all tests, including the 6 new `regroupByHierarchy` ones)

---

### Task 2: Wire `regroupByHierarchy` into `groupTasksIntoBuckets`

**Files:**
- Modify: `src/core/BucketManager.ts:114-120` (the `applyManualOrder` loop)
- Test: `tests/BucketManager.test.ts` (new integration test)

**Interfaces:**
- Consumes: `regroupByHierarchy` (Task 1), already in the same file — no new import needed.
- Produces: no new exports — `groupTasksIntoBuckets`'s returned `BucketGroup[]` now always has contiguous parent/child ordering per bucket.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe("groupTasksIntoBuckets manual order", ...)` block in `tests/BucketManager.test.ts` (find it and add this as one more `it(...)` before its closing `});`):

```ts
  it("keeps a moved parent's auto-inherited children contiguous with it, even though only the parent has a saved position", () => {
    const parent = makeTask({ id: "p", filePath: "x.md", lineNumber: 0, text: "Parent" });
    const child1 = makeTask({ id: "c1", filePath: "x.md", lineNumber: 1, text: "Child 1", parentId: "p" });
    const child2 = makeTask({ id: "c2", filePath: "x.md", lineNumber: 2, text: "Child 2", parentId: "p" });
    parent.childIds = ["c1", "c2"];
    const other = makeTask({ id: "o", filePath: "x.md", lineNumber: 3, text: "Other" });

    // Only the parent has an explicit saved order key (simulating: it was
    // dragged into this bucket, children auto-inherited with no saved
    // position of their own).
    const keys = computeOrderKeys([parent, child1, child2, other]);
    const withOrder = {
      ...settings,
      taskOrder: { [TO_REVIEW_ID]: [keys.get("p")!] },
    };

    const grouped = groupTasksIntoBuckets([other, parent, child1, child2], withOrder);
    const review = grouped.find((g) => g.bucketId === TO_REVIEW_ID)!;

    expect(review.tasks.map((t) => t.id)).toEqual(["p", "c1", "c2", "o"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern=BucketManager`
Expected: FAIL — result is `["p", "o", "c1", "c2"]` (parent at its saved position, children and the unrelated task both just appended in their original relative order, not regrouped).

- [ ] **Step 3: Implement**

In `src/core/BucketManager.ts`, find:

```ts
  const orderKeys = computeOrderKeys(tasks);
  for (const group of bucketMap.values()) {
    const saved = settings.taskOrder?.[group.bucketId];
    if (saved && saved.length > 0) {
      group.tasks = applyManualOrder(group.tasks, orderKeys, saved);
    }
  }
```

Replace with:

```ts
  const orderKeys = computeOrderKeys(tasks);
  for (const group of bucketMap.values()) {
    const saved = settings.taskOrder?.[group.bucketId];
    if (saved && saved.length > 0) {
      group.tasks = applyManualOrder(group.tasks, orderKeys, saved);
    }
    group.tasks = regroupByHierarchy(group.tasks);
  }
```

(Runs unconditionally, not just when `saved` exists: without manual order, `group.tasks` is already in natural file-scan order, where parent/child contiguity holds by construction — `regroupByHierarchy` is then a safe no-op, per Task 1's first test. Making it unconditional means contiguity is always guaranteed, not just in the manually-ordered case.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --testPathPattern=BucketManager`
Expected: PASS (all tests, including the new integration test)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions (ignore doubled counts from the unrelated pre-existing worktree at `.claude/worktrees/fix-network-disclosure/` if present)

---

### Task 3: Capture-time reattachment for same-bucket parent drags

**Files:**
- Modify: `src/views/BucketGroup.svelte` (add a helper function; use it in `onAdd` and `onUpdate`)

**Interfaces:**
- Consumes: `allTasksMap`, `getDescendantIdsInBucket` (both already present in the component).
- Produces: `onAdd`/`onUpdate` now dispatch `orderedTaskIds` with the dragged task's same-bucket children already placed immediately after it — consumed identically to before by `GTDPanel.svelte`/`main.ts` (no changes needed there; the payload shape is unchanged, only its *content* is corrected before dispatch).

No unit tests possible (`.svelte` files aren't unit-tested in this repo). Verify via `npx tsc -noEmit -skipLibCheck` and `npm run build`; behavior verified manually in Task 5.

- [ ] **Step 1: Add the reattachment helper**

In `src/views/BucketGroup.svelte`, find:

```svelte
  /** IDs of all descendants of task that are currently in this bucket. */
  function getDescendantIdsInBucket(task: TaskRecord): Set<string> {
    const result = new Set<string>();
    const queue = [...task.childIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (taskBucketMap.get(id) === bucketId) {
        result.add(id);
        const child = allTasksMap.get(id);
        if (child) queue.push(...child.childIds);
      }
    }
    return result;
  }

  onMount(() => {
```

Replace with:

```svelte
  /** IDs of all descendants of task that are currently in this bucket. */
  function getDescendantIdsInBucket(task: TaskRecord): Set<string> {
    const result = new Set<string>();
    const queue = [...task.childIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (taskBucketMap.get(id) === bucketId) {
        result.add(id);
        const child = allTasksMap.get(id);
        if (child) queue.push(...child.childIds);
      }
    }
    return result;
  }

  /**
   * A drag only ever moves the one row you grabbed — a dragged parent's
   * same-bucket children are still sitting wherever they physically were.
   * This moves them (preserving their own relative order) to immediately
   * after draggedId in the raw captured order, so same-bucket drags are
   * correct at the moment of capture rather than relying on a later
   * render-time pass. For a cross-bucket drop this can only catch children
   * that already independently lived in the target bucket — an
   * auto-inheriting child isn't part of orderedIds yet at all, since it
   * only appears in this bucket after the file write is reindexed.
   */
  function reattachDescendants(orderedIds: string[], draggedId: string): string[] {
    const draggedTask = allTasksMap.get(draggedId);
    if (!draggedTask) return orderedIds;
    const descIds = getDescendantIdsInBucket(draggedTask);
    if (descIds.size === 0) return orderedIds;

    const descendantsInOrder = orderedIds.filter((id) => descIds.has(id));
    const result: string[] = [];
    for (const id of orderedIds) {
      if (descIds.has(id)) continue;
      result.push(id);
      if (id === draggedId) result.push(...descendantsInOrder);
    }
    return result;
  }

  onMount(() => {
```

- [ ] **Step 2: Use it in `onAdd` and `onUpdate`**

Find:

```svelte
      onAdd(evt) {
        const taskId = evt.item.dataset.taskId ?? "";
        const sourceBucketId = evt.from.dataset.bucketId ?? "";
        const orderedTaskIds = Array.from(evt.to.children)
          .map((el) => (el as HTMLElement).dataset.taskId ?? "")
          .filter(Boolean);
        // SortableJS already moved evt.item into evt.to's DOM at the drop
        // position (that's what triggered onAdd) — read it above, then
        // revert the manual DOM move so Svelte's keyed {#each} in the
        // *source* bucket doesn't lose track of a node it still thinks it
        // owns. The real re-render happens once the drop/reorder handlers
        // persist the new order and the store refreshes.
        evt.from.appendChild(evt.item);
        dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId, orderedTaskIds });
      },
      onUpdate(evt) {
        const orderedTaskIds = Array.from(evt.to.children)
          .map((el) => (el as HTMLElement).dataset.taskId ?? "")
          .filter(Boolean);
        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex ?? 0] ?? null);
        dispatch("reorder", { bucketId, orderedTaskIds });
      },
```

Replace with:

```svelte
      onAdd(evt) {
        const taskId = evt.item.dataset.taskId ?? "";
        const sourceBucketId = evt.from.dataset.bucketId ?? "";
        const rawOrderedTaskIds = Array.from(evt.to.children)
          .map((el) => (el as HTMLElement).dataset.taskId ?? "")
          .filter(Boolean);
        const orderedTaskIds = reattachDescendants(rawOrderedTaskIds, taskId);
        // SortableJS already moved evt.item into evt.to's DOM at the drop
        // position (that's what triggered onAdd) — read it above, then
        // revert the manual DOM move so Svelte's keyed {#each} in the
        // *source* bucket doesn't lose track of a node it still thinks it
        // owns. The real re-render happens once the drop/reorder handlers
        // persist the new order and the store refreshes.
        evt.from.appendChild(evt.item);
        dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId, orderedTaskIds });
      },
      onUpdate(evt) {
        const taskId = evt.item.dataset.taskId ?? "";
        const rawOrderedTaskIds = Array.from(evt.to.children)
          .map((el) => (el as HTMLElement).dataset.taskId ?? "")
          .filter(Boolean);
        const orderedTaskIds = reattachDescendants(rawOrderedTaskIds, taskId);
        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex ?? 0] ?? null);
        dispatch("reorder", { bucketId, orderedTaskIds });
      },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors

---

### Task 4: Replace the two broad parent constraints with one precise one

**Files:**
- Modify: `src/views/BucketGroup.svelte` (the `onMove` handler inside `Sortable.create`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `onMove`'s return type (`boolean`) and call signature are unchanged.

No unit tests possible. Verify via `npx tsc -noEmit -skipLibCheck`, `npm run build`, and Task 5's manual tests.

**Why:** the old Constraint 2 ("a parent can't be placed below *any* of its same-bucket descendants, anywhere in the list") and Constraint 4 ("a parent can't be placed where non-descendant tasks appear between it and its *first* same-bucket descendant") both tried to keep a dragged parent above all its descendants at every position in the whole list. Once descendants have been scattered — e.g. by an earlier cross-bucket move before this fix existed, or any other pre-existing `taskOrder` entry — Constraint 4 in particular only allows the parent to move one slot at a time toward its stranded children: that's the reported "climbs one slot at a time" bug. Neither constraint is needed for correctness once Task 3 keeps things contiguous going forward and Task 2's backstop cleans up whatever's already scattered — the only thing actually worth blocking live, during the drag, is dropping the parent literally in between two of its own children. That's a narrow extension of the *existing* Constraint 1 (which already blocks inserting into another family's contiguous block) to the case where the dragged task is that family's own root.

- [ ] **Step 1: Replace the constraint block**

In `src/views/BucketGroup.svelte`, find:

```svelte
        const draggedRoot = targetGroupRoot(draggedId);

        // Constraint 1 (cross- and same-bucket): the insertion point must not lie
        // inside another task's group. If the elements immediately before AND after
        // share the same group root, only members of that group may be placed there.
        if (beforeId && afterId) {
          const beforeRoot = targetGroupRoot(beforeId);
          const afterRoot = targetGroupRoot(afterId);
          if (beforeRoot === afterRoot && draggedRoot !== beforeRoot) return false;
        }

        // Remaining constraints only apply within the same bucket.
        if (isCrossBucket) return true;

        const descIds = getDescendantIdsInBucket(draggedTask);

        // Constraint 2: A parent can't be placed below any of its same-bucket descendants.
        for (let i = 0; i < insertIdx; i++) {
          if (descIds.has(currentIds[i])) return false;
        }

        // Constraint 3: A subtask can't be placed above its parent, and must stay within
        // its group's contiguous range.
        const parentId = draggedTask.parentId;
        if (parentId && taskBucketMap.get(parentId) === bucketId) {
          const parentIdx = currentIds.indexOf(parentId);
          if (parentIdx !== -1 && insertIdx <= parentIdx) return false;

          const parentTask = allTasksMap.get(parentId);
          if (parentTask) {
            const groupIds = getDescendantIdsInBucket(parentTask);
            groupIds.add(parentId);
            let lastGroupIdx = -1;
            for (let i = 0; i < currentIds.length; i++) {
              if (groupIds.has(currentIds[i])) lastGroupIdx = i;
            }
            if (lastGroupIdx !== -1 && insertIdx > lastGroupIdx + 1) return false;
          }
        }

        // Constraint 4: A parent can't be placed where non-descendant tasks would appear
        // between it and its first same-bucket descendant (keeps the group contiguous).
        if (descIds.size > 0) {
          let firstDescIdx = currentIds.length;
          for (let i = 0; i < currentIds.length; i++) {
            if (descIds.has(currentIds[i])) { firstDescIdx = i; break; }
          }
          for (let i = insertIdx; i < firstDescIdx; i++) {
            if (!descIds.has(currentIds[i])) return false;
          }
        }

        return true;
      },
```

Replace with:

```svelte
        const draggedRoot = targetGroupRoot(draggedId);

        // Constraint 1 (cross- and same-bucket): the insertion point must not lie
        // inside another task's group. If the elements immediately before AND after
        // share the same group root, only members of that group may be placed there
        // — including the case where the dragged task IS that group's own root: a
        // parent can't be dropped in between two of its own children either.
        if (beforeId && afterId) {
          const beforeRoot = targetGroupRoot(beforeId);
          const afterRoot = targetGroupRoot(afterId);
          if (beforeRoot === afterRoot) {
            if (draggedRoot !== beforeRoot) return false;
            if (draggedId === beforeRoot) return false;
          }
        }

        // Remaining constraint only applies within the same bucket.
        if (isCrossBucket) return true;

        // Constraint 2: A subtask can't be placed above its parent, and must stay within
        // its group's contiguous range. (A dragged PARENT has no equivalent restriction
        // here — onAdd/onUpdate above already reattach a moved parent's same-bucket
        // children to follow it wherever it's dropped, and BucketManager's
        // regroupByHierarchy is a render-time backstop for the rest — so the parent is
        // free to move to any top-level position, just never literally in between its
        // own children per Constraint 1 above.)
        const parentId = draggedTask.parentId;
        if (parentId && taskBucketMap.get(parentId) === bucketId) {
          const parentIdx = currentIds.indexOf(parentId);
          if (parentIdx !== -1 && insertIdx <= parentIdx) return false;

          const parentTask = allTasksMap.get(parentId);
          if (parentTask) {
            const groupIds = getDescendantIdsInBucket(parentTask);
            groupIds.add(parentId);
            let lastGroupIdx = -1;
            for (let i = 0; i < currentIds.length; i++) {
              if (groupIds.has(currentIds[i])) lastGroupIdx = i;
            }
            if (lastGroupIdx !== -1 && insertIdx > lastGroupIdx + 1) return false;
          }
        }

        return true;
      },
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors

Run: `npm run build`
Expected: succeeds (translations validation, typecheck, lint, esbuild production bundle)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions

---

### Task 5: Manual verification in Obsidian

**Files:** none (manual testing only)

- [ ] **Step 1: Dev loop**

`npm run dev` with the plugin symlinked into a vault and Hot Reload installed (per CLAUDE.md), same as the prior plan's Task 7.

- [ ] **Step 2: Can't drop a parent inside its own children (same-bucket)**

With a parent + 2+ children in one bucket, try to drag the parent to a position literally between two of its children. Confirm the drag preview never allows it to land there — it should skip past, not settle in the middle of its own family.

- [ ] **Step 3: Same-bucket parent reorder — children move with it immediately**

Drag the parent to a different top-level position within the same bucket (past other unrelated tasks). Confirm its children are contiguous with it **immediately upon drop** — not after some delay or a second action. (The live drag preview may not visually show children moving with the parent mid-drag — that's expected, see the note below — but the state right after the drop must already be correct.)

- [ ] **Step 4: Cross-bucket parent move — children auto-follow on the next render**

Create a parent with 2-3 subtasks in Bucket A. Drag the *parent only* to Bucket B. Confirm all its children render directly under it in Bucket B, in their original relative order, once the move completes (this one goes through the reindex, so allow a brief moment — this is the structural async case, not a delay to be optimized away).

- [ ] **Step 5: Child independently assigned elsewhere stays independent**

Give one child of a multi-child parent its own explicit bucket assignment (different from the parent's bucket) via a quick-move button or "Move to…". Confirm that child renders in its own bucket, unaffected by any parent-side dragging, and the *remaining* children still group correctly under the parent.

- [ ] **Step 6: Sibling reordering among children still works**

Drag one child to reorder it relative to its siblings (still under the same parent). Confirm it's still restricted to that parent's contiguous range (can't be dragged above the parent or out past the family) — this is Constraint 2 (formerly Constraint 3), unchanged.

- [ ] **Step 7: Multi-level nesting, if your vault has any 3-level task hierarchies**

Repeat step 3/4 with a grandparent → parent → child chain if you have one handy. Otherwise skip — Task 1's unit tests already cover this in isolation.

- [ ] **Step 8: Report back**

Pass/fail on each step before considering this fix complete.
