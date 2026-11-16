# Drag Tasks By (Mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-only setting, "Drag tasks by", so a swipe over a task row scrolls the panel
instead of picking the task up. Fixes GitHub issue #11.

**Architecture:**
- A pure module, `src/core/DragZone.ts`, turns the setting into SortableJS options.
- `TaskItem.svelte` draws the grip or bar; `BucketGroup.svelte` applies the options.
- `settings-tab.ts` adds the entry, its page and the preview.

**Tech Stack:** TypeScript, Svelte 5 (legacy syntax), SortableJS 1.15, Obsidian API, Jest, the
ObsidianE2EHarness specs.

**Spec:** [docs/superpowers/specs/2026-11-15-mobile-drag-zones-design.md](../specs/2026-11-15-mobile-drag-zones-design.md).
Every decision and string is there; this plan only orders the work.

## Where to work

On `main`, no feature branch. No commits until the feature is done and Vitaly has tried it with
`app.emulateMobile(true)`. Then **one** commit, including the spec and this plan.

New strings go into `en.json` only. `validate-translations` fails until Vitaly asks for
translations; that is expected.

## Decisions this plan makes that the spec leaves open

1. **Setting key:** `mobileDragBy`, type `MobileDragBy` = `"right-grip" | "left-grip" |
   "right-bar" | "left-bar" | "right-half" | "left-half" | "whole-row"`, default `"right-grip"`.
2. **Grip icon:** Lucide `grip-vertical` through `setIcon`. Check it exists in Obsidian's bundled
   Lucide first (`setIcon` fails silently). Icon CSS goes in `styles.css`, never a Svelte block.
3. **Bar look:** 3px wide, 60% of the row height, `--text-faint`, centred in its 32px touch area.
4. **Where the halves split:** the middle of the task list element's bounding box, read at touch
   start, so every row uses the same line.
5. **Settings change:** `sortable.option("handle" | "filter", …)` updates a mounted list; no reload.
6. **Notice id:** `"2"`, text under `whatsNew.notes.2.message`.

---

### Task 1: `DragZone.ts` and its tests (about 45 min)

**Files:**
- Create: `src/core/DragZone.ts`
- Create: `tests/DragZone.test.ts`
- Modify: `src/settings.ts` (type, field, default)

- [ ] **Step 1: Add the setting** — `MobileDragBy` type, `mobileDragBy` field with a doc comment,
  default `"right-grip"` in `DEFAULT_SETTINGS`.
- [ ] **Step 2: Write failing tests** for `dragZone(mode, isMobile)`:
  - desktop returns `{ kind: "row" }` for every mode;
  - `whole-row` on mobile returns `{ kind: "row" }`;
  - grips and bars return `{ kind: "handle", side, look }`;
  - halves return `{ kind: "half", side }`.
- [ ] **Step 3: Write failing tests** for `inDragHalf(side, x, left, width)`: true on the drag
  side, false on the scroll side, the midpoint counts as the drag side's edge.
- [ ] **Step 4: Run** `npm test -- --testPathPattern=DragZone` and confirm they fail.
- [ ] **Step 5: Implement** `dragZone`, `inDragHalf`, and `sortableOptions(zone, listEl)`, which
  returns `{ handle: ".gtd-drag-handle" }`, or a `filter` function with `preventOnFilter: false`,
  or `{}`. The filter reads `clientX` from the event, or from `touches[0]` for a touch event.
- [ ] **Step 6: Run** the tests and confirm they pass.

### Task 2: The grip and the bar on a row (about 1 hour)

**Files:**
- Modify: `src/views/TaskItem.svelte`
- Modify: `styles.css`

- [ ] **Step 1:** Pass the zone into `TaskItem` (from `GTDPanel` through `BucketGroup`, the way
  `settings` already travels).
- [ ] **Step 2:** For a `handle` zone, render `<span class="gtd-drag-handle">` with the grip icon
  or the bar. A right handle goes after `.gtd-task-actions`, so the hover buttons sit to its left.
  A left handle goes before the checkbox.
- [ ] **Step 3:** In `styles.css`: a 32px touch area the full row height, pinned to the row edge
  and not indented (cancel the subtask indent with a negative margin or absolute positioning).
  A left handle adds its width to the row's left padding so the checkbox moves right.
