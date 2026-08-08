# Tasks-plugin metadata: single-pass scanning, structured fields, and display

**Date:** 2026-08-06
**Status:** Approved, pending implementation plan

## Problem

`stripMetadata` in `src/core/TaskParser.ts` removes each kind of Tasks-plugin metadata with
its own independent regex, applied in sequence:

```ts
function stripMetadata(text: string): string {
  return text
    .replace(/\s+\^[\w-]+\s*$/, "")
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/✅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/🔁[^#[📅✅]*/gu, "")
    .replace(/[⏫🔼🔽⏬]/gu, "")
    .replace(/#[\w/-]+/g, "")
    .replace(/\[[\w-]+::\s*[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
```

Two of these fields have **free-text values** — 🔁 recurrence ("every week") and 🏁
on-completion ("delete") — with no terminator of their own. A regex for such a field can
only know where its value ends by carrying a hand-maintained list of every *other* field's
marker. The recurrence regex's list is `[^#[📅✅]` — four stop characters.

Every marker not in that list is therefore consumed. Given:

```
- [ ] Test 2 ⏫ 🔁 every week 🏁 delete 🛫 2026-10-11 ⏳ 2026-10-11
```

the recurrence match runs from 🔁 to end of line, silently eating 🏁, 🛫 and ⏳ along with
their values. Nothing downstream can recover them.

### Root cause

Sequential independent regexes make each field responsible for knowing the syntax of all
the others. That is N×N knowledge maintained in N places, and it is only ever *partially*
maintained. Adding the missing markers to the recurrence stop-list would fix this one line
and leave the structure that produced it intact: the next field added — or the next field
pairing nobody tested — reintroduces the same bug somewhere else.

Three further defects fall out of the same structure:

1. **🔺 (highest priority) is not stripped at all.** The priority regex lists only
   `[⏫🔼🔽⏬]`. A task marked highest priority shows a stray 🔺 in the panel.
2. **⏳ scheduled and 🛫 start are never stripped.** They sit inside `task.text` verbatim,
   and therefore inside the order-key hash (see §7).
3. **Almost nothing is parsed.** Only 📅 and ✅ become structured `TaskRecord` fields.
   Everything else is discarded, so the panel can never show it.

## Decisions

Replace the sequential regexes with **one scan that locates every token's span before
anything is removed**. A free-text value then terminates at the next token's start index —
a fact the scanner already has, not a guess encoded in a stop-list. Adding a token to the
table cannot reintroduce the bug, because no pattern owns a stop-list any more.

The fields that scan produces become real `TaskRecord` fields, and get displayed:
priority as a row badge, everything else in the existing hover popover.

Scope note: this recognizes the **emoji** syntax only. Tasks also supports a Dataview-style
form (`[due:: 2026-08-10]`); that is deliberately out of scope, and it does not leak into
the visible text because the existing generic `[key:: value]` stripper removes it.

## Model

### 1. The scanner

Lives in `src/integrations/TasksPluginParser.ts` — it is the Tasks integration, and keeping
it there stops `TaskParser` from growing a second syntax's knowledge.

```ts
export type TasksField =
  | "due" | "done" | "scheduled" | "start" | "created" | "cancelled"
  | "priority" | "recurrence" | "onCompletion" | "id" | "dependsOn";

export interface TokenSpan {
  field: TasksField;
  /** Index of the marker emoji in the input string. */
  start: number;
  /** Index one past the last character of the token (marker + value). */
  end: number;
  /** Parsed value: ISO date string, priority level, or free text. Null if unparseable. */
  value: string | null;
}

export function scanTasksMetadata(text: string): TokenSpan[];
```

The scan runs in two phases:

**Phase 1 — locate markers.** Walk the string once, recording the index of every
recognized marker emoji. This yields the complete set of boundaries before any value is
interpreted.

**Phase 2 — claim values.** For each marker in order, read its value according to its kind,
bounded by the *next marker's index* (or end of string). Boundaries come from phase 1 and
therefore include markers that phase 2 goes on to reject (below), so a rejected marker
still stops a preceding free-text value:

| Kind | Markers | Value grammar |
|---|---|---|
| Date | 📅 ✅ ⏳ 🛫 ➕ ❌ | `\d{4}-\d{2}-\d{2}` after optional whitespace |
| Level | 🔺 ⏫ 🔼 🔽 ⏬ | none — the marker *is* the value |
| Free text | 🔁 🏁 | everything up to the next marker, trimmed |
| Id | 🆔 ⛔ | `[A-Za-z0-9_-]+`; comma-separated list for ⛔ |

