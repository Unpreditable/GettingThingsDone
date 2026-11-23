# Plan mode (GitHub #10): brainstorm notes

Status: brainstorm in progress, nothing approved for building. Started 2026-11-10/11.
Issue: "Plan mode: rearrange the week in a preview, then apply or discard", requested by
thegr8dooma. Their spike (reference only, not for merging):
https://github.com/thegr8dooma/GettingThingsDone/tree/spike/plan-mode

**Next up when we resume:** all design topics are closed. Before the first beta pre-release,
Vitaly reviews the requester's install steps (draft under "Still to discuss").

---

## What plan mode is

- The **same panel**, switched into plan mode. The real panel is hidden while planning, and no
  second panel is shown next to it.
- **Peek button:** tap it to see the real panel, tap again (or Escape on desktop) to go back to
  the plan. Same on desktop and mobile: holding puts a finger over the list and makes scrolling a
  long list awkward. Peek is **read-only**: scrolling, collapsing buckets, hover popovers, search
  and opening a task's note work; drag, the row menu, checkboxes and the Tasks popup are blocked.
  The toolbar stays visible ("Viewing real tasks", 👁 highlighted, Apply/Discard disabled), so
  peeking never looks like leaving plan mode. Only Apply or Discard ends it.
- **One plan per vault.** If the panel is open in two places (sidebar and popout), both switch
  into plan mode together.
- **In memory only.** A plan does not survive a panel close, a plugin reload or a restart.
- **Apply / Discard.** Only Discard asks for confirmation. The Apply button names the count,
  e.g. "Apply 7 changes", so people don't build a habit of clicking through confirmations.
- **Commands:** only "Enter plan mode". No Apply/Discard commands, because a mistaken command
  is costly and planning is done with the mouse.

## How it works: an overlay, not a replay

- The plan stores **changes only**, per task: pin/bucket, dates (due, scheduled), and order
  within the bucket. The line text always comes from the note.
- The panel renders real lines + planned changes through the existing `BucketManager`. Buckets
  are recalculated every render, so **midnight rollover** works for the plan as it does today.
- **Apply = write the difference** between planned and real. A task moved back and forth
  writes nothing.
- **Discard = throw the changes away.**

## What saves immediately vs. what is planned

| Saved to the note at once | Planned, saved on Apply |
|---|---|
| Status: done, in progress, cancelled, all others | Bucket moves (drag) |
| Text edits | Unpin |
| Text/priority/recurrence from the Tasks popup | Date changes: row menu, drop menu, Tasks popup |
| Anything typed in the note | Order within a bucket |

- **Tasks popup in plan mode (decided):** it stays in. It opens with the **planned** line, so it
  shows the same dates as the panel. Its result is split: dates go to the plan, everything else
  is written to the note. No extra banner asking where dates go: in plan mode, dates changed
  from the panel are always planned. To save a date for real mid-plan, edit it in the note.
- Recurring completions create the next occurrence immediately; it joins the starting point
  with no indicator.

## Edits made in the note while planning

- An edit to a task the plan didn't touch flows in silently.
- A text-only edit to a planned task: the planned changes stay on top of the new text.
- **Conflict** = the note edit changes a field the plan also changed (bucket tag or a date).
  A **persistent banner** asks: use the note's version (the plan drops that change) or keep the
  plan (Apply overwrites that field). All open conflicts are listed in the **one banner**; a new
  conflict after answering brings a new banner. Never stack several banners.
- **Following a task across edits (Hard problem 1, closed):** reuse `diffFileTasks`
  (`src/core/OrderMigration.ts`) on every file change to carry planned changes over to the
  task's new key. If a task can't be paired, its planned change is dropped and listed in one
  grouped notice, shown at once. The dropped change is kept in memory for the whole plan session:
  if the same task shows up again (e.g. cut, then pasted later, even in another note) its
  planned change comes back and it leaves the notice. No "wait until the file is quiet" timer.

## Settings while a plan is open

Settings show "You're in plan mode. Apply or discard planned changes first." Settings that
affect planning are disabled. Display settings stay editable. Planning settings include:
buckets, storage mode, tag prefix, the Auto-assignment date setting, the global filter, and
folder/file scope (these change which tasks are in the plan).

## Indicators

- ↑2 / ↓3 for order within a bucket, ⇑ / ⇓ for a bucket jump. Hover names the bucket it came from.
- No review screen; indicators are enough.
- **Noise:** mark only the tasks that really moved, using the longest run of tasks still in
  their original order (longest increasing subsequence). Moving one task up 3 marks only that
  task, not the 3 it passed.
- **Subtasks:** a subtask moving with its parent gets no indicator; one moving on its own does.
- Unpin is just one more planned change; no special indicator needed.
- **Bucket header delta:** e.g. `Today 5 → 8`.

## Revert and undo

