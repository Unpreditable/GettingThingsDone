# Due flags: splitting the `!` indicator into overdue and misfiled

**Date:** 2026-08-05
**Status:** Approved, pending implementation plan

## Problem

A task due today, manually filed in **This Week**, shows a red `!`. The setting that
controls that badge is labelled *"Mark overdue tasks with !"* — but a task due today is
not overdue. Reported from real use; reproduced against the live rules:

```
auto (no tag)          → bucket: today       stale: false
manual #gtd/today      → bucket: today       stale: false
manual #gtd/this-week  → bucket: this-week   stale: TRUE
manual #gtd/next-week  → bucket: next-week   stale: TRUE
manual #gtd/this-month → bucket: this-month  stale: TRUE
manual #gtd/someday    → bucket: someday     stale: false
```

Date parsing is not at fault: `parseDueDate` builds a local midnight and `diffInDays`
correctly returns 0 for today.

### Root cause

`isStale()` in `src/core/BucketManager.ts` is a hand-maintained *mirror* of
`autoAssign()`'s rule switch. Both enumerate the same eight `DateRangeRule` types; one
decides where a task is placed, the other decides whether it is flagged. Two switches
that must agree, maintained separately, drifted apart. `tests/BucketManager.test.ts:117`
locks the drifted behavior in as if it were intended.

A second, latent instance of the same drift: `within-days-range` flags at
`diff < from - 1`, so a task due exactly one day before its window opens goes unflagged.

## Decisions

The single `!` becomes two states, because the user has two distinct concerns:

| State | Glyph | Color | Means |
|---|---|---|---|
| **overdue** | `!` | `var(--text-error)` | The due date has passed. "You're late." |
| **misfiled** | `⚑` | `var(--text-warning)` | A bucket earlier in the list claims this due date. "This will be late if you don't move it." |

Both glyphs are text-presentation codepoints, so they take theme colors. No emoji: the
Tasks plugin's priority markers (`🔺⏫🔼🔽⏬`) are arrow-shaped and will be displayed on
these rows in future work, so any arrow glyph (`↑ ⇧ ▲`) would collide. `⚑` (U+2691) does
not.

Neither glyph appears on a completed task.

## Model

New module `src/core/DueStatus.ts` — pure, no Obsidian import, unit-testable. It owns
`diffInDays` (moved out of `BucketManager`, which imports it back for `autoAssign`).

```ts
export type DueStatus =
  | { kind: "overdue";  diffDays: number }
  | { kind: "misfiled"; diffDays: number; belongsIn: BucketConfig }
  | { kind: "on-track"; diffDays: number };

/** Extracted verbatim from autoAssign's switch — the single source of truth. */
export function matchesRule(rule: DateRangeRule, dueDate: Date, now: Date): boolean;

export function computeDueStatus(
  task: TaskRecord,
  currentBucketId: string,
  buckets: BucketConfig[],
  now: Date
): DueStatus | null;
```

`autoAssign()` is rewritten to `buckets.find(b => b.dateRangeRule && matchesRule(...))`,
so placement and flagging can never disagree again.

### Algorithm

```
computeDueStatus:
  no due date                         → null   (no glyph, no popover due line)
  task.isCompleted                    → on-track
  diffDays < 0                        → overdue
  autoIdx = index of first bucket whose rule matches the due date
  autoIdx not found                   → on-track
  curIdx  = index of currentBucketId in buckets
  curIdx not found (To Review)        → on-track
  autoIdx < curIdx                    → misfiled (belongsIn = buckets[autoIdx])
  otherwise                           → on-track
```

**Misfiled is `autoIdx < curIdx`, not `autoIdx !== curIdx`.** The flag fires only when a
task sits *later* than its due date warrants. Deliberately pulling a task forward — a task
due Friday dragged into Today on Wednesday to work on it early — is a choice, not a
mistake, and stays silent.

The test is "does an earlier-listed bucket claim this date", not "does my own bucket's
rule match". A task due in 3 days sitting in **This Month** is misfiled even though This
Month's own range (1…end of month) does cover it, because This Week is listed first and
also covers it. This is the intended review workflow: tasks migrate inward, Next Month →
This Month → Next Week → This Week → Today.

### Why bucket order is the tie-break