Edge rules, each with a test:

- **Rejected marker.** A marker whose value fails to parse — `📅 soon`, a bare 🔁 with
  nothing after it, 🆔 followed by punctuation — is **not a token**. It produces no span, is
  not stripped, and yields no field. `- [ ] Pay rent 📅 soon` therefore reads `Pay rent 📅
  soon` on the row, gets no due row in the popover, and lands in To Review.

  This preserves today's behaviour exactly, and the visible 📅 is the only signal the user
  gets that Tasks cannot read what they typed. Stripping the marker and keeping the text
  would leave an orphaned "soon" with no trace of what it was; stripping both risks
  swallowing a sentence, since a free-text value is bounded only by the next marker.

  Level markers (🔺⏫🔼🔽⏬) have no value and so can never be rejected.

  A rejected marker still bounds its neighbours, per phase 2 above — this is what keeps
  `🔁 every week 📅 soon` from letting the recurrence value run to end of line.
- **Duplicate markers** (`📅 2026-01-01 📅 2026-02-01`): the first occurrence's value wins;
  every occurrence is stripped. Matches Tasks' own first-wins behavior.
- **Unrecognized emoji**: not a marker, not stripped, stays in the text.
- **Marker order is irrelevant.** Phase 1 does not assume the canonical Tasks ordering.

🆔 and ⛔ are scanned and stripped but produce no `TaskRecord` field — nothing would consume
them, and leaving them in the table is what stops them from breaking a neighbouring
free-text value later.

### 2. Span merging in `TaskParser`

`stripMetadata` stops being a chain of replacements and becomes a merge-and-cut:

```ts
function stripMetadata(text: string): string {
  const spans = [
    ...scanTasksMetadata(text),          // Tasks plugin syntax
    ...scanObsidianMetadata(text),       // #tags, [key:: value], trailing ^blockid
  ];
  return cutSpans(text, spans);          // sort, merge overlaps, remove, collapse spaces
}
```

`scanObsidianMetadata` is local to `TaskParser` — `#tags`, Dataview inline fields and block
references are not Tasks-plugin syntax and do not belong in the integration module.
`cutSpans` sorts by start index, merges any overlaps, removes back-to-front, then applies
the existing `\s{2,}` collapse and trim.

`parseDueDate` and `parseCompletionDate` keep their exported signatures but delegate to the
scanner rather than running their own regex, so there is exactly one definition of what a
📅 token is. They have no production callers — `TaskParser` was the only one, and this
rewrite removes even that — so they survive purely as the integration module's one-line
entry point for a raw line. Deleting them instead is a reasonable alternative.

`parseFile` today scans each line three times over: `parseDueDate(line)`,
`parseCompletionDate(line)`, and `stripMetadata(rawRest)`. It instead scans `rawRest` once
and derives every field plus the stripped text from that one result — "single pass" meaning
literally once per line, not once per field. The standalone `parseDueDate` /
`parseCompletionDate` exports remain for callers outside the parser, which hold a raw line
and no scan result.

### 3. New `TaskRecord` fields

```ts
export type TaskPriority = "highest" | "high" | "medium" | "low" | "lowest";

// added to TaskRecord:
priority: TaskPriority | null;
recurrence: string | null;      // "every week"
scheduledDate: Date | null;
startDate: Date | null;
createdDate: Date | null;
cancelledDate: Date | null;
onCompletion: string | null;    // "delete"
blockId: string | null;         // without the leading ^
```

`dueDate` and `completedAt` keep their current names and types.

`isRecurring()` in `src/core/TaskOrder.ts` drops its `rawLine.includes("🔁")` substring test
for `task.recurrence !== null`. The substring test currently matches a 🔁 appearing anywhere
on the line, including inside the task's own visible text.

### 4. Row badges — priority

Priority renders as Tasks' own emoji (🔺⏫🔼🔽⏬), in the badge strip immediately before the
🔁 recurrence badge. Using the file's own glyphs rather than inventing a second notation:
the user already reads these in their notes.

Which levels render is controlled by the `priorityDisplay` setting (§6). This is display of
data already in the file — the plugin never computes or infers a priority — so unlike the
due flags there is no case where the badge can be "wrong".

The 🔁 recurrence badge gains a setting of its own but keeps its current appearance.

### 5. Popover block

The hover popover's first section becomes one row per present field, in fixed order, each
reading **emoji + localized label + value**:

```
┌──────────────────────────────────┐
│ 📅 Due in 3 days (Wed, Aug 5)    │
│ 🔺 Highest                       │
│ 🔁 Repeats every week            │
│ ⏳ Scheduled Wed, Aug 5          │
│ 🛫 Starts Mon, Aug 3             │
│ ➕ Created Tue, Jul 1            │
│ ❌ Cancelled Wed, Aug 5          │
│ ✅ Done Mon, Aug 4               │
│ 🏁 On completion: delete         │
│ ──────────────────────────────── │
│ 3 active subtasks                │
│ ──────────────────────────────── │
│ @ inbox.md (L12)                 │
└──────────────────────────────────┘
```

The label word is what distinguishes ⏳ from 🛫 from ➕ for a reader who has not memorized
the Tasks glyph set; the emoji is what ties the row back to what is written in the file.

**Due row glyph.** Today the due row carries ❢ when overdue and ⚑ when misfiled, and
*nothing at all* when on track — which would leave the first column ragged on the most
common case once every other row leads with an emoji. The glyph slot is therefore always
filled, with the flag superseding 📅 when present:

| Status | Glyph |
|---|---|
| on track | 📅 |
| overdue | ❢ (`var(--text-error)`) |
| misfiled | ⚑ (`var(--text-warning)`) |

A flag supersedes rather than accompanies 📅 because it already means "this is a due date,
and there is a problem with it" — strictly more information than 📅 carries. `formatDueLine`
in `DueStatusText.ts` is unchanged; only the glyph slot in `TaskItem.svelte` gains its 📅
fallback.

📅 and ✅ are *already* stripped from `text` today and displayed nowhere. Including them here
is not new stripping — it is the first time either is shown at all.

**Formatting module.** `src/core/TasksFieldText.ts` — pure, no Obsidian import, no Svelte,
same shape as the existing `DueStatusText.ts`:

```ts
export interface FieldRow { emoji: string; text: string; }
export function formatTasksFields(task: TaskRecord): FieldRow[];
```

It returns only rows for fields that are present, already in display order, so
`TaskItem.svelte` renders an `{#each}` and owns no field-ordering logic.

**Row/popover split.** The rule established by the due flags carries over verbatim: *the
badge settings gate row glyphs only; the popover tells the truth.* The priority and
recurrence rows appear in the block regardless of `priorityDisplay` and
`showRecurrenceBadge`, gated only by `showTasksFieldsInPopover`.

### 6. Settings — new "Tasks plugin integration" section

A new section between **Behaviour** and **Buckets**, added to both
`getSettingDefinitions()` and its `renderLegacyBehaviourFallback` mirror in
`src/settings-tab.ts`.

`SettingDefinitionGroup` has `heading` but no description field, so the section blurb is
added as a first group item with a name and `desc` and no control (a
`SettingDefinitionEmpty`); the legacy path uses `setDesc()` on the heading `Setting`.

> **Tasks plugin integration**
> How this plugin treats the metadata the Tasks plugin writes on task lines.

The blurb is deliberately general — it does not enumerate fields or settings, so adding a
control to this section later (task ordering by priority is the anticipated one) requires
no rewording.

| Setting | Control | Default |
|---|---|---|
| Show priority | dropdown | All priorities |
| Show recurrence badge | toggle | on |
| Show Tasks fields in popover | toggle | on |

Priority dropdown entries — each answers a distinct question, none is a near-duplicate:

| Entry | Levels badged |
|---|---|
| All priorities | 🔺 ⏫ 🔼 🔽 ⏬ |
| Medium and above | 🔺 ⏫ 🔼 |
| High and above | 🔺 ⏫ |
| Hidden | none |

`PluginSettings` gains:

```ts
priorityDisplay: "all" | "medium-up" | "high-up" | "hidden";  // default "all"
showRecurrenceBadge: boolean;                                  // default true
showTasksFieldsInPopover: boolean;                             // default true
```

All three defaults preserve today's observable behaviour except priority, which today
displays a stray 🔺 by accident and nothing else.

### 7. Order-key disambiguator

`computeOrderKeys` currently hashes `` `${task.text}|${due}` ``. The TODO calls for the
newly-structured read-only fields to join it, so that two tasks with identical visible text
but different priority or recurrence stop colliding.

Extended **back-compatibly**: each extra is appended only when present, and key-prefixed so
`p:high` cannot collide with a recurrence rule that happens to read `high`.