- **Right-click "Revert: bucket" and "Revert: date"** on a task. No revert for order.
  - Neither shows for a task with no original to link to: a task added during planning, or one
    that couldn't be paired after a note edit.
  - If the bucket changed only because a date changed, only "Revert: date" shows.
- **Undo/redo buttons** in the plan toolbar (not Ctrl+Z, which the editor owns). Each step stores
  only planned changes, so undo never rolls back a note edit.
- **Undo is blocked** at a step that refers to a task the plan dropped or lost (conflict answered
  "use the note's version", or unpairable). The button is disabled with a tooltip like "Can't
  undo past a note edit". Plain note edits create no barrier.

## Pins vs dates: the drop menu

- New setting: **"Dropping a task into a bucket: Pin / Ask for a date".** The requester (pins
  only, `#gtd/` tags, no dates) uses Pin. A **pin icon next to undo/redo** switches it on the fly.
- **Ask:** dropping into a bucket with a date range opens a menu:
  - "Pin to <bucket>"
  - up to 7 dates from that range: start, 2nd day, 25%, middle, 75%, 2nd-last day, end
  - Custom…, which opens Kalendae limited to the bucket's range
- The date is written to the field set by the Auto-assignment date setting (see
  `src/core/PlanningDate.ts`).
- A bucket with no date range (Someday, tag-only buckets): pin, no menu.
- No menu when reordering inside the same bucket.
- Escape / clicking outside the menu cancels the drop; the task goes back.
- Never ask anything on Apply.
- **Ships first in the normal panel, as its own release**, ahead of plan mode.
- Related TODOs: GTD TODO #41 (Custom… without Kalendae offers to install it), Kalendae TODO #29
  (`pickDate` accepts a list of allowed ranges and single days).

## Toolbar, intro and Apply animation

**Toolbar:** a strip directly under the existing panel header (title, search and settings stay).

```
│ Plan mode        ↶  ↷  📌  👁  ⓘ │
│ [ Apply 7 changes ]  [ Discard ] │
```

- ↶ ↷ undo/redo, 📌 pin/ask toggle, 👁 peek (tap to toggle), ⓘ opens the intro.
- While peeking:

  ```
  │ Viewing real tasks      👁 Back to plan │
  │ [ Apply 7 changes ]  [ Discard ]        │  ← disabled
  ```
- No note line in the toolbar.
- An accent left border on the strip. Apply is the accent button, Discard plain. With zero
  changes Apply reads "No changes" and is disabled.
- The pin/ask icon shows a pin in Pin mode and a calendar in Ask mode; its tooltip names the
  mode.

**Intro dialog:** shown on entering plan mode, with "Don't show this again", Cancel and Start
planning. Opened from ⓘ it has only "Back to planning". No setting to bring the entry intro back:
ⓘ keeps the text one click away. Draft text:

> **Plan mode**
>
> Rearrange your week without touching your notes. Nothing is written until you click Apply.
>
> - **Waits for Apply:** moving tasks between buckets, unpinning, date changes, order.
> - **Saves right away:** checking off tasks and other status changes, text edits, anything you
>   type in a note.
>
> Tap 👁 to see your real panel. Discard throws the plan away. The plan isn't saved: closing
> the panel or restarting Obsidian discards it.

**Apply animation (success), 2 s at most:**
1. Tasks switch top to bottom: each arrow (↑2, ⇑) turns into a green ✓ over 300 ms, and the
   next task starts 100 ms after the previous one. Bucket header deltas settle
   (`Today 5 → 8` becomes `Today 8`).
2. 500 ms after the last ✓ appears, all checkmarks fade out together over 200 ms.
3. The strip shows "✓ 7 changes applied" throughout, then slides up (200 ms) into the normal
   view.
- The fixed parts take 1.2 s, leaving 800 ms for the stagger: beyond 9 tasks the gap shrinks to
  800 ms ÷ (tasks − 1).
- Only rows on screen animate and count toward the gap; off-screen rows switch instantly.
- Crossfade (opacity) first; a true morph needs custom matched SVG paths, maybe later.
- Reduced motion: the ✓ appears and disappears without fades, same timing.
- On failure: no animation, no exit; the notice shows and Apply names the remaining count.

## Hard problems