- [ ] **Step 4:** `npm run build`, then check with `app.emulateMobile(true)` that each of the
  four handle choices draws in the right place, with subtasks and with hover buttons shown.

### Task 3: Sortable options (about 45 min)

**Files:**
- Modify: `src/views/BucketGroup.svelte`

- [ ] **Step 1:** In `onMount`, spread `sortableOptions(zone, taskListEl)` into `Sortable.create`.
- [ ] **Step 2:** A reactive statement calls `sortable.option(...)` when the zone changes,
  clearing whichever of `handle` / `filter` the new zone doesn't use.
- [ ] **Step 3:** Check a drop onto a bucket header still works when the drag starts from a
  handle. A touch drag fires `pointermove`, not `dragover` (`GTDPanel.svelte`, drop menu).
- [ ] **Step 4:** `npm run build` and `npm test`.

### Task 4: Settings entry, page and preview (about 1.5 hours)

**Files:**
- Modify: `src/settings-tab.ts`
- Modify: `src/i18n/locales/en.json`
- Modify: `styles.css`

- [ ] **Step 1:** Add every string from the spec's Text section to `en.json`, each with a
  `_comment` for translators, under `settings.behaviour.dragBy`.
- [ ] **Step 2:** In the 1.13+ Behaviour group, add a `type: "page"` entry: name "Drag tasks by
  (Mobile)", `desc` the current choice's label, page from `createSubPage`.
- [ ] **Step 3:** `renderDragBy(el, page)`: the explanation (on the page only), the dropdown, the
  per-choice description swapped on change, and the preview. Saving refreshes open panels.
- [ ] **Step 4:** The preview: three mock rows built with `createDiv`, one indented, drawing the
  grip, bar or dashed line with "drag" / "scroll" labels, plus the caption. Redrawn on change.
  Styles in `styles.css`, Obsidian variables only.
- [ ] **Step 5:** In `renderLegacyBehaviourFallback`, call `renderDragBy(el, false)` so Obsidian
  before 1.13 shows the controls in the section.
- [ ] **Step 6:** `npm run build`; check the page and the preview by hand in Obsidian.

### Task 5: Banner and changelog (about 15 min)

**Files:**
- Modify: `src/notices.json`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/changelog/en.md`

- [ ] **Step 1:** Append `{ "id": "2", "action": "settings" }` to `notices.json`.
- [ ] **Step 2:** Add `whatsNew.notes.2.message` with the spec's banner text.
- [ ] **Step 3:** Under `## Unreleased` in `en.md`: "On mobile, tasks drag by a grip so the panel
  scrolls. Choose the grip, a bar, half the row or the whole row in settings."

### Task 6: End-to-end tests (about 45 min)

**Files:**
- Modify: `e2e/specs/panel.e2e.ts` (no new imports, see `e2e/README.md`)
- Modify: `e2e/specs/settings.e2e.ts`

- [ ] **Step 1:** Find out whether `app.emulateMobile(true)` through `browser.execute` makes
  `Platform.isMobile` true for the panel, and whether a synthetic touch drag reaches Sortable.
  If either fails, note it here and drop the drag specs, keeping only the settings spec.
- [ ] **Step 2:** Spec: with Right grip, a drag from the row text leaves the task in place; a drag
  from the grip moves it to another bucket.
- [ ] **Step 3:** Spec: with Left half, a drag from the right half leaves the task in place.
- [ ] **Step 4:** Spec: the settings page shows the description and preview for the chosen value,
  and both change with the dropdown.
- [ ] **Step 5:** Turn emulation off at the end of each spec.

### Task 7: Checks and the commit (about 15 min, plus Vitaly's testing)

- [ ] **Step 1:** `npm run build`, `npm test`, `npm run test:perf`, `npm run test:e2e`. Report the
  output as it is; `validate-translations` failing is expected.
- [ ] **Step 2:** Vitaly tries every choice with `app.emulateMobile(true)`.
- [ ] **Step 3:** After Vitaly's OK, one commit with the code, the spec and this plan. Subject
  only plus terse bullets; no mention of tests or plan documents.
