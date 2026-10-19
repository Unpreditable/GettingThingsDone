# Waiting Tasks (start date + blocked) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dim open tasks that can't be done yet: ones whose 🛫 start date is after today (TODO #36) and ones blocked by an open task through Tasks' `⛔`/`🆔` dependencies (TODO #37). Each gets an icon in front and explains itself on hover.

**Architecture:** The parser folds `🆔`/`⛔` into the `TaskRecord`. A new pure module, `src/core/Waiting.ts`, works out each task's waiting state from the full task list on every grouping pass. `groupTasksIntoBuckets` attaches that state to each `BucketGroup` the way it already attaches `dueStatuses`. `formatTasksFields` turns it into popover rows. `TaskItem` dims the row and draws the icon. `GTDPanel` adds the jump-to-blocker menu item.

**Tech Stack:** TypeScript, Svelte 4 syntax on Svelte 5, Jest, Obsidian `setIcon` (Lucide).

**Spec:** the design agreed in chat on 2026-10-18 (no separate file). It is summarised here:
- **Can't start yet:** an open task whose 🛫 date is after today. The row is dimmed and has a `snail` icon in front. The popover gets a `snail` row reading `Can't start yet`, placed directly above the existing `🛫 Starts {{date}}` row, which stays unchanged. The row returns to normal on its start day.
- **Blocked:** an open task with a `⛔` id that matches the `🆔` of a task that is still open. The row is dimmed and has a `construction` icon in front. The popover gets one `construction` row per open blocker, reading `Blocked by: ‹blocker's text›`. Right-click offers "Go to blocking task". The row returns to normal once every blocker is done or cancelled.
- **Blocker not found:** a `⛔` id that matches no indexed task. The task is not blocked by it: no dimming and no row icon. The popover gets a `badge-alert` row reading `Depends on task not found in scope`.
- **Both:** always on, with no settings. Subtasks don't inherit their parent's state. Strings go into `en.json` only.

## Global Constraints

- New strings go into `src/i18n/locales/en.json` only, each with a `_comment` sibling like its neighbours. Do not touch the other locales. `validate-translations` fails until translations are requested, and that is expected.
- No `!important` and no inline styles. Any rule that touches an `svg.svg-icon` lives in `styles.css`, because `setIcon` output never carries a Svelte scope class.
- Icons are `snail`, `construction` and `badge-alert`. Each must exist in Obsidian's bundled Lucide back to `minAppVersion` 1.8.7. `setIcon` fails silently on an unknown name.
- `📅` stays read-only. This feature writes nothing to any file.
- Commits: subject-only for small items; end each with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No session trailer.

## Review Focus

1. **A self-reference:** a task with `🆔 a ⛔ a`. A reasonable person expects it not to be blocked by itself, so it is excluded from its own blockers. Pinned by a test in Task 2.
2. **A duplicate `🆔`:** two tasks share id `a`, one done and one open. Tasks treats any open match as blocking, so the dependent stays blocked and lists the open one. Pinned by a test in Task 2.
3. **The popover dims with the row:** `.gtd-tooltip` is a child of `.gtd-task`, so `opacity` on the row would fade the hover popover too. The dimming must skip the tooltip. Checked by hand in Task 5.
4. **A completed task carrying a future 🛫 or an open blocker** is not waiting and gets no icon. Pinned by a test in Task 2.
5. **Day rollover:** a task whose start date is tomorrow un-dims after midnight without a file edit. The existing `armMidnightTimer` → `renderAll` covers this, and Task 2's `now` parameter makes it testable. Pinned by a test in Task 2.

---

### Task 1: Read `🆔` and `⛔` into the TaskRecord

**Files:**
- Modify: `src/integrations/TasksPluginParser.ts` (`TasksFields`, `foldTasksFields`)
- Modify: `src/core/TaskParser.ts` (`TaskRecord`, record construction near line 168)
- Modify: every `TaskRecord` literal in tests: the `makeTask`-style helpers in the 15 files under `tests/` and `tests/perf/` that contain `childIds: []`. Add `tasksId: null, dependsOn: []` to each default.
- Test: `tests/TasksPluginParser.test.ts`, `tests/TaskParser.test.ts`