1. **Following a task when its line changes:** closed, see "Edits made in the note".
2. **Planned date changes and the saved order:** closed.
   An order entry is keyed by a hash of the task's text and planning date, plus an occurrence
   number for identical tasks in one file, so a planned date change gives the task a new key after
   Apply. Every change during planning goes to both the real state and the plan, so the plan's
   copy of the order is always complete. On Apply:
   1. Write the lines file by file (one `vault.process` per file) and wait for each reindex.
   2. For each written file, pair tasks by line number (Apply never adds or removes lines) to get
      old key → new key for **every** task in the file. A date change on one task can shift the
      occurrence number of an identical task the plan never touched.
   3. Replace the whole saved order (`taskOrder`) and the "still visible" completion records
      (`completionSeen`) with the plan's copies, translated through that map. Files that failed
      keep their old keys, which still match.

   Why replace the whole order rather than patch what the plan changed: patching relies on the
   reindex's heuristic pairing for the rest, which can swap two identical tasks' positions. Our
   write goes last, so whatever the reindex did is overwritten. Without translating
   `completionSeen`, a task completed mid-plan whose date was also planned would vanish from the
   panel after Apply.
3. **Apply failure:** closed. Goal (from Vitaly): Apply should work 99.999% of the time. Catch
   failure cases early, during planning, not at Apply. Conflicts are caught when the note
   changes, so Apply writes against lines the plan has just checked; what's left is a narrow race
   (an edit or a sync tool rewriting the file the moment Apply runs).
   - **Each file is all or nothing.** Inside each `vault.process`, Apply checks that every line it
     will change still matches what the plan expects. Any mismatch, or a write that throws, leaves
     that file untouched.
   - **If some files fail, stay in plan mode.** Every task stays in the plan view. The files that
     succeeded are applied, and their tasks no longer show as changed. The failed changes stay
     planned (leaving plan mode would lose them, since the plan is in memory only).
   - One notice names the unapplied changes, e.g. "2 changes in Projects.md weren't applied: the
     note changed". The button now reads "Apply 2 changes", so a retry is one click.
   - **On success:** the Apply animation (see "Toolbar, intro and Apply animation"), then the
     panel returns to the normal view.
4. **Tasks popup:** closed, see "What saves immediately vs. what is planned".
5. **Midnight rollover:** handled by the overlay model.

## Still to discuss

- Edits outside Obsidian: out of scope for version 1 (both the requester and Vitaly agree).
- Test release for the requester before the final release. **Decided:** a GitHub pre-release
  (e.g. `0.4.0-beta.1`) installed through BRAT, built by a new manual workflow from the
  plan-mode branch; no commit to main, no changelog stamp, invisible to store users. Each fix
  round is one more pre-release.
  - **How BRAT works (checked 2026-11-11):** it reads GitHub (pre-)releases and installs the
    highest by semver, taking `manifest.json` from the release assets, not the repo.
    `manifest-beta.json` is not needed. Testers can pin a version. Store users never see betas.
    Betas must rank above the store version: the drop menu ships first (e.g. `0.4.0`), so plan
    mode betas are `0.5.0-beta.N`. When `0.5.0` ships, BRAT moves the tester to it.
  - **Workflow "Beta release"** (manual, run on the plan-mode branch):
    1. Input: base version, e.g. `0.5.0`.
    2. Beta number = count of existing `0.5.0-beta.*` tags + 1.
    3. Stop if that tag exists.
    4. Set the version in `manifest.json` on the build machine only, never committed.
    5. `npm ci`, `npm run build`. No translation validation: new strings are English-only until
       translations are asked for, and missing keys fall back to English.
    6. Tag the commit, push only the tag. No branch commit, no changelog stamp.
    7. Publish a GitHub pre-release (not a draft) with `main.js`, `manifest.json`, `styles.css`.
  - **Requester's install steps: DRAFT, not reviewed.** Ask Vitaly to review this before the
    first pre-release is published. Check the BRAT command name and "Add plugin" button against
    BRAT's real UI (taken from docs/forum posts, not seen). Meant as a comment on issue #10:

    > **Plan mode beta is ready to try**
    >
    > It's installed through BRAT, which lets you run beta versions of community plugins.
    >
    > 1. In Obsidian, open **Settings → Community plugins**, search for **BRAT**, install it and
    >    enable it.
    > 2. Run the command **BRAT: Add a beta plugin for testing**.
    > 3. Paste `https://github.com/Unpreditable/GettingThingsDone`, pick the latest version, and
    >    click **Add plugin**.
    >
    > This replaces your installed Getting Things Done in place, and your settings and task order
    > are kept. BRAT updates you to each new beta automatically, and to the final release when it
    > ships. After that you can remove the plugin from BRAT.
    >
    > **Before you start:** back up your vault, or at least the notes you'll plan with. Apply
    > writes to many notes at once, and this is a beta.
    >
    > **To start:** run **Enter plan mode** from the command palette. The intro explains the rest,
    > and you can reopen it any time with ⓘ.
    >
    > **What I'd love feedback on:**
    > - Dragging across buckets and reordering, then Apply. Did every note end up how the plan
    >   looked?
    > - Editing a note while a plan is open, and the conflict banner if you hit one.
    > - Peek, undo/redo, and the pin/ask toggle.
    > - Anything that surprised you or felt slow.
    >
    > Reply here with what you find. Screenshots help.