```ts
function disambiguator(task: TaskRecord): string {
  const due = task.dueDate ? task.dueDate.toISOString() : "";
  const base = `${task.text}|${due}`;
  const extras = [
    task.priority       && `p:${task.priority}`,
    task.recurrence     && `r:${task.recurrence}`,
    task.scheduledDate  && `s:${task.scheduledDate.toISOString()}`,
    task.startDate      && `b:${task.startDate.toISOString()}`,
    task.createdDate    && `c:${task.createdDate.toISOString()}`,
    task.cancelledDate  && `x:${task.cancelledDate.toISOString()}`,
    task.blockId        && `i:${task.blockId}`,
  ].filter(Boolean);
  return extras.length > 0 ? `${base}|${extras.join("|")}` : base;
}
```

A task carrying none of these fields produces a **byte-identical** string to today's, so
the great majority of saved order entries survive the upgrade untouched.

**Accepted one-time loss.** Manual order is lost, once, for two groups of tasks:

1. Tasks carrying ⏳ / 🛫 / 🆔 / ⛔ / 🔺 — those markers live *inside* `task.text` today
   because nothing strips them, and the rewrite removes them, changing the text the hash is
   built from.
2. Tasks that gain an extra segment.

Both fall back to the existing graceful path — no saved key found, task appended at the end
of its bucket — not to an error. The affected population is narrow: a task must both carry
one of these fields *and* have been manually dragged.

**Hard invariant, to be written as a doc comment beside `disambiguator` and not violated:**

> Only fields this plugin's own actions never write may enter the disambiguator.

Every field added here is read-only *today* — no GTD-Tasks action mutates a priority, a
recurrence rule, or any date but 📅. That is incidental to current scope, not structural.
This is precisely the bug fixed on 2026-07-22: `tags`/`inlineField` were in the hash while
`moveTaskToBucket` writes exactly those, so a moved task's freshly-saved key stopped
matching the key computed on the next render and every cross-bucket drop landed at the
bucket's end. A future "bump priority" quick action would reintroduce that race unless this
invariant is checked first.

### 8. Internationalization

CI (`scripts/validate-translations.mjs`) enforces key parity across all 12 non-English
locales, so every new string ships in 13 languages. New keys:

- `settings.tasksIntegration.*` — heading, blurb, three setting names and descriptions,
  four priority dropdown entries.
- `task.priority.*` — five level labels (Highest, High, Medium, Low, Lowest).
- `task.fields.*` — row labels for recurrence, scheduled, start, created, cancelled, done,
  on-completion.

Every key gets a sibling `_comment` explaining its context, per the convention already in
`en.json`.

## Testing

All new logic is pure and unit-testable with no Obsidian API dependency, consistent with
the rest of `tests/`.

**`tests/TasksPluginParser.test.ts`** (extended) — the token table:

- The exact TODO repro line, asserting 🏁 / 🛫 / ⏳ all survive as parsed fields and `text`
  is `"Test 2"`.
- 🔁 immediately followed by each other marker in turn — the pairing matrix the old
  stop-list got wrong.
- Rejected marker (`📅 soon`): nothing stripped, `dueDate` null, row text unchanged — a
  regression guard on today's behaviour.
- Rejected marker as a boundary: `🔁 every week 📅 soon` parses `recurrence` as
  `"every week"` and leaves `📅 soon` in the text.
- Duplicate markers: first value wins, all stripped.
- Markers in non-canonical order.
- Unknown emoji preserved in text.
- All five priority levels parse, including 🔺.

**`tests/TaskParser.test.ts`** (extended) — span merging with `#tags`, `[key:: value]` and
trailing `^blockid`; overlapping spans; the existing strip assertions still pass.

**`tests/TasksFieldText.test.ts`** (new) — row order, absent fields omitted, due-glyph
supersession across on-track / overdue / misfiled.

**`tests/TaskOrder.test.ts`** (extended) — a regression guard on the back-compat claim in
§7: a task with none of the new fields must hash to the literal value it hashes to today.

## Out of scope

- **Dataview-style field syntax** (`[due:: 2026-08-10]`) — emoji form only.
- **Writing** any of the new fields. Everything here is read-only, which is what makes §7
  safe.
- **Task ordering by priority or due date.** Raised during design as a likely future
  addition to the new settings section; it is a substantial piece of work on its own and
  the section's blurb is worded so it can be added without rewording.
- **Structured fields or UI for 🆔 / ⛔.** Scanned and stripped only.