**Interfaces:**
- Produces: `TaskRecord.tasksId: string | null` (the `🆔` value; the name avoids a clash with the existing `id`) and `TaskRecord.dependsOn: string[]` (the `⛔` ids, in line order, empty when absent). The same two fields are added to `TasksFields`.

- [ ] **Step 1: Write the failing tests** in `tests/TaskParser.test.ts`:

```ts
it("reads the Tasks id and its dependencies", () => {
  const [t] = parseFile("a.md", "- [ ] Ship 🆔 ship1 ⛔ docs2, qa_3");
  expect(t.tasksId).toBe("ship1");
  expect(t.dependsOn).toEqual(["docs2", "qa_3"]);
});
it("reads them from Dataview fields too", () => {
  const [t] = parseFile("a.md", "- [ ] Ship [id:: ship1] [dependsOn:: docs2]");
  expect(t.tasksId).toBe("ship1");
  expect(t.dependsOn).toEqual(["docs2"]);
});
it("leaves them empty when absent", () => {
  const [t] = parseFile("a.md", "- [ ] Ship");
  expect(t.tasksId).toBeNull();
  expect(t.dependsOn).toEqual([]);
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `npm test -- --testPathPattern=TaskParser`. Expected: FAIL on `tasksId` being `undefined`.

- [ ] **Step 3: Implement.** In `foldTasksFields`, set `tasksId` to the first comma-separated item of `get("id")`. Tasks allows only one id, while `ID_VALUE_REGEX` admits a list for both kinds. Set `dependsOn` to `get("dependsOn")` split on `,`, trimmed, with empty items dropped. Copy both onto the record in `parseFile`. Add the two fields to the test helpers.

- [ ] **Step 4: Run the full suite and the type check.** Run `npm test` and `npx tsc --noEmit`. Expected: all pass. The helpers must compile with the new required fields.

- [ ] **Step 5: Commit.** Message: `feat: read Tasks' 🆔 and ⛔ into the task record`.

---

### Task 2: Work out which tasks are waiting

**Files:**
- Create: `src/core/Waiting.ts`
- Modify: `src/core/BucketManager.ts` (`BucketGroup`, `groupTasksIntoBuckets`)
- Test: `tests/Waiting.test.ts`, `tests/BucketManager.test.ts`

**Interfaces:**
- Consumes: `TaskRecord.tasksId`, `TaskRecord.dependsOn` (Task 1).
- Produces:

```ts
export interface WaitingInfo {
  /** The 🛫 date, set only while it is after today. */
  startsOn: Date | null;
  /** Open tasks whose 🆔 matches one of this task's ⛔ ids, in ⛔ order. */
  blockedBy: TaskRecord[];
  /** True when at least one ⛔ id matches no indexed task. */
  missingDependency: boolean;
}
/** Entries only for open tasks with at least one of the three set. */
export function computeWaiting(tasks: TaskRecord[], now: Date): Map<string, WaitingInfo>;
/** Dimmed when it can't start yet or has an open blocker. A missing dependency alone doesn't dim. */
export function isDimmed(w: WaitingInfo): boolean;
```

  `BucketGroup` gains `waiting: Record<string, WaitingInfo>`, keyed by task id and filled for the tasks in that group, like `dueStatuses`.

- [ ] **Step 1: Write the failing tests** in `tests/Waiting.test.ts`. Use a local `makeTask` like the one in `BucketManager.test.ts` and `now = new Date(2026, 9, 18)`:
  - `🛫` tomorrow → `startsOn` is that date and `isDimmed` is true. `🛫` today or earlier → no entry.
  - Rollover: the same task computed with `now` set to the start date gives no entry.
  - `⛔ a` with an open `🆔 a` → `blockedBy` is `[thatTask]` and `isDimmed` is true.
  - `⛔ a` whose `🆔 a` task is completed → no entry. (`isCompleted` covers both done and cancelled.)
  - `⛔ a` with no task carrying `🆔 a` → `missingDependency` is true, `blockedBy` is `[]`, and `isDimmed` is false.
  - `⛔ a, b`, where `a` is open and `b` is missing → `blockedBy` has one task and `missingDependency` is true.
  - Self-reference `🆔 a ⛔ a` → no entry.
  - Duplicate `🆔 a`, one completed and one open → blocked by the open one only.
  - A completed task with a future `🛫` and an open blocker → no entry.
  - A child of a blocked parent, with no fields of its own → no entry.

