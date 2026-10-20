# Change due and scheduled dates from the panel

**Date:** 2026-10-18
**Status:** Draft, awaiting approval
**TODO:** #35

## Problem

Clearing a pile of overdue tasks means giving each one a new date. Today that is one of two
things, and both are bad:

- **Open each task** (by hand, or through Tasks' edit modal from the row menu) and retype the
  date. Tedious for more than a couple of tasks.
- **Drag it to another bucket.** That writes a manual bucket tag (`#gtd/today`) or field
  (`[gtd:: today]`), which pins the task: from then on the tag, not the date, decides its bucket,
  so the task stops moving on its own as days pass.

The user wants to change the date itself, from the panel, in one or two clicks, so date-based
placement keeps working. The moves they make in practice are short and relative: tomorrow, start
of next week, a week out. A far-off date is rare but must be possible.

## Goals

- Change a task's 📅 due or ⏳ scheduled date from the row's right-click menu.
- Give a task with no date that Plan by uses the date that Plan by implies.
- Never add a bucket tag as a side effect. Changing the date that decides placement unpins a
  pinned task, with a visible warning.
- Every change is deliberate and per task.

## Non-goals

- **Batch actions** ("move all overdue in this bucket to …"). Rejected on purpose: changing dates
  should be deliberate. Moving everything to today would only clear the overdue badges anyway.
- **End of week** presets. Deferred: "end of week" has no agreed meaning (5th or 7th day from the
  start of the week, work week or not). Revisit in a later release.
- **🛫 start dates.** Placement ignores them, so changing one moves nothing.
- **Removing a date.** Tasks' menu has "Remove date"; this one does not.
- **A date picker of our own.** "Custom…" uses Kalendae's picker or nothing (see below).

## Anti-goals

- A date change that silently leaves the task where it was. That is what a pinned task would do
  if the pin stayed, which is why the pin goes.
- Writing a date Tasks can no longer read (wrong position, wrong format, broken Dataview field).

## Policy change: the plugin now writes dates

CLAUDE.md says 📅 is read-only to this plugin, and nothing writes ⏳ either. This feature lifts
that deliberately. Update CLAUDE.md in the same change: the data-flow block ("it never writes a 📅
date") and the "User move action" description should say the plugin writes the due and scheduled
dates only through the Change/Set date menu, and never as a side effect of a bucket move. Drag and
"Move to" still only write the bucket tag/field.

## The menu

### Structure

The existing row menu ([GTDPanel.svelte](../../../src/views/GTDPanel.svelte) `showContextMenu`)
keeps its top section (Edit task, status items, Pin/Unpin) unchanged. The middle section, which
today lists one "Move to: <bucket>" item per bucket, becomes:

```
Move to                 ›   (submenu: the existing bucket items, unchanged — same titles,
                             same up/down icons, same order, current bucket left out)
Change due date         ›
Change scheduled date   ›
```

The bottom section (Go to blocker, Open file) is unchanged.

Moving the bucket list into a "Move to ›" submenu is part of this work. Since the parent row
says "Move to", the items inside drop the prefix and show just the bucket: "🗓 This Week"
instead of "Move to: 🗓 This Week". The `panel.contextMenu.moveTo` string is then unused by this
menu; remove it if nothing else uses it.

### Which date entries appear

Only for open tasks: status `[ ]` or `[/]`. Done (`[x]`) and cancelled (`[-]`) tasks get none.
With Plan by set to **manual**, no task gets any date entry, dated or not, because dates don't
place tasks in that mode.

Each date the task has gets a **Change … date ›** entry, whether or not Plan by uses it:

| Task has | Change entries |
|---|---|
| 📅 and ⏳ | **Change due date ›**, **Change scheduled date ›** (due first) |
| 📅 only | **Change due date ›** |
| ⏳ only | **Change scheduled date ›** |
| neither | none |

"Has" means the parsed field (`task.dueDate` / `task.scheduledDate`), so any spelling Tasks reads
counts: 📅 📆 🗓, ⏳ ⌛, or the Dataview `[due:: …]` / `[scheduled:: …]` forms.

**Set entry.** A task is *dateless* when it has no date that Plan by uses, which is when
`planningDate(task, planBy)` returns null. A dateless task also gets one **Set … date ›** entry,
after any Change entries. So under due-only, a task with only ⏳ gets **Change scheduled date ›**
and **Set due date ›**. Plan by picks which date the Set entry adds:

| Plan by | Entry |
|---|---|
| due-only, due-first | **Set due date ›** |
| scheduled-only, scheduled-first, earliest | **Set scheduled date ›** |
| manual | none |

### Submenu rows

Each date entry opens the same submenu:

```
Update unpins from Today      (grey label row — pinned tasks only)
Today, Sun 18 Oct
Tomorrow, Mon 19 Oct
Start of next week, Mon 19 Oct
In 1 week, Sun 25 Oct
In 2 weeks, Sun 1 Nov
Custom…                       (only when Kalendae's API is present)
```

- All presets count from **today**, never from the task's current date. That way an overdue
  task lands on a date that makes sense now, which matches how Tasks' postpone menu behaves.
- **Start of next week** follows the plugin's existing `weekStartsOn` setting
  ([settings.ts](../../../src/settings.ts), `weekStartIndex()`): the first day of the week after
  the current one. On a Sunday with weeks starting Monday, that is tomorrow.
- **In 1 week / In 2 weeks** are today + 7 / + 14 days. That lands on the same weekday, but the
  label doesn't say so.
- Each label carries its date, in the style Tasks uses: "Tomorrow, Mon 19 Oct". Use Obsidian's
  `moment` so the weekday and month follow the app's language. The exact format string is the
  builder's call, as long as it shows weekday, day and month. *(Builder's call.)*
- **Duplicates collapse.** When two presets land on the same day, only the first in the list
  above is shown. In the example, "Start of next week" equals Tomorrow, so it disappears.
- **The current date is left out.** A preset equal to the date being changed is hidden, since
  picking it would do nothing. For a dateless "Set" entry nothing is hidden this way.
- Every preset can be hidden this way, leaving only the label row and/or Custom…, or nothing at
  all. If the submenu would be empty, don't show the entry. In practice this can't happen, since
  five distinct days can't all be equal to one current date.

### Pinned tasks

A pinned task carries a bucket tag or field (`hasExplicitAssignment(task)`). Only the date that
decides placement unpins it. That is the date `planningDate(task, planBy)` returns now, or, for a
Set entry, the date being added (which will then be the planning date).

- **The deciding date's entry** (the Change entry whose field equals `planningDate().source`, or
  the Set entry) starts its submenu with a grey, unclickable label row
  (`MenuItem.setIsLabel(true)`):

  > **Update unpins from Today**

  The bucket named is the one the task is pinned to, with the same display name the menu uses
  elsewhere. Picking a date (a preset or Custom…) writes the new date **and** removes the bucket
  tag/field, both in one file write, so the new date takes over placement.
