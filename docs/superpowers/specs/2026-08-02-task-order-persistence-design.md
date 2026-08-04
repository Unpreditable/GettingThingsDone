# Task Order Persistence — Design

Date: 2026-08-02
Status: approved pending final review
Input: the Task Order Tracking scenario catalog (Groups 1–5), reproduced in the
traceability table at the end.

## Problem

Manual per-bucket task order is stored in plugin data (`data.json`), keyed by a
content hash. The current key format (`hash(filePath + text + dueDate):occurrence`)
fails several catalog scenarios: editing a task's text or due date orphans its key
(1.1), renaming a file orphans every key in it (2.1/2.2), nothing ever purges keys
for deleted or aged-out tasks (3.4/4.1 — unbounded growth), and scope changes have
no defined semantics (4.4–4.6). Separately, the completion-time source (`✅` date)
does not exist in all configurations, so the "show completed until midnight" filter
currently shows dateless completed tasks forever.

## Decisions (made interactively, in order)

1. **Identity**: content-derived keys + event-driven migration. No IDs are ever
   written into files. The one case content identity cannot distinguish
   (delete + recreate an identical task) is explicitly permitted by scenario 1.2.
2. **Completion clock**: `✅ date ?? firstSeen`, where `firstSeen` is a plugin-data
   timestamp recorded only when the index *witnesses* a task transition to
   completed with no date. Unwitnessed completions (already completed at first
   sight) are treated as aged — hidden immediately, no record created.
   Rationale: the until-midnight view exists so a completion performed in front of
   the user doesn't vanish instantly; a completion the user performed outside
   Obsidian needs no such courtesy.
3. **Edit pairing**: tiered diff — key match, then same-line pairing, then
   sole-leftover pairing; anything more ambiguous degrades to add/delete.
4. **External file moves** (delete+create with no rename event): accepted loss.
5. **Cleanup**: two evidence-based purge rules (aged-out at refresh, dangling at
   startup reconciliation), no timers. Scope changes never discard anything —
   out-of-scope entries go dormant — so the 4.5 warning dialog does not need to
   exist.
6. **Settings**: the `readTasksPlugin` toggle is removed. Parsing of 📅/✅ and
   due-date auto-assign become always-on. The panel's completion toggle delegates
   to the Tasks plugin's documented `apiV1` when present (both completing and
   reopening), and performs a minimal checkbox flip — writing no date — when
   absent. Panel behavior therefore always matches editor behavior on the same
   device, by construction.

## Data model (`data.json`)

```ts
interface OrderEntry {
  file: string;  // vault-relative path, stored beside the key, NOT hashed into it
  key: string;   // hash(`${text}|${dueDateISO}`) + ":" + occurrenceIndex
}

taskOrder: Record<string, OrderEntry[]>;  // bucketId → entries in display order
completionSeen: Record<string, number>;   // `${file}::${key}` → epoch ms
```

- The file path moving out of the hash is what makes rename migration a trivial
  in-place field rewrite.
- `occurrenceIndex` disambiguates identical tasks within one file, counted in
  line order per disambiguator, exactly as today.
- The disambiguator remains `text|dueDate` only. **Hard invariant (existing, kept):
  only fields this plugin's own actions never write may enter the disambiguator.**
  Completion state, tags, and inline fields stay excluded.
- `completionSeen` holds only witnessed, dateless completions from today —
  records older than today are purged, and the no-record rule (decision 2) keeps
  aged tasks hidden without them, so the map cannot accumulate history.
- Removed setting: `readTasksPlugin`.

### One-time migrations at first launch after upgrade

Run after `initialScan` completes, before the first reconciliation (same pass):

1. **Order format**: for every indexed task, compute its *old-format* key
   (`hash(filePath:text|due):occurrence`). Match old flat strings in `taskOrder`
   against them; rewrite hits to structured `OrderEntry` values at the same array
   positions; drop only genuine orphans. Lossless for every task currently in the
   vault.
2. **Settings**: delete the `readTasksPlugin` field.

## Mechanisms

### Key computation (`TaskOrder.ts`)

`computeOrderKeys` keeps its shape (per-file grouping, line-order occurrence
counting) but stops folding `filePath` into the hash; callers receive
`{ file, key }` pairs. Runs per refresh over indexed tasks only — O(current tasks).

### Event-time migration (`TaskIndex`)

The `changed` handler keeps the previous parse of the file before replacing it,
then diffs old vs new:

- **Tier 1** — tasks whose keys match on both sides are unchanged.
- **Tier 2** — an unmatched old task and an unmatched new task at the *same line
  number* is an in-place edit → rewrite the entry's `key` in place in every
  bucket array, and rekey its `completionSeen` record if any.
- **Tier 3** — if exactly one unmatched old and one unmatched new remain (any
  lines), pair them as an edit.
- Anything more ambiguous: leftover old entries go dormant (harmless under lazy
  purge), leftover new tasks are new.

The same diff detects completion transitions:

- open → completed, and the new line has no ✅ date → record
  `completionSeen[entryId] = now`.
- completed → open → delete the record.

The `rename` handler rewrites the `file` field of the renamed file's entries and
`completionSeen` keys (positions untouched — structurally lossless), and updates
the path in `settings.filePaths` when the file is explicitly listed in a
"specific files" scope (2.2).

The `delete` handler does **nothing extra** — laziness is deliberate, so external
delete+create sequences and cut-wait-paste edits don't insta-lose positions.

### Purge rules

Both are evidence-based (never act on an incomplete view) and piggyback on work
that already happens (no timers, no schedules):