- [ ] **Step 2: Run them and confirm they fail.** Run `npm test -- --testPathPattern=Waiting`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `computeWaiting` and `isDimmed`** in `src/core/Waiting.ts`. Build one `Map<string, TaskRecord[]>` from `tasksId` to every task carrying it, then walk the tasks once. Compare dates with `startDate.getTime() > now.getTime()`. Both are local midnight, as from `today()`.

- [ ] **Step 4: Wire it into `groupTasksIntoBuckets`.** Call `computeWaiting(tasks, now)` once, then copy each entry into `group.waiting[task.id]` in the loop that fills `dueStatuses`. Initialise `waiting: {}` in both `bucketMap.set` literals. Add one test to `tests/BucketManager.test.ts`: a task with `startDate` one day after `FIXED_MONDAY` has a `waiting` entry in its group.

- [ ] **Step 5: Run `npm test`.** Expected: all pass.

- [ ] **Step 6: Commit.** Message: `feat: work out which tasks can't start yet or are blocked`.

---

### Task 3: Popover rows

**Files:**
- Modify: `src/core/TasksFieldText.ts` (`formatTasksFields`)
- Modify: `src/i18n/locales/en.json` (`task.fields`)
- Test: `tests/TasksFieldText.test.ts`

**Interfaces:**
- Consumes: `WaitingInfo` (Task 2).
- Produces: `formatTasksFields(task, dueStatus, placement, waiting: WaitingInfo | null = null): FieldRow[]`. The fourth parameter defaults to `null`, so existing callers and tests keep compiling.

**Exact copy** (`en.json`, under `task.fields`):

```json
"notStarted_comment": "Popover row on a task whose Tasks start date (🛫) is still in the future, so it can't be worked on yet. Sits directly above the 'Starts {{date}}' row, which gives the date.",
"notStarted": "Can't start yet",
"blockedBy_comment": "Popover row on a task that waits on another, unfinished task (Tasks' ⛔ dependency). {{task}} = the text of the task it waits on. One row per such task.",
"blockedBy": "Blocked by: {{task}}",
"dependencyMissing_comment": "Popover row on a task whose Tasks dependency (⛔) names an id that no task in the folders this panel reads carries. The task is NOT treated as blocked.",
"dependencyMissing": "Depends on task not found in scope"
```

- [ ] **Step 1: Write the failing tests** in `tests/TasksFieldText.test.ts`. Build a `WaitingInfo` by hand:
  - `startsOn` set, on a line with `🛫 2026-10-20` → the rows include `{ icon: "snail", text: "Can't start yet" }` at the index directly before the `🛫` row.
  - `blockedBy` holding two tasks with texts `A` and `B` → two rows `{ icon: "construction", text: "Blocked by: A" }` and `"Blocked by: B"`, placed after the `misfiledIn` row and before the `📅` row.
  - `missingDependency: true` → one row `{ icon: "badge-alert", text: "Depends on task not found in scope" }`, after any blocked rows.
  - `waiting` null → the rows are identical to today's output. The existing "documented order" test is unchanged.

- [ ] **Step 2: Run them and confirm they fail.** Run `npm test -- --testPathPattern=TasksFieldText`.

- [ ] **Step 3: Implement.** Blocker text is `stripWikilinks(blocker.text)` from `TaskParser`, matching how the popover shows long task text. Push the snail row inside the existing `if (task.startDate)` branch, before the `🛫` row, when `waiting?.startsOn` is set.

- [ ] **Step 4: Run `npm test`.** Expected: all pass.

- [ ] **Step 5: Commit.** Message: `feat: popover rows for tasks that can't start yet or are blocked`.

---

### Task 4: Dim the row, draw the icon, add the menu item