- **The other date's entry** has no label row. Picking a date only rewrites that date, and the pin
  stays. Example: under due-first, a pinned task with both dates is placed by 📅. "Change scheduled
  date" edits ⏳ and nothing else.

With Native menus on, a label row renders as a disabled item, which still shows the text.

Under **earliest**, the deciding date is whichever is earlier right now. After the write, the
other date may become the earlier one. That's fine: the pin is gone either way, and placement
follows whichever date is earliest.

### Custom… and Kalendae

"Custom…" opens the calendar of the user's other plugin, **Kalendae**, next to the task row. GTD
does not copy or reimplement the picker.

Kalendae has no public API yet. Adding one is tracked in Kalendae's own TODO (#27 there, "Let
other plugins open the calendar"). The proposed shape:

```ts
// app.plugins.getPlugin("kalendae")?.api
pickDate(options: { value: string; anchor: HTMLElement | MouseEvent }): Promise<string | null>
```

`value` is the current date as `YYYY-MM-DD`; it resolves with the picked day in the same format,
or null if the user closed the picker. The final shape is decided in Kalendae; GTD adapts to it.

**Build Custom… now**, against the shape above. Before this change is committed, the user will
make sure Kalendae exposes the API for testing. If its final shape differs, adapt GTD to match.
Keep the integration in one small module (detection plus a typed wrapper) so that adapting it
touches one place.