Ranges overlap by design. When several buckets claim a date, the first one in the user's
configured order wins — which is what `autoAssign` already does, and the default order is
tightest-first. Verified on a Wednesday with default buckets:

| due in | first matching bucket | expected |
|---|---|---|
| 3 days | This Week (range 1–4) | This Week ✅ |
| 10 days | Next Week (range 5–11) | Next Week ✅ |
| 20 days | This Month (range 1–26) | This Month ✅ |

Computing each rule's numeric span instead was rejected: a span-based "smallest wins"
could pick a different bucket than `autoAssign` does under a reordered bucket list, so
the panel could flag a task that it auto-placed itself — reintroducing the two-sources-of-
truth bug this design removes. Bucket order in Settings → Buckets *is* the declaration of
which bucket is tightest.

### Buckets with no date rule

**Someday** and **To Review** have no `dateRangeRule`, so today's `isStale` returns
`false` immediately and they never flag anything. Under the new model they flag `overdue`
normally — a due date you set and blew past is worth knowing about wherever the task sits.

They can still be `misfiled`: Someday is last in the list, so a task there due in 2 weeks
is claimed by This Month and gets `⚑`. A task in Someday due in 6 months is claimed by
nobody and stays silent — which is exactly what Someday is for.

To Review holds only dateless or unclaimed tasks by construction (a dated task matching
any rule is auto-placed), so its `curIdx not found → on-track` branch is defensive.

## Data flow

`BucketGroup.staleTaskIds: string[]` → `dueStatuses: Record<string, DueStatus>`, one entry
per dated task in the group.

The status is now computed unconditionally, because the popover shows a due line even for
on-track tasks. `settings.staleIndicatorEnabled` therefore stops gating *computation* and
gates *rendering of the two row glyphs* only; a new `showDueFlags` prop threads
`GTDPanel → BucketGroup → TaskItem`. The popover always tells the truth regardless of the
toggle — the toggle is about row noise, and popover content is on-demand detail.

`TaskItem`'s `isStale: boolean` prop becomes `dueStatus: DueStatus | null`.

## Rendering

### Row

Same slot the current `!` occupies:

- `.gtd-overdue-badge` — `!`, `var(--text-error)` (today's `.gtd-stale-badge`, renamed)
- `.gtd-misfiled-badge` — `⚑`, `var(--text-warning)`

The `title=` attributes come off both glyphs. The popover now carries the real
explanation, and two tooltips competing on one row is worse than one.

### Popover

The due line goes **first**, above the task text — it is the reason you hovered.

```
┌────────────────────────────┐
│ ⚑ Due today (belongs in    │
│   Today)                   │
│ ────────────────────────── │
│ File the tax form with the │
│ receipts attached          │
│ ────────────────────────── │
│ @ Tasks.md (L7)            │
└────────────────────────────┘
```

| state | line |
|---|---|
| on-track | `Due Fri, Aug 7` |
| on-track, due today | `Due today` |
| overdue | `! Due Sat, Aug 1 (3 days overdue)` |
| overdue, by one day | `! Due Mon, Aug 3 (1 day overdue)` |
| misfiled | `⚑ Due today (belongs in Today)` |
| misfiled, future date | `⚑ Due Sat, Aug 8 (belongs in This Week)` |

Every dated task gets the line — the panel shows dates nowhere else, so the popover
becomes the place to check one without opening the file. A dateless task's popover is
unchanged. A completed task computes as `on-track`, so a completed task whose date has
passed shows the plain `Due Sat, Aug 1` with no glyph and no overdue parenthetical.

Dates format via `Intl.DateTimeFormat(i18next.language, { weekday: "short", month:
"short", day: "numeric" })`. `diffDays === 0` renders as "today". "Tomorrow" is not
special-cased.

## Day rollover

`now` is captured once per `groupTasksIntoBuckets` call, and `renderAll()` only ever runs
off vault events, settings saves, and load — there is no timer in the plugin. An Obsidian
left open overnight therefore shows yesterday's buckets until the first edit, which then
reshuffles everything at once. This already affects auto-placement today, independent of
this feature.

Two event-driven triggers, no polling:

- **`setTimeout` to the next local midnight**, re-armed on each fire, cleared in
  `onunload`. Computed as `new Date(y, m, d + 1, 0, 0, 1)` so it is DST-safe (wall-clock
  arithmetic, plus a one-second skew).
- **`registerDomEvent(window, "focus", …)`**, which fires exactly when the user returns
  to the machine.

Both call the same cheap `maybeRolloverDay()`: compare `dayKey(today())` to the day
`renderAll()` last ran on, and re-render only if it differs. `renderAll()` records the day
each time it runs.

The focus listener exists because a `setTimeout` alone is unreliable across system
suspend: Chromium measures the delay on a clock that generally does not advance while the
machine sleeps, so a timer armed at 4pm for midnight, with the lid closed 6pm–8am, may not
fire until mid-afternoon. Background-window throttling (timers coalesced to roughly once a
minute) is real but harmless for a midnight rollover.

Two pure helpers, unit-testable, live beside the status logic:

```ts
export function dayKey(d: Date): string;              // "2026-08-05", local
export function msUntilNextMidnight(now: Date): number;
```

## Settings and i18n

The persisted field name `staleIndicatorEnabled` **stays** — renaming it needs a
`data.json` migration for no user-visible gain. A comment records that its name predates
the two-state split.

i18n key `settings.behaviour.markOverdue` → `markDueFlags`, relabelled to describe both
states. Both call sites update: the declarative definition (`src/settings-tab.ts:330`) and
the legacy `Setting` builder (`src/settings-tab.ts:596`).

New keys under `task.due`:

| key | English |
|---|---|
| `today` | `Due today` |
| `date` | `Due {{date}}` |
| `overdue_one` | `{{count}} day overdue` |
| `overdue_other` | `{{count}} days overdue` |
| `belongsIn` | `belongs in {{bucket}}` |
| `withDetail` | `{{main}} ({{detail}})` |

`withDetail` exists so locales control the parenthetical rather than having it hardcoded
in the composing code.

Removed: `task.staleTooltip`, `settings.behaviour.markOverdue.*`.

All 14 locale files are updated, with `_comment` entries in `en.json` and full plural sets
for `overdue` — `_few`/`_many` for ru/uk/lt, `_zero` for lv — matching the existing
`activeSubtasks` precedent. `sample_lang.json` gets empty-string placeholders, as it does
for every other key.

## Tests

New `tests/DueStatus.test.ts`:

- `matchesRule` for all eight rule types at both window boundaries
- `within-days-range` at exactly `from - 1` — the latent off-by-one, which must now flag
- overdue at `diff === -1`, on-track at `diff === 0` in the Today bucket
- misfiled: due today in This Week; due in 3 days in This Month; due in 2 weeks in Someday
- pull-forward stays on-track: due Friday while in Today
- Someday with a 6-month-out date stays on-track
- completed tasks never overdue or misfiled
- `dayKey` and `msUntilNextMidnight`, including across a DST boundary

Updated `tests/BucketManager.test.ts`: `:64` and `:117` rewritten — the latter currently
asserts the reported bug as correct behavior. All `staleTaskIds` references become
`dueStatuses`.

## Files

| File | Change |
|---|---|
| `src/core/DueStatus.ts` | new — `matchesRule`, `computeDueStatus`, `diffInDays`, `dayKey`, `msUntilNextMidnight` |
| `src/core/BucketManager.ts` | delete `isStale`; `autoAssign` uses `matchesRule`; `staleTaskIds` → `dueStatuses` |
| `src/main.ts` | midnight timer, focus listener, `maybeRolloverDay`, last-rendered-day tracking |
| `src/views/GTDPanel.svelte` | pass `dueStatuses`, `showDueFlags` |
| `src/views/BucketGroup.svelte` | thread both props |
| `src/views/TaskItem.svelte` | two badges, popover due line, drop `title=` attrs |
| `src/settings.ts` | comment on `staleIndicatorEnabled` |
| `src/settings-tab.ts` | i18n key rename, both call sites |
| `src/i18n/locales/*.json` | 14 files |
| `tests/DueStatus.test.ts` | new |
| `tests/BucketManager.test.ts` | updated |

CSS follows the project rules: no `!important`, no inline styles, Obsidian variables for
all colors.

## Out of scope

- A toggle to hide the popover due line — deferred until it proves annoying.
- Displaying Tasks plugin priority markers. Noted here only because it constrains glyph
  choice.
- "Tomorrow" as a special-cased date word.
- Renaming the `staleIndicatorEnabled` persisted field.
