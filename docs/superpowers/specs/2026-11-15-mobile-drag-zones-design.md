# Drag tasks by (Mobile) — GitHub issue #11

## Why

On a phone, a swipe that starts on a task row picks the task up instead of scrolling the panel.
SortableJS is created with no `handle` and no `filter` (`BucketGroup.svelte`), so the first finger
movement over any row starts a drag. The reporter moves tasks between buckets by accident.

## Decided

- A new setting, **"Drag tasks by (Mobile)"**, in the Behaviour section. It takes effect only when
  `Platform.isMobile` is true. Desktop keeps today's behaviour: the whole row drags with the mouse.
- Settings sync between devices, so the setting shows on desktop too, for setting up the phone.

| Choice | A drag starts on | Default |
|---|---|---|
| Right grip | the grip at the right end of a row | ✔ |
| Left grip | the grip at the left end of a row | |
| Right bar | the thin bar along the right edge | |
| Left bar | the thin bar along the left edge | |
| Right half | the right half of a row; the left half scrolls | |
| Left half | the left half of a row; the right half scrolls | |
| Whole row | anywhere on a row (today's behaviour) | |

- **Grips and bars** sit in a touch area 32px wide and the full row height, pinned to the panel
  edge. They never indent with subtasks. A left grip or bar moves the checkbox right by its width.
- **Quick-move buttons** still appear on hover. A tap leaves the hover on a phone, so they show
  after a tap. With a right grip or bar they sit to its left, never on top of it. They are not
  hidden on mobile: a user who has tapped a task may still want to move it.
- **Halves** split at the middle of the panel, the same line for every row, subtasks included.
- Taps keep working everywhere: checkbox, text, links, long-press for the row menu. Sortable only
  starts a drag once the finger moves.

## Approaches

- **Grips and bars: Sortable's `handle`**, a selector for the grip or bar element. Chosen.
- **Halves: Sortable's `filter` as a function**, which turns down a drag that starts in the scroll
  half, with `preventOnFilter: false` so the tap still goes through. Chosen.
- **Halves through `handle`**: needs an invisible element over half of each row, which would take
  the taps meant for the checkbox and the text. Rejected.
- **Long-press to drag** (`delay` + `delayOnTouchOnly`): Obsidian mobile opens the row menu on a
  long press, so one gesture would do two things. Rejected.

## Settings page

- On Obsidian 1.13+, the Behaviour entry opens its own page (like Pinning). The entry's
  description shows the current choice.
- The page, top to bottom:
  - the explanation of why the setting exists;
  - the dropdown;
  - a description under the dropdown for the current choice, swapped when it changes;
  - a preview: a small mock panel with three rows, one a subtask, drawn for the current choice.
    The half choices show a dashed line with "drag" and "scroll" on either side.
- Before 1.13, the same controls sit in the Behaviour section itself.

## Text (`en.json` only)

- Entry name: "Drag tasks by (Mobile)"
- Explanation: "On a phone, a swipe that starts on a task can move it instead of scrolling the
  panel. Choose where on a row a drag starts. A swipe anywhere else scrolls. On desktop the whole
  row drags, and you scroll with the mouse or touchpad."
- Choice labels: Right grip, Left grip, Right bar, Left bar, Right half, Left half, Whole row.
- Choice descriptions:
  - Right grip: "Drag by the grip at the right end of a row."
  - Left grip: "Drag by the grip at the left end of a row."
  - Right bar: "Drag by the thin bar along the right edge."
  - Left bar: "Drag by the thin bar along the left edge."
  - Right half: "Drag from the right half of a row. Swipe on the left half to scroll."
  - Left half: "Drag from the left half of a row. Swipe on the right half to scroll."
  - Whole row: "Drag from anywhere on a row. Scroll by swiping on the bucket headers or the
    scrollbar."
- Preview caption: "The dashed line only appears in this preview."
- Preview labels: "drag", "scroll".

## What's new banner

- A new note in `notices.json` with the existing `"settings"` action, shown on every device.
- Text: "Scrolling on mobile is easier: tasks now drag by a grip on the right."
- "Open settings" opens the plugin's settings tab, not the new page.

## Not in scope

- Screen-edge swipes that open Obsidian's sidebars. Users pick the choice that suits their phone.
- A mobile-only banner.
- Making the setting affect desktop.