- Show **Custom…** only when `app.plugins.getPlugin("kalendae")?.api?.pickDate` is a function
  at the moment the menu opens. A missing, disabled or older Kalendae simply hides the row. In
  that case Edit task (already in the menu's top section when Tasks is installed) covers far-off
  dates.
- Anchor the picker to the task row's element, falling back to the menu's mouse event.
  `showContextMenu(task)` receives neither today, so the call site in the row component has to
  pass the event and/or the row element through.
- For a "Set" entry (no current date), pass today as `value`.
- A null result writes nothing.

## Writing the date

One `vault.process` write per pick, locating the line the way every other write does
(`findTaskLine` in [TaskWriter.ts](../../../src/core/TaskWriter.ts)), and aborting with the
usual notice if the line can't be found. `replaceTaskLine` already has this shape and can be
reused or mirrored.

**Changing an existing date.** Rewrite only the value of the span that the parser's
`foldTasksFields` would pick: emoji outrank Dataview, and the first occurrence wins within a
format. Keep the marker as written: a 📆 stays 📆, `(due:: …)` keeps its parentheses, and so on.
Leave any second, unused occurrence alone. The spans come from `scanTasksMetadata` in
[TasksPluginParser.ts](../../../src/integrations/TasksPluginParser.ts), which stays the sole owner
of Tasks syntax. The new writer should live there, or next to the other line setters in
[TaskParser.ts](../../../src/core/TaskParser.ts), and use its spans rather than a new regex.

**Adding a missing date.** Insert `📅 YYYY-MM-DD` or `⏳ YYYY-MM-DD` after the line's last Tasks
field, so the date stays inside the run of fields Tasks reads from the end of the line. If the
line has no Tasks fields, add it at the end of the line, before any block reference (as
`insertBeforeBlockRef` does). If the line's existing Tasks fields are all in Dataview format,
write `[due:: YYYY-MM-DD]` / `[scheduled:: YYYY-MM-DD]` instead. *(My call: match the line's
format; emoji otherwise, since that is what Tasks writes by default.)*

**Unpinning in the same write.** For a pinned task, also remove the bucket tag/field, as
`moveTaskToBucket(…, null, …)` does via `setTagValue` / `setInlineFieldValue` with `null`. Apply
both changes to the same line inside the same `vault.process` callback.

**Recurring tasks.** No special handling. Changing the due date of a 🔁 task shifts the series,
exactly as editing it in Tasks would.

**Manual order.** A changed date can move the task to another bucket by itself. The move has to
keep the task's manual order behaviour (TODO #1): it lands where an auto-placed task normally
lands, and its existing order entries are not corrupted. Checked in the code: the order key
hashes the planning date (`disambiguator` in `src/core/TaskOrder.ts`), so a date write changes
the key. The existing edit path already copes. `handleEdit` in `src/main.ts` builds a known-line
`diffForEdit` after `replaceTaskLine`, so the entry gets re-keyed, not lost. The date writer
should follow that same pattern. The "HARD INVARIANT" comment in `TaskOrder.ts` says only fields
the plugin never writes may be in the key. That is no longer true for 📅/⏳, so update the comment
to say that these writes re-key through the known-line diff.

## Strings

New UI strings go into `src/i18n/locales/en.json` **only**, each with a `_comment` sibling like
the existing ones. No other locale files until the user asks for translations. Expected keys,
names left to the builder:

- "Move to" (the submenu parent)
- "Change due date", "Change scheduled date", "Set due date", "Set scheduled date"
- "Today", "Tomorrow", "Start of next week", "In 1 week", "In 2 weeks", each combined with a date
  ("{{label}}, {{date}}" or per-preset strings — builder's call)
- "Custom…"
- "Update unpins from {{name}}"

## Obsidian API note

`MenuItem.setSubmenu()` is not in `obsidian.d.ts`, but it exists at runtime. This was checked in
Obsidian 1.14.4's `app.js`: Obsidian builds its own editor "Format ›" menu with it, the Native
menus conversion passes `submenu` through to Electron, and on phones the submenu slides in with a
back row. Call it through one small typed helper, for example
`(item as MenuItem & { setSubmenu(): Menu }).setSubmenu()`, kept in one place so it is easy to
replace if the API becomes public. Native menus drop item icons, as they already do for every
item in this menu.

## Testing

- **Unit tests (Jest, pure logic):**
  - The preset list for a given today, week start and current date: dates, duplicate
    collapsing, current-date hiding. Include a Sunday with a Monday week start, a week-start
    day itself, and a month/year boundary.
  - Entry selection per Plan by and per which dates the task has, including the Set entry
    alongside a Change entry when the only date is one Plan by ignores. Also which entry carries
    the unpin label row.
  - The line writer: emoji, alternate emoji (📆 🗓 ⌛), `[…]` and `(…)` Dataview, duplicate
    fields, adding a missing date with and without other fields and before a block ref, and
    unpin + date in one line for both storage modes.
- **Manual QA in a vault:** follow the project convention. A QA file at the repo root holds the
  fixtures as real tasks, with steps as plain bullets. It is never committed and is deleted at
  commit time. The checks:
  - Native menus on and off.
  - With Kalendae absent, and with Kalendae present but without the API: no Custom… row.
  - With Kalendae's API present: Custom… opens the picker by the row. A pick writes the date, and
    closing the picker writes nothing.
  - An overdue task moving buckets by its new date.
  - A pinned task unpinning through its deciding date, and keeping its pin when the other date
    is changed.
- E2E specs are optional; `e2e/specs/` must not gain imports.

## Left to the builder

- Module boundaries for the preset calculation and the menu wiring.
- Label format details, string key names.
- Exact anchoring of Kalendae's picker once its API exists.

## Dependencies

- **Kalendae #27** (public `pickDate` API) is needed to test the Custom… row. The row is built
  in this work and hidden whenever the API is missing. The user will have the API available
  before commit.
