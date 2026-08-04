# Task Order Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual per-bucket task order survive text edits, due-date edits and file renames; give it evidence-based cleanup rules so it can never grow unbounded; and give completed-task visibility a clock that exists in every configuration.

**Architecture:** Order keys stop folding the file path into their hash and become structured `{ file, key }` entries, so a rename is an in-place field rewrite. `TaskIndex` keeps the previous parse of a changed file and hands `(oldTasks, newTasks)` to `main.ts`, which runs a tiered diff to migrate keys through in-place edits and to witness completion transitions. Two purge rules ride on work that already happens — aged-out on every index change, dangling once at startup after `initialScan` resolves. The `readTasksPlugin` setting is deleted; 📅/✅ parsing and due-date auto-assign become always-on, and the panel's completion toggle delegates to the Tasks plugin's `apiV1` when present.

**Tech Stack:** TypeScript 5.4 (strict, `isolatedModules`), Svelte 5 running Svelte-4 legacy syntax, esbuild, Jest + ts-jest, SortableJS, i18next.

**Source spec:** `docs/superpowers/specs/2026-08-02-task-order-persistence-design.md` — read it before starting. Every decision below traces to it.

## Global Constraints

- **Never write IDs into user files.** Identity is content-derived plus event-driven migration. No new markdown syntax is introduced by this plan.
- **Hard invariant on the disambiguator:** only fields this plugin's own actions never write may enter it. It stays `text|dueDate`. Completion state, tags, and inline fields stay excluded. (Adding them caused a shipped bug — see the comment block above `disambiguator` in `src/core/TaskOrder.ts`.)
- **Purges are evidence-based.** Aged-out requires the task to be present in the index; dangling runs only after `initialScan()` has resolved. Out-of-scope entries go dormant, never purged.
- **No timers, no schedules.** Both purges piggyback on existing work.
- All `data.json` mutations go through the existing `saveSettings()`.
- `isolatedModules: true` — use `import type` for type-only imports. Note the established convention in `src/core/`: `TaskRecord` is imported as a plain (non-`type`) import there; match the file you are editing.
- Match existing code style: comments only where a non-obvious constraint needs explaining. Look at `src/core/BucketManager.ts` and `src/core/TaskOrder.ts` for the house tone.
- **CSS rules (from `CLAUDE.md`)**: no `!important`, no inline `style=""`, no partially-supported CSS properties, use Obsidian CSS variables. This plan changes no CSS, but do not introduce any.
- **Commit messages: subject line only, no body.** Format: `type: short description` plus the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer. This is a standing project preference.
- Unit tests are pure logic with no Obsidian API, in `tests/`. `tests/__mocks__/obsidian.ts` stubs the `obsidian` module. `.svelte` files have no unit tests (repo convention) — verify those via `npm run build` and manual QA.
- Verification commands: `npm test` (Jest), `npm run build` (runs `validate-translations` → `tsc -noEmit` → `eslint` → esbuild). Both must pass at the end of every task.

---

### Task 1: Structured order entries

Replaces the flat `hash(filePath + text + due):occurrence` string with `{ file, key }`, where `key = hash(text|due):occurrence`. This is what makes rename migration a field rewrite. Also adds the shared helpers later tasks build on.

**Files:**
- Modify: `src/core/TaskOrder.ts` (rewrite of the key-computation half)
- Modify: `src/settings.ts` (`taskOrder` type, new `completionSeen`, new `isPathInScope`)
- Modify: `src/main.ts` (call sites: `handleReorder`, `handleMove`, `loadSettings`)
- Test: `tests/TaskOrder.test.ts`, `tests/settings.test.ts`

