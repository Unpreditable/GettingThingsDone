# Tasks-plugin metadata: single-pass scanning, structured fields, and display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sequential per-field regexes in `stripMetadata` with one scan that locates every Tasks-plugin token before removing any of them, parse the located tokens into real `TaskRecord` fields, and display those fields as a priority row badge and a hover-popover block.

**Architecture:** A two-phase scanner in `src/integrations/TasksPluginParser.ts` records every marker emoji's index first, then claims each marker's value bounded by the next marker's index — so a free-text value like 🔁's terminates on a fact rather than on a hand-maintained stop-list. `TaskParser` contributes spans for the non-Tasks syntax it owns (`#tags`, `[key:: value]`, `^blockid`), merges both span sets, and cuts once. Display logic is a pure formatter module mirroring the existing `DueStatusText.ts`, so `TaskItem.svelte` owns no field-ordering logic.

**Tech Stack:** TypeScript, Svelte 4 legacy syntax, esbuild, Jest, i18next.

**Spec:** `docs/superpowers/specs/2026-08-06-tasks-metadata-single-pass-design.md`

## Global Constraints

- **Branch:** all work lands on `tasks-metadata-single-pass`. Do not commit to `main`.
- **Commit messages:** subject line only, no body. Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- **CSS:** no `!important`; no inline `style=""` (use scoped `<style>` blocks and raise selector specificity when Obsidian wins the cascade); no partially-supported properties (`text-decoration-color`, `text-decoration-thickness`, `text-decoration-skip-ink`); all colors/fonts/spacing from Obsidian CSS variables.
- **Svelte:** Svelte 4 legacy syntax throughout (`export let`, `$:`, `createEventDispatcher`). No runes.
- **Type-only imports:** use `import type` for type-only imports — the build passes `verbatimModuleSyntax: true` to TypeScript via svelte-preprocess, and a value-import of a type breaks the bundle.
- **Tests:** pure logic only, no Obsidian API. `tests/__mocks__/obsidian.ts` stubs the module for Jest.
- **i18n:** every user-visible string goes through `t()`. CI (`scripts/validate-translations.mjs`) enforces key parity across all 12 non-English locales — a new key in `en.json` without its 12 siblings fails the build.
- **Emoji scanning:** several markers are non-BMP (🔺 U+1F53A, 🔼 U+1F53C, 🔽 U+1F53D, 📅 U+1F4C5, 🛫 U+1F6EB, 🔁 U+1F501, 🏁 U+1F3C1, 🆔 U+1F194) and several are BMP (⏫ U+23EB, ⏬ U+23EC, ✅ U+2705, ⏳ U+23F3, ➕ U+2795, ❌ U+274C, ⛔ U+26D4). All regexes over them carry the `u` flag, and marker length is read from the match (`m[0].length`), never assumed to be 1.

## Commands

```bash
npm test                                          # full Jest suite
npm test -- --testPathPattern=TasksPluginParser   # one test file
npm run build                                     # tsc check + production bundle
node scripts/validate-translations.mjs            # locale key parity
```

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/integrations/TasksPluginParser.ts` | Modify | Token table, two-phase scanner, field folding. Owns *all* knowledge of Tasks-plugin syntax. |
| `src/core/TaskParser.ts` | Modify | Obsidian-syntax spans (`#tags`, `[k:: v]`, `^blockid`), span merge-and-cut, new `TaskRecord` fields, one scan per line in `parseFile`. |
| `src/core/TasksFieldText.ts` | Create | Pure formatter: `TaskRecord` → ordered display rows. No Obsidian, no Svelte. |
| `src/core/TaskOrder.ts` | Modify | Back-compatible disambiguator extension; `isRecurring` reads the parsed field. |
| `src/settings.ts` | Modify | Three new `PluginSettings` fields + defaults. |
| `src/settings-tab.ts` | Modify | "Tasks plugin integration" section in both the declarative and legacy render paths. |
| `src/views/TaskItem.svelte` | Modify | Priority badge, recurrence badge gating, popover field block. |
| `src/views/BucketGroup.svelte` | Modify | Thread three new props through to `TaskItem`. |
| `src/views/GTDPanel.svelte` | Modify | Pass the three settings into `BucketGroup`. |
| `src/i18n/locales/*.json` | Modify | ~20 new keys × 13 locales. |
| `tests/TasksPluginParser.test.ts` | Modify | Scanner behaviour, edge rules. |
| `tests/TaskParser.test.ts` | Modify | Span merging, field population. |
| `tests/TasksFieldText.test.ts` | Create | Row order, omission, due-glyph supersession. |
| `tests/TaskOrder.test.ts` | Modify | Back-compat regression guard. |

## Task Order Rationale

