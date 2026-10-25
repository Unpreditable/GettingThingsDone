## 0.3.0

#### Features
- See what you got done: click 🏆 in the ribbon for a report of tasks completed today, yesterday, this week or last week, with a 10-week graph.
- Change a task's due or scheduled date from its right-click menu.
- A **Toggle task done** command, next to the in progress and cancelled ones.
- Tasks that can't start yet or wait on another task are dimmed.
- Reads Tasks' Dataview-format fields.

## 0.2.7

- No changes. Re-released 0.2.6 to get past a problem in Obsidian's publishing checks.

## 0.2.6

#### Features
- **Global task filter**: a checkbox counts as a task only if it contains one of the texts you list, as in the Tasks plugin. Options include subtasks and hide the filter text in the panel.
- **In progress and cancelled**: editor commands and right-click items mark a task in progress or cancelled. Running one again sets it back to open.

#### Fixes
- Fixed tasks missing from the panel in notes with Windows line endings.
- Fixed Cancel in Tasks' edit dialog wiping the task's line.
- Fixed To Review dropping a task you had just ticked, and dismissed tasks coming back.
- Fixed search keeping a bucket on screen when every match in it was hidden.

## 0.2.5

#### Features
- **Open links from the panel**: click a link in a task to open it.

#### Fixes
- Fixed #headings in wikilinks and #fragments in URLs being dropped from task text in the panel.

## 0.2.4

#### Features
- **Edit task**: open a task in the Tasks plugin's edit dialog from the right-click menu.
- **Jump to task**: opening a task centres its line, puts the cursor on it and briefly highlights it.
- Every right-click menu item has an icon when Native menus is off in Settings → Interface.

## 0.2.3

#### Features
- **More checkbox statuses**: in progress `[/]`, forwarded `[>]` and scheduled `[<]` show as open tasks, and cancelled `[-]` counts as done.
- The panel shows your theme's own icons for these statuses.

## 0.2.2

#### Features
- **First day of the week**: pick it in settings, and This Week and Next Week follow it.
- **Exclusions for whole-vault scans**: skip chosen folders and files. The folder and file scope lists are merged into one.

#### Fixes
- Fixed custom settings sections on Obsidian 1.13 and later. The "Getting Things Done" section is now "General".
- Fixed the ↖︎ badge missing from a subtask whose parent isn't on screen. Its tooltip now names the parent.

## 0.2.1

#### Features
- **Auto-assignment date**: place tasks by their due date, scheduled date, whichever is earlier, or neither.
- **Date-ordered buckets**: tasks sort by date within a bucket, undated last. A bucket you arrange by drag and drop keeps your order.
- **Pin and unpin**: pin a task to a bucket, or unpin it to follow its dates again.
- Separate overdue and misfiled flags, explained in the popover.
- **Catch-all bucket rule**: "Everything (catch-all)" claims every dated task the buckets above it didn't. Someday has it by default.
- Icons follow Obsidian and your theme.

#### Fixes
- Fixed notes added after Obsidian started not showing up until a restart.

## 0.2.0

#### Features
- **Task order that lasts**: your drag order survives file edits, renames, folder moves and restarts.
- **Completion through the Tasks plugin**: repeating tasks get their next occurrence, and ✅ dates follow Tasks' rules.
- Completed tasks stay in the panel until you reload.
- **Tasks plugin fields**: priority, recurrence, dates and on-completion actions show as badges and in the hover popover, with settings for which ones.
- **Overdue and misfiled flags**, and a due line in the popover.
- A ribbon icon opens the panel.

#### Fixes
- Fixed a dragged task landing in the wrong place in another bucket, and subtasks drifting away from their parent.
- Fixed a second panel opening on reload or update, and buckets not rolling over at midnight.
- Fixed Tasks plugin metadata leaking into task text, and tooltips popping up during a drag.
- The plugin asks before opening its GitHub feedback link.

## 0.1.9

#### Features
- Each scan scope (whole vault, folders, files) remembers its own list.
- A message when no folders or files are picked to scan.
- Behaviour settings show up in Obsidian's settings search (Obsidian 1.13 and later).
- A thank-you banner in settings, with a link to share feedback and ideas.

#### Fixes
- Fixed block references (^abc123) being lost when a task's bucket was written.
- Fixed stale tasks after changing the scan scope, and the celebration image sometimes not showing.
- Fixed the "language changed" notice showing on a first install.

## 0.1.8

#### Fixes
- Fixed the wrong line opening for a task in a note edited near the top.

## 0.1.7

#### Features
- **12 languages**, following your Obsidian language.
- Opening a task focuses its note's tab if one is already open.
- Task text fills the row; quick-move buttons appear on hover.

## 0.1.6

#### Features
- Hovering a task shows its note and line number.

## 0.1.5

#### Features
- **Search**: filter the panel as you type.
- Release builds are signed, so you can check they came from the official source.

## 0.1.4

#### Fixes
- Fixed tasks under plain bullet points showing as subtasks of an unrelated task.

## 0.1.3

#### Features
- Task text renders bold, italic, strikethrough, code, highlights and links, as in your notes.

## 0.1.2

#### Features
- Completed tasks get a dismiss button, and **Dismiss all** in the header clears them at once.

## 0.1.1

#### Features
- Wikilinks in task text render in the panel.
- Status bar counts are clickable.

#### Fixes
- Fixed tooltips on completed tasks, and moves failing on stale task data.

## 0.1.0

#### Features
- The GTD panel: tasks from your vault grouped into Today, This Week, Someday and more.
- Move tasks with one click or by drag and drop.
- Subtasks follow their parent.
- Live task counts per bucket in the status bar.
- Celebration animations when you complete a task.
- A compact view.
- Bucket stored as an inline tag (#gtd/today) or a Dataview inline field.
