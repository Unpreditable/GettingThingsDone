# Change Dates From the Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change or set a task's 📅 due / ⏳ scheduled date from the panel row's right-click menu, and move the bucket list into a "Move to ›" submenu.

**Architecture:** Pure logic in two new places: `src/core/DateMenu.ts` decides which entries and preset rows the menu shows, and a line writer in `TaskParser.ts` rewrites or inserts the date. A thin bridge in `src/integrations/Kalendae.ts` finds Kalendae's picker. `GTDPanel.svelte` builds the submenus; `main.ts` gets a `handleSetDate` that writes through `replaceTaskLine` and re-keys order the way `handleEdit` does.

**Tech Stack:** TypeScript, Svelte 4 syntax, Obsidian `Menu`, Jest.

**Spec:** [docs/superpowers/specs/2026-10-18-change-dates-from-panel-design.md](../specs/2026-10-18-change-dates-from-panel-design.md)

## Global Constraints

- **No commits.** Leave everything uncommitted; the user commits the finished feature as one commit (this overrides the skill's commit steps).
- New UI strings go into `src/i18n/locales/en.json` only, each with a `_comment` sibling. No other locale files.
- Date entries only for status `[ ]` or `[/]`, and never when `planBy === "manual"`.
- Presets count from today: Today, Tomorrow, Start of next week (from `settings.weekStartsOn`), In 1 week (+7), In 2 weeks (+14). No "end of week".
- Label row text: "Update unpins from {{name}}". Entry names: "Change due date", "Change scheduled date", "Set due date", "Set scheduled date".
- Only the date that decides placement unpins; the unpin and the date are one `vault.process` write.
- Rewrite keeps the original marker / Dataview bracket; insert matches Dataview only when every Tasks field on the line is Dataview.
- `setSubmenu()` is called through one typed helper only.
- No `!important`, no inline styles, Obsidian CSS variables only.

## Review Focus

1. **A date inside a code span or link** (`` `📅 2026-01-01` ``) must not be the one rewritten. The writer scans with the same Obsidian holes the parser uses (test in Task 2).
2. **Inline-field storage mode** — `[gtd:: today]` must not be mistaken for a Tasks field, and a new date must land after it, not before (test in Task 2).
3. **A stale row** — the line changed since indexing; the write aborts with the usual notice and reindexes (Task 4 reuses `replaceTaskLine`, which already does this; verified in QA).
4. **Week start on the current day** — on the week's first day, "Start of next week" equals "In 1 week" and collapses (test in Task 1).
5. **Kalendae present without the API, or `pickDate` rejecting** — no Custom… row in the first case; a rejection writes nothing and shows no error loop (tests in Task 3).

---

### Task 1: Menu logic (entries and presets)

**Files:**
- Create: `src/core/DateMenu.ts`
- Test: `tests/DateMenu.test.ts`

**Interfaces:**
- Consumes: `planningDate(task, planBy)` from `src/core/PlanningDate.ts`; `statusSymbol(rawLine)` from `TaskParser.ts`; `dayKey(d)` from `src/core/DueStatus.ts`.
- Produces:
  ```ts
  export type DateField = "due" | "scheduled";
  export type PresetId = "today" | "tomorrow" | "startOfNextWeek" | "inOneWeek" | "inTwoWeeks";
  export interface DatePreset { id: PresetId; date: Date; key: string /* YYYY-MM-DD */ }
  export interface DateEntry { kind: "change" | "set"; field: DateField; unpins: boolean }
  export function dateEntries(task: TaskRecord, planBy: PlanBy, pinned: boolean): DateEntry[]
  export function datePresets(today: Date, weekStart: number, current: Date | null): DatePreset[]
  ```

- [ ] **Step 1: Write the failing tests** in `tests/DateMenu.test.ts` (reuse the `makeTask` shape from `tests/PlanningDate.test.ts`):
  - `dateEntries`:
    - due-first, both dates, pinned → `[{change,due,unpins:true},{change,scheduled,unpins:false}]`
    - scheduled-first, both, pinned → due `unpins:false`, scheduled `unpins:true`
    - earliest, both (⏳ earlier), pinned → scheduled unpins
    - due-only, ⏳ only, pinned → `[{change,scheduled,false},{set,due,true}]`
    - scheduled-only, 📅 only → `[{change,due,false},{set,scheduled,false}]` (not pinned)
    - no dates: due-only/due-first → `set due`; scheduled-only/scheduled-first/earliest → `set scheduled`
    - manual → `[]` with dates and without
    - rawLine `- [x] …`, `- [-] …` → `[]`; `- [/] …` → entries
  - `datePresets` (weekStart Monday = 1):
    - today Sun 2026-10-18, current null → keys `2026-10-18, 2026-10-19, 2026-10-25, 2026-11-01` with ids `today, tomorrow, inOneWeek, inTwoWeeks` (startOfNextWeek collapsed into tomorrow)
    - today Mon 2026-10-19 → `startOfNextWeek` collapses into `inOneWeek`; the first id kept is `startOfNextWeek` (list order wins)
    - today Wed 2026-10-21 → five rows; startOfNextWeek `2026-10-26`
    - weekStart Sunday (0), today Sun 2026-10-18 → startOfNextWeek `2026-10-25`, collapses with inOneWeek
    - current = tomorrow → tomorrow row absent
    - year boundary: today 2026-12-28 → inTwoWeeks `2027-01-11`

- [ ] **Step 2: Run** `npm test -- --testPathPattern=DateMenu` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/core/DateMenu.ts`. Day arithmetic via `new Date(y, m, d + n)` (DST-safe). Start of next week: `lead = (today.getDay() - weekStart + 7) % 7`, date = today + `7 - lead`. Build in id order above, drop a row whose key equals an earlier row's or `dayKey(current)`. In `dateEntries`, the Set field is due for `due-only`/`due-first`, scheduled otherwise; Set `unpins = pinned`; a Change entry `unpins = pinned && plan?.source === field`.

- [ ] **Step 4: Run** `npm test -- --testPathPattern=DateMenu` — Expected: PASS.

---

### Task 2: Line writer

**Files:**
- Modify: `src/core/TaskParser.ts` (next to `setInlineFieldValue`, ~line 495)
- Modify: `src/core/TaskWriter.ts` (export a line function beside `applyBucketChange`, ~line 240)
- Test: `tests/TaskParser.test.ts`, `tests/TaskWriter.test.ts`

**Interfaces:**
- Consumes: `DateField` from Task 1; `scanTasksMetadata` (TasksPluginParser); the file-local `scanObsidianMetadata` and `insertBeforeBlockRef` in TaskParser.
- Produces:
  ```ts
  // TaskParser.ts
  export function setTaskDate(line: string, field: DateField, date: string, bucketKey?: string): string
  // TaskWriter.ts
  export function setDateLine(line: string, field: DateField, date: string, unpin: boolean, settings: PluginSettings): string
  ```

- [ ] **Step 1: Write the failing tests.** `setTaskDate` (date `2026-10-25`):
  - `- [ ] a 📅 2026-10-10` → `- [ ] a 📅 2026-10-25`
  - `📆`, `🗓`, `⌛`, and `📅️` keep their marker
  - `- [ ] a [due:: 2026-10-10]` → `[due:: 2026-10-25]`; `(due:: 2026-10-10)` keeps parentheses
  - two `📅` → only the first changes; emoji + Dataview due → only the emoji changes
  - field `scheduled` on `- [ ] a 📅 2026-10-10` → `- [ ] a 📅 2026-10-10 ⏳ 2026-10-25`
  - all-Dataview line `- [ ] a [priority:: high]` + due → `- [ ] a [priority:: high] [due:: 2026-10-25]`
  - no fields: `- [ ] a ^abc` → `- [ ] a 📅 2026-10-25 ^abc`
  - code span: `` - [ ] see `📅 2026-01-01` `` + due → the code span is untouched and `📅 2026-10-25` is appended
  - bucketKey: `- [ ] a [gtd:: today] 📅 2026-10-10` with `bucketKey "gtd"` → only the 📅 value changes; on `- [ ] a [gtd:: today]` + due → `- [ ] a [gtd:: today] 📅 2026-10-25`

  `setDateLine`:
  - inline-tag, `- [ ] a #gtd/today 📅 2026-10-10`, unpin → tag gone, date changed
  - inline-field, `- [ ] a [gtd:: today] 📅 2026-10-10`, unpin → field gone, date changed
  - `unpin: false` leaves the tag

- [ ] **Step 2: Run** `npm test -- --testPathPattern="TaskParser|TaskWriter"` — Expected: FAIL.

- [ ] **Step 3: Implement.** `setTaskDate`: spans = `scanTasksMetadata(line, scanObsidianMetadata(line), bucketKey)` filtered to `field`. Target = first emoji span, else first Dataview span. If there's a target, replace the first `\d{4}-\d{2}-\d{2}` inside `line.slice(span.start, span.end)`. Otherwise, if the line has any Tasks spans, insert ` <token>` at the max `end`; if it has none, call `insertBeforeBlockRef`. The token is `[due:: d]` / `[scheduled:: d]` when every span is Dataview, else `📅 d` / `⏳ d`. `setDateLine`: call `setTaskDate` with `bucketKey = settings.storageMode === "inline-field" ? settings.tagPrefix : undefined`, then `applyBucketChange(result, null, settings)` if `unpin`.

- [ ] **Step 4: Run** the same command — Expected: PASS.

---

### Task 3: Kalendae bridge

**Files:**
- Create: `src/integrations/Kalendae.ts`
- Test: `tests/Kalendae.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DatePicker = (value: string, anchor: HTMLElement | MouseEvent) => Promise<string | null>;
  export function getDatePicker(app: App): DatePicker | null
  ```
  Reads `app.plugins.plugins["kalendae"]?.api?.pickDate` the way `getTasksApi` reads Tasks. Returns a bound wrapper that resolves null on a rejection, or on a result that isn't `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing tests** with a fake `app` object:
  - no plugin → null
  - plugin without `api` → null
  - `api.pickDate` not a function → null
  - resolves `"2026-10-25"` → wrapper resolves `"2026-10-25"` and passes `{ value, anchor }` through
  - resolves null → null
  - rejects → null
  - resolves `"25/10/2026"` → null
- [ ] **Step 2: Run** `npm test -- --testPathPattern=Kalendae` — Expected: FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** — Expected: PASS.

---

### Task 4: Menu wiring, write handler, strings, docs

**Files:**
- Modify: `src/views/GTDPanel.svelte` (`showContextMenu`, ~193–278; new prop)
- Modify: `src/main.ts` (props ~583; new `handleSetDate` beside `handleEdit` ~711)
- Modify: `src/i18n/locales/en.json` (`panel.contextMenu`)
- Modify: `src/core/TaskOrder.ts` (HARD INVARIANT comment, lines 22–31)
- Modify: `CLAUDE.md` (data-flow block and Architecture)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: GTDPanel props
  ```ts
  export let onSetDate: (task: TaskRecord, field: DateField, date: string, unpin: boolean) => Promise<void>;
  export let getDatePicker: () => DatePicker | null;   // asked each time the menu opens
  ```

- [ ] **Step 1: Strings** under `panel.contextMenu` in en.json, each with a `_comment`:
  - `moveToMenu` "Move to"
  - `changeDue` "Change due date", `changeScheduled` "Change scheduled date"
  - `setDue` "Set due date", `setScheduled` "Set scheduled date"
  - `presetToday` "Today, {{date}}", `presetTomorrow` "Tomorrow, {{date}}", `presetStartOfNextWeek` "Start of next week, {{date}}", `presetInOneWeek` "In 1 week, {{date}}", `presetInTwoWeeks` "In 2 weeks, {{date}}"
  - `customDate` "Custom…"
  - `updateUnpins` "Update unpins from {{name}}"

  Remove `moveTo`/`moveTo_comment` ("Move to: {{name}}") from en.json only; it has no other user.

- [ ] **Step 2: `handleSetDate` in main.ts.** Mirror `handleEdit`: call `replaceTaskLine(app, task, (line) => [setDateLine(line, field, date, unpin, settings)])`. On failure, show a notice (`notices.editFailed` text is fine, or add `notices.dateFailed` "Could not change the date: {{error}}") and reindex. On success, `diffForEdit(before, after, lineIdx, 1, scheme)` → `recordTaskDiff` → `reindexFile`. Pass `onSetDate` and `getDatePicker: () => getDatePicker(this.app)` as props.

- [ ] **Step 3: Menu in `showContextMenu`.**
  - Add one helper: `function submenu(item: MenuItem): Menu { return (item as MenuItem & { setSubmenu(): Menu }).setSubmenu(); }`, with a one-line comment saying it's runtime API absent from `obsidian.d.ts`.
  - Replace the per-bucket loop with a "Move to" item (icon `arrow-right-left`) whose submenu holds the same items. Same icons and order, title just `${b.emoji} ${b.name}`.
  - Then, for each `dateEntries(task, settings.planBy, pinnedIn.has(task.id))` entry, add an item (icon `calendar-clock`) with a submenu:
    - if `entry.unpins`, first a `setIsLabel(true)` row with `updateUnpins` (name `${bucket.emoji} ${bucket.name}` from `pinnedIn`)
    - then one row per `datePresets(today(), weekStartIndex(settings.weekStartsOn), current)`, where `current` = `task.dueDate`/`task.scheduledDate` for change and null for set. The title is the preset string with `date` formatted as `new Intl.DateTimeFormat(i18next.language, { weekday: "short", day: "numeric", month: "short" })`, the CompletionReport precedent. This is used instead of the spec's `moment`, since it meets the same "follows the app's language" requirement. onClick → `onSetDate(task, entry.field, preset.key, entry.unpins)`
    - then, if `getDatePicker()` is non-null, `customDate`: onClick → `picker(current key ?? today key, lastContextMenuEvent ?? new MouseEvent("click"))`, and on a non-null result → `onSetDate(...)`.
  - Leave the top and bottom sections unchanged.

- [ ] **Step 4: Docs.**
  - **CLAUDE.md:** change "it never writes a 📅 date — 📅 is read-only to this plugin" to say that 📅/⏳ are written only by the Change/Set date menu, never by a bucket move. Add `DateMenu.ts` and `Kalendae.ts` to the key-files table.
  - **TaskOrder.ts:** reword the invariant comment. 📅/⏳ are now written, and that's safe only because `handleSetDate` records a known-line `diffForEdit` before reindexing. Any new write path for a hashed field must do the same.

- [ ] **Step 5: Verify** `npm run build` — Expected: no TypeScript errors. Then `npm test` — Expected: all pass. (`validate-translations` will fail on the new keys; that's expected per CLAUDE.md, so don't run `release-check` as a gate.)

---

### Task 5: End-to-end spec

**Files:**
- Create: `e2e/specs/dates.e2e.ts` (no imports; copy `menuItems`/`clickMenuItem` from `e2e/specs/waiting.e2e.ts:108-125`, and `openPanel`/`rowOf`/`dayFromToday` as the other specs do)
- Modify: `e2e/README.md` (add the spec to the "What is here" table)

**Interfaces:**
- Consumes: the menu from Task 4, opened by a synthetic `contextmenu` event (non-native menus). Open a submenu by clicking its parent `.menu-item`; its items appear in a second `.menu`.

- [ ] **Step 1: Write the spec.** Dated tasks are written by the test, with dates computed from today (the fixture vault stays dateless). Tests:
  - "Move to ›" lists `${emoji} ${name}` without "Move to:"; moving through it writes the bucket tag as before
  - overdue 📅 task: Change due date › Tomorrow writes tomorrow's date, and the row is in the bucket for tomorrow
  - pinned `#gtd/today` with both dates under due-first: the Change due date submenu's first item is "Update unpins from …"; picking In 1 week writes the date and removes the tag. The Change scheduled date submenu has no label row; a pick there keeps the tag
  - dateless task: due-first → "Set due date"; scheduled-first → "Set scheduled date"
  - `[x]` and `[-]` tasks show no date entries; Plan by manual shows none
  - `[due:: …]` line keeps its brackets after a change
- [ ] **Step 2: Break it on purpose** (e.g. skip the unpin in `setDateLine`), run `npm run test:e2e -- --spec dates`, and confirm that the related test fails. Then restore the code.
- [ ] **Step 3: Run** `npm run test:e2e -- --spec dates` — Expected: all pass. This opens an Obsidian window, so warn the user before running it.

---

### Task 6: Manual QA file

**Files:**
- Create: `QA-change-dates.md` at the repo root (never committed; deleted at commit time)

- [ ] **Step 1: Write it** following the project's QA convention: fixtures as real tasks, steps as plain bullets. Fixtures, dated relative to the QA day:
  - overdue 📅 only
  - both dates
  - pinned `#gtd/today` with both dates
  - ⏳ only (for due-only)
  - no date
  - Dataview `[due:: …]`
  - 📆 spelling
  - done task
  - cancelled task
  - recurring 🔁 task

  Steps:
  - Native menus on and off.
  - Each Plan by mode, including manual (no entries).
  - The unpin label appears only on the deciding date's entry.
  - An overdue task moves bucket by its new date and keeps its place in a manually ordered bucket.
  - Custom… is absent without Kalendae, absent with Kalendae but no API, and with the API it opens by the row; a pick writes, and closing writes nothing.
  - The "Move to ›" submenu lists the bucket names without the prefix.
- [ ] **Step 2: Tell the user** the file is ready to copy into a vault.