- **Aged-out** — during grouping, where the key→task map already exists: purge any
  entry whose task exists in the index, is completed, and whose clock
  (`completedAt ?? completionSeen ?? aged`) is before today's midnight. Purge
  `completionSeen` records older than today at the same time.
- **Dangling** — only at startup reconciliation, after `initialScan` resolves
  (complete view of every scoped file): purge an entry when its file no longer
  exists in the vault, or when its file is in scope, fully parsed, and contains
  no matching key. An entry whose file exists but is **out of scope is kept
  dormant** — scope is reversible; re-widening restores positions. Dormant
  entries still purge when their file is truly deleted.

### Visibility filter (`BucketGroup.svelte`)

A completed task is shown iff its clock ≥ today's midnight, where clock is
`completedAt ?? completionSeen[entryId]`, and **no clock means aged (hidden)**.
Behavior changes from today: a dateless completed task no longer lingers forever;
a task completed while Obsidian was closed is hidden immediately at next launch.

### Completion toggle (`TaskWriter`)

- **Tasks plugin present** (`app.plugins.plugins["obsidian-tasks-plugin"]?.apiV1`
  exposes `executeToggleTaskDoneCommand`): pass the raw line and path; write back
  whatever it returns. Handles 0 lines (on-completion delete), 1 line (plain
  toggle, with or without ✅ per Tasks' own settings), or 2 lines (🔁 recurrence —
  the new occurrence is inserted as a new line). Used for both completing and
  reopening. Tasks applies its own settings, global filter, and future behaviors;
  panel ≡ editor by construction.
- **Tasks absent, or the API call is missing/throws**: minimal flip
  `[ ]` ↔ `[x]`; on reopen also strip an existing ✅ date; never write a date.
- The plugin no longer writes ✅ itself under any configuration. **Release-note
  item**: users without Tasks previously got ✅ written on panel completions
  (old default `readTasksPlugin: true`); they stop getting dates, and visibility
  keeps working via `firstSeen`.

### Auto-assign (`BucketManager`)

The `settings.readTasksPlugin` gate on due-date auto-assignment is removed;
auto-assign runs whenever a task has a due date. Per-bucket opt-out already
exists (`dateRangeRule: null`).

### Move/reorder plumbing (`main.ts`)

`handleReorder`/`handleMove` switch from flat key arrays to `OrderEntry[]`;
`purgeOrderKey`/`mapToOrderKeys` operate on entries. Logic otherwise unchanged,
including the silent-reindex-then-single-refresh sequencing.

## Scenario traceability

| Scenario | How it's satisfied |
|---|---|
| 1.1 edit keeps position | Tiered diff pairs the edit; entry key rewritten in place |
| 1.2 identical recreate | Relaxed by catalog; content identity + lazy purge may inherit — permitted |
| 2.1 rename keeps order | Rename event rewrites `file` field in place; nothing rehashed |
| 2.2 rename in files scope | Same handler updates `settings.filePaths` |
| 3.1 toggle never moves task | Completion state excluded from key; toggling touches nothing else |
| 3.2 position held while visible | Entry persists; aged-out purge fires only once clock < today |
| 3.3 same-day reopen restores | Key unchanged by completion; witnessed transitions always have a clock |
| 3.4 aged tasks release position | Aged-out purge during grouping; no-record rule prevents re-linger loops |
| 4.1 deleted tasks cleaned up | Dangling purge at startup reconciliation |
| 4.2 no timers | Purges ride on grouping (already per-refresh) and startup scan |
| 4.3 never purge on partial view | Aged-out requires the task to exist; dangling runs only post-`initialScan` |
| 4.4 scope narrowing ≠ deletion | Out-of-scope entries dormant, never purged while the file exists |
| 4.5/4.6 warn before discard | Vacuously satisfied — no scope change can discard, so no dialog exists |
| 5.1 cost scales with current set | Per-refresh work is O(indexed tasks + entries); both bounded by purges |

## Accepted losses (recorded, agreed)

- External-tool file moves (delete+create) reset that file's saved order.
- Bulk multi-task edits within one debounce window may append instead of migrate.
- Editing one of several identical tasks can shuffle occurrence indexes (1.2).
- Dateless completions performed while Obsidian was closed hide immediately.
- Non-Tasks users can no longer get ✅ dates written by the panel; the escape
  hatch is installing Tasks.

## Error handling

- Pairing ambiguity always degrades to append-at-end — never a wrong pairing.
- Tasks API failure falls back to the minimal flip inside the same
  `vault.process` call; a Notice is not needed (the fallback is a valid outcome).
- Reconciliation and format migration run strictly after `initialScan` resolves.
- All `data.json` mutations go through the existing `saveSettings()` batching.

## Testing

Pure-logic units, no Obsidian API (consistent with the existing `tests/` suites):

- Diff/pairing: tier 1/2/3 cases, ambiguous bulk edits, completion transitions.
- Purge rules: aged-out (with date, with record, with neither), dangling
  (file gone / in-scope no match / out-of-scope dormant).
- Rename migration: entries, `completionSeen`, `filePaths` scope list.
- Format migration: flat → structured, orphan dropping, position preservation.
- Key computation: path independence, occurrence counting.
- `TaskWriter` delegation: mocked `apiV1` returning 0/1/2 lines; fallback path.
- Existing `TaskOrder`/`BucketManager`/`StorageMigrator` suites updated for the
  new entry shape and removed setting.

## Out of scope

- Storing bucket assignment itself in plugin data (tracked in TODO.md; blocked on
  this design landing first).
- Single-pass metadata-stripping parser rewrite and disambiguator extension
  (tracked in TODO.md; the hard invariant above still applies when it lands).