**Interfaces:**
- Consumes: `TaskRecord` from `./TaskParser`; `TaskScope` from `../settings`.
- Produces (all used by Tasks 2–10):
  - `interface OrderEntry { file: string; key: string }`
  - `entryId(entry: OrderEntry): string` → `` `${file}::${key}` ``
  - `sameEntry(a: OrderEntry, b: OrderEntry): boolean`
  - `isOrderEntry(value: unknown): value is OrderEntry`
  - `computeOrderKeys(tasks: TaskRecord[]): Map<string, OrderEntry>` (keyed by `task.id`)
  - `computeLegacyOrderKeys(tasks: TaskRecord[]): Map<string, string>`
  - `applyManualOrder(tasks: TaskRecord[], orderEntries: Map<string, OrderEntry>, savedOrder: OrderEntry[]): TaskRecord[]`
  - `mapToOrderEntries(taskIds: string[], orderEntries: Map<string, OrderEntry>): OrderEntry[]` (renamed from `mapToOrderKeys`)
  - `purgeOrderEntry(taskOrder: Record<string, OrderEntry[]>, entry: OrderEntry): { taskOrder: Record<string, OrderEntry[]>; changed: boolean }` (renamed from `purgeOrderKey`)
  - `completionClock(task: TaskRecord, entry: OrderEntry | undefined, completionSeen: Record<string, number>): number | null`
  - `isPathInScope(path: string, scope: TaskScope): boolean` (from `src/settings.ts`)
  - `PluginSettings.completionSeen: Record<string, number>`

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe("computeOrderKeys", ...)` block in `tests/TaskOrder.test.ts` with the version below, and update the three later `describe` blocks. The full new file content after the `makeTask` helper (keep `makeTask` and the imports line updated as shown):

Change the import line at the top of the file to:

```ts
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
```

Then replace everything from `describe("computeOrderKeys"` to the end of the file with:

```ts
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
```

Also append to `tests/settings.test.ts`:

```ts
import { getActiveScope, isPathInScope, migrateSettingsData } from "../src/settings";

describe("isPathInScope", () => {
  it("accepts every path under a vault scope", () => {
    expect(isPathInScope("anything/at/all.md", { type: "vault" })).toBe(true);
  });

  it("matches folder scopes by prefix, with or without a trailing slash", () => {
    expect(isPathInScope("Tasks/a.md", { type: "folders", paths: ["Tasks"] })).toBe(true);
    expect(isPathInScope("Tasks/a.md", { type: "folders", paths: ["Tasks/"] })).toBe(true);
    expect(isPathInScope("TasksArchive/a.md", { type: "folders", paths: ["Tasks"] })).toBe(false);
  });

  it("matches file scopes by exact path", () => {
    expect(isPathInScope("Tasks/a.md", { type: "files", paths: ["Tasks/a.md"] })).toBe(true);
    expect(isPathInScope("Tasks/b.md", { type: "files", paths: ["Tasks/a.md"] })).toBe(false);
  });
});
```

(Replace the existing first import line of `tests/settings.test.ts` with the one above.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="TaskOrder|settings"`
Expected: FAIL — `computeLegacyOrderKeys`, `mapToOrderEntries`, `purgeOrderEntry`, `entryId`, `isOrderEntry`, `completionClock`, `isPathInScope` are not exported.

- [ ] **Step 3: Rewrite `src/core/TaskOrder.ts`**

Keep `hashString` and the existing `disambiguator` function *and its full comment block* exactly as they are. Replace everything else with:

```ts
import { TaskRecord } from "./TaskParser";

/**
 * A saved order position. The file path is stored beside the key rather than
 * hashed into it: that is what turns a file rename into an in-place field
 * rewrite instead of a rehash of every entry belonging to that file.
 */
export interface OrderEntry {
  file: string;
  /** hash(text|dueDate) + ":" + occurrence index within the file. */
  key: string;
}

/** `${file}::${key}` — the identity used to key completionSeen records. */
export function entryId(entry: OrderEntry): string {
  return `${entry.file}::${entry.key}`;
}

export function sameEntry(a: OrderEntry, b: OrderEntry): boolean {
  return a.file === b.file && a.key === b.key;
}

/**
 * Guards against pre-0.2 data.json content, where each saved position was a
 * flat string. Those survive in memory until migrateOrderFormat runs at
 * startup reconciliation, so every consumer must tolerate them.
 */
export function isOrderEntry(value: unknown): value is OrderEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OrderEntry).file === "string" &&
    typeof (value as OrderEntry).key === "string"
  );
}

/**
 * Walks tasks grouped by file in line order, handing each one its
 * disambiguator and the running occurrence index for that disambiguator.
 * Shared by the current and legacy key formats so the two can never drift
 * on occurrence counting.
 */
function forEachWithOccurrence(
  tasks: TaskRecord[],
  cb: (task: TaskRecord, disambig: string, occurrence: number) => void
): void {
  const byFile = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (!byFile.has(task.filePath)) byFile.set(task.filePath, []);
    byFile.get(task.filePath)!.push(task);
  }

  for (const fileTasks of byFile.values()) {
    const sorted = [...fileTasks].sort((a, b) => a.lineNumber - b.lineNumber);
    const occurrenceCount = new Map<string, number>();
    for (const task of sorted) {
      const disambig = disambiguator(task);
      const count = occurrenceCount.get(disambig) ?? 0;
      occurrenceCount.set(disambig, count + 1);
      cb(task, disambig, count);
    }
  }
}

/**
 * Stable identity for persisting a task's manual bucket-order position across
 * reindexes. Excludes lineNumber so it survives unrelated line churn, and
 * excludes the file path from the hash so a rename is a field rewrite. Tasks
 * that still collide (genuinely identical content in one file) are
 * disambiguated by their occurrence order (first gets :0, second :1, ...).
 */
export function computeOrderKeys(tasks: TaskRecord[]): Map<string, OrderEntry> {
  const result = new Map<string, OrderEntry>();
  forEachWithOccurrence(tasks, (task, disambig, occurrence) => {
    result.set(task.id, {
      file: task.filePath,
      key: `${hashString(disambig)}:${occurrence}`,
    });
  });
  return result;
}

/**
 * The pre-0.2 key format: file path folded into the hash, stored as a bare
 * string. Used only by migrateOrderFormat, to match saved flat keys against
 * the tasks currently in the vault.
 */
export function computeLegacyOrderKeys(tasks: TaskRecord[]): Map<string, string> {
  const result = new Map<string, string>();
  forEachWithOccurrence(tasks, (task, disambig, occurrence) => {
    result.set(task.id, `${hashString(`${task.filePath}:${disambig}`)}:${occurrence}`);
  });
  return result;
}

/**
 * Sorts `tasks` to match `savedOrder`. Tasks with no match — new tasks, or
 * stale/unmatched entries — are appended at the end in their original
 * relative order.
 */
export function applyManualOrder(
  tasks: TaskRecord[],
  orderEntries: Map<string, OrderEntry>,
  savedOrder: OrderEntry[]
): TaskRecord[] {
  const byEntry = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const entry = orderEntries.get(task.id);
    if (entry) byEntry.set(entryId(entry), task);
  }

  const result: TaskRecord[] = [];
  const used = new Set<string>();
  for (const entry of savedOrder) {
    if (!isOrderEntry(entry)) continue;
    const task = byEntry.get(entryId(entry));
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

/** Resolves task ids to their order entries, dropping any that don't resolve. */
export function mapToOrderEntries(
  taskIds: string[],
  orderEntries: Map<string, OrderEntry>
): OrderEntry[] {
  return taskIds
    .map((id) => orderEntries.get(id))
    .filter((e): e is OrderEntry => e !== undefined);
}

/**
 * Removes `entry` from every bucket's array in `taskOrder`. Returns a new
 * record (does not mutate the input) and whether anything changed.
 */
export function purgeOrderEntry(
  taskOrder: Record<string, OrderEntry[]>,
  entry: OrderEntry
): { taskOrder: Record<string, OrderEntry[]>; changed: boolean } {
  let changed = false;
  const result: Record<string, OrderEntry[]> = {};
  for (const [bucketId, saved] of Object.entries(taskOrder)) {
    const filtered = saved.filter((e) => !(isOrderEntry(e) && sameEntry(e, entry)));
    if (filtered.length !== saved.length) {
      changed = true;
      result[bucketId] = filtered;
    } else {
      result[bucketId] = saved;
    }
  }
  return { taskOrder: result, changed };
}

/**
 * When a completed task's completion happened, in epoch ms: the ✅ date if the
 * line carries one, else the timestamp recorded when the index witnessed the
 * transition. null means no evidence at all — the completion happened outside
 * this plugin's sight, and is treated as aged.
 */
export function completionClock(
  task: TaskRecord,
  entry: OrderEntry | undefined,
  completionSeen: Record<string, number>
): number | null {
  if (task.completedAt) return task.completedAt.getTime();
  if (entry) {
    const seen = completionSeen[entryId(entry)];
    if (typeof seen === "number") return seen;
  }
  return null;
}
```

- [ ] **Step 4: Update `src/settings.ts`**

Add this import at the very top of the file:

```ts
import type { OrderEntry } from "./core/TaskOrder";
```

In `interface PluginSettings`, replace the `taskOrder` declaration (keeping its existing doc comment, amended) with:

```ts
  /**
   * Manual per-bucket task order from drag-and-drop, keyed by bucket ID.
   * Each value is an array of order entries (see core/TaskOrder.ts) in
   * display order. Tasks not present in a bucket's array render after it,
   * in their natural (file scan) order.
   */
  taskOrder: Record<string, OrderEntry[]>;
  /**
   * Epoch-ms timestamps for dateless completions the index actually
   * witnessed, keyed by `${file}::${key}`. Only today's records are kept —
   * OrderPurge drops older ones, and an unwitnessed completion never gets a
   * record at all, so this map cannot accumulate history.
   */
  completionSeen: Record<string, number>;
```

In `DEFAULT_SETTINGS`, add after `taskOrder: {},`:

```ts
  completionSeen: {},
```

Append this function at the end of the file:

```ts
/** Whether `path` falls inside `scope`. Extension filtering is the caller's job. */
export function isPathInScope(path: string, scope: TaskScope): boolean {
  switch (scope.type) {
    case "vault":
      return true;
    case "folders":
      return scope.paths.some((p) => path.startsWith(p.endsWith("/") ? p : p + "/"));
    case "files":
      return scope.paths.includes(path);
  }
}
```

- [ ] **Step 5: Update the call sites in `src/main.ts`**

Change the `TaskOrder` import line to:

```ts
import { computeOrderKeys, mapToOrderEntries, purgeOrderEntry } from "./core/TaskOrder";
```

In `loadSettings()`, directly after the existing `this.settings.taskOrder = ...` line, add:

```ts
    this.settings.completionSeen = { ...(this.settings.completionSeen ?? {}) };
```

In `GtdPanelView.handleReorder`, replace the body with:

```ts
    const orderEntries = computeOrderKeys(this.plugin.taskIndex.getAllTasks());
    this.plugin.settings.taskOrder[bucketId] = mapToOrderEntries(orderedTaskIds, orderEntries);
    await this.plugin.saveSettings();
```

In `GtdPanelView.handleMove`, replace the block from `const orderKeys = ...` through the `if (orderedTaskIds) { ... }` block with:

```ts
    const orderEntries = computeOrderKeys(this.plugin.taskIndex.getAllTasks());
    const entry = orderEntries.get(task.id);
    if (entry) {
      const purged = purgeOrderEntry(this.plugin.settings.taskOrder, entry);
      this.plugin.settings.taskOrder = purged.taskOrder;
    }

    if (orderedTaskIds) {
      const targetId = targetBucketId ?? TO_REVIEW_ID;
      this.plugin.settings.taskOrder[targetId] = mapToOrderEntries(orderedTaskIds, orderEntries);
    }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test`
Expected: PASS (all suites).

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add src/core/TaskOrder.ts src/settings.ts src/main.ts tests/TaskOrder.test.ts tests/settings.test.ts
git commit -m "refactor: store task order as structured {file, key} entries"
```

---

### Task 2: Tiered edit diff

The pairing logic that lets an edited task keep its position. Pure, no Obsidian API.

**Files:**
- Create: `src/core/OrderMigration.ts`
- Test: `tests/OrderMigration.test.ts`

**Interfaces:**
- Consumes: `TaskRecord` (`./TaskParser`); `computeOrderKeys`, `OrderEntry` (`./TaskOrder`).
- Produces:
  - `interface TaskDiff { rekeys: Array<{ from: string; to: string }>; completedWithoutDate: string[]; reopened: string[] }` — all values are bare `key`s (not entries): a diff is always scoped to one file.
  - `diffFileTasks(oldTasks: TaskRecord[], newTasks: TaskRecord[]): TaskDiff`

- [ ] **Step 1: Write the failing tests**

Create `tests/OrderMigration.test.ts`:

```ts
import { diffFileTasks } from "../src/core/OrderMigration";
import { computeOrderKeys } from "../src/core/TaskOrder";
import type { TaskRecord } from "../src/core/TaskParser";

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "1",
    filePath: "a.md",
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

function keyOf(task: TaskRecord): string {
  return computeOrderKeys([task]).get(task.id)!.key;
}

describe("diffFileTasks", () => {
  it("reports nothing when the file is unchanged (tier 1)", () => {
    const task = makeTask({ id: "a", text: "Buy milk" });

    expect(diffFileTasks([task], [task])).toEqual({
      rekeys: [],
      completedWithoutDate: [],
      reopened: [],
    });
  });

  it("pairs an in-place text edit by line number (tier 2)", () => {
    const before = makeTask({ id: "a", lineNumber: 3, text: "Buy milk" });
    const after = makeTask({ id: "a2", lineNumber: 3, text: "Buy oat milk" });

    const diff = diffFileTasks([before], [after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("pairs an in-place due-date edit by line number (tier 2)", () => {
    const before = makeTask({ id: "a", lineNumber: 0, text: "Ship it", dueDate: new Date("2026-08-01") });
    const after = makeTask({ id: "a2", lineNumber: 0, text: "Ship it", dueDate: new Date("2026-08-09") });

    const diff = diffFileTasks([before], [after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("does not pair an unchanged task's line-mate (tier 1 wins before tier 2)", () => {
    const keep = makeTask({ id: "k", lineNumber: 0, text: "Keep" });
    const before = makeTask({ id: "a", lineNumber: 1, text: "Old" });
    const after = makeTask({ id: "a2", lineNumber: 1, text: "New" });

    const diff = diffFileTasks([keep, before], [keep, after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("pairs a sole leftover on each side even when the line number moved (tier 3)", () => {
    const before = makeTask({ id: "a", lineNumber: 1, text: "Buy milk" });
    const after = makeTask({ id: "a2", lineNumber: 7, text: "Buy oat milk" });

    const diff = diffFileTasks([before], [after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
  });

  it("degrades to add/delete when two unmatched tasks on each side are ambiguous", () => {
    const oldA = makeTask({ id: "a", lineNumber: 0, text: "Old A" });
    const oldB = makeTask({ id: "b", lineNumber: 1, text: "Old B" });
    const newA = makeTask({ id: "c", lineNumber: 5, text: "New A" });
    const newB = makeTask({ id: "d", lineNumber: 9, text: "New B" });

    const diff = diffFileTasks([oldA, oldB], [newA, newB]);

    expect(diff.rekeys).toEqual([]);
  });

  it("treats a pure addition as new, with no rekey", () => {
    const existing = makeTask({ id: "a", lineNumber: 0, text: "Existing" });
    const added = makeTask({ id: "b", lineNumber: 1, text: "Added" });

    expect(diffFileTasks([existing], [existing, added]).rekeys).toEqual([]);
  });

  it("treats a pure deletion as gone, with no rekey", () => {
    const kept = makeTask({ id: "a", lineNumber: 0, text: "Kept" });
    const removed = makeTask({ id: "b", lineNumber: 1, text: "Removed" });

    expect(diffFileTasks([kept, removed], [kept]).rekeys).toEqual([]);
  });

  it("records a dateless open → completed transition", () => {
    const before = makeTask({ id: "a", text: "Foo", isCompleted: false });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });

    const diff = diffFileTasks([before], [after]);

    expect(diff.completedWithoutDate).toEqual([keyOf(after)]);
    expect(diff.reopened).toEqual([]);
  });

  it("records nothing when the completed line carries a ✅ date", () => {
    const before = makeTask({ id: "a", text: "Foo", isCompleted: false });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: new Date("2026-08-02") });

    expect(diffFileTasks([before], [after]).completedWithoutDate).toEqual([]);
  });

  it("records a completed → open transition", () => {
    const before = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });
    const after = makeTask({ id: "a", text: "Foo", isCompleted: false });

    const diff = diffFileTasks([before], [after]);

    expect(diff.reopened).toEqual([keyOf(after)]);
    expect(diff.completedWithoutDate).toEqual([]);
  });

  it("records a completion transition on a paired edit, under the NEW key", () => {
    const before = makeTask({ id: "a", lineNumber: 2, text: "Old text", isCompleted: false });
    const after = makeTask({ id: "b", lineNumber: 2, text: "New text", isCompleted: true, completedAt: null });

    const diff = diffFileTasks([before], [after]);

    expect(diff.rekeys).toEqual([{ from: keyOf(before), to: keyOf(after) }]);
    expect(diff.completedWithoutDate).toEqual([keyOf(after)]);
  });

  it("does not record a completion for a task that was already completed when first seen", () => {
    const done = makeTask({ id: "a", text: "Foo", isCompleted: true, completedAt: null });

    expect(diffFileTasks([], [done]).completedWithoutDate).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=OrderMigration`
Expected: FAIL — `Cannot find module '../src/core/OrderMigration'`.

- [ ] **Step 3: Create `src/core/OrderMigration.ts`**

```ts
import { TaskRecord } from "./TaskParser";
import { computeOrderKeys } from "./TaskOrder";

/**
 * What changed in one file between two parses. All values are bare order
 * keys, never entries: a diff is always scoped to a single file, so the
 * `file` half of an entry is implied by the caller.
 */
export interface TaskDiff {
  /** In-place edits: the task kept its position, its content key changed. */
  rekeys: Array<{ from: string; to: string }>;
  /** Keys that went open → completed on a line carrying no ✅ date. */
  completedWithoutDate: string[];
  /** Keys that went completed → open. */
  reopened: string[];
}

/**
 * Tiered pairing of an old and new parse of the same file. Tier 1: keys that
 * match on both sides are unchanged. Tier 2: an unmatched old and unmatched
 * new task on the same line number is an in-place edit. Tier 3: exactly one
 * leftover on each side, anywhere in the file, is an edit too. Anything more
 * ambiguous degrades to add/delete — a wrong pairing would silently move
 * someone else's task, which is worse than losing one position.
 */
export function diffFileTasks(oldTasks: TaskRecord[], newTasks: TaskRecord[]): TaskDiff {
  const oldByKey = keyTasks(oldTasks);
  const newByKey = keyTasks(newTasks);

  const diff: TaskDiff = { rekeys: [], completedWithoutDate: [], reopened: [] };

  const unmatchedOld = new Map(oldByKey);
  const unmatchedNew = new Map(newByKey);

  for (const [key, newTask] of newByKey) {
    const oldTask = oldByKey.get(key);
    if (!oldTask) continue;
    unmatchedOld.delete(key);
    unmatchedNew.delete(key);
    recordCompletion(diff, oldTask, newTask, key);
  }

  for (const [newKey, newTask] of [...unmatchedNew]) {
    for (const [oldKey, oldTask] of unmatchedOld) {
      if (oldTask.lineNumber !== newTask.lineNumber) continue;
      pair(diff, oldKey, oldTask, newKey, newTask);
      unmatchedOld.delete(oldKey);
      unmatchedNew.delete(newKey);
      break;
    }
  }

  if (unmatchedOld.size === 1 && unmatchedNew.size === 1) {
    const [oldKey, oldTask] = [...unmatchedOld][0];
    const [newKey, newTask] = [...unmatchedNew][0];
    pair(diff, oldKey, oldTask, newKey, newTask);
  }

  return diff;
}

function keyTasks(tasks: TaskRecord[]): Map<string, TaskRecord> {
  const entries = computeOrderKeys(tasks);
  const result = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const entry = entries.get(task.id);
    if (entry) result.set(entry.key, task);
  }
  return result;
}

function pair(
  diff: TaskDiff,
  oldKey: string,
  oldTask: TaskRecord,
  newKey: string,
  newTask: TaskRecord
): void {
  diff.rekeys.push({ from: oldKey, to: newKey });
  recordCompletion(diff, oldTask, newTask, newKey);
}

function recordCompletion(
  diff: TaskDiff,
  oldTask: TaskRecord,
  newTask: TaskRecord,
  key: string
): void {
  if (!oldTask.isCompleted && newTask.isCompleted && newTask.completedAt === null) {
    diff.completedWithoutDate.push(key);
  } else if (oldTask.isCompleted && !newTask.isCompleted) {
    diff.reopened.push(key);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=OrderMigration`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/OrderMigration.ts tests/OrderMigration.test.ts
git commit -m "feat: tiered diff pairing for in-place task edits"
```

---

### Task 3: Applying diffs and renames to saved order

**Files:**
- Modify: `src/core/OrderMigration.ts`
- Test: `tests/OrderMigration.test.ts`

**Interfaces:**
- Consumes: `TaskDiff` (Task 2); `OrderEntry`, `isOrderEntry` (`./TaskOrder`).
- Produces:
  - `interface OrderState { taskOrder: Record<string, OrderEntry[]>; completionSeen: Record<string, number> }`
  - `applyTaskDiff(state: OrderState, filePath: string, diff: TaskDiff, now: number): { state: OrderState; changed: boolean }`
  - `renameFileInState(state: OrderState, oldPath: string, newPath: string): { state: OrderState; changed: boolean }`

- [ ] **Step 1: Write the failing tests**

Update the import line at the top of `tests/OrderMigration.test.ts`:

```ts
import { diffFileTasks, applyTaskDiff, renameFileInState } from "../src/core/OrderMigration";
import type { OrderState } from "../src/core/OrderMigration";
```

Append these describes:

```ts
const NOW = 1_800_000_000_000;

function state(partial: Partial<OrderState> = {}): OrderState {
  return { taskOrder: {}, completionSeen: {}, ...partial };
}

describe("applyTaskDiff", () => {
  it("rewrites a rekeyed entry in place, keeping its position", () => {
    const before = state({
      taskOrder: {
        today: [
          { file: "a.md", key: "k1:0" },
          { file: "a.md", key: "old:0" },
          { file: "a.md", key: "k3:0" },
        ],
      },
    });

    const { state: after, changed } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [{ from: "old:0", to: "new:0" }], completedWithoutDate: [], reopened: [] },
      NOW
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([
      { file: "a.md", key: "k1:0" },
      { file: "a.md", key: "new:0" },
      { file: "a.md", key: "k3:0" },
    ]);
  });

  it("leaves a same-key entry belonging to a different file alone", () => {
    const before = state({ taskOrder: { today: [{ file: "b.md", key: "old:0" }] } });

    const { state: after, changed } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [{ from: "old:0", to: "new:0" }], completedWithoutDate: [], reopened: [] },
      NOW
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([{ file: "b.md", key: "old:0" }]);
  });

  it("moves a completionSeen record onto the new key", () => {
    const before = state({ completionSeen: { "a.md::old:0": 555 } });

    const { state: after } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [{ from: "old:0", to: "new:0" }], completedWithoutDate: [], reopened: [] },
      NOW
    );

    expect(after.completionSeen).toEqual({ "a.md::new:0": 555 });
  });

  it("records `now` for a witnessed dateless completion", () => {
    const { state: after, changed } = applyTaskDiff(
      state(),
      "a.md",
      { rekeys: [], completedWithoutDate: ["k:0"], reopened: [] },
      NOW
    );

    expect(changed).toBe(true);
    expect(after.completionSeen).toEqual({ "a.md::k:0": NOW });
  });

  it("deletes the record when a task is reopened", () => {
    const before = state({ completionSeen: { "a.md::k:0": 555 } });

    const { state: after, changed } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [], completedWithoutDate: [], reopened: ["k:0"] },
      NOW
    );

    expect(changed).toBe(true);
    expect(after.completionSeen).toEqual({});
  });

  it("reports changed: false for an empty diff and does not mutate the input", () => {
    const before = state({
      taskOrder: { today: [{ file: "a.md", key: "k:0" }] },
      completionSeen: { "a.md::k:0": 1 },
    });

    const { changed } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [], completedWithoutDate: [], reopened: [] },
      NOW
    );

    expect(changed).toBe(false);
    expect(before.taskOrder.today).toEqual([{ file: "a.md", key: "k:0" }]);
    expect(before.completionSeen).toEqual({ "a.md::k:0": 1 });
  });

  it("leaves legacy flat-string entries untouched", () => {
    const before = state({ taskOrder: { today: ["legacy:0" as unknown as never] } });

    const { state: after } = applyTaskDiff(
      before,
      "a.md",
      { rekeys: [{ from: "legacy:0", to: "new:0" }], completedWithoutDate: [], reopened: [] },
      NOW
    );

    expect(after.taskOrder.today).toEqual(["legacy:0"]);
  });
});

describe("renameFileInState", () => {
  it("rewrites the file field of the renamed file's entries, keeping positions", () => {
    const before = state({
      taskOrder: {
        today: [
          { file: "old.md", key: "k1:0" },
          { file: "other.md", key: "k2:0" },
          { file: "old.md", key: "k3:0" },
        ],
      },
    });

    const { state: after, changed } = renameFileInState(before, "old.md", "new.md");

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([
      { file: "new.md", key: "k1:0" },
      { file: "other.md", key: "k2:0" },
      { file: "new.md", key: "k3:0" },
    ]);
  });

  it("rewrites completionSeen keys for the renamed file only", () => {
    const before = state({
      completionSeen: { "old.md::k:0": 1, "other.md::k:0": 2 },
    });

    const { state: after } = renameFileInState(before, "old.md", "new.md");

    expect(after.completionSeen).toEqual({ "new.md::k:0": 1, "other.md::k:0": 2 });
  });

  it("reports changed: false when the renamed file has no saved order", () => {
    const before = state({ taskOrder: { today: [{ file: "other.md", key: "k:0" }] } });

    expect(renameFileInState(before, "old.md", "new.md").changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=OrderMigration`
Expected: FAIL — `applyTaskDiff` / `renameFileInState` are not exported.

- [ ] **Step 3: Implement in `src/core/OrderMigration.ts`**

Change the `TaskOrder` import at the top to:

```ts
import { computeOrderKeys, isOrderEntry } from "./TaskOrder";
import type { OrderEntry } from "./TaskOrder";
```

Append:

```ts
/** The two data.json fields this plugin migrates and purges together. */
export interface OrderState {
  taskOrder: Record<string, OrderEntry[]>;
  completionSeen: Record<string, number>;
}

/**
 * Folds one file's diff into saved order: rekeyed entries are rewritten
 * where they sit (position untouched), and witnessed completion transitions
 * are recorded or cleared. `now` is injected so this stays pure.
 */
export function applyTaskDiff(
  state: OrderState,
  filePath: string,
  diff: TaskDiff,
  now: number
): { state: OrderState; changed: boolean } {
  let changed = false;
  const rekeyMap = new Map(diff.rekeys.map((r) => [r.from, r.to]));

  const taskOrder: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(state.taskOrder)) {
    taskOrder[bucketId] = entries.map((entry) => {
      if (!isOrderEntry(entry) || entry.file !== filePath) return entry;
      const to = rekeyMap.get(entry.key);
      if (to === undefined || to === entry.key) return entry;
      changed = true;
      return { file: filePath, key: to };
    });
  }

  const completionSeen = { ...state.completionSeen };
  for (const { from, to } of diff.rekeys) {
    if (from === to) continue;
    const fromId = `${filePath}::${from}`;
    if (fromId in completionSeen) {
      completionSeen[`${filePath}::${to}`] = completionSeen[fromId];
      delete completionSeen[fromId];
      changed = true;
    }
  }
  for (const key of diff.completedWithoutDate) {
    completionSeen[`${filePath}::${key}`] = now;
    changed = true;
  }
  for (const key of diff.reopened) {
    const id = `${filePath}::${key}`;
    if (id in completionSeen) {
      delete completionSeen[id];
      changed = true;
    }
  }

  return { state: { taskOrder, completionSeen }, changed };
}

/**
 * Rewrites the `file` half of every entry belonging to a renamed file, and
 * the matching completionSeen keys. Structurally lossless — nothing is
 * rehashed and no array position moves.
 */
export function renameFileInState(
  state: OrderState,
  oldPath: string,
  newPath: string
): { state: OrderState; changed: boolean } {
  let changed = false;

  const taskOrder: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(state.taskOrder)) {
    taskOrder[bucketId] = entries.map((entry) => {
      if (!isOrderEntry(entry) || entry.file !== oldPath) return entry;
      changed = true;
      return { file: newPath, key: entry.key };
    });
  }

  const completionSeen: Record<string, number> = {};
  const prefix = `${oldPath}::`;
  for (const [id, at] of Object.entries(state.completionSeen)) {
    if (id.startsWith(prefix)) {
      completionSeen[`${newPath}::${id.slice(prefix.length)}`] = at;
      changed = true;
    } else {
      completionSeen[id] = at;
    }
  }

  return { state: { taskOrder, completionSeen }, changed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=OrderMigration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/OrderMigration.ts tests/OrderMigration.test.ts
git commit -m "feat: apply edit diffs and renames to saved task order"
```

---

### Task 4: One-time format migration

Upgrades pre-0.2 flat string keys to structured entries, losslessly for every task currently in the vault.

**Files:**
- Modify: `src/core/OrderMigration.ts`
- Test: `tests/OrderMigration.test.ts`

**Interfaces:**
- Consumes: `computeOrderKeys`, `computeLegacyOrderKeys`, `isOrderEntry`, `OrderEntry` (`./TaskOrder`); `TaskRecord`.
- Produces: `migrateOrderFormat(taskOrder: Record<string, unknown[]>, tasks: TaskRecord[]): { taskOrder: Record<string, OrderEntry[]>; changed: boolean }`

- [ ] **Step 1: Write the failing tests**

Update the `OrderMigration` import line in `tests/OrderMigration.test.ts` to include `migrateOrderFormat`, and add `computeLegacyOrderKeys` to the `TaskOrder` import:

```ts
import { diffFileTasks, applyTaskDiff, renameFileInState, migrateOrderFormat } from "../src/core/OrderMigration";
import type { OrderState } from "../src/core/OrderMigration";
import { computeOrderKeys, computeLegacyOrderKeys } from "../src/core/TaskOrder";
```

Append:

```ts
describe("migrateOrderFormat", () => {
  const taskA = makeTask({ id: "a", filePath: "a.md", lineNumber: 0, text: "Alpha" });
  const taskB = makeTask({ id: "b", filePath: "a.md", lineNumber: 1, text: "Beta" });
  const tasks = [taskA, taskB];

  function legacyKey(task: TaskRecord): string {
    return computeLegacyOrderKeys(tasks).get(task.id)!;
  }

  function entryFor(task: TaskRecord) {
    return computeOrderKeys(tasks).get(task.id)!;
  }

  it("rewrites matching flat keys to structured entries at the same positions", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [legacyKey(taskB), legacyKey(taskA)] },
      tasks
    );

    expect(changed).toBe(true);
    expect(taskOrder.today).toEqual([entryFor(taskB), entryFor(taskA)]);
  });

  it("drops flat keys that match no task in the vault", () => {
    const { taskOrder } = migrateOrderFormat(
      { today: ["9999999:0", legacyKey(taskA)] },
      tasks
    );

    expect(taskOrder.today).toEqual([entryFor(taskA)]);
  });

  it("leaves already-migrated entries untouched and reports changed: false", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [entryFor(taskA), entryFor(taskB)] },
      tasks
    );

    expect(changed).toBe(false);
    expect(taskOrder.today).toEqual([entryFor(taskA), entryFor(taskB)]);
  });

  it("handles a mixed bucket, migrating only the flat keys", () => {
    const { taskOrder, changed } = migrateOrderFormat(
      { today: [entryFor(taskA), legacyKey(taskB)] },
      tasks
    );

    expect(changed).toBe(true);
    expect(taskOrder.today).toEqual([entryFor(taskA), entryFor(taskB)]);
  });

  it("preserves empty buckets", () => {
    const { taskOrder } = migrateOrderFormat({ today: [], someday: [] }, tasks);
    expect(taskOrder).toEqual({ today: [], someday: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=OrderMigration`
Expected: FAIL — `migrateOrderFormat` is not exported.

- [ ] **Step 3: Implement in `src/core/OrderMigration.ts`**

Change the `TaskOrder` import to:

```ts
import { computeOrderKeys, computeLegacyOrderKeys, isOrderEntry } from "./TaskOrder";
import type { OrderEntry } from "./TaskOrder";
```

Append:

```ts
/**
 * One-time upgrade of pre-0.2 data.json: each saved position used to be a
 * flat `hash(filePath:text|due):occurrence` string. Recomputing both formats
 * for every currently-indexed task gives an exact old→new mapping, so this
 * is lossless for every task still in the vault; genuine orphans are dropped.
 * Must run only after initialScan resolves, or in-scope files that hadn't
 * loaded yet would look like orphans.
 */
export function migrateOrderFormat(
  taskOrder: Record<string, unknown[]>,
  tasks: TaskRecord[]
): { taskOrder: Record<string, OrderEntry[]>; changed: boolean } {
  const legacy = computeLegacyOrderKeys(tasks);
  const current = computeOrderKeys(tasks);

  const byLegacyKey = new Map<string, OrderEntry>();
  for (const task of tasks) {
    const legacyKey = legacy.get(task.id);
    const entry = current.get(task.id);
    if (legacyKey && entry) byLegacyKey.set(legacyKey, entry);
  }

  let changed = false;
  const result: Record<string, OrderEntry[]> = {};
  for (const [bucketId, saved] of Object.entries(taskOrder)) {
    const migrated: OrderEntry[] = [];
    for (const value of saved) {
      if (isOrderEntry(value)) {
        migrated.push(value);
        continue;
      }
      changed = true;
      if (typeof value !== "string") continue;
      const entry = byLegacyKey.get(value);
      if (entry) migrated.push(entry);
    }
    result[bucketId] = migrated;
  }

  return { taskOrder: result, changed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=OrderMigration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/OrderMigration.ts tests/OrderMigration.test.ts
git commit -m "feat: migrate legacy flat order keys to structured entries"
```

---

### Task 5: Evidence-based purge rules

**Files:**
- Create: `src/core/OrderPurge.ts`
- Test: `tests/OrderPurge.test.ts`

**Interfaces:**
- Consumes: `OrderState` (`./OrderMigration`); `completionClock`, `computeOrderKeys`, `entryId`, `isOrderEntry`, `OrderEntry` (`./TaskOrder`); `TaskRecord`.
- Produces:
  - `purgeAgedEntries(state: OrderState, tasks: TaskRecord[], now: Date): { state: OrderState; changed: boolean }`
  - `reconcileDanglingEntries(state: OrderState, tasks: TaskRecord[], fileExists: (path: string) => boolean, inScope: (path: string) => boolean): { state: OrderState; changed: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `tests/OrderPurge.test.ts`:

```ts
import { purgeAgedEntries, reconcileDanglingEntries } from "../src/core/OrderPurge";
import { computeOrderKeys } from "../src/core/TaskOrder";
import type { OrderState } from "../src/core/OrderMigration";
import type { TaskRecord } from "../src/core/TaskParser";

const NOW = new Date("2026-08-02T14:00:00");
const TODAY_MIDNIGHT = new Date("2026-08-02T00:00:00").getTime();
const YESTERDAY = new Date("2026-08-01T23:00:00").getTime();

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "1",
    filePath: "a.md",
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

function entryFor(task: TaskRecord, tasks: TaskRecord[]) {
  return computeOrderKeys(tasks).get(task.id)!;
}

function state(partial: Partial<OrderState> = {}): OrderState {
  return { taskOrder: {}, completionSeen: {}, ...partial };
}

describe("purgeAgedEntries", () => {
  it("keeps an open task's entry", () => {
    const task = makeTask({ id: "a", text: "Open" });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [task],
      NOW
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([entry]);
  });

  it("keeps a task completed today (✅ date is today)", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: new Date(TODAY_MIDNIGHT) });
    const entry = entryFor(task, [task]);

    const { state: after } = purgeAgedEntries(state({ taskOrder: { today: [entry] } }), [task], NOW);

    expect(after.taskOrder.today).toEqual([entry]);
  });

  it("purges a task completed before today (✅ date is yesterday)", () => {
    const task = makeTask({
      id: "a",
      text: "Done",
      isCompleted: true,
      completedAt: new Date("2026-08-01T00:00:00"),
    });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [task],
      NOW
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([]);
  });

  it("keeps a dateless completion witnessed today via completionSeen", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: null });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({
        taskOrder: { today: [entry] },
        completionSeen: { [`a.md::${entry.key}`]: TODAY_MIDNIGHT + 1000 },
      }),
      [task],
      NOW
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([entry]);
  });

  it("purges a dateless completion with no record at all (unwitnessed → aged)", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: null });
    const entry = entryFor(task, [task]);

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [task],
      NOW
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([]);
  });

  it("keeps an entry whose task is not in the index (never purge on a partial view)", () => {
    const entry = { file: "unloaded.md", key: "k:0" };

    const { state: after, changed } = purgeAgedEntries(
      state({ taskOrder: { today: [entry] } }),
      [],
      NOW
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([entry]);
  });

  it("drops completionSeen records older than today", () => {
    const { state: after, changed } = purgeAgedEntries(
      state({ completionSeen: { "a.md::old:0": YESTERDAY, "a.md::new:0": TODAY_MIDNIGHT } }),
      [],
      NOW
    );

    expect(changed).toBe(true);
    expect(after.completionSeen).toEqual({ "a.md::new:0": TODAY_MIDNIGHT });
  });

  it("leaves legacy flat-string entries untouched", () => {
    const before = state({ taskOrder: { today: ["legacy:0" as unknown as never] } });

    const { state: after, changed } = purgeAgedEntries(before, [], NOW);

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual(["legacy:0"]);
  });
});

describe("reconcileDanglingEntries", () => {
  const always = () => true;
  const never = () => false;

  it("purges an entry whose file no longer exists", () => {
    const entry = { file: "gone.md", key: "k:0" };

    const { state: after, changed } = reconcileDanglingEntries(
      state({ taskOrder: { today: [entry] }, completionSeen: { "gone.md::k:0": 1 } }),
      [],
      never,
      always
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([]);
    expect(after.completionSeen).toEqual({});
  });

  it("purges an entry whose file is in scope and fully parsed but contains no match", () => {
    const task = makeTask({ id: "a", filePath: "a.md", text: "Still here" });
    const stale = { file: "a.md", key: "gone:0" };

    const { state: after, changed } = reconcileDanglingEntries(
      state({ taskOrder: { today: [entryFor(task, [task]), stale] } }),
      [task],
      always,
      always
    );

    expect(changed).toBe(true);
    expect(after.taskOrder.today).toEqual([entryFor(task, [task])]);
  });

  it("keeps an out-of-scope entry dormant — narrowing scope is not deletion", () => {
    const entry = { file: "excluded.md", key: "k:0" };

    const { state: after, changed } = reconcileDanglingEntries(
      state({ taskOrder: { today: [entry] }, completionSeen: { "excluded.md::k:0": 1 } }),
      [],
      always,
      never
    );

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual([entry]);
    expect(after.completionSeen).toEqual({ "excluded.md::k:0": 1 });
  });

  it("still purges a dormant out-of-scope entry once its file is truly deleted", () => {
    const entry = { file: "excluded.md", key: "k:0" };

    const { state: after } = reconcileDanglingEntries(
      state({ taskOrder: { today: [entry] } }),
      [],
      never,
      never
    );

    expect(after.taskOrder.today).toEqual([]);
  });

  it("leaves legacy flat-string entries untouched", () => {
    const before = state({ taskOrder: { today: ["legacy:0" as unknown as never] } });

    const { state: after, changed } = reconcileDanglingEntries(before, [], never, always);

    expect(changed).toBe(false);
    expect(after.taskOrder.today).toEqual(["legacy:0"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=OrderPurge`
Expected: FAIL — `Cannot find module '../src/core/OrderPurge'`.

- [ ] **Step 3: Create `src/core/OrderPurge.ts`**

```ts
import { TaskRecord } from "./TaskParser";
import { completionClock, computeOrderKeys, entryId, isOrderEntry } from "./TaskOrder";
import type { OrderEntry } from "./TaskOrder";
import type { OrderState } from "./OrderMigration";

function startOfDay(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function indexByEntryId(tasks: TaskRecord[]): Map<string, { task: TaskRecord; entry: OrderEntry }> {
  const entries = computeOrderKeys(tasks);
  const result = new Map<string, { task: TaskRecord; entry: OrderEntry }>();
  for (const task of tasks) {
    const entry = entries.get(task.id);
    if (entry) result.set(entryId(entry), { task, entry });
  }
  return result;
}

/**
 * Releases positions held by completions that are no longer "today". Runs on
 * every index change, riding on work that already happens — no timer. An
 * entry is only purged when its task is actually present in the index, so a
 * partially-loaded vault can never cause a loss. A completed task with no
 * clock at all (completion never witnessed by this plugin, no ✅ date) counts
 * as aged, which is what stops it lingering forever.
 */
export function purgeAgedEntries(
  state: OrderState,
  tasks: TaskRecord[],
  now: Date
): { state: OrderState; changed: boolean } {
  const midnight = startOfDay(now);
  const byId = indexByEntryId(tasks);
  let changed = false;

  const taskOrder: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(state.taskOrder)) {
    const kept = entries.filter((entry) => {
      if (!isOrderEntry(entry)) return true;
      const found = byId.get(entryId(entry));
      if (!found || !found.task.isCompleted) return true;
      const clock = completionClock(found.task, entry, state.completionSeen);
      return clock !== null && clock >= midnight;
    });
    if (kept.length !== entries.length) changed = true;
    taskOrder[bucketId] = kept;
  }

  const completionSeen: Record<string, number> = {};
  for (const [id, at] of Object.entries(state.completionSeen)) {
    if (at >= midnight) completionSeen[id] = at;
    else changed = true;
  }

  return { state: { taskOrder, completionSeen }, changed };
}

/**
 * Drops entries whose task is genuinely gone. Only safe once initialScan has
 * resolved, since it needs a complete view of every scoped file. An entry
 * whose file exists but is OUT OF SCOPE is kept dormant: narrowing scope is
 * reversible and must never be treated as a deletion. Dormant entries still
 * go when their file is really deleted.
 */
export function reconcileDanglingEntries(
  state: OrderState,
  tasks: TaskRecord[],
  fileExists: (path: string) => boolean,
  inScope: (path: string) => boolean
): { state: OrderState; changed: boolean } {
  const byId = indexByEntryId(tasks);
  let changed = false;

  const isDangling = (file: string, id: string): boolean => {
    if (!fileExists(file)) return true;
    if (!inScope(file)) return false;
    return !byId.has(id);
  };

  const taskOrder: Record<string, OrderEntry[]> = {};
  for (const [bucketId, entries] of Object.entries(state.taskOrder)) {
    const kept = entries.filter(
      (entry) => !isOrderEntry(entry) || !isDangling(entry.file, entryId(entry))
    );
    if (kept.length !== entries.length) changed = true;
    taskOrder[bucketId] = kept;
  }

  const completionSeen: Record<string, number> = {};
  for (const [id, at] of Object.entries(state.completionSeen)) {
    const separator = id.lastIndexOf("::");
    const file = separator === -1 ? id : id.slice(0, separator);
    if (isDangling(file, id)) changed = true;
    else completionSeen[id] = at;
  }

  return { state: { taskOrder, completionSeen }, changed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=OrderPurge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/OrderPurge.ts tests/OrderPurge.test.ts
git commit -m "feat: evidence-based aged-out and dangling order purges"
```

---

### Task 6: Completion visibility clock

Replaces "no ✅ date ⇒ visible forever" with the real clock. `BucketManager` marks aged completions; the panel and status bar both read that one list.

**Files:**
- Modify: `src/core/BucketManager.ts`
- Modify: `src/main.ts` (`updateStatusBar`)
- Modify: `src/views/GTDPanel.svelte` (pass the new prop)
- Modify: `src/views/BucketGroup.svelte` (visibility filter)
- Test: `tests/BucketManager.test.ts`

**Interfaces:**
- Consumes: `completionClock`, `computeOrderKeys` (`./TaskOrder`); `PluginSettings.completionSeen`.
- Produces: `BucketGroup.agedCompletedTaskIds: string[]` — ids of completed tasks in that group whose clock is `null` or before today's midnight. Consumed by `main.ts` and `BucketGroup.svelte`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/BucketManager.test.ts` — update the `TaskOrder` import line to:

```ts
import { computeOrderKeys, entryId } from "../src/core/TaskOrder";
```

Append this describe block at the end of the file:

```ts
describe("agedCompletedTaskIds", () => {
  // The suite's mocked `today()` is Mon Feb 23 2026 00:00.
  const settings = { ...DEFAULT_SETTINGS, buckets: DEFAULT_BUCKETS };

  it("does not mark an open task", () => {
    const task = makeTask({ id: "a", text: "Open" });
    const groups = groupTasksIntoBuckets([task], settings);
    const review = groups.find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.agedCompletedTaskIds).toEqual([]);
  });

  it("does not mark a task whose ✅ date is today", () => {
    const task = makeTask({
      id: "a",
      text: "Done",
      isCompleted: true,
      completedAt: new Date("2026-02-23T00:00:00"),
    });
    const review = groupTasksIntoBuckets([task], settings).find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.agedCompletedTaskIds).toEqual([]);
  });

  it("marks a task whose ✅ date is before today", () => {
    const task = makeTask({
      id: "a",
      text: "Done",
      isCompleted: true,
      completedAt: new Date("2026-02-22T00:00:00"),
    });
    const review = groupTasksIntoBuckets([task], settings).find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.agedCompletedTaskIds).toEqual(["a"]);
  });

  it("marks a dateless completion with no witnessed record", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: null });
    const review = groupTasksIntoBuckets([task], settings).find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.agedCompletedTaskIds).toEqual(["a"]);
  });

  it("does not mark a dateless completion witnessed today", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: null });
    const entry = computeOrderKeys([task]).get("a")!;
    const withRecord = {
      ...settings,
      completionSeen: { [entryId(entry)]: new Date("2026-02-23T09:00:00").getTime() },
    };

    const review = groupTasksIntoBuckets([task], withRecord).find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.agedCompletedTaskIds).toEqual([]);
  });

  it("marks a dateless completion whose witnessed record is from before today", () => {
    const task = makeTask({ id: "a", text: "Done", isCompleted: true, completedAt: null });
    const entry = computeOrderKeys([task]).get("a")!;
    const withRecord = {
      ...settings,
      completionSeen: { [entryId(entry)]: new Date("2026-02-22T09:00:00").getTime() },
    };

    const review = groupTasksIntoBuckets([task], withRecord).find((g) => g.bucketId === TO_REVIEW_ID)!;
    expect(review.agedCompletedTaskIds).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=BucketManager`
Expected: FAIL — `agedCompletedTaskIds` is undefined on the group.

- [ ] **Step 3: Implement in `src/core/BucketManager.ts`**

Change the `TaskOrder` import to:

```ts
import { computeOrderKeys, applyManualOrder, completionClock } from "./TaskOrder";
```

Add the field to the `BucketGroup` interface, after `autoPlacedTaskIds`:

```ts
  /** Completed tasks whose completion clock is before today's midnight (or
   *  missing entirely) — hidden by the until-midnight visibility filter. */
  agedCompletedTaskIds: string[];
```

Add `agedCompletedTaskIds: [],` to **both** object literals that build a `BucketGroup` (the `TO_REVIEW_ID` one and the `for (const b of settings.buckets)` one), right after `autoPlacedTaskIds: [],`.

Replace the existing manual-order loop with:

```ts
  const orderKeys = computeOrderKeys(tasks);
  const completionSeen = settings.completionSeen ?? {};
  const midnight = now.getTime();
  for (const group of bucketMap.values()) {
    const saved = settings.taskOrder?.[group.bucketId];
    if (saved && saved.length > 0) {
      group.tasks = applyManualOrder(group.tasks, orderKeys, saved);
    }
    group.tasks = regroupByHierarchy(group.tasks);

    for (const task of group.tasks) {
      if (!task.isCompleted) continue;
      const clock = completionClock(task, orderKeys.get(task.id), completionSeen);
      if (clock === null || clock < midnight) group.agedCompletedTaskIds.push(task.id);
    }
  }
```

(`now` is `today()` — already midnight-normalised at the top of `groupTasksIntoBuckets`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=BucketManager`
Expected: PASS.

- [ ] **Step 5: Update the status bar in `src/main.ts`**

In `updateStatusBar()`, replace the `if (this.settings.completedVisibilityUntilMidnight) { ... }` block with:

```ts
      if (this.settings.completedVisibilityUntilMidnight) {
        const aged = new Set(group.agedCompletedTaskIds);
        total = active + group.tasks.filter((t) => t.isCompleted && !aged.has(t.id)).length;
      }
```

The local `const midnight = new Date(); midnight.setHours(0,0,0,0);` inside this block is now unused — delete it.

- [ ] **Step 6: Update `src/views/BucketGroup.svelte`**

Add a prop after `export let autoPlacedTaskIds: string[] = [];`:

```ts
  export let agedCompletedTaskIds: string[] = [];
```

Add next to the existing `$: staleSet`/`$: autoPlacedSet` lines:

```ts
  $: agedSet = new Set(agedCompletedTaskIds);
```

Replace the `$: visibleTasks = (() => { ... })();` block with:

```ts
  $: visibleTasks = tasks.filter((t) => {
    if (dismissedIds.has(t.id)) return false;
    if (!t.isCompleted) return true;
    if (!showCompletedUntilMidnight) return false;
    return !agedSet.has(t.id);
  });
```

- [ ] **Step 7: Update `src/views/GTDPanel.svelte`**

In the `<BucketGroup ... />` element, add after the `autoPlacedTaskIds={group.autoPlacedTaskIds}` line:

```svelte
        agedCompletedTaskIds={group.agedCompletedTaskIds}
```

- [ ] **Step 8: Verify the build**

Run: `npm test`
Expected: PASS (all suites).

Run: `npm run build`
Expected: exits 0, `main.js` rebuilt.

- [ ] **Step 9: Commit**

```bash
git add src/core/BucketManager.ts src/main.ts src/views/BucketGroup.svelte src/views/GTDPanel.svelte tests/BucketManager.test.ts
git commit -m "feat: hide completed tasks by real completion clock"
```

---

### Task 7: TaskIndex change and rename hooks

Gives `main.ts` the old parse alongside the new one, and a rename notification that fires *before* the scope check so a "specific files" scope path can be updated first.

**Files:**
- Modify: `src/core/TaskIndex.ts`
- Test: `tests/TaskIndex.test.ts`

**Interfaces:**
- Consumes: `isPathInScope` (`../settings`, from Task 1).
- Produces:
  - `TaskIndex.onFileReplaced(cb: (filePath: string, oldTasks: TaskRecord[], newTasks: TaskRecord[]) => void): () => void`
  - `TaskIndex.onRename(cb: (oldPath: string, newPath: string) => void): () => void`

- [ ] **Step 1: Write the failing tests**

In `tests/TaskIndex.test.ts`, extend `makeMockEnv` so vault events can be fired. Replace the `const app = { ... }` block and the `return { ... }` block with:

```ts
  let changedCb: ((file: TFile, data: string) => void) | null = null;
  const vaultCbs = new Map<string, (file: TFile, oldPath?: string) => void>();

  const app = {
    vault: {
      getMarkdownFiles: () => Array.from(tfiles.values()),
      getAbstractFileByPath: (path: string) => tfiles.get(path) ?? null,
      cachedRead: async (file: TFile) => contents.get(file.path) ?? "",
      on: (event: string, cb: (file: TFile, oldPath?: string) => void) => {
        vaultCbs.set(event, cb);
        return {};
      },
    },
    metadataCache: {
      on: (event: string, cb: (file: TFile, data: string) => void) => {
        if (event === "changed") changedCb = cb;
        return {};
      },
    },
  } as any;

  const plugin = { registerEvent: (_ref: any) => {} } as any;

  return {
    app,
    plugin,
    /** Simulates a file write followed by Obsidian's own async metadataCache
     * "changed" event firing for it (what happens on disk edits we didn't
     * make ourselves, or the redundant event after ones we did). */
    fireChanged(path: string, content: string) {
      contents.set(path, content);
      if (!tfiles.has(path)) tfiles.set(path, makeTFile(path));
      changedCb?.(tfiles.get(path)!, content);
    },
    setContentSilently(path: string, content: string) {
      contents.set(path, content);
    },
    async fireRename(oldPath: string, newPath: string) {
      const content = contents.get(oldPath) ?? "";
      contents.delete(oldPath);
      tfiles.delete(oldPath);
      contents.set(newPath, content);
      tfiles.set(newPath, makeTFile(newPath));
      await (vaultCbs.get("rename") as any)?.(tfiles.get(newPath)!, oldPath);
    },
  };
```

Append these tests inside the existing `describe("TaskIndex", ...)`:

```ts
  it("hands onFileReplaced the previous parse alongside the new one", async () => {
    const { app, plugin, fireChanged } = makeMockEnv({ "a.md": "- [ ] Old text" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    const seen: Array<{ path: string; old: string[]; next: string[] }> = [];
    index.onFileReplaced((path, oldTasks, newTasks) => {
      seen.push({
        path,
        old: oldTasks.map((t) => t.text),
        next: newTasks.map((t) => t.text),
      });
    });

    fireChanged("a.md", "- [ ] New text");

    expect(seen).toEqual([{ path: "a.md", old: ["Old text"], next: ["New text"] }]);
  });

  it("does not fire onFileReplaced when the changed event reports already-indexed content", async () => {
    const { app, plugin, fireChanged } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    let calls = 0;
    index.onFileReplaced(() => calls++);

    fireChanged("a.md", "- [ ] Task A");

    expect(calls).toBe(0);
  });

  it("notifies rename listeners before applying the scope check", async () => {
    let scopePaths = ["old.md"];
    const { app, plugin, fireRename } = makeMockEnv({ "old.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => ({ type: "files", paths: scopePaths }));
    index.registerVaultEvents();
    await index.initialScan();

    index.onRename((oldPath, newPath) => {
      scopePaths = scopePaths.map((p) => (p === oldPath ? newPath : p));
    });

    await fireRename("old.md", "new.md");

    expect(index.getAllTasks().map((t) => t.filePath)).toEqual(["new.md"]);
  });

  it("returns an unsubscribe function from onFileReplaced", async () => {
    const { app, plugin, fireChanged } = makeMockEnv({ "a.md": "- [ ] Task A" });
    const index = new TaskIndex(app, plugin, () => vaultScope);
    index.registerVaultEvents();
    await index.initialScan();

    let calls = 0;
    const off = index.onFileReplaced(() => calls++);
    off();

    fireChanged("a.md", "- [ ] Task B");

    expect(calls).toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=TaskIndex`
Expected: FAIL — `index.onFileReplaced is not a function`.

- [ ] **Step 3: Implement in `src/core/TaskIndex.ts`**

Change the imports at the top to:

```ts
import { App, TFile, Plugin } from "obsidian";
import { parseFile, TaskRecord } from "./TaskParser";
import { TaskScope, isPathInScope } from "../settings";
import { hashString } from "./TaskOrder";

type ChangeCallback = (allTasks: TaskRecord[]) => void;
type FileReplacedCallback = (
  filePath: string,
  oldTasks: TaskRecord[],
  newTasks: TaskRecord[]
) => void;
type RenameCallback = (oldPath: string, newPath: string) => void;
```

Add these fields next to `private listeners: ChangeCallback[] = [];`:

```ts
  private fileReplacedListeners: FileReplacedCallback[] = [];
  private renameListeners: RenameCallback[] = [];
```

Add these methods right after `onChange`:

```ts
  /**
   * Fires when an external edit replaces a file's parse, with the parse it
   * replaced. Consumers diff the two to migrate saved order through in-place
   * edits and to witness completion transitions. Fires before onChange, so
   * the refresh that follows already sees migrated order.
   */
  onFileReplaced(cb: FileReplacedCallback): () => void {
    this.fileReplacedListeners.push(cb);
    return () => {
      const idx = this.fileReplacedListeners.indexOf(cb);
      if (idx !== -1) this.fileReplacedListeners.splice(idx, 1);
    };
  }

  /**
   * Fires at the very top of the rename handler — before the new path is
   * scope-checked — so a listener can update a "specific files" scope list
   * and keep the file indexed across the rename.
   */
  onRename(cb: RenameCallback): () => void {
    this.renameListeners.push(cb);
    return () => {
      const idx = this.renameListeners.indexOf(cb);
      if (idx !== -1) this.renameListeners.splice(idx, 1);
    };
  }
```

In `registerVaultEvents`, replace the body of the `metadataCache.on("changed", ...)` handler with:

```ts
        if (this.isInScope(file)) {
          const hash = hashString(data);
          if (this.contentHashes.get(file.path) === hash) return;
          this.contentHashes.set(file.path, hash);
          const oldTasks = this.index.get(file.path) ?? [];
          const tasks = parseFile(file.path, data);
          this.index.set(file.path, tasks);
          for (const cb of this.fileReplacedListeners) cb(file.path, oldTasks, tasks);
          this.emit();
        }
```

In the `vault.on("rename", ...)` handler, insert the notification immediately after the `TFile` guard:

```ts
        if (!(file instanceof TFile)) return;
        for (const cb of this.renameListeners) cb(oldPath, file.path);
        const wasIndexed = this.index.has(oldPath);
```

Replace the private `isInScope` method with:

```ts
  private isInScope(file: TFile): boolean {
    return file.extension === "md" && isPathInScope(file.path, this.getScope());
  }
```

Replace `getScopedFiles` with:

```ts
  private getScopedFiles(): TFile[] {
    const scope = this.getScope();
    return this.app.vault.getMarkdownFiles().filter((f) => isPathInScope(f.path, scope));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=TaskIndex`
Expected: PASS.

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/core/TaskIndex.ts tests/TaskIndex.test.ts
git commit -m "feat: expose file-replaced and rename hooks from TaskIndex"
```

---

### Task 8: Delegate the completion toggle to the Tasks plugin

**Files:**
- Modify: `src/core/TaskWriter.ts`
- Modify: `src/main.ts` (`handleToggle` call site)
- Test: `tests/TaskWriter.test.ts`

**Interfaces:**
- Produces:
  - `interface TasksPluginApiV1 { executeToggleTaskDoneCommand: (line: string, path: string) => string }`
  - `getTasksApi(app: App): TasksPluginApiV1 | null`
  - `toggleTaskLine(rawLine: string, filePath: string, isCompleted: boolean, api: TasksPluginApiV1 | null): string[]`
  - `toggleTaskCompletion(app: App, task: TaskRecord): Promise<MoveResult>` — **signature change**: the `settings` parameter is dropped, since nothing in the toggle reads settings any more. Its one call site is `GtdPanelView.handleToggle` in `src/main.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/TaskWriter.test.ts`, update the first import line to:

```ts
import { findTaskLine, moveTaskToBucket, toggleTaskCompletion, confirmTaskPlacement, toggleTaskLine } from "../src/core/TaskWriter";
```

Replace the whole existing `describe("toggleTaskCompletion", ...)` block (the one using `readTasksPlugin`) with:

```ts
describe("toggleTaskLine", () => {
  it("delegates to the Tasks API when present and returns its line", () => {
    const api = {
      executeToggleTaskDoneCommand: jest.fn(() => "- [x] Test task ✅ 2026-08-02"),
    };

    const result = toggleTaskLine("- [ ] Test task", "test.md", false, api);

    expect(api.executeToggleTaskDoneCommand).toHaveBeenCalledWith("- [ ] Test task", "test.md");
    expect(result).toEqual(["- [x] Test task ✅ 2026-08-02"]);
  });

  it("returns both lines when Tasks expands a recurring task into two", () => {
    const api = {
      executeToggleTaskDoneCommand: () => "- [ ] Water plants 🔁 every week 📅 2026-08-09\n- [x] Water plants 🔁 every week 📅 2026-08-02 ✅ 2026-08-02",
    };

    const result = toggleTaskLine("- [ ] Water plants 🔁 every week 📅 2026-08-02", "test.md", false, api);

    expect(result).toHaveLength(2);
  });

  it("returns no lines when Tasks deletes the task on completion", () => {
    const api = { executeToggleTaskDoneCommand: () => "" };

    expect(toggleTaskLine("- [ ] Throwaway 🏁 delete", "test.md", false, api)).toEqual([]);
  });

  it("also delegates when reopening a completed task", () => {
    const api = { executeToggleTaskDoneCommand: jest.fn(() => "- [ ] Test task") };

    expect(toggleTaskLine("- [x] Test task ✅ 2026-08-02", "test.md", true, api)).toEqual([
      "- [ ] Test task",
    ]);
    expect(api.executeToggleTaskDoneCommand).toHaveBeenCalled();
  });

  it("falls back to a minimal flip when the API throws", () => {
    const api = {
      executeToggleTaskDoneCommand: () => {
        throw new Error("boom");
      },
    };

    expect(toggleTaskLine("- [ ] Test task", "test.md", false, api)).toEqual(["- [x] Test task"]);
  });

  it("flips the checkbox and writes no date when Tasks is absent", () => {
    expect(toggleTaskLine("- [ ] Test task", "test.md", false, null)).toEqual(["- [x] Test task"]);
  });

  it("clears the checkbox and strips an existing ✅ date on reopen when Tasks is absent", () => {
    expect(toggleTaskLine("- [x] Test task ✅ 2026-08-02", "test.md", true, null)).toEqual([
      "- [ ] Test task",
    ]);
  });

  it("preserves other metadata on the line in the fallback path", () => {
    expect(toggleTaskLine("- [ ] Test task 📅 2026-08-09 #gtd/today", "test.md", false, null)).toEqual([
      "- [x] Test task 📅 2026-08-09 #gtd/today",
    ]);
  });
});

describe("toggleTaskCompletion", () => {
  it("checks an open task without writing a date (no Tasks plugin)", async () => {
    const { app, getContent } = makeMockApp("- [ ] Test task");
    const task = makeTask({ rawLine: "- [ ] Test task" });

    const result = await toggleTaskCompletion(app, task);

    expect(result.success).toBe(true);
    expect(getContent()).toBe("- [x] Test task");
  });

  it("unchecks a completed task and strips its ✅ date", async () => {
    const { app, getContent } = makeMockApp("- [x] Test task ✅ 2026-08-02");
    const task = makeTask({
      rawLine: "- [x] Test task ✅ 2026-08-02",
      isCompleted: true,
    });

    const result = await toggleTaskCompletion(app, task);

    expect(result.success).toBe(true);
    expect(getContent()).toBe("- [ ] Test task");
  });

  it("fails cleanly when the task line can't be located", async () => {
    const { app } = makeMockApp("- [ ] Something else");
    const task = makeTask({ rawLine: "- [ ] Test task", lineNumber: 5 });

    expect((await toggleTaskCompletion(app, task)).success).toBe(false);
  });
});
```

> Check the existing file first: keep whichever of these `toggleTaskCompletion` cases already exist rather than duplicating them, and delete only the assertions that depended on `readTasksPlugin`. If `DEFAULT_SETTINGS` ends up unused in the file after this edit, leave the import — `moveTaskToBucket`'s own describes still use it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=TaskWriter`
Expected: FAIL — `toggleTaskLine` is not exported.

- [ ] **Step 3: Implement in `src/core/TaskWriter.ts`**

Remove the now-unused import of `formatDate`:

```ts
import { setTagValue, setInlineFieldValue } from "./TaskParser";
```

(delete the `import { formatDate } from "../integrations/TasksPluginParser";` line entirely.)

Add after the `MoveResult` interface:

```ts
/** The subset of the Tasks plugin's documented apiV1 that this plugin uses. */
export interface TasksPluginApiV1 {
  executeToggleTaskDoneCommand: (line: string, path: string) => string;
}

/** The Tasks community plugin's apiV1, if it is installed and enabled. */
export function getTasksApi(app: App): TasksPluginApiV1 | null {
  const plugins = (app as App & {
    plugins?: { plugins?: Record<string, { apiV1?: TasksPluginApiV1 }> };
  }).plugins;
  const api = plugins?.plugins?.["obsidian-tasks-plugin"]?.apiV1;
  return typeof api?.executeToggleTaskDoneCommand === "function" ? api : null;
}

/**
 * The line(s) that replace `rawLine` when its checkbox is toggled. Delegates
 * to Tasks whenever it is installed, for both completing and reopening, so
 * the panel behaves exactly like the editor does on the same device: Tasks
 * applies its own ✅-date setting, global filter, 🔁 recurrence (two lines
 * back) and 🏁 on-completion delete (no lines back). Without Tasks — or if
 * the call fails — this flips the checkbox and writes no date; visibility
 * still works, via the witnessed completionSeen clock.
 */
export function toggleTaskLine(
  rawLine: string,
  filePath: string,
  isCompleted: boolean,
  api: TasksPluginApiV1 | null
): string[] {
  if (api) {
    try {
      const result = api.executeToggleTaskDoneCommand(rawLine, filePath);
      if (typeof result === "string") return result === "" ? [] : result.split("\n");
    } catch {
      // Fall through to the minimal flip — a valid outcome, not an error.
    }
  }

  if (isCompleted) {
    return [
      rawLine
        .replace(/\[[ xX]\]/, "[ ]")
        .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "")
        .trimEnd(),
    ];
  }
  return [rawLine.replace(/\[ \]/, "[x]")];
}
```

Replace the body of `toggleTaskCompletion`'s `vault.process` callback:

```ts
export async function toggleTaskCompletion(
  app: App,
  task: TaskRecord
): Promise<MoveResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) {
    return { success: false, error: `File not found: ${task.filePath}` };
  }

  const api = getTasksApi(app);
  let result: MoveResult = { success: false, error: "Task line not found in file (stale index)" };

  try {
    await app.vault.process(file, (content) => {
      const lines = content.split("\n");
      const lineIdx = findTaskLine(lines, task);

      if (lineIdx === -1) {
        new Notice(`GTD Tasks: Could not locate task in ${file.basename}.`);
        return content;
      }

      lines.splice(lineIdx, 1, ...toggleTaskLine(lines[lineIdx], task.filePath, task.isCompleted, api));
      result = { success: true };
      return lines.join("\n");
    });
    return result;
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
```

- [ ] **Step 4: Update the one call site in `src/main.ts`**

In `GtdPanelView.handleToggle`, replace:

```ts
    const result = await toggleTaskCompletion(
      this.app,
      task,
      this.plugin.settings
    );
```

with:

```ts
    const result = await toggleTaskCompletion(this.app, task);
```

- [ ] **Step 5: Run tests and lint**

Run: `npm test -- --testPathPattern=TaskWriter`
Expected: PASS.

Run: `npm run lint`
Expected: exits 0.

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/core/TaskWriter.ts src/main.ts tests/TaskWriter.test.ts
git commit -m "feat: delegate panel completion toggle to the Tasks plugin API"
```

---

### Task 9: Remove the `readTasksPlugin` setting

📅/✅ parsing and due-date auto-assign become always-on. Per-bucket opt-out already exists via `dateRangeRule: null`.

**Files:**
- Modify: `src/settings.ts` (field, default, `migrateSettingsData`)
- Modify: `src/core/BucketManager.ts` (auto-assign gate)
- Modify: `src/settings-tab.ts` (delete the toggle)
- Modify: `src/i18n/locales/*.json` (all 14 files: remove `settings.tasksPlugin`)
- Modify: `README.md`
- Test: `tests/settings.test.ts`, `tests/BucketManager.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PluginSettings` no longer has `readTasksPlugin`; `migrateSettingsData` strips it from loaded data.

- [ ] **Step 1: Write the failing tests**

Add to `describe("migrateSettingsData", ...)` in `tests/settings.test.ts`:

```ts
  it("drops the removed readTasksPlugin field", () => {
    expect(migrateSettingsData({ scopeType: "vault", readTasksPlugin: true })).toEqual({
      scopeType: "vault",
    });
  });

  it("drops readTasksPlugin while also migrating a legacy taskScope", () => {
    expect(migrateSettingsData({ taskScope: { type: "vault" }, readTasksPlugin: false })).toEqual({
      scopeType: "vault",
    });
  });
```

In `tests/BucketManager.test.ts`, replace the test named `"readTasksPlugin=false: tasks with dueDate go to To Review (no auto-assign)"` (and its `settingsNoPlugin` local) with:

```ts
  it("auto-assigns by due date with no toggle to gate it", () => {
    const task = makeTask({ dueDate: daysFromMonday(0) });
    const groups = groupTasksIntoBuckets([task], settings);
    expect(groups.find((g) => g.bucketId === "today")!.tasks).toHaveLength(1);
  });

  it("does not auto-assign into a bucket whose dateRangeRule is null", () => {
    const noRuleBuckets = DEFAULT_BUCKETS.map((b) => ({ ...b, dateRangeRule: null }));
    const task = makeTask({ dueDate: daysFromMonday(0) });

    const groups = groupTasksIntoBuckets([task], { ...settings, buckets: noRuleBuckets });

    expect(groups.find((g) => g.bucketId === TO_REVIEW_ID)!.tasks).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="settings|BucketManager"`
Expected: FAIL — `migrateSettingsData` still returns `readTasksPlugin`.

- [ ] **Step 3: Remove the field from `src/settings.ts`**

Delete these two lines (declaration + default):

```ts
  /** If true, read 📅 / ✅ metadata from the Tasks plugin. */
  readTasksPlugin: boolean;
```
```ts
  readTasksPlugin: true,
```

Replace `migrateSettingsData` with:

```ts
/**
 * Normalizes raw loaded plugin data. Two migrations live here:
 * the pre-persistence `taskScope: {type, paths}` object is split into
 * scopeType/folderPaths/filePaths (seeded once, without losing the user's
 * existing selections), and the removed `readTasksPlugin` field is dropped —
 * 📅/✅ parsing and due-date auto-assign are unconditional now.
 */
export function migrateSettingsData(raw: unknown): Partial<PluginSettings> {
  if (!raw || typeof raw !== "object") return {};
  const data = { ...(raw as Record<string, unknown> & { taskScope?: LegacyTaskScope }) };
  delete data.readTasksPlugin;

  if (!data.taskScope || "scopeType" in data) return data as Partial<PluginSettings>;

  const { taskScope, ...rest } = data;
  const migrated: Partial<PluginSettings> = { ...rest, scopeType: taskScope.type };
  if (taskScope.type === "folders") migrated.folderPaths = taskScope.paths ?? [];
  if (taskScope.type === "files") migrated.filePaths = taskScope.paths ?? [];
  return migrated;
}
```

- [ ] **Step 4: Remove the gate in `src/core/BucketManager.ts`**

Replace:

```ts
    if (task.dueDate && settings.readTasksPlugin) {
```

with:

```ts
    if (task.dueDate) {
```

- [ ] **Step 5: Remove the toggle from `src/settings-tab.ts`**

Delete this entire block from `renderGeneralSection` (currently around line 454):

```ts
    // Read Tasks plugin
    const pluginName: string = "Tasks";
    new Setting(containerEl)
      .setName(t("settings.tasksPlugin.name", { pluginName }))
      .setDesc(t("settings.tasksPlugin.description", { pluginName }))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.readTasksPlugin);
        tog.onChange(async (val) => {
          this.plugin.settings.readTasksPlugin = val;
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
        });
      });
```

- [ ] **Step 6: Remove the i18n keys**

Delete the `"tasksPlugin": { ... }` object (including its `_comment`) from the `"settings"` section of **every** file in `src/i18n/locales/`: `en.json`, `de.json`, `es.json`, `et.json`, `fr.json`, `ja.json`, `ko.json`, `lt.json`, `lv.json`, `pt.json`, `ru.json`, `uk.json`, `zh.json`, and `sample_lang.json`.

Watch the trailing comma on the line before/after so each file stays valid JSON.

Run: `npm run validate-translations`
Expected: ✅ for every locale, exit 0. If a locale reports `extra: settings.tasksPlugin.*`, you missed that file.

- [ ] **Step 7: Update `README.md`**

Replace line 21:

```markdown
- **Tasks plugin integration** — reads 📅 due dates and auto-assigns tasks to the matching bucket
```

with:

```markdown
- **Tasks plugin integration** — reads 📅 due dates, auto-assigns tasks to the matching bucket, and hands completion toggles to the Tasks plugin when it's installed
```

Replace the "Tasks plugin integration" section body (line 121) with:

```markdown
The plugin always reads `📅 YYYY-MM-DD` due dates written by the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) community plugin and automatically assigns tasks to the matching time-horizon bucket. Manual assignments (tag/field) always take priority over date-based ones. To opt a bucket out of date-based assignment, clear its date rule in the bucket settings.

When the Tasks plugin is installed, checking a task off in the panel runs Tasks' own toggle command, so the panel behaves exactly like the editor does — including its ✅-date setting, `🔁` recurrence and `🏁 delete` on-completion actions. Without the Tasks plugin, the panel flips the checkbox and writes no date.

> **Behavior change:** earlier versions wrote a `✅` date on panel completions even without the Tasks plugin installed. They no longer do. Completed tasks still stay visible until midnight — the plugin remembers dateless completions it witnessed rather than relying on a date in the file.
```

- [ ] **Step 8: Run tests and build**

Run: `npm test`
Expected: PASS (all suites).

Run: `npm run build`
Expected: exits 0 (translations valid, tsc clean, lint clean).

- [ ] **Step 9: Commit**

```bash
git add src/settings.ts src/core/BucketManager.ts src/settings-tab.ts src/i18n/locales README.md tests/settings.test.ts tests/BucketManager.test.ts
git commit -m "feat: make Tasks plugin metadata parsing unconditional"
```

---

### Task 10: Wire it all together in `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `diffFileTasks`, `applyTaskDiff`, `renameFileInState`, `migrateOrderFormat`, `OrderState` (`./core/OrderMigration`); `purgeAgedEntries`, `reconcileDanglingEntries` (`./core/OrderPurge`); `isPathInScope`, `getActiveScope` (`./settings`); `TaskIndex.onFileReplaced` / `onRename` (Task 7).
- Produces: no new exports. Behaviour only.

There are no unit tests for `main.ts` (it is pure Obsidian-API glue — repo convention). Verify by typecheck, build, and the manual QA in Task 11.

- [ ] **Step 1: Add the imports**

In `src/main.ts`, replace the settings import line with:

```ts
import { PluginSettings, DEFAULT_SETTINGS, DEFAULT_BUCKETS, getActiveScope, isPathInScope, migrateSettingsData } from "./settings";
```

and add after the existing `TaskOrder` import:

```ts
import { diffFileTasks, applyTaskDiff, renameFileInState, migrateOrderFormat } from "./core/OrderMigration";
import type { OrderState } from "./core/OrderMigration";
import { purgeAgedEntries, reconcileDanglingEntries } from "./core/OrderPurge";
```

- [ ] **Step 2: Add the state fields and helpers to `GtdTasksPlugin`**

Add next to the existing private fields:

```ts
  /** Set when an event handler has changed order state that isn't saved yet. */
  private orderStateDirty = false;
  /** False until startup reconciliation has run against a complete vault view. */
  private orderStateReady = false;
```

Add these methods (place them after `refreshIndex()`):

```ts
  private orderState(): OrderState {
    return {
      taskOrder: this.settings.taskOrder,
      completionSeen: this.settings.completionSeen,
    };
  }

  private applyOrderState(state: OrderState): void {
    this.settings.taskOrder = state.taskOrder;
    this.settings.completionSeen = state.completionSeen;
  }

  /**
   * Per-index-change housekeeping. The aged-out purge rides on work that
   * already happens on every refresh, so nothing needs a timer. It stays off
   * until reconcileOrderState() has run: purging against a partially-scanned
   * vault would discard positions for files that simply hadn't loaded yet.
   */
  private async handleIndexChanged(): Promise<void> {
    if (this.orderStateReady) {
      const purged = purgeAgedEntries(this.orderState(), this.taskIndex.getAllTasks(), new Date());
      if (purged.changed) {
        this.applyOrderState(purged.state);
        this.orderStateDirty = true;
      }
    }

    if (this.orderStateDirty) {
      this.orderStateDirty = false;
      await this.saveSettings();
      return;
    }

    this.panelView?.refresh();
    this.updateStatusBar();
  }

  /**
   * One-time startup pass, run only after initialScan resolves so the vault
   * view is complete: upgrades pre-0.2 flat keys to structured entries, drops
   * entries whose task is genuinely gone (keeping out-of-scope ones dormant),
   * and runs the first aged-out purge.
   */
  private async reconcileOrderState(): Promise<void> {
    const tasks = this.taskIndex.getAllTasks();
    const scope = getActiveScope(this.settings);

    const migrated = migrateOrderFormat(
      this.settings.taskOrder as unknown as Record<string, unknown[]>,
      tasks
    );
    const reconciled = reconcileDanglingEntries(
      { taskOrder: migrated.taskOrder, completionSeen: this.settings.completionSeen },
      tasks,
      (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      (path) => isPathInScope(path, scope)
    );
    const purged = purgeAgedEntries(reconciled.state, tasks, new Date());

    this.applyOrderState(purged.state);
    this.orderStateReady = true;

    if (migrated.changed || reconciled.changed || purged.changed || this.orderStateDirty) {
      this.orderStateDirty = false;
      await this.saveSettings();
    } else {
      this.panelView?.refresh();
    }
  }
```

- [ ] **Step 3: Register the handlers in `onload()`**

Replace the existing block:

```ts
    this.taskIndex.registerVaultEvents();

    this.taskIndex.onChange(() => {
      this.panelView?.refresh();
      this.updateStatusBar();
    });

    this.app.workspace.onLayoutReady(async () => {
      await this.activateView();
      await this.taskIndex.initialScan();
      this.updateStatusBar();
    });
```

with:

```ts
    this.taskIndex.registerVaultEvents();

    this.taskIndex.onFileReplaced((filePath, oldTasks, newTasks) => {
      const diff = diffFileTasks(oldTasks, newTasks);
      const applied = applyTaskDiff(this.orderState(), filePath, diff, Date.now());
      if (applied.changed) {
        this.applyOrderState(applied.state);
        this.orderStateDirty = true;
      }
    });

    // Fires before TaskIndex scope-checks the new path, so updating a
    // "specific files" scope list here keeps the file indexed across a rename.
    this.taskIndex.onRename((oldPath, newPath) => {
      const renamed = renameFileInState(this.orderState(), oldPath, newPath);
      if (renamed.changed) {
        this.applyOrderState(renamed.state);
        this.orderStateDirty = true;
      }
      const idx = this.settings.filePaths.indexOf(oldPath);
      if (idx !== -1) {
        this.settings.filePaths[idx] = newPath;
        this.orderStateDirty = true;
      }
    });

    this.taskIndex.onChange(() => {
      void this.handleIndexChanged();
    });

    this.app.workspace.onLayoutReady(async () => {
      await this.activateView();
      await this.taskIndex.initialScan();
      await this.reconcileOrderState();
      this.updateStatusBar();
    });
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no output.

Run: `npm run build`
Expected: exits 0.

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire order migration, purge and reconciliation into the plugin"
```

---

### Task 11: End-to-end verification

Every automated check plus the manual scenarios that no unit test covers (Svelte rendering, real Obsidian events, real Tasks plugin).

**Files:** none modified unless a check fails.

- [ ] **Step 1: Full automated verification**

Run each and confirm the stated result before moving on:

```bash
npm test
```
Expected: all suites pass, zero failures.

```bash
npm run build
```
Expected: exits 0 — `validate-translations` prints ✅ for every locale, `tsc -noEmit` silent, `eslint src/` clean, `main.js` written.

- [ ] **Step 2: Manual QA in Obsidian**

Symlink the repo into `<vault>/.obsidian/plugins/gtd-tasks/`, run `npm run dev`, and enable the Hot Reload plugin. Work through this list, checking each off:

- [ ] **Upgrade is lossless (format migration).** Before installing this build, on the previous version, manually order 3+ tasks in a bucket. Install this build, restart Obsidian, confirm the order is unchanged and `data.json`'s `taskOrder` now holds `{file, key}` objects.
- [ ] **1.1 Text edit keeps position.** Manually order 3 tasks. Edit the middle one's text in the editor. It stays in the middle.
- [ ] **Due-date edit keeps position.** Same setup; change the middle task's 📅 date instead. It stays in the middle.
- [ ] **2.1 Rename keeps order.** Rename the file containing ordered tasks. Order survives; `data.json` shows the new path in the `file` fields.
- [ ] **2.2 Rename under "specific files" scope.** Set scope to a specific file, rename it, confirm the file is still indexed and `settings.filePaths` shows the new path.
- [ ] **3.1 Toggling never moves a task.** Check and uncheck a middle task; it does not move.
- [ ] **3.3 Same-day reopen restores.** Check a task, let it grey out, uncheck it — same position, still visible.
- [ ] **Completion visibility without Tasks installed.** Disable the Tasks plugin. Check a task in the panel: no ✅ date is written to the file, and the task stays visible (strikethrough) until midnight.
- [ ] **3.4 Aged completions release position.** With a task completed yesterday (edit its ✅ date to yesterday by hand), reload: it disappears from the panel and its entry is gone from `data.json`.
- [ ] **Unwitnessed completion hides immediately.** With Obsidian closed, mark a task `[x]` in an external editor with no ✅ date. Reopen Obsidian: it does not appear in the panel.
- [ ] **Tasks plugin delegation.** Enable Tasks. Check a task in the panel — the line matches exactly what Tasks writes when you check the same task in the editor (✅ date per Tasks' own setting). Check a `🔁 every week` task — a new occurrence line appears. Uncheck a completed task — Tasks' reopen behaviour applies.
- [ ] **4.1 Deleted tasks are cleaned up.** Manually order tasks, delete one from the file, restart Obsidian, confirm its entry is gone from `data.json`.
- [ ] **4.4 Narrowing scope is not deletion.** Order tasks in a file, narrow the scope to exclude that file, restart, re-widen the scope. The original order is restored.
- [ ] **Auto-assign has no toggle.** Confirm the "Read Tasks plugin metadata" toggle is gone from settings and that a 📅-dated task still lands in its matching bucket.
- [ ] **Cross-bucket drag still works.** Drag a parent task with same-bucket children to another bucket; children follow, order sticks.

- [ ] **Step 3: Report**

Summarize results: which manual checks passed, and the exact symptom of any that did not. Do not claim completion for a check that was not actually run.

---

## Deferred / out of scope

Named here so a reviewer doesn't flag them as gaps — both are recorded in the spec and in repo-root `TODO.md`:

- Storing bucket assignment itself in plugin data (blocked on this design landing first).
- The single-pass metadata-stripping parser rewrite and the disambiguator extension that depends on it. The hard invariant above still applies when that lands.

## Accepted losses (agreed in the spec, do not "fix")

- External-tool file moves (delete + create, no rename event) reset that file's saved order.
- Bulk multi-task edits inside one debounce window may append instead of migrate.
- Editing one of several identical tasks can shuffle occurrence indexes.
- Dateless completions performed while Obsidian was closed hide immediately.
- Non-Tasks users no longer get ✅ dates written by the panel.
