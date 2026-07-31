# Persist Drag-and-Drop Task Order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make drag-and-drop task reordering (within a bucket, and the drop position when moving between buckets) actually persist, fixing GitHub issue #2 ("Drag between buckets doesn't keep exact order").

**Architecture:** Order is a UI-arrangement concern, not vault content, so it is stored in the plugin's own data (`data.json`, alongside `PluginSettings`), never written into markdown files. Because `TaskRecord.id` (hash of `filePath+lineNumber+text`) churns whenever unrelated lines shift above a task, order is keyed by a separate, more stable identity — `filePath+text` plus an occurrence index for duplicate-text disambiguation — computed fresh on every reindex and matched against the saved order array. Tasks not present in the saved order (new tasks) are appended at the end. SortableJS's `onAdd`/`onUpdate` events capture the exact drop position on drop, then revert their own DOM mutation so Svelte's keyed `{#each}` blocks stay in charge of rendering; the captured order is what gets persisted and re-applied.

**Tech Stack:** TypeScript, Svelte 4 (legacy syntax), SortableJS, Jest.

## Global Constraints

- No new markdown syntax written into user files — order lives in plugin data only.
- Match existing code style: no comments except where a non-obvious constraint/workaround needs explaining (see existing files for tone).
- `isolatedModules: true` in tsconfig — use `import type` for type-only imports.
- Tests for pure logic go in `tests/`, matching the existing per-module test file convention (no Obsidian API dependency, see `tests/__mocks__/obsidian.ts` only if a test needs it — these new tests don't).
- Run `npm test` after each logic task; run `npm run build` (tsc check + bundle) after each Svelte/main.ts wiring task, since those aren't unit-testable per this repo's conventions (see CLAUDE.md "Tests" section).

---

### Task 1: Stable order-key and manual-order sort helpers

**Files:**
- Create: `src/core/TaskOrder.ts`
- Test: `tests/TaskOrder.test.ts`

**Interfaces:**
- Produces: `computeOrderKeys(tasks: TaskRecord[]): Map<string, string>` — maps `TaskRecord.id` → stable order key.
- Produces: `applyManualOrder(tasks: TaskRecord[], orderKeys: Map<string, string>, savedOrder: string[]): TaskRecord[]` — returns a new array sorted per `savedOrder`, unmatched tasks appended at the end in original order.

- [ ] **Step 1: Write the failing tests**

Create `tests/TaskOrder.test.ts`:

```ts
import { computeOrderKeys, applyManualOrder } from "../src/core/TaskOrder";
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=TaskOrder`
Expected: FAIL with "Cannot find module '../src/core/TaskOrder'"

- [ ] **Step 3: Write the implementation**

Create `src/core/TaskOrder.ts`:

```ts
import { TaskRecord } from "./TaskParser";

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

/**
 * Stable identity for persisting a task's manual bucket-order position across
 * reindexes. Unlike TaskRecord.id (hash of filePath+lineNumber+text), this
 * excludes lineNumber so it survives unrelated line churn elsewhere in the
 * file. Duplicate-text tasks in the same file are disambiguated by their
 * occurrence order (first "Buy milk" gets :0, second gets :1, ...).
 */
export function computeOrderKeys(tasks: TaskRecord[]): Map<string, string> {
  const byFile = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (!byFile.has(task.filePath)) byFile.set(task.filePath, []);
    byFile.get(task.filePath)!.push(task);
  }

  const result = new Map<string, string>();
  for (const [filePath, fileTasks] of byFile) {
    const sorted = [...fileTasks].sort((a, b) => a.lineNumber - b.lineNumber);
    const occurrenceCount = new Map<string, number>();
    for (const task of sorted) {
      const count = occurrenceCount.get(task.text) ?? 0;
      occurrenceCount.set(task.text, count + 1);
      result.set(task.id, `${hashString(`${filePath}:${task.text}`)}:${count}`);
    }
  }
  return result;
}

/**
 * Sorts `tasks` to match `savedOrder` (order keys in the desired sequence).
 * Tasks with no match in `savedOrder` — new tasks, or stale/unmatched keys —
 * are appended at the end in their original relative order.
 */
export function applyManualOrder(
  tasks: TaskRecord[],
  orderKeys: Map<string, string>,
  savedOrder: string[]
): TaskRecord[] {
  const byKey = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const key = orderKeys.get(task.id);
    if (key) byKey.set(key, task);
  }

  const result: TaskRecord[] = [];
  const used = new Set<string>();
  for (const key of savedOrder) {
    const task = byKey.get(key);
    if (task && !used.has(task.id)) {
      result.push(task);
      used.add(task.id);
    }
  }
  for (const task of tasks) {
    if (!used.has(task.id)) result.push(task);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=TaskOrder`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/TaskOrder.ts tests/TaskOrder.test.ts
git commit -m "feat: add stable order-key computation and manual-order sort helper"
```

---

### Task 2: Add `taskOrder` to plugin settings

**Files:**
- Modify: `src/settings.ts:37-69` (`PluginSettings` interface), `src/settings.ts:115-131` (`DEFAULT_SETTINGS`)
- Modify: `src/main.ts:78-92` (`loadSettings()`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PluginSettings.taskOrder: Record<string, string[]>` — bucketId → array of order keys (from Task 1's `computeOrderKeys`), consumed by Task 3 and Task 6.

- [ ] **Step 1: Add the field to `PluginSettings`**

In `src/settings.ts`, find this in the `PluginSettings` interface (currently the last field before the closing brace):

```ts
  /** Controls which celebration animations play on task completion. */
  celebrationMode: CelebrationMode;
}
```

Replace with:

```ts
  /** Controls which celebration animations play on task completion. */
  celebrationMode: CelebrationMode;
  /**
   * Manual per-bucket task order from drag-and-drop, keyed by bucket ID.
   * Each value is an array of stable order keys (see core/TaskOrder.ts) in
   * display order. Tasks not present in a bucket's array render after it,
   * in their natural (file scan) order.
   */
  taskOrder: Record<string, string[]>;
}
```

- [ ] **Step 2: Add the default value**

In `src/settings.ts`, find in `DEFAULT_SETTINGS`:

```ts
  compactView: false,
  celebrationMode: "confetti",
};
```

Replace with:

```ts
  compactView: false,
  celebrationMode: "confetti",
  taskOrder: {},
};
```

- [ ] **Step 3: Defensively clone `taskOrder` on load**

`Object.assign({}, DEFAULT_SETTINGS, ...)` is a shallow copy — if the loaded data has no `taskOrder`, `this.settings.taskOrder` would be the *same object reference* as the module-level `DEFAULT_SETTINGS.taskOrder`, so writes would leak into the shared default across plugin reloads/tests. `settings.buckets` already gets this same defensive treatment a few lines below; add the equivalent for `taskOrder`.

In `src/main.ts`, find:

```ts
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, migrateSettingsData(await this.loadData()));
    if (!this.settings.buckets || this.settings.buckets.length === 0) {
      this.settings.buckets = DEFAULT_BUCKETS.map((b) => ({ ...b }));
    }
```

Replace with:

```ts
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, migrateSettingsData(await this.loadData()));
    if (!this.settings.buckets || this.settings.buckets.length === 0) {
      this.settings.buckets = DEFAULT_BUCKETS.map((b) => ({ ...b }));
    }
    this.settings.taskOrder = { ...(this.settings.taskOrder ?? {}) };
```

- [ ] **Step 4: Verify existing tests and typecheck still pass**

Run: `npm test -- --testPathPattern=settings`
Expected: PASS (existing `settings.test.ts` suite; it doesn't assert exact `DEFAULT_SETTINGS` shape, so this is just a regression check)

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/main.ts
git commit -m "feat: add taskOrder field to plugin settings"
```

---

### Task 3: Apply manual order when grouping tasks into buckets

**Files:**
- Modify: `src/core/BucketManager.ts:1-11` (imports), `src/core/BucketManager.ts:88-119` (`groupTasksIntoBuckets`, tail end)
- Modify: `tests/BucketManager.test.ts` (append new `describe` block)

**Interfaces:**
- Consumes: `computeOrderKeys`, `applyManualOrder` from `src/core/TaskOrder.ts` (Task 1); `PluginSettings.taskOrder` (Task 2).
- Produces: no new exports — `groupTasksIntoBuckets(tasks, settings)` keeps its existing signature, but each returned group's `.tasks` array now reflects `settings.taskOrder[group.bucketId]` when present.

- [ ] **Step 1: Write the failing test**

Add this import near the top of `tests/BucketManager.test.ts`, alongside the existing imports:

```ts
import { computeOrderKeys } from "../src/core/TaskOrder";
```

Then append this `describe` block at the end of the file (after the existing `describe("groupTasksIntoBuckets", ...)` block's closing):

```ts
describe("groupTasksIntoBuckets manual order", () => {
  const settings = { ...DEFAULT_SETTINGS, buckets: DEFAULT_BUCKETS };

  it("reorders a bucket's tasks per settings.taskOrder", () => {
    const a = makeTask({ id: "a", filePath: "x.md", lineNumber: 0, text: "A" });
    const b = makeTask({ id: "b", filePath: "x.md", lineNumber: 1, text: "B" });
    const c = makeTask({ id: "c", filePath: "x.md", lineNumber: 2, text: "C" });

    const unordered = groupTasksIntoBuckets([a, b, c], settings);
    const review = unordered.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);

    const keys = computeOrderKeys([a, b, c]);
    const withOrder = {
      ...settings,
      taskOrder: { [TO_REVIEW_ID]: [keys.get("c")!, keys.get("a")!, keys.get("b")!] },
    };

    const ordered = groupTasksIntoBuckets([a, b, c], withOrder);
    const reviewOrdered = ordered.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(reviewOrdered.tasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("appends a newly-appearing task after the manually ordered ones", () => {
    const a = makeTask({ id: "a", filePath: "x.md", lineNumber: 0, text: "A" });
    const b = makeTask({ id: "b", filePath: "x.md", lineNumber: 1, text: "B" });

    const keys = computeOrderKeys([a]);
    const withOrder = {
      ...settings,
      taskOrder: { [TO_REVIEW_ID]: [keys.get("a")!] },
    };

    const ordered = groupTasksIntoBuckets([a, b], withOrder);
    const review = ordered.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern=BucketManager`
Expected: FAIL — both new tests fail because order is still file-scan order regardless of `settings.taskOrder` (first new test's second assertion expects `["c", "a", "b"]` but gets `["a", "b", "c"]`).

- [ ] **Step 3: Implement**

In `src/core/BucketManager.ts`, add the import:

```ts
import { TaskRecord, getTagValue, getInlineFieldValue } from "./TaskParser";
import { BucketConfig, PluginSettings } from "../settings";
import { today } from "../integrations/TasksPluginParser";
import { t } from "../i18n/i18n";
```

Replace with:

```ts
import { TaskRecord, getTagValue, getInlineFieldValue } from "./TaskParser";
import { BucketConfig, PluginSettings } from "../settings";
import { today } from "../integrations/TasksPluginParser";
import { t } from "../i18n/i18n";
import { computeOrderKeys, applyManualOrder } from "./TaskOrder";
```

Then find the tail of `groupTasksIntoBuckets`:

```ts
    bucketMap.get(TO_REVIEW_ID)!.tasks.push(task);
  }

  const result: BucketGroup[] = [bucketMap.get(TO_REVIEW_ID)!];
  for (const b of settings.buckets) {
    result.push(bucketMap.get(b.id)!);
  }

  return result;
}
```

Replace with:

```ts
    bucketMap.get(TO_REVIEW_ID)!.tasks.push(task);
  }

  const orderKeys = computeOrderKeys(tasks);
  for (const group of bucketMap.values()) {
    const saved = settings.taskOrder[group.bucketId];
    if (saved && saved.length > 0) {
      group.tasks = applyManualOrder(group.tasks, orderKeys, saved);
    }
  }

  const result: BucketGroup[] = [bucketMap.get(TO_REVIEW_ID)!];
  for (const b of settings.buckets) {
    result.push(bucketMap.get(b.id)!);
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --testPathPattern=BucketManager`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions in TaskParser/TaskWriter/StorageMigrator/settings suites)

- [ ] **Step 6: Commit**

```bash
git add src/core/BucketManager.ts tests/BucketManager.test.ts
git commit -m "feat: apply manual task order when grouping tasks into buckets"
```

---

### Task 4: Capture drop position in `BucketGroup.svelte`

**Files:**
- Modify: `src/views/BucketGroup.svelte:22-28` (dispatch types), `:84-95` (`handleHeaderDrop`), `:229-235` (`onAdd`, add `onUpdate`)

**Interfaces:**
- Consumes: nothing new.
- Produces: dispatched `drop` event payload gains `orderedTaskIds: string[] | null`; new `reorder` event `{ bucketId: string; orderedTaskIds: string[] }`. Both consumed by Task 5 (`GTDPanel.svelte`).

No unit tests — this repo doesn't test `.svelte` files (pure-logic-only convention, see CLAUDE.md). Verified by `npm run build` (Step 4) and the manual smoke test in Task 7.

- [ ] **Step 1: Extend the dispatch event types**

Find:

```ts
  const dispatch = createEventDispatcher<{
    move: { task: TaskRecord; targetBucketId: string | null };
    toggle: { task: TaskRecord };
    navigate: { task: TaskRecord };
    confirm: { task: TaskRecord; bucketId: string };
    drop: { taskId: string; sourceBucketId: string; targetBucketId: string };
  }>();
```

Replace with:

```ts
  const dispatch = createEventDispatcher<{
    move: { task: TaskRecord; targetBucketId: string | null };
    toggle: { task: TaskRecord };
    navigate: { task: TaskRecord };
    confirm: { task: TaskRecord; bucketId: string };
    drop: {
      taskId: string;
      sourceBucketId: string;
      targetBucketId: string;
      orderedTaskIds: string[] | null;
    };
    reorder: { bucketId: string; orderedTaskIds: string[] };
  }>();
```

- [ ] **Step 2: Update `handleHeaderDrop` (dropping onto a collapsed bucket header has no position info)**

Find:

```ts
  function handleHeaderDrop(e: DragEvent) {
    if (!collapsed || bucketId === TO_REVIEW_ID) return;
    e.preventDefault();
    headerDragOver = false;
    const dragged = Sortable.dragged;
    if (!dragged) return;
    const taskId = dragged.dataset.taskId ?? "";
    const sourceBucketId =
      (dragged.parentElement as HTMLElement)?.dataset?.bucketId ?? "";
    if (!taskId || sourceBucketId === bucketId) return;
    dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId });
  }
```

Replace with:

```ts
  function handleHeaderDrop(e: DragEvent) {
    if (!collapsed || bucketId === TO_REVIEW_ID) return;
    e.preventDefault();
    headerDragOver = false;
    const dragged = Sortable.dragged;
    if (!dragged) return;
    const taskId = dragged.dataset.taskId ?? "";
    const sourceBucketId =
      (dragged.parentElement as HTMLElement)?.dataset?.bucketId ?? "";
    if (!taskId || sourceBucketId === bucketId) return;
    dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId, orderedTaskIds: null });
  }
```

(`orderedTaskIds: null` is a sentinel meaning "no position info" — Task 5's handler will skip persisting order in this case rather than wiping the bucket's saved order with an empty array.)

- [ ] **Step 3: Capture position in `onAdd`, add `onUpdate` for same-bucket reorders**

Find:

```ts
      onAdd(evt) {
        const taskId = evt.item.dataset.taskId ?? "";
        const sourceBucketId = evt.from.dataset.bucketId ?? "";
        evt.from.appendChild(evt.item);
        dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId });
      },
    });
  });