Tasks 1–3 are the parser rewrite and are strictly sequential (each consumes the previous one's exports). Task 4 (i18n) comes before Tasks 5–8 because every one of them calls `t()` with keys that must already exist. Task 9 is last because its regression guard needs the new fields populated to be meaningful.

---

### Task 1: Two-phase scanner in TasksPluginParser

**Files:**
- Modify: `src/integrations/TasksPluginParser.ts`
- Test: `tests/TasksPluginParser.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type TaskPriority = "highest" | "high" | "medium" | "low" | "lowest";
  export type TasksField =
    | "due" | "done" | "scheduled" | "start" | "created" | "cancelled"
    | "priority" | "recurrence" | "onCompletion" | "id" | "dependsOn";
  export interface TokenSpan { field: TasksField; start: number; end: number; value: string | null; }
  export interface TasksFields {
    dueDate: Date | null; completedAt: Date | null; scheduledDate: Date | null;
    startDate: Date | null; createdDate: Date | null; cancelledDate: Date | null;
    priority: TaskPriority | null; recurrence: string | null; onCompletion: string | null;
  }
  export function scanTasksMetadata(text: string): TokenSpan[];
  export function foldTasksFields(spans: TokenSpan[]): TasksFields;
  ```
  `parseDueDate(rawLine: string): Date | null` and `parseCompletionDate(rawLine: string): Date | null` keep their existing signatures.

- [ ] **Step 1: Write the failing tests**

Append to `tests/TasksPluginParser.test.ts`:

```ts
import { scanTasksMetadata, foldTasksFields } from "../src/integrations/TasksPluginParser";

/** Convenience: scan + fold in one call, as parseFile will do. */
function fields(text: string) {
  return foldTasksFields(scanTasksMetadata(text));
}

describe("scanTasksMetadata", () => {
  it("parses every field on the TODO repro line", () => {
    const f = fields("Test 2 ⏫ 🔁 every week 🏁 delete 🛫 2026-10-11 ⏳ 2026-10-11");
    expect(f.priority).toBe("high");
    expect(f.recurrence).toBe("every week");
    expect(f.onCompletion).toBe("delete");
    expect(f.startDate!.getFullYear()).toBe(2026);
    expect(f.startDate!.getMonth()).toBe(9); // October, 0-indexed
    expect(f.startDate!.getDate()).toBe(11);
    expect(f.scheduledDate!.getDate()).toBe(11);
  });

  it("terminates a recurrence value at every other marker in turn", () => {
    const cases: Array<[string, string]> = [
      ["Task 🔁 every week 📅 2026-03-01", "every week"],
      ["Task 🔁 every week ✅ 2026-03-01", "every week"],
      ["Task 🔁 every week ⏳ 2026-03-01", "every week"],
      ["Task 🔁 every week 🛫 2026-03-01", "every week"],
      ["Task 🔁 every week ➕ 2026-03-01", "every week"],
      ["Task 🔁 every week ❌ 2026-03-01", "every week"],
      ["Task 🔁 every week 🔺", "every week"],
      ["Task 🔁 every week ⏫", "every week"],
      ["Task 🔁 every week 🔼", "every week"],
      ["Task 🔁 every week 🔽", "every week"],
      ["Task 🔁 every week ⏬", "every week"],
      ["Task 🔁 every week 🏁 delete", "every week"],
      ["Task 🔁 every week 🆔 ab12", "every week"],
      ["Task 🔁 every week ⛔ cd34", "every week"],
    ];
    for (const [input, expected] of cases) {
      expect(fields(input).recurrence).toBe(expected);
    }
  });

  it("parses all five priority levels", () => {
    expect(fields("Task 🔺").priority).toBe("highest");
    expect(fields("Task ⏫").priority).toBe("high");
    expect(fields("Task 🔼").priority).toBe("medium");
    expect(fields("Task 🔽").priority).toBe("low");
    expect(fields("Task ⏬").priority).toBe("lowest");
    expect(fields("Task").priority).toBeNull();
  });

  it("rejects a date marker whose value does not parse", () => {
    const spans = scanTasksMetadata("Pay rent 📅 soon");
    expect(spans).toHaveLength(0);
    expect(foldTasksFields(spans).dueDate).toBeNull();
  });

  it("rejects a calendar-invalid date", () => {
    expect(scanTasksMetadata("Task 📅 2026-13-45")).toHaveLength(0);
  });

  it("rejects a marker with an empty free-text value", () => {
    expect(scanTasksMetadata("Task 🔁")).toHaveLength(0);
    expect(scanTasksMetadata("Task 🏁")).toHaveLength(0);
  });

  it("still uses a rejected marker as a boundary", () => {
    const f = fields("Review 🔁 every week 📅 soon");
    expect(f.recurrence).toBe("every week");
    expect(f.dueDate).toBeNull();
  });

  it("keeps the first value when a marker repeats", () => {
    const spans = scanTasksMetadata("Task 📅 2026-01-01 📅 2026-02-01");
    expect(spans).toHaveLength(2);
    expect(foldTasksFields(spans).dueDate!.getMonth()).toBe(0); // January
  });

  it("does not assume canonical marker order", () => {
    const f = fields("Task ⏳ 2026-05-05 ⏫ 📅 2026-06-06");
    expect(f.scheduledDate!.getMonth()).toBe(4);
    expect(f.priority).toBe("high");
    expect(f.dueDate!.getMonth()).toBe(5);
  });

  it("ignores unrecognized emoji", () => {
    expect(scanTasksMetadata("Buy 🍎 apples")).toHaveLength(0);
  });

  it("scans id and depends-on without producing fields", () => {
    const spans = scanTasksMetadata("Task 🆔 ab12 ⛔ cd34,ef56");
    expect(spans.map((s) => s.field)).toEqual(["id", "dependsOn"]);
    expect(spans[1].value).toBe("cd34,ef56");
  });

  it("reports spans that cover marker and value", () => {
    const spans = scanTasksMetadata("Pay rent 🛫 2026-10-11");
    expect(spans).toHaveLength(1);
    expect("Pay rent 🛫 2026-10-11".slice(spans[0].start, spans[0].end)).toBe("🛫 2026-10-11");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --testPathPattern=TasksPluginParser`
Expected: FAIL — `scanTasksMetadata is not a function` / `foldTasksFields is not a function`, and TypeScript errors for the missing exports.

- [ ] **Step 3: Implement the scanner**

Replace the whole of `src/integrations/TasksPluginParser.ts` with:

```ts
export type TaskPriority = "highest" | "high" | "medium" | "low" | "lowest";

export type TasksField =
  | "due" | "done" | "scheduled" | "start" | "created" | "cancelled"
  | "priority" | "recurrence" | "onCompletion" | "id" | "dependsOn";

export interface TokenSpan {
  field: TasksField;
  /** Index of the marker emoji in the scanned string. */
  start: number;
  /** Index one past the last character of the token (marker + value). */
  end: number;
  /** Date fields: "YYYY-MM-DD". Priority: the level. Others: the raw value. */
  value: string | null;
}

type TokenKind = "date" | "level" | "freeText" | "id";

interface TokenDef {
  field: TasksField;
  kind: TokenKind;
  /** Only for kind "level". */
  level?: TaskPriority;
}

/**
 * The single source of truth for Tasks-plugin syntax. Adding a marker here is
 * the whole cost of supporting it — no other pattern in the codebase needs to
 * learn about it, which is the property the old per-field regexes lacked.
 */
const TOKENS: Record<string, TokenDef> = {
  "📅": { field: "due",          kind: "date" },
  "✅": { field: "done",         kind: "date" },
  "⏳": { field: "scheduled",    kind: "date" },
  "🛫": { field: "start",        kind: "date" },
  "➕": { field: "created",      kind: "date" },
  "❌": { field: "cancelled",    kind: "date" },
  "🔺": { field: "priority",     kind: "level", level: "highest" },
  "⏫": { field: "priority",     kind: "level", level: "high" },
  "🔼": { field: "priority",     kind: "level", level: "medium" },
  "🔽": { field: "priority",     kind: "level", level: "low" },
  "⏬": { field: "priority",     kind: "level", level: "lowest" },
  "🔁": { field: "recurrence",   kind: "freeText" },
  "🏁": { field: "onCompletion", kind: "freeText" },
  "🆔": { field: "id",           kind: "id" },
  "⛔": { field: "dependsOn",    kind: "id" },
};

/** Alternation over every marker. The `u` flag keeps non-BMP markers intact. */
const MARKER_REGEX = new RegExp(Object.keys(TOKENS).join("|"), "gu");

const DATE_VALUE_REGEX = /^\s*(\d{4}-\d{2}-\d{2})/;
const ID_VALUE_REGEX = /^\s*([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)/;

/** Parses "YYYY-MM-DD" at local midnight. Null if the calendar date is invalid. */
function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Locates every Tasks-plugin token in `text`.
 *
 * Runs in two phases, and the split is what fixes the bug this replaced. Phase
 * 1 records the index of every marker emoji, so the complete set of boundaries
 * exists before any value is interpreted. Phase 2 then reads each marker's
 * value bounded by the NEXT marker's index — so a free-text value (🔁, 🏁) ends
 * at a known position instead of at whatever characters a hand-maintained
 * stop-list happened to list. The old code's recurrence regex listed four stop
 * characters and silently ate 🏁, 🛫 and ⏳ along with their values.
 *
 * A marker whose value fails to parse is REJECTED: it yields no span, so it is
 * not stripped and stays visible to the user. It is still a phase-1 boundary,
 * which is what stops `🔁 every week 📅 soon` from letting the recurrence value
 * run to end of line.
 */
export function scanTasksMetadata(text: string): TokenSpan[] {
  const markers = [...text.matchAll(MARKER_REGEX)];
  const spans: TokenSpan[] = [];

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const def = TOKENS[marker[0]];
    const start = marker.index!;
    const valueStart = start + marker[0].length;
    const bound = i + 1 < markers.length ? markers[i + 1].index! : text.length;
    const slice = text.slice(valueStart, bound);

    if (def.kind === "level") {
      spans.push({ field: def.field, start, end: valueStart, value: def.level! });
      continue;
    }

    if (def.kind === "date") {
      const m = slice.match(DATE_VALUE_REGEX);
      if (!m || toDate(m[1]) === null) continue; // rejected
      spans.push({ field: def.field, start, end: valueStart + m[0].length, value: m[1] });
      continue;
    }

    if (def.kind === "id") {
      const m = slice.match(ID_VALUE_REGEX);
      if (!m) continue; // rejected
      spans.push({
        field: def.field,
        start,
        end: valueStart + m[0].length,
        value: m[1].replace(/\s*,\s*/g, ","),
      });
      continue;
    }

    // freeText
    const value = slice.trim();
    if (value === "") continue; // rejected
    spans.push({
      field: def.field,
      start,
      end: valueStart + slice.trimEnd().length,
      value,
    });
  }

  return spans;
}

export interface TasksFields {
  dueDate: Date | null;
  completedAt: Date | null;
  scheduledDate: Date | null;
  startDate: Date | null;
  createdDate: Date | null;
  cancelledDate: Date | null;
  priority: TaskPriority | null;
  recurrence: string | null;
  onCompletion: string | null;
}

/** Folds spans into fields. First occurrence wins, matching Tasks' own behavior. */
export function foldTasksFields(spans: TokenSpan[]): TasksFields {
  const first = new Map<TasksField, string | null>();
  for (const span of spans) {
    if (!first.has(span.field)) first.set(span.field, span.value);
  }
  const get = (f: TasksField) => first.get(f) ?? null;

  return {
    dueDate: toDate(get("due")),
    completedAt: toDate(get("done")),
    scheduledDate: toDate(get("scheduled")),
    startDate: toDate(get("start")),
    createdDate: toDate(get("created")),
    cancelledDate: toDate(get("cancelled")),
    priority: (get("priority") as TaskPriority | null) ?? null,
    recurrence: get("recurrence"),
    onCompletion: get("onCompletion"),
  };
}

export function parseDueDate(rawLine: string): Date | null {
  return foldTasksFields(scanTasksMetadata(rawLine)).dueDate;
}

export function parseCompletionDate(rawLine: string): Date | null {
  return foldTasksFields(scanTasksMetadata(rawLine)).completedAt;
}

export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --testPathPattern=TasksPluginParser`
Expected: PASS — the new describe block plus the pre-existing `parseDueDate` / `parseCompletionDate` / `today` tests, which must not have regressed.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/TasksPluginParser.ts tests/TasksPluginParser.test.ts
git commit -m "feat: scan Tasks-plugin metadata in a single two-phase pass"
```

---

### Task 2: Span merge-and-cut in TaskParser

**Files:**
- Modify: `src/core/TaskParser.ts:135-146` (`stripMetadata`)
- Test: `tests/TaskParser.test.ts`

**Interfaces:**
- Consumes: `scanTasksMetadata`, `TokenSpan` from Task 1.
- Produces: `stripMetadata` stays private to the module; its behaviour change is observed through `parseFile(...)[0].text`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/TaskParser.test.ts`:

```ts
describe("stripMetadata via parseFile", () => {
  const textOf = (line: string) => parseFile("test.md", line)[0].text;

  it("strips scheduled and start dates, which the old regexes left visible", () => {
    expect(textOf("- [ ] Pay rent 🛫 2026-10-11")).toBe("Pay rent");
    expect(textOf("- [ ] Pay rent ⏳ 2026-10-11")).toBe("Pay rent");
  });

  it("strips highest priority, which the old regex omitted", () => {
    expect(textOf("- [ ] Urgent 🔺")).toBe("Urgent");
  });

  it("strips id and depends-on markers", () => {
    expect(textOf("- [ ] Ship it 🆔 ab12 ⛔ cd34")).toBe("Ship it");
  });

  it("strips created and cancelled dates", () => {
    expect(textOf("- [ ] Old task ➕ 2026-01-01 ❌ 2026-02-02")).toBe("Old task");
  });

  it("strips every field on the TODO repro line", () => {
    expect(
      textOf("- [ ] Test 2 ⏫ 🔁 every week 🏁 delete 🛫 2026-10-11 ⏳ 2026-10-11")
    ).toBe("Test 2");
  });

  it("leaves a rejected marker visible", () => {
    expect(textOf("- [ ] Pay rent 📅 soon")).toBe("Pay rent 📅 soon");
  });

  it("merges Tasks spans with tag, inline-field and block-ref spans", () => {
    expect(
      textOf("- [ ] Buy milk 📅 2026-02-18 ⏫ #gtd/today [horizon:: today] ^abc123")
    ).toBe("Buy milk");
  });

  it("keeps text that sits between two metadata tokens", () => {
    expect(textOf("- [ ] Call ⏫ Bob 📅 2026-02-18")).toBe("Call Bob");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --testPathPattern=TaskParser`
Expected: FAIL on the first four assertions — e.g. `Expected: "Pay rent"`, `Received: "Pay rent 🛫 2026-10-11"`. The repro-line and rejected-marker cases already pass today and are regression guards.

- [ ] **Step 3: Implement span merge-and-cut**

In `src/core/TaskParser.ts`, **add to** the existing import on line 1 — do not replace it, because
`parseFile` still calls `parseDueDate` and `parseCompletionDate` until Task 3 rewrites that block:

```ts
import {
  parseDueDate,
  parseCompletionDate,
  scanTasksMetadata,
  foldTasksFields,
} from "../integrations/TasksPluginParser";
import type { TokenSpan } from "../integrations/TasksPluginParser";
```

Then replace `stripMetadata` with:

```ts
/** A half-open [start, end) range of `text` to remove. */
interface Span {
  start: number;
  end: number;
}

const TAG_REGEX = /#[\w/-]+/g;
const INLINE_FIELD_REGEX = /\[[\w-]+::\s*[^\]]*\]/g;
const BLOCK_REF_REGEX = /\s+\^[\w-]+\s*$/;

/**
 * Spans for the syntax this parser owns — Obsidian tags, Dataview inline
 * fields, and a trailing block reference. Deliberately NOT in
 * TasksPluginParser: none of these are Tasks-plugin syntax, and keeping the
 * two token sets in separate modules is what stops either from growing a
 * stop-list describing the other.
 */
function scanObsidianMetadata(text: string): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(TAG_REGEX)) {
    spans.push({ start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(INLINE_FIELD_REGEX)) {
    spans.push({ start: m.index!, end: m.index! + m[0].length });
  }
  const blockRef = text.match(BLOCK_REF_REGEX);
  if (blockRef) {
    spans.push({ start: blockRef.index!, end: blockRef.index! + blockRef[0].length });
  }
  return spans;
}

/** Sorts, merges overlaps, and removes back-to-front so earlier indices stay valid. */
function cutSpans(text: string, spans: Span[]): string {
  if (spans.length === 0) return text.replace(/\s{2,}/g, " ").trim();

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [sorted[0]];
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  let result = text;
  for (let i = merged.length - 1; i >= 0; i--) {
    result = result.slice(0, merged[i].start) + result.slice(merged[i].end);
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

function stripMetadata(text: string, tasksSpans: TokenSpan[]): string {
  return cutSpans(text, [...tasksSpans, ...scanObsidianMetadata(text)]);
}
```

Then update the one call site in `parseFile` (currently line 65) to pass the spans:

```ts
    const tasksSpans = scanTasksMetadata(rawRest);
    const text = stripMetadata(rawRest, tasksSpans);
```

Leave the rest of `parseFile` alone for now — Task 3 finishes the wiring.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS across the whole suite. `BucketManager`, `TaskWriter` and `StorageMigrator` tests exercise `parseFile` indirectly and must stay green.

- [ ] **Step 5: Commit**

```bash
git add src/core/TaskParser.ts tests/TaskParser.test.ts
git commit -m "fix: strip Tasks metadata by merged spans instead of sequential regexes"
```

---

### Task 3: Structured TaskRecord fields

**Files:**
- Modify: `src/core/TaskParser.ts` (`TaskRecord` interface, `parseFile`)
- Modify: `src/core/TaskOrder.ts:209-211` (`isRecurring`)
- Test: `tests/TaskParser.test.ts`

**Interfaces:**
- Consumes: `foldTasksFields`, `TaskPriority` from Task 1; `scanTasksMetadata` already wired in Task 2.
- Produces: `TaskRecord` gains `priority`, `recurrence`, `scheduledDate`, `startDate`, `createdDate`, `cancelledDate`, `onCompletion`, `blockId`. Tasks 5, 7, 8 and 9 all read these.

- [ ] **Step 1: Write the failing tests**

Append to `tests/TaskParser.test.ts`:

```ts
describe("TaskRecord Tasks-plugin fields", () => {
  it("populates every new field", () => {
    const line =
      "- [ ] Test 2 ⏫ 🔁 every week 🏁 delete 🛫 2026-10-11 ⏳ 2026-10-12 ➕ 2026-01-01 ^abc123";
    const task = parseFile("test.md", line)[0];
    expect(task.priority).toBe("high");
    expect(task.recurrence).toBe("every week");
    expect(task.onCompletion).toBe("delete");
    expect(task.startDate!.getDate()).toBe(11);
    expect(task.scheduledDate!.getDate()).toBe(12);
    expect(task.createdDate!.getMonth()).toBe(0);
    expect(task.cancelledDate).toBeNull();
    expect(task.blockId).toBe("abc123");
  });

  it("leaves every new field null on a bare task", () => {
    const task = parseFile("test.md", "- [ ] Buy milk")[0];
    expect(task.priority).toBeNull();
    expect(task.recurrence).toBeNull();
    expect(task.scheduledDate).toBeNull();
    expect(task.startDate).toBeNull();
    expect(task.createdDate).toBeNull();
    expect(task.cancelledDate).toBeNull();
    expect(task.onCompletion).toBeNull();
    expect(task.blockId).toBeNull();
  });

  it("still populates dueDate and completedAt", () => {
    const task = parseFile("test.md", "- [x] Done thing 📅 2026-02-18 ✅ 2026-02-19")[0];
    expect(task.dueDate!.getDate()).toBe(18);
    expect(task.completedAt!.getDate()).toBe(19);
  });
});
```

And append to `tests/TaskOrder.test.ts`:

```ts
describe("isRecurring", () => {
  it("is true when the task has a recurrence rule", () => {
    const task = parseFile("test.md", "- [ ] Weekly review 🔁 every week")[0];
    expect(isRecurring(task)).toBe(true);
  });

  it("is false when 🔁 appears only in the task's own visible text", () => {
    const task = parseFile("test.md", "- [ ] Explain the 🔁 emoji to Sam")[0];
    expect(isRecurring(task)).toBe(false);
  });
});
```

Add `parseFile` and `isRecurring` to that file's imports if they are not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --testPathPattern="TaskParser|TaskOrder"`
Expected: FAIL — TypeScript errors for properties that do not exist on `TaskRecord`, and the `isRecurring` visible-text case returning `true`.

- [ ] **Step 3: Implement the fields**

In `src/core/TaskParser.ts`, extend the `TaskRecord` interface (after `dueDate` on line 14):

```ts
  /** Tasks-plugin priority level (🔺⏫🔼🔽⏬). Null if unset. */
  priority: TaskPriority | null;
  /** Tasks-plugin recurrence rule text, e.g. "every week". */
  recurrence: string | null;
  scheduledDate: Date | null;
  startDate: Date | null;
  createdDate: Date | null;
  cancelledDate: Date | null;
  /** Tasks-plugin on-completion action, e.g. "delete". */
  onCompletion: string | null;
  /** Trailing Obsidian block reference, without the leading ^. */
  blockId: string | null;
```

Add the type import at the top, and re-export it so view code has one import path for task types:

```ts
import type { TaskPriority } from "../integrations/TasksPluginParser";
export type { TaskPriority };
```

`parseDueDate` and `parseCompletionDate` become unused in this file once the loop body below is
in place — drop them from the line-1 import Task 2 extended. They stay exported from
`TasksPluginParser` for `BucketManager`, `TaskWriter` and `DueStatus`.

Replace the per-line body of `parseFile`'s loop (currently lines 57-81) so the line is scanned exactly once:

```ts
    const checkMark = match[2];
    const rawRest = match[3];

    const isCompleted = checkMark === "x" || checkMark === "X";
    // One scan per line: parseDueDate/parseCompletionDate each used to run
    // their own regex over the same string, and stripMetadata a third set.
    const tasksSpans = scanTasksMetadata(rawRest);
    const fields = foldTasksFields(tasksSpans);
    const tags = extractTags(rawRest);
    const inlineField = extractInlineField(rawRest);
    const text = stripMetadata(rawRest, tasksSpans);
    const blockRef = rawRest.match(/\s+\^([\w-]+)\s*$/);

    records.push({
      id: makeId(filePath, i, text),
      filePath,
      lineNumber: i,
      rawLine: line,
      text,
      isCompleted,
      completedAt: isCompleted ? fields.completedAt : null,
      dueDate: fields.dueDate,
      priority: fields.priority,
      recurrence: fields.recurrence,
      scheduledDate: fields.scheduledDate,
      startDate: fields.startDate,
      createdDate: fields.createdDate,
      cancelledDate: fields.cancelledDate,
      onCompletion: fields.onCompletion,
      blockId: blockRef ? blockRef[1] : null,
      tags,
      inlineField,
      indentLevel: extractIndentLevel(line),
      parentId: null,
      childIds: [],
    });
```

In `src/core/TaskOrder.ts`, replace `isRecurring`:

```ts
/** A completed recurrence has already been replaced by its next occurrence. */
export function isRecurring(task: TaskRecord): boolean {
  return task.recurrence !== null;
}
```

- [ ] **Step 4: Run the full suite and the type check**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: clean `tsc` pass. Any other construction site of a `TaskRecord` literal (test fixtures included) will surface here as a missing-property error — add the eight new fields as `null` to each.

- [ ] **Step 5: Commit**

```bash
git add src/core/TaskParser.ts src/core/TaskOrder.ts tests/
git commit -m "feat: parse Tasks-plugin fields into TaskRecord"
```

---

### Task 4: Localization keys

**Files:**
- Modify: `src/i18n/locales/en.json` and all 12 other locale files (`de`, `es`, `et`, `fr`, `ja`, `ko`, `lt`, `lv`, `pt`, `ru`, `uk`, `zh`)
- Test: `node scripts/validate-translations.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the keys `settings.tasksIntegration.*`, `task.priority.*` and `task.fields.*`, consumed by Tasks 5–8.

This task exists on its own because the validator gates the whole build on key parity: adding a key in `en.json` during a UI task and translating it in a later one leaves CI red in between.

- [ ] **Step 1: Add the English keys**

In `src/i18n/locales/en.json`, add to the `settings` object:

```json
"tasksIntegration_comment": "Section heading for settings that control how the plugin displays metadata written by the community Tasks plugin (priority, recurrence, dates). The blurb is deliberately generic so new settings can be added to this section without rewording it.",
"tasksIntegration": {
  "heading": "Tasks plugin integration",
  "blurb": "How this plugin treats the metadata the Tasks plugin writes on task lines.",
  "priority": {
    "name": "Show priority",
    "description_comment": "Dropdown controlling which Tasks-plugin priority levels get an emoji badge on the task row. Levels, highest to lowest: 🔺 Highest, ⏫ High, 🔼 Medium, 🔽 Low, ⏬ Lowest. The hover popover always shows the priority regardless of this setting.",
    "description": "Which priority levels show an emoji badge on the task row.",
    "all": "All priorities",
    "mediumUp": "Medium and above",
    "highUp": "High and above",
    "hidden": "Hidden"
  },
  "recurrence": {
    "name": "Show recurrence badge",
    "description_comment": "Toggle for the 🔁 badge on rows of tasks that repeat. The hover popover shows the recurrence rule regardless of this setting.",
    "description": "Mark repeating tasks with 🔁 on the task row."
  },
  "popoverFields": {
    "name": "Show Tasks fields in popover",
    "description_comment": "Toggle for the block of Tasks-plugin metadata rows (due, priority, recurrence, scheduled, start, created, cancelled, done, on-completion) shown in the popover that appears after hovering a task row.",
    "description": "List due date, priority, recurrence and the other Tasks fields when hovering a task."
  }
}
```

And to the `task` object:

```json
"priority_comment": "Labels for the five Tasks-plugin priority levels, shown beside their emoji in the hover popover. Use the Tasks plugin's own terms for these levels where your language has established ones.",
"priority": {
  "highest": "Highest",
  "high": "High",
  "medium": "Medium",
  "low": "Low",
  "lowest": "Lowest"
},
"fields_comment": "Rows in the hover popover, one per Tasks-plugin field present on the task. Each is preceded by its emoji, so the wording continues from a glyph rather than starting a sentence. {{date}} is a formatted date like 'Wed, Aug 5'; {{rule}} is a recurrence rule written by the user, e.g. 'every week'; {{action}} is an on-completion action, e.g. 'delete'.",
"fields": {
  "recurrence": "Repeats {{rule}}",
  "scheduled": "Scheduled {{date}}",
  "start": "Starts {{date}}",
  "created": "Created {{date}}",
  "cancelled": "Cancelled {{date}}",
  "done": "Done {{date}}",
  "onCompletion": "On completion: {{action}}"
}
```

- [ ] **Step 2: Run the validator to verify it fails**

Run: `node scripts/validate-translations.mjs`
Expected: FAIL — every one of the 12 non-English locales reported as missing the new paths.

- [ ] **Step 3: Translate into the 12 other locales**

Add the same key structure to `de.json`, `es.json`, `et.json`, `fr.json`, `ja.json`, `ko.json`, `lt.json`, `lv.json`, `pt.json`, `ru.json`, `uk.json`, `zh.json`, translating the values.

Rules for the translations:
- `_comment` keys are **not** copied into other locales — the validator skips them, and `en.json` is the only place they belong.
- Interpolation placeholders (`{{date}}`, `{{rule}}`, `{{action}}`) are copied verbatim; translating a placeholder name breaks the substitution.
- `task.fields.*` strings follow an emoji on the same line, so they continue from a glyph rather than opening a sentence. Keep them lowercase-initial where the target language's conventions allow.
- For `task.priority.*`, prefer the terms the Tasks plugin itself uses in that language if it has an established translation; otherwise translate plainly.
- The emoji inside `settings.tasksIntegration.recurrence.description` (🔁) is copied as-is.
- Match the register and sentence style each locale file already uses for `settings.behaviour.*`
  — those were written by the same hand and are the tone reference for these.

- [ ] **Step 4: Run the validator to verify it passes**

Run: `node scripts/validate-translations.mjs`
Expected: PASS for all 12 locales.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/
git commit -m "i18n: add keys for Tasks plugin integration settings and field labels"
```

---

### Task 5: TasksFieldText formatter

**Files:**
- Create: `src/core/TasksFieldText.ts`
- Create: `tests/TasksFieldText.test.ts`

**Interfaces:**
- Consumes: `TaskRecord` (Task 3), the `task.priority.*` / `task.fields.*` keys (Task 4), `formatDueLine` and `DueStatus` from the existing `src/core/DueStatusText.ts` / `src/core/DueStatus.ts`.
- Produces:
  ```ts
  export interface FieldRow { emoji: string; text: string; }
  export function formatTasksFields(task: TaskRecord, dueStatus: DueStatus | null): FieldRow[];
  ```
  Consumed by Task 8.

- [ ] **Step 1: Write the failing tests**

Create `tests/TasksFieldText.test.ts`:

```ts
import { parseFile } from "../src/core/TaskParser";
import { formatTasksFields } from "../src/core/TasksFieldText";
import type { DueStatus } from "../src/core/DueStatus";

const onTrack: DueStatus = { kind: "on-track", diffDays: 3 };
const overdue: DueStatus = { kind: "overdue", diffDays: -2 };

function rowsFor(line: string, status: DueStatus | null = null) {
  return formatTasksFields(parseFile("test.md", line)[0], status);
}

describe("formatTasksFields", () => {
  it("returns no rows for a task with no Tasks metadata", () => {
    expect(rowsFor("- [ ] Buy milk")).toEqual([]);
  });

  it("emits rows in the documented order", () => {
    const line =
      "- [ ] Everything 📅 2026-08-07 🔺 🔁 every week ⏳ 2026-08-05 " +
      "🛫 2026-08-03 ➕ 2026-07-01 ❌ 2026-08-06 🏁 delete";
    const emojis = rowsFor(line, onTrack).map((r) => r.emoji);
    expect(emojis).toEqual(["📅", "🔺", "🔁", "⏳", "🛫", "➕", "❌", "🏁"]);
  });

  it("omits absent fields", () => {
    const rows = rowsFor("- [ ] Weekly review 🔁 every week");
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe("🔁");
    expect(rows[0].text).toBe("Repeats every week");
  });

  it("labels each priority level with its own emoji", () => {
    expect(rowsFor("- [ ] T 🔺")[0]).toEqual({ emoji: "🔺", text: "Highest" });
    expect(rowsFor("- [ ] T ⏫")[0]).toEqual({ emoji: "⏫", text: "High" });
    expect(rowsFor("- [ ] T 🔼")[0]).toEqual({ emoji: "🔼", text: "Medium" });
    expect(rowsFor("- [ ] T 🔽")[0]).toEqual({ emoji: "🔽", text: "Low" });
    expect(rowsFor("- [ ] T ⏬")[0]).toEqual({ emoji: "⏬", text: "Lowest" });
  });

  it("uses 📅 for the due row when the task is on track", () => {
    expect(rowsFor("- [ ] Pay rent 📅 2026-08-07", onTrack)[0].emoji).toBe("📅");
  });

  it("lets the overdue flag supersede 📅", () => {
    expect(rowsFor("- [ ] Pay rent 📅 2026-08-07", overdue)[0].emoji).toBe("❢");
  });

  it("emits no due row when there is no due status", () => {
    expect(rowsFor("- [ ] Pay rent 📅 2026-08-07", null)).toEqual([]);
  });

  it("emits a done row for a completed task", () => {
    const rows = rowsFor("- [x] Shipped ✅ 2026-08-04");
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe("✅");
    expect(rows[0].text).toMatch(/^Done /);
  });

  it("emits an on-completion row", () => {
    expect(rowsFor("- [ ] T 🏁 delete")[0]).toEqual({
      emoji: "🏁",
      text: "On completion: delete",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --testPathPattern=TasksFieldText`
Expected: FAIL — `Cannot find module '../src/core/TasksFieldText'`.

- [ ] **Step 3: Implement the formatter**

Create `src/core/TasksFieldText.ts`:

```ts
import { t, i18next } from "../i18n/i18n";
import type { TaskRecord, TaskPriority } from "./TaskParser";
import type { DueStatus } from "./DueStatus";
import { formatDueLine } from "./DueStatusText";

/** One line of the hover popover's metadata block. */
export interface FieldRow {
  emoji: string;
  text: string;
}

const PRIORITY_EMOJI: Record<TaskPriority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};

/** Locale-aware short date, e.g. "Wed, Aug 5". Matches DueStatusText's format. */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(i18next.language, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * The glyph leading the due row. A flag supersedes 📅 rather than joining it:
 * it already means "this is a due date, and there is a problem with it", which
 * is strictly more than 📅 says. On-track tasks fall back to 📅 so the popover's
 * first column is never ragged.
 */
function dueEmoji(status: DueStatus): string {
  if (status.kind === "overdue") return "❢";
  if (status.kind === "misfiled") return "⚑";
  return "📅";
}

/**
 * The metadata rows for a task's hover popover, already in display order and
 * already filtered to fields that are present. TaskItem renders these with an
 * {#each} and owns no ordering logic of its own.
 *
 * `dueStatus` is null when the panel has no status for this task; the due row
 * is then omitted, since its text is entirely status-derived.
 */
export function formatTasksFields(task: TaskRecord, dueStatus: DueStatus | null): FieldRow[] {
  const rows: FieldRow[] = [];

  if (task.dueDate && dueStatus) {
    rows.push({ emoji: dueEmoji(dueStatus), text: formatDueLine(task.dueDate, dueStatus) });
  }
  if (task.priority) {
    rows.push({ emoji: PRIORITY_EMOJI[task.priority], text: t(`task.priority.${task.priority}`) });
  }
  if (task.recurrence) {
    rows.push({ emoji: "🔁", text: t("task.fields.recurrence", { rule: task.recurrence }) });
  }
  if (task.scheduledDate) {
    rows.push({ emoji: "⏳", text: t("task.fields.scheduled", { date: formatDate(task.scheduledDate) }) });
  }
  if (task.startDate) {
    rows.push({ emoji: "🛫", text: t("task.fields.start", { date: formatDate(task.startDate) }) });
  }
  if (task.createdDate) {
    rows.push({ emoji: "➕", text: t("task.fields.created", { date: formatDate(task.createdDate) }) });
  }
  if (task.cancelledDate) {
    rows.push({ emoji: "❌", text: t("task.fields.cancelled", { date: formatDate(task.cancelledDate) }) });
  }
  if (task.completedAt) {
    rows.push({ emoji: "✅", text: t("task.fields.done", { date: formatDate(task.completedAt) }) });
  }
  if (task.onCompletion) {
    rows.push({ emoji: "🏁", text: t("task.fields.onCompletion", { action: task.onCompletion }) });
  }

  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --testPathPattern=TasksFieldText`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/TasksFieldText.ts tests/TasksFieldText.test.ts
git commit -m "feat: format Tasks-plugin fields into ordered popover rows"
```

---

### Task 6: Settings — types, defaults, and the new section

**Files:**
- Modify: `src/settings.ts` (`PluginSettings`, `DEFAULT_SETTINGS`)
- Modify: `src/settings-tab.ts` (`getSettingDefinitions`, `renderLegacyBehaviourFallback`, `display`)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: the `settings.tasksIntegration.*` keys from Task 4.
- Produces:
  ```ts
  export type PriorityDisplay = "all" | "medium-up" | "high-up" | "hidden";
  // on PluginSettings:
  priorityDisplay: PriorityDisplay;
  showRecurrenceBadge: boolean;
  showTasksFieldsInPopover: boolean;
  ```
  Read by Tasks 7 and 8.

- [ ] **Step 1: Write the failing test**

Append to `tests/settings.test.ts`:

```ts
import { DEFAULT_SETTINGS } from "../src/settings";

describe("Tasks integration defaults", () => {
  it("shows all priority levels by default", () => {
    expect(DEFAULT_SETTINGS.priorityDisplay).toBe("all");
  });

  it("keeps the recurrence badge and popover fields on, matching current behaviour", () => {
    expect(DEFAULT_SETTINGS.showRecurrenceBadge).toBe(true);
    expect(DEFAULT_SETTINGS.showTasksFieldsInPopover).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern=settings`
Expected: FAIL — TypeScript errors for properties that do not exist on `PluginSettings`.

- [ ] **Step 3: Add the settings fields**

In `src/settings.ts`, add the type next to `CelebrationMode`:

```ts
/** Which Tasks-plugin priority levels get an emoji badge on the task row. */
export type PriorityDisplay = "all" | "medium-up" | "high-up" | "hidden";
```

Add to `PluginSettings` (after `compactView`):

```ts
  /** Which priority levels show a badge on the row. The popover is unaffected. */
  priorityDisplay: PriorityDisplay;
  /** Show the 🔁 badge on rows of repeating tasks. The popover is unaffected. */
  showRecurrenceBadge: boolean;
  /** Show the Tasks-plugin metadata block in the hover popover. */
  showTasksFieldsInPopover: boolean;
```

Add to `DEFAULT_SETTINGS` (after `compactView: false,`):

```ts
  priorityDisplay: "all",
  showRecurrenceBadge: true,
  showTasksFieldsInPopover: true,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --testPathPattern=settings`
Expected: PASS.

- [ ] **Step 5: Add the declarative settings section**

In `src/settings-tab.ts`, insert this group into `getSettingDefinitions()`'s returned array, between the Behaviour group and the Buckets item:

```ts
      {
        type: "group",
        heading: t("settings.tasksIntegration.heading"),
        items: [
          {
            // SettingDefinitionGroup has no description field, so the section
            // blurb rides in as a control-less item.
            name: "",
            desc: t("settings.tasksIntegration.blurb"),
            searchable: false,
          },
          // If the empty name column renders with awkward spacing in Obsidian
          // 1.13+, swap that item for a `render:` one following the banner
          // pattern already in this file: add the `gtd-settings-escape-hatch`
          // class, `empty()` the element, and write the blurb into it.
          {
            name: t("settings.tasksIntegration.priority.name"),
            desc: t("settings.tasksIntegration.priority.description"),
            control: {
              type: "dropdown",
              key: "priorityDisplay",
              options: {
                all: t("settings.tasksIntegration.priority.all"),
                "medium-up": t("settings.tasksIntegration.priority.mediumUp"),
                "high-up": t("settings.tasksIntegration.priority.highUp"),
                hidden: t("settings.tasksIntegration.priority.hidden"),
              },
            },
          },
          {
            name: t("settings.tasksIntegration.recurrence.name"),
            desc: t("settings.tasksIntegration.recurrence.description"),
            control: { type: "toggle", key: "showRecurrenceBadge" },
          },
          {
            name: t("settings.tasksIntegration.popoverFields.name"),
            desc: t("settings.tasksIntegration.popoverFields.description"),
            control: { type: "toggle", key: "showTasksFieldsInPopover" },
          },
        ],
      },
```

- [ ] **Step 6: Add the legacy fallback mirror**

Still in `src/settings-tab.ts`, add this method next to `renderLegacyBehaviourFallback`:

```ts
  /**
   * Imperative mirror of the Tasks integration group, for Obsidian below
   * 1.13.0. Those versions never call getSettingDefinitions(), so without this
   * the section would not exist for them at all.
   */
  private renderLegacyTasksIntegrationFallback(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName(t("settings.tasksIntegration.heading"))
      .setDesc(t("settings.tasksIntegration.blurb"))
      .setHeading();

    new Setting(containerEl)
      .setName(t("settings.tasksIntegration.priority.name"))
      .setDesc(t("settings.tasksIntegration.priority.description"))
      .addDropdown((dd) => {
        dd.addOption("all", t("settings.tasksIntegration.priority.all"));
        dd.addOption("medium-up", t("settings.tasksIntegration.priority.mediumUp"));
        dd.addOption("high-up", t("settings.tasksIntegration.priority.highUp"));
        dd.addOption("hidden", t("settings.tasksIntegration.priority.hidden"));
        dd.setValue(this.plugin.settings.priorityDisplay ?? "all");
        dd.onChange(async (val) => {
          await this.setControlValue("priorityDisplay", val);
        });
      });

    new Setting(containerEl)
      .setName(t("settings.tasksIntegration.recurrence.name"))
      .setDesc(t("settings.tasksIntegration.recurrence.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.showRecurrenceBadge);
        tog.onChange(async (val) => {
          await this.setControlValue("showRecurrenceBadge", val);
        });
      });

    new Setting(containerEl)
      .setName(t("settings.tasksIntegration.popoverFields.name"))
      .setDesc(t("settings.tasksIntegration.popoverFields.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.showTasksFieldsInPopover);
        tog.onChange(async (val) => {
          await this.setControlValue("showTasksFieldsInPopover", val);
        });
      });
  }
```

And call it from `display()` between the two existing calls (currently line 291-292):

```ts
    this.renderLegacyBehaviourFallback(containerEl);
    this.renderLegacyTasksIntegrationFallback(containerEl);
    this.renderBucketsSection(containerEl);
```

- [ ] **Step 7: Verify the build and check the section renders**

Run: `npm run build`
Expected: clean.

Then, with `npm run dev` running and the plugin symlinked into a vault, open **Settings → GTD Tasks** and confirm: the "Tasks plugin integration" section appears between Behaviour and Buckets; the blurb reads under the heading; the dropdown shows four entries and persists a change across a settings reopen; both toggles persist.

- [ ] **Step 8: Commit**

```bash
git add src/settings.ts src/settings-tab.ts tests/settings.test.ts
git commit -m "feat: add Tasks plugin integration settings section"
```

---

### Task 7: Priority and recurrence badges on the task row

**Files:**
- Modify: `src/views/GTDPanel.svelte:344` (props passed to `BucketGroup`)
- Modify: `src/views/BucketGroup.svelte:14-26, 342-358` (props in, props through)
- Modify: `src/views/TaskItem.svelte`

**Interfaces:**
- Consumes: `task.priority` / `task.recurrence` (Task 3), `PriorityDisplay` and the three settings (Task 6).
- Produces: no exports; visual change only.

- [ ] **Step 1: Thread the settings down**

In `src/views/GTDPanel.svelte`, add to the `<BucketGroup ... />` props, next to `showDueFlags`:

```svelte
        priorityDisplay={settings.priorityDisplay}
        showRecurrenceBadge={settings.showRecurrenceBadge}
        showTasksFieldsInPopover={settings.showTasksFieldsInPopover}
```

In `src/views/BucketGroup.svelte`, add to the prop declarations after `showDueFlags`:

```svelte
  export let priorityDisplay: PriorityDisplay = "all";
  export let showRecurrenceBadge: boolean = true;
  export let showTasksFieldsInPopover: boolean = true;
```

with the type import alongside the existing ones:

```ts
  import type { PriorityDisplay } from "../settings";
```

and pass all three straight through to `<TaskItem ... />` next to `{showDueFlags}`:

```svelte
          {priorityDisplay}
          {showRecurrenceBadge}
          {showTasksFieldsInPopover}
```

- [ ] **Step 2: Render the priority badge**

In `src/views/TaskItem.svelte`, add the imports and props:

```ts
  import type { PriorityDisplay } from "../settings";
  import type { TaskPriority } from "../core/TaskParser";

  export let priorityDisplay: PriorityDisplay = "all";
  export let showRecurrenceBadge: boolean = true;
  export let showTasksFieldsInPopover: boolean = true;
```

Add the badge logic next to the existing `$:` block that computes `showOverdueBadge`:

```ts
  const PRIORITY_EMOJI: Record<TaskPriority, string> = {
    highest: "🔺", high: "⏫", medium: "🔼", low: "🔽", lowest: "⏬",
  };
  /** Levels each dropdown entry admits, highest first. */
  const PRIORITY_VISIBLE: Record<PriorityDisplay, TaskPriority[]> = {
    all: ["highest", "high", "medium", "low", "lowest"],
    "medium-up": ["highest", "high", "medium"],
    "high-up": ["highest", "high"],
    hidden: [],
  };
  $: priorityEmoji =
    task.priority && PRIORITY_VISIBLE[priorityDisplay].includes(task.priority)
      ? PRIORITY_EMOJI[task.priority]
      : null;
```

Change the recurrence badge's guard and add the priority badge immediately before it, so priority leads the badge strip:

```svelte
  {#if priorityEmoji}
    <span class="gtd-priority-badge">{priorityEmoji}</span>
  {/if}

  {#if isRecurringTask && showRecurrenceBadge}
    <span class="gtd-recurring-badge" title={t("task.recurringTooltip")}>🔁</span>
  {/if}
```

Add the style, matching the existing badge block's shape:

```css
  .gtd-priority-badge {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    padding-right: 2px;
    cursor: default;
  }
```

No `title` attribute on the priority badge: the popover carries the label, and a native tooltip would race the 800ms popover on the same hover.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Verify in the app**

With `npm run dev` running, create a scratch note containing:

```markdown
- [ ] Highest thing 🔺
- [ ] High thing ⏫
- [ ] Medium thing 🔼
- [ ] Low thing 🔽
- [ ] Lowest thing ⏬
- [ ] Plain thing
- [ ] Repeating thing 🔁 every week
```

Confirm: all five priority emoji render on their rows at the default setting; switching the dropdown to "Medium and above" drops 🔽 and ⏬; "High and above" drops 🔼 as well; "Hidden" drops all five and leaves the other badges intact. Toggling "Show recurrence badge" off removes 🔁 from the row.

- [ ] **Step 5: Commit**

```bash
git add src/views/
git commit -m "feat: show Tasks priority as a row badge"
```

---

### Task 8: Popover metadata block

**Files:**
- Modify: `src/views/TaskItem.svelte`

**Interfaces:**
- Consumes: `formatTasksFields` (Task 5), `showTasksFieldsInPopover` (Tasks 6, 7).
- Produces: no exports; visual change only.

- [ ] **Step 1: Replace the popover's due section with the field block**

In `src/views/TaskItem.svelte`, add the import:

```ts
  import { formatTasksFields } from "../core/TasksFieldText";
```

Replace the `dueLine` reactive statement with:

```ts
  // The row glyphs obey their settings; the popover always tells the truth,
  // so it is gated only by its own toggle.
  $: fieldRows = showTasksFieldsInPopover ? formatTasksFields(task, dueStatus) : [];
```

Remove the now-unused `formatDueLine` import and the `dueLine` binding.

Replace the popover's due block (the `{#if dueLine}` … `{/if}` section) with:

```svelte
      {#if fieldRows.length > 0}
        <div class="gtd-tooltip-fields">
          {#each fieldRows as row}
            <div class="gtd-tooltip-field">
              <span
                class="gtd-tooltip-field-emoji"
                class:is-overdue={row.emoji === "❢"}
                class:is-misfiled={row.emoji === "⚑"}
              >{row.emoji}</span>
              <span class="gtd-tooltip-field-text">{row.text}</span>
            </div>
          {/each}
        </div>
        <hr class="gtd-tooltip-divider" />
      {/if}
```

Add the styles, replacing `.gtd-tooltip-due`:

```css
  div.gtd-tooltip-field {
    display: flex;
    gap: 4px;
    align-items: baseline;
    color: var(--text-normal);
  }

  .gtd-tooltip-field-emoji {
    flex-shrink: 0;
  }

  .gtd-tooltip-field-emoji.is-overdue {
    color: var(--text-error);
    font-weight: 700;
  }

  .gtd-tooltip-field-emoji.is-misfiled {
    color: var(--text-warning);
    font-weight: 700;
  }
```

The ❢ and ⚑ colors are re-declared here rather than reusing `.gtd-overdue-badge` / `.gtd-misfiled-badge`: those two classes also carry row-specific sizing and padding that would be wrong inside the popover.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Verify in the app**

With `npm run dev` running, add to the scratch note:

```markdown
- [ ] Everything 📅 2026-08-07 🔺 🔁 every week ⏳ 2026-08-05 🛫 2026-08-03 ➕ 2026-07-01 🏁 delete
- [ ] Just due 📅 2026-08-07
- [ ] Nothing at all
- [ ] Bad date 📅 soon
```

Hover each for 800ms and confirm:
- "Everything" shows eight rows in the order 📅 🔺 🔁 ⏳ 🛫 ➕ 🏁, then the divider and the source line.
- The due row's glyph is 📅 while the task is on track, ❢ (red) when its due date has passed, ⚑ (amber) when it is misfiled.
- "Nothing at all" shows only the source line, with no leading divider.
- "Bad date" shows `📅 soon` in the *row text* and no due row in the popover.
- Turning "Show Tasks fields in popover" off removes the whole block, including the due row, leaving the subtask and source sections.
- Long text (over 40 chars) and subtask-count sections still render with correct dividers.

- [ ] **Step 4: Commit**

```bash
git add src/views/TaskItem.svelte
git commit -m "feat: list Tasks-plugin fields in the task hover popover"
```

---

### Task 9: Back-compatible order-key disambiguator

**Files:**
- Modify: `src/core/TaskOrder.ts:11-28` (`disambiguator`)
- Test: `tests/TaskOrder.test.ts`

**Interfaces:**
- Consumes: the new `TaskRecord` fields (Task 3).
- Produces: no signature change — `computeOrderKeys` and `computeLegacyOrderKeys` keep their exports.

- [ ] **Step 1: Write the failing tests**

Append to `tests/TaskOrder.test.ts`:

```ts
describe("disambiguator back-compatibility", () => {
  it("hashes a task with no Tasks fields to its pre-change key", () => {
    // Captured from the pre-change implementation: hash("Buy milk|") + ":0".
    // This literal is the whole guarantee that existing users keep their saved
    // manual order — if it changes, every stored order entry is orphaned.
    const tasks = parseFile("notes.md", "- [ ] Buy milk");
    const keys = computeOrderKeys(tasks);
    expect(keys.get(tasks[0].id)).toEqual({ file: "notes.md", key: "4046230919:0" });
  });

  it("distinguishes two identical-text tasks by priority", () => {
    const tasks = parseFile("notes.md", "- [ ] Call Bob 🔺\n- [ ] Call Bob ⏫");
    const keys = computeOrderKeys(tasks);
    expect(keys.get(tasks[0].id)!.key).not.toBe(keys.get(tasks[1].id)!.key);
  });

  it("distinguishes two identical-text tasks by recurrence", () => {
    const tasks = parseFile("notes.md", "- [ ] Review 🔁 every week\n- [ ] Review 🔁 every month");
    const keys = computeOrderKeys(tasks);
    expect(keys.get(tasks[0].id)!.key).not.toBe(keys.get(tasks[1].id)!.key);
  });

  it("does not confuse a priority value with a recurrence rule of the same text", () => {
    const tasks = parseFile("notes.md", "- [ ] T 🔁 high\n- [ ] T ⏫");
    const keys = computeOrderKeys(tasks);
    expect(keys.get(tasks[0].id)!.key).not.toBe(keys.get(tasks[1].id)!.key);
  });

  it("still falls back to occurrence index for genuinely identical tasks", () => {
    const tasks = parseFile("notes.md", "- [ ] Same 🔺\n- [ ] Same 🔺");
    const keys = computeOrderKeys(tasks);
    expect(keys.get(tasks[0].id)!.key).toMatch(/:0$/);
    expect(keys.get(tasks[1].id)!.key).toMatch(/:1$/);
  });
});
```

Add `parseFile` and `computeOrderKeys` to that file's imports if not already present.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --testPathPattern=TaskOrder`
Expected: FAIL on the priority/recurrence cases (identical keys), PASS on the back-compat literal and the occurrence-index case — those two are guards on behaviour that must survive.

- [ ] **Step 3: Extend the disambiguator**

In `src/core/TaskOrder.ts`, replace `disambiguator` and its doc comment:

```ts
/**
 * Content used to distinguish tasks with identical visible text.
 *
 * HARD INVARIANT: only fields this plugin's own actions NEVER write may appear
 * here. Every field below is read-only today — no GTD-Tasks action mutates a
 * priority, a recurrence rule, or any date but 📅 — but that is incidental to
 * current scope, not structural. Adding a write path for one of them (a "bump
 * priority" quick action, say) reintroduces the bug fixed on 2026-07-22:
 * `tags`/`inlineField` were in this hash while `moveTaskToBucket` writes
 * exactly those, so computeOrderKeys — called once right after the write, with
 * TaskIndex's async reindex not yet caught up, and again on the next render
 * after it has — produced two different keys for the same task. Its
 * freshly-saved key never matched, and every cross-bucket drop landed at the
 * bucket's end. Check this invariant before adding anything here.
 *
 * isCompleted/completedAt are excluded for the same reason: they flip on every
 * checkbox toggle and must not perturb order.
 *
 * Extras are appended only when present, so a task carrying none of them
 * produces a byte-identical string to the pre-extras version and keeps its
 * saved order across the upgrade. Each extra is key-prefixed so a priority of
 * "high" cannot collide with a recurrence rule reading "high".
 */
function disambiguator(task: TaskRecord): string {
  const due = task.dueDate ? task.dueDate.toISOString() : "";
  const base = `${task.text}|${due}`;
  const extras = [
    task.priority && `p:${task.priority}`,
    task.recurrence && `r:${task.recurrence}`,
    task.scheduledDate && `s:${task.scheduledDate.toISOString()}`,
    task.startDate && `b:${task.startDate.toISOString()}`,
    task.createdDate && `c:${task.createdDate.toISOString()}`,
    task.cancelledDate && `x:${task.cancelledDate.toISOString()}`,
    task.blockId && `i:${task.blockId}`,
  ].filter((e): e is string => Boolean(e));
  return extras.length > 0 ? `${base}|${extras.join("|")}` : base;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, including `OrderMigration` and `OrderPurge`, which round-trip keys through this function.

- [ ] **Step 5: Commit**

```bash
git add src/core/TaskOrder.ts tests/TaskOrder.test.ts
git commit -m "feat: disambiguate order keys by read-only Tasks fields"
```

---

### Task 10: Documentation and TODO cleanup

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `TODO.md` (gitignored — edit but do not commit)

- [ ] **Step 1: Document the new settings in README.md**

Find the section documenting the overdue and misfiled flags (added in commit `c1442fb`) and add a sibling subsection for the Tasks plugin integration settings: what the three controls do, the four priority-dropdown entries and which levels each admits, and the rule that badge settings gate row glyphs only while the popover always shows every field.

- [ ] **Step 2: Update CLAUDE.md's architecture notes**

In the "Key files" table, update the `TasksPluginParser.ts` row — it no longer just reads 📅/✅:

```markdown
| [src/integrations/TasksPluginParser.ts](src/integrations/TasksPluginParser.ts) | Token table + two-phase scanner for all Tasks-plugin metadata; sole owner of that syntax |
```

Add a row for the new module:

```markdown
| [src/core/TasksFieldText.ts](src/core/TasksFieldText.ts) | Formats a task's Tasks-plugin fields into ordered hover-popover rows |
```

And in the "Data flow" block, change the `TasksPluginParser` line to read:

```
  → TasksPluginParser  single-pass scan of all Tasks-plugin tokens → structured fields
```

- [ ] **Step 3: Close the TODO item**

In `TODO.md`, move the "Rewrite Tasks-plugin metadata stripping as a single pass" section under a `### RESOLVED:` heading following the file's existing convention, recording: the spec and plan paths, that rejected markers stay visible, that ordering-by-priority was split out as future work, and the one-time order loss for tasks carrying ⏳/🛫/🆔/⛔/🔺.

Add a new open item for the deferred work surfaced during design:

```markdown
### Tasks integration: ordering by priority and due date
The "Tasks plugin integration" settings section currently holds display controls only.
Ordering tasks by priority / due date instead of (or alongside) manual drag order was
raised while designing it and deliberately deferred — it interacts with saved manual
order, which is the fragile part of the codebase. The section's blurb is worded
generically so a control can be added without rewording it.
*Raised 2026-08-06, designing the single-pass metadata rewrite.*
```

- [ ] **Step 4: Verify and commit**

Run: `npm run build && npm test && node scripts/validate-translations.mjs`
Expected: all clean.

```bash
git add README.md CLAUDE.md
git commit -m "docs: document Tasks plugin integration settings"
```

---

## Verification Checklist

Before considering the branch done:

- [ ] `npm test` — full suite green.
- [ ] `npm run build` — clean `tsc` pass and a produced `main.js`.
- [ ] `node scripts/validate-translations.mjs` — all 12 locales at parity.
- [ ] Manual: the scratch note from Tasks 7 and 8 renders correctly, and all three settings take effect without an Obsidian restart.
- [ ] Manual: drag a task to reorder it within a bucket, reload Obsidian, confirm the order persisted — the disambiguator change must not have broken order round-tripping.
- [ ] Manual: drag a task across buckets and confirm it lands where dropped, not at the bucket's end — the specific failure mode the §7 invariant guards against.