**Files:**
- Modify: `src/views/TaskItem.svelte` (new prop, class, badge, pass `waiting` to `formatTasksFields`)
- Modify: `src/views/BucketGroup.svelte` (new prop `waiting`, pass `waiting[task.id] ?? null` to each `TaskItem`, like `dueStatuses`)
- Modify: `src/views/GTDPanel.svelte` (pass `group.waiting`; menu item)
- Modify: `styles.css` (icon colour and dimming)
- Modify: `src/i18n/locales/en.json` (`panel.contextMenu`)

**Interfaces:**
- Consumes: `BucketGroup.waiting`, `WaitingInfo`, `isDimmed` (Task 2); `formatTasksFields(..., waiting)` (Task 3).

**Exact copy** (`en.json`, under `panel.contextMenu`):

```json
"goToBlocker_comment": "Right-click context menu item on a task that waits on another, unfinished task (Tasks' ⛔ dependency). Opens the file at the line of the task it waits on.",
"goToBlocker": "Go to blocking task",
"goToBlockerNamed_comment": "Same as goToBlocker, used when the task waits on several tasks: one item each. {{task}} = the text of that task.",
"goToBlockerNamed": "Go to blocking task: {{task}}"
```

- [ ] **Step 1: Check the icons exist.** Add a temporary `use:icon={"snail"}` and the other two, so `npm run check-icons` sees them. Expected: `ok` for `snail`, `construction` and `badge-alert` on the installed Obsidian. Then confirm on lucide.dev that each icon was added before Obsidian 1.8.7 (Feb 2025). If one wasn't, stop and ask.

- [ ] **Step 2: TaskItem.** Add the prop `export let waiting: WaitingInfo | null = null`, and set `class:is-waiting={waiting !== null && isDimmed(waiting)}` on `.gtd-task`. After the misfiled badge, render `<span class="gtd-waiting-badge" use:icon={...}>`, using `"construction"` when `waiting.blockedBy.length > 0`, else `"snail"` when `waiting.startsOn`. Skip it when the task isn't dimmed. Unlike the due flags, this badge ignores `showDueFlags`. Pass `waiting` as the fourth argument to `formatTasksFields`. Style `.gtd-waiting-badge` like `.gtd-overdue-badge`, with `color: var(--text-muted)`.

- [ ] **Step 3: Dimming CSS** in `styles.css`. The tooltip is a child of the row, so the rule must not reach it:

```css
.gtd-task.is-waiting > :not(.gtd-tooltip) {
  opacity: 0.5;
}
```

- [ ] **Step 4: Menu item.** In `GTDPanel.svelte`, build `waitingMap` from `bucketGroups.flatMap(g => Object.entries(g.waiting))`, the way `pinnedIn` is built. In `showContextMenu`, put the item just above "Show in file" when the task has blockers. With one blocker, use `goToBlocker` with icon `construction` and `onClick` set to `onNavigate(blocker)`. With several, add one `goToBlockerNamed` item each.

- [ ] **Step 5: Build.** Run `npm run build`, then `npm run check-icons` and `npm test`. Expected: all pass. Remove any temporary icon usage left from Step 1.

- [ ] **Step 6: Commit.** Message: `feat: dim tasks that can't start yet or are blocked`, with bullets for the row icon, the popover and the menu item.

---

### Task 5: QA file and hand check

**Files:**
- Create: `QA-waiting-tasks.md` at the repo root, following the existing QA-file convention. It holds real tasks as fixtures and the steps as plain bullets, and is meant to be copied whole into a vault.

- [ ] **Step 1: Write the fixtures.** Include:
  - a task with `🛫` tomorrow;
  - a task with `🛫` today;
  - a pair linked by `🆔 qa1` / `⛔ qa1`;
  - a task with `⛔ nosuchid`;
  - a task waiting on two blockers;
  - a self-referencing task;
  - a done task with a future `🛫`.

- [ ] **Step 2: Write the steps,** one expected result each:
  - the dimming and icon on each row;
  - the popover text and order, with the popover itself not dimmed;
  - ticking the blocker un-dims the dependent;
  - the "Go to blocking task" item jumps to the blocker's line;
  - with several blockers, one menu item each;
  - light and dark themes.

- [ ] **Step 3: Hand it to the user** for the manual run. Don't commit it until they say so.