```

Replace with:

```ts
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
    });
  });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors (this alone won't catch Svelte template issues — full check happens in Task 5/6 once `GTDPanel.svelte` is wired up to match the new event shape)

- [ ] **Step 5: Commit**

```bash
git add src/views/BucketGroup.svelte
git commit -m "feat: capture drop position for cross-bucket and same-bucket drags"
```

---

### Task 5: Wire order persistence through `GTDPanel.svelte`

**Files:**
- Modify: `src/views/GTDPanel.svelte:23-28` (props), `:110-153` (`pendingMoveConfirm` type, `handleMove`, `confirmMoveChildren`), `:248-263` (`handleDrop`), `:320-338` (template — add `on:reorder`)

**Interfaces:**
- Consumes: `drop`/`reorder` events from `BucketGroup.svelte` (Task 4).
- Produces: calls a new `onReorder(bucketId: string, orderedTaskIds: string[]): Promise<void>` prop, consumed by Task 6 (`main.ts`).

No unit tests (same rationale as Task 4). Verified by `npm run build` (Step 6) and the manual smoke test in Task 7.

- [ ] **Step 1: Add the `onReorder` prop**

Find:

```ts
  export let onMove: (task: TaskRecord, targetBucketId: string | null) => Promise<void>;
  export let onToggle: (task: TaskRecord) => Promise<void>;
  export let onNavigate: (task: TaskRecord) => void;
  export let onConfirm: (task: TaskRecord, bucketId: string) => Promise<void>;
  export let onOpenSettings: () => void;
  export let onDismissLanguageBanner: () => void;
```

Replace with:

```ts
  export let onMove: (task: TaskRecord, targetBucketId: string | null) => Promise<void>;
  export let onToggle: (task: TaskRecord) => Promise<void>;
  export let onNavigate: (task: TaskRecord) => void;
  export let onConfirm: (task: TaskRecord, bucketId: string) => Promise<void>;
  export let onReorder: (bucketId: string, orderedTaskIds: string[]) => Promise<void>;
  export let onOpenSettings: () => void;
  export let onDismissLanguageBanner: () => void;
```

- [ ] **Step 2: Thread `orderedTaskIds` through the move-confirmation flow**

Find:

```ts
  let pendingMoveConfirm: {
    task: TaskRecord;
    targetBucketId: string | null;
    explicitChildren: TaskRecord[];
  } | null = null;

  async function handleMove(task: TaskRecord, targetBucketId: string | null) {
    if (targetBucketId === "__context_menu__") {
      showContextMenu(task);
      return;
    }

    const descendants = getDescendants(task);
    const targetId = targetBucketId ?? TO_REVIEW_ID;
    // Only ask about children that are in a *different* bucket than the target.
    // Children already in the target bucket need no action and should not trigger a dialog.
    const explicitChildren = descendants.filter(
      (t) => hasExplicitAssignment(t) && taskBucketMap.get(t.id) !== targetId
    );

    if (explicitChildren.length > 0) {
      pendingMoveConfirm = { task, targetBucketId, explicitChildren };
      return;
    }

    await onMove(task, targetBucketId);
  }

  async function confirmMoveChildren(moveChildren: boolean) {
    if (!pendingMoveConfirm) return;
    const { task, targetBucketId, explicitChildren } = pendingMoveConfirm;
    pendingMoveConfirm = null;

    await onMove(task, targetBucketId);

    if (moveChildren) {
      for (const child of explicitChildren) {
        // Re-look up from the live map — re-indexing after the parent write may have
        // produced a fresh TaskRecord with an updated rawLine for this child.
        const fresh = allTasksMap.get(child.id) ?? child;
        await onMove(fresh, targetBucketId);
      }
    }
  }
```

Replace with:

```ts
  let pendingMoveConfirm: {
    task: TaskRecord;
    targetBucketId: string | null;
    explicitChildren: TaskRecord[];
    orderedTaskIds: string[] | null;
  } | null = null;

  async function handleMove(
    task: TaskRecord,
    targetBucketId: string | null,
    orderedTaskIds: string[] | null = null
  ) {
    if (targetBucketId === "__context_menu__") {
      showContextMenu(task);
      return;
    }

    const descendants = getDescendants(task);
    const targetId = targetBucketId ?? TO_REVIEW_ID;
    // Only ask about children that are in a *different* bucket than the target.
    // Children already in the target bucket need no action and should not trigger a dialog.
    const explicitChildren = descendants.filter(
      (t) => hasExplicitAssignment(t) && taskBucketMap.get(t.id) !== targetId
    );

    if (explicitChildren.length > 0) {
      pendingMoveConfirm = { task, targetBucketId, explicitChildren, orderedTaskIds };
      return;
    }

    await onMove(task, targetBucketId);
    if (orderedTaskIds) await onReorder(targetId, orderedTaskIds);
  }

  async function confirmMoveChildren(moveChildren: boolean) {
    if (!pendingMoveConfirm) return;
    const { task, targetBucketId, explicitChildren, orderedTaskIds } = pendingMoveConfirm;
    pendingMoveConfirm = null;

    await onMove(task, targetBucketId);
    if (orderedTaskIds) await onReorder(targetBucketId ?? TO_REVIEW_ID, orderedTaskIds);

    if (moveChildren) {
      for (const child of explicitChildren) {
        // Re-look up from the live map — re-indexing after the parent write may have
        // produced a fresh TaskRecord with an updated rawLine for this child.
        const fresh = allTasksMap.get(child.id) ?? child;
        await onMove(fresh, targetBucketId);
      }
    }
  }
```

- [ ] **Step 3: Update `handleDrop` and add `handleReorderEvent`**

Find:

```ts
  async function handleDrop(event: CustomEvent<{
    taskId: string;
    sourceBucketId: string;
    targetBucketId: string;
  }>) {
    const { taskId, targetBucketId } = event.detail;
    const resolvedTarget = targetBucketId === TO_REVIEW_ID ? null : targetBucketId;

    for (const group of bucketGroups) {
      const task = group.tasks.find((t) => t.id === taskId);
      if (task) {
        await handleMove(task, resolvedTarget);
        return;
      }
    }
  }
```

Replace with:

```ts
  async function handleDrop(event: CustomEvent<{
    taskId: string;
    sourceBucketId: string;
    targetBucketId: string;
    orderedTaskIds: string[] | null;
  }>) {
    const { taskId, targetBucketId, orderedTaskIds } = event.detail;
    const resolvedTarget = targetBucketId === TO_REVIEW_ID ? null : targetBucketId;

    for (const group of bucketGroups) {
      const task = group.tasks.find((t) => t.id === taskId);
      if (task) {
        await handleMove(task, resolvedTarget, orderedTaskIds);
        return;
      }
    }
  }

  async function handleReorderEvent(event: CustomEvent<{ bucketId: string; orderedTaskIds: string[] }>) {
    await onReorder(event.detail.bucketId, event.detail.orderedTaskIds);
  }
```

- [ ] **Step 4: Wire the `reorder` event in the template**

Find (inside the `{#each filteredBucketGroups as group, i (group.bucketId)}` block):

```svelte
        on:move={(e) => handleMove(e.detail.task, e.detail.targetBucketId)}
        on:toggle={(e) => handleToggle(e.detail.task)}
        on:navigate={(e) => onNavigate(e.detail.task)}
        on:confirm={(e) => onConfirm(e.detail.task, e.detail.bucketId)}
        on:drop={handleDrop}
      />
```

Replace with:

```svelte
        on:move={(e) => handleMove(e.detail.task, e.detail.targetBucketId)}
        on:toggle={(e) => handleToggle(e.detail.task)}
        on:navigate={(e) => onNavigate(e.detail.task)}
        on:confirm={(e) => onConfirm(e.detail.task, e.detail.bucketId)}
        on:drop={handleDrop}
        on:reorder={handleReorderEvent}
      />
```

- [ ] **Step 5: Commit**

```bash
git add src/views/GTDPanel.svelte
git commit -m "feat: thread reorder events through GTDPanel to a new onReorder prop"
```

(Typecheck deferred to Task 6, Step 3, since `main.ts` must supply `onReorder` before `svelte-check`-equivalent compilation is fully clean end-to-end.)

---

### Task 6: Persist order in `main.ts`

**Files:**
- Modify: `src/main.ts:1-24` (imports), `:207-236` (`mountSvelte`, add `handleReorder`)

**Interfaces:**
- Consumes: `computeOrderKeys` from `src/core/TaskOrder.ts` (Task 1); `onReorder` prop contract from Task 5.
- Produces: nothing further downstream — this is the last hop, writing to `this.plugin.settings.taskOrder` and calling `saveSettings()` (which already triggers `panelView.refresh()`, re-running `groupTasksIntoBuckets` from Task 3 with the new order applied).

- [ ] **Step 1: Import `computeOrderKeys`**

Find:

```ts
import { moveTaskToBucket, toggleTaskCompletion, confirmTaskPlacement } from "./core/TaskWriter";
import type { TaskRecord } from "./core/TaskParser";
```

Replace with:

```ts
import { moveTaskToBucket, toggleTaskCompletion, confirmTaskPlacement } from "./core/TaskWriter";
import type { TaskRecord } from "./core/TaskParser";
import { computeOrderKeys } from "./core/TaskOrder";
```

- [ ] **Step 2: Wire the `onReorder` prop and implement the handler**

Find:

```ts
        onMove: this.handleMove.bind(this),
        onToggle: this.handleToggle.bind(this),
        onNavigate: this.handleNavigate.bind(this),
        onConfirm: this.handleConfirmPlacement.bind(this),
        onOpenSettings: openSettings,
```

Replace with:

```ts
        onMove: this.handleMove.bind(this),
        onToggle: this.handleToggle.bind(this),
        onNavigate: this.handleNavigate.bind(this),
        onConfirm: this.handleConfirmPlacement.bind(this),
        onReorder: this.handleReorder.bind(this),
        onOpenSettings: openSettings,
```

Then find:

```ts
  private async handleMove(task: TaskRecord, targetBucketId: string | null) {
```

Insert a new method directly above it:

```ts
  private async handleReorder(bucketId: string, orderedTaskIds: string[]) {
    const allTasks = this.plugin.taskIndex.getAllTasks();
    const orderKeys = computeOrderKeys(allTasks);
    const keys = orderedTaskIds
      .map((id) => orderKeys.get(id))
      .filter((k): k is string => k !== undefined);
    this.plugin.settings.taskOrder[bucketId] = keys;
    await this.plugin.saveSettings();
  }

  private async handleMove(task: TaskRecord, targetBucketId: string | null) {
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors — this confirms `GTDPanel.svelte`'s `onReorder` prop type matches what `main.ts` now supplies, and `BucketGroup.svelte`'s event payloads match what `GTDPanel.svelte` consumes.

Run: `npm run build`
Expected: succeeds (runs translations validation, typecheck, lint, and the production esbuild bundle)

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: persist drag-and-drop task order to plugin settings"
```

---

### Task 7: Manual verification in Obsidian

**Files:** none (manual testing only — this repo doesn't have Svelte component tests; see CLAUDE.md's "Tests" section)

- [ ] **Step 1: Set up the dev loop**

Per `CLAUDE.md`: symlink this repo folder into `<vault>/.obsidian/plugins/gtd-tasks/`, install the community "Hot Reload" plugin, then run:

```bash
npm run dev
```

- [ ] **Step 2: Verify same-bucket reorder persists**

In the GTD panel, drag a task to a new position within the same bucket. Check a *different* task in a different bucket (or toggle any unrelated setting) to force a `saveSettings()`/refresh cycle, then confirm the dragged task is still in its new position (not reset to file order).

- [ ] **Step 3: Verify cross-bucket drop respects the exact drop position**

Drag a task from Bucket A and drop it between two specific tasks in Bucket B (not at the top or bottom). Confirm it lands exactly between them on the first drop — no second drag needed.

- [ ] **Step 4: Verify order survives an Obsidian restart**

After reordering a bucket, close and reopen Obsidian (or reload the plugin via the Hot Reload command). Confirm the manual order is still applied — this exercises the `data.json` persistence path, not just the in-session store.

- [ ] **Step 5: Verify a newly-added task appends at the end**

Add a brand-new task to a file such that it lands in an already-manually-ordered bucket (e.g. via auto date-assignment or by adding the bucket tag directly in the file). Confirm it appears after the manually ordered tasks, not interleaved unpredictably.

- [ ] **Step 6: Verify subtask grouping constraints still hold**

With a parent task that has subtasks in the same bucket, drag things around and confirm the existing constraints from commit `4d839d3` still apply (parent can't be dropped below its own descendants, subtask can't be dropped above its parent, groups stay contiguous) — Task 3's sort is a stable re-ordering of already-valid drop sequences, but this confirms nothing regressed.

- [ ] **Step 7: Report back**

Summarize pass/fail for each of the above to the user before considering GitHub issue #2 resolved.
