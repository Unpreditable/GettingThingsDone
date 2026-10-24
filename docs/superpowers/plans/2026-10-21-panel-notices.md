# What's New Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A list-driven, one-time "what's new" banner in the panel for existing users, plus a translated markdown changelog in a modal reachable from the banner, the settings page and a command.

**Architecture:** Note entries live in `src/notices.json`, with their text in `en.json`. Pure logic in `src/core/PanelNotices.ts` picks the note to show. `src/changelog/<lang>.md` holds the changelog, picked by `src/changelog/index.ts`. `GTDPanel.svelte` adds one last `{:else if}` banner driven by `settings.lastNoticeSeen`. `WhatsNewModal.ts` renders the changelog. `release.yml` stamps `## Unreleased` with the tag. `validate-translations.mjs` checks every locale's changelog.

**Tech Stack:** TypeScript, Svelte 4 syntax, Obsidian `Modal` + `MarkdownRenderer`, Jest, GitHub Actions + sed.

**Spec:** [docs/superpowers/specs/2026-10-21-panel-notices-design.md](../specs/2026-10-21-panel-notices-design.md)

## Global Constraints

- **No commits.** Leave everything uncommitted on `feat/panel-notices`. The user commits the finished feature as one commit (this overrides the skill's commit steps).
- New UI strings go into `src/i18n/locales/en.json` only, each with a `_comment` sibling, under a new top-level `whatsNew` key. No other locale files, and no changelog translations, until the user asks.
- Note ids are numbers, rising in list order: `1`, `2`, `3`…
- No `!important`, no inline styles, Obsidian CSS variables only. Banner reuses the `gtd-language-banner*` classes.
- Strings: title/command/settings button "What's new"; "Dismiss"; "Open Settings"; "Read more" (opens the changelog); "Read in English".

## Review Focus

1. **An existing install upgrading for the first time** (`data.json` present, no `lastNoticeSeen`) must see the newest note. A fresh install must not. (Tests in Task 1, e2e in Task 6.)
2. **A deleted note** (`lastNoticeSeen` names an id no longer in the list) must not bring back an older note. (Task 1.)
3. **A note with no text in en.json** would render an i18next key in the banner. (Registry test in Task 1.)
4. **Another banner is already showing** (e.g. week start unseen): the note waits its turn and doesn't stack. (e2e in Task 6.)
5. **The translation check** must fail on a missing bullet, not only on a missing file. (Task 3.)
6. **The settings banner on Obsidian 1.13+**: a second button must not break the escape-hatch layout fixed in commit 6a40122. (Manual check in Task 5.)

---

### Task 1: Note list and selection logic

**Files:** Create `src/notices.json`, `src/core/PanelNotices.ts`, `tests/PanelNotices.test.ts`. Modify `src/i18n/locales/en.json`.

**Produces:**
```ts
export type NoticeAction = "dismiss" | "settings";
export interface PanelNotice { id: string; action: NoticeAction }
export const PANEL_NOTICES: PanelNotice[];  // notices.json, oldest first
export function noticeToShow(notices: PanelNotice[], lastSeen: string): PanelNotice | null
export function seedLastNoticeSeen(freshInstall: boolean, notices: PanelNotice[]): string
export function settleUnknownNotice(lastSeen: string, notices: PanelNotice[]): string
```

- [ ] **Step 1: Failing tests**, fixture list `a`, `b`, `c`:
  - `noticeToShow([], "")` → `null`. `noticeToShow(list, "")` → `c`. With `"c"` → `null`. With `"a"` → `c`.
  - `seedLastNoticeSeen(true, list)` → `"c"`; `(false, list)` → `""`; `(true, [])` → `""`.
  - `settleUnknownNotice("gone", list)` → `"c"`; `("a", list)` → `"a"`; `("", list)` → `""`; `("gone", [])` → `""`.
  - Registry on `PANEL_NOTICES`: ids are numbers rising in list order; action is `dismiss` or `settings`; every id has a non-empty `en.whatsNew.notes[id].message`.
- [ ] **Step 2:** `npm test -- --testPathPattern=PanelNotices` → FAIL (module not found).
- [ ] **Step 3: Implement**, plus en.json keys `whatsNew.title`, `openChangelog`, `dismiss`, `openSettings`, `readInEnglish`, `notes.1.message`.
- [ ] **Step 4:** same command → PASS.

### Task 2: Changelog files and build wiring

**Files:** Create `src/changelog/en.md`, `src/changelog/index.ts`, `tests/mdTransform.js`, `tests/changelog.test.ts`. Modify `esbuild.config.mjs`, `src/global.d.ts`, `jest.config.js`, `jest.perf.config.js` if it shares transforms.

**Produces:** `export function changelogFor(lang: string): { text: string; isEnglish: boolean }`.

- [ ] **Step 1: Failing tests:** `changelogFor("en")` → en text, `isEnglish: true`; `changelogFor("xx")` → en text, `isEnglish: true`; en text starts with `## Unreleased`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (loader, d.ts, Jest transform, `en.md` with an `## Unreleased` section and two placeholder bullets). **Step 4:** run → PASS; `npm run build` passes.

### Task 3: Changelog translation check

**Files:** Modify `scripts/validate-translations.mjs`.

- [ ] **Step 1:** For every locale JSON except `en.json` and `sample_lang.json`, require `src/changelog/<lang>.md` with the same `##` headings as `en.md` in order and the same bullet count under each. Print one `❌`/`✅` line per changelog, like the key check.
- [ ] **Step 2: Verify.** Temporarily copy `en.md` to `de.md`: `de.md` passes. Remove one bullet from it: fails with a message naming the heading. Delete the temp file. With only `en.md`, the script fails for the 12 missing locales (expected until translations are asked for).

### Task 4: Setting, panel banner and changelog modal

**Files:** Modify `src/settings.ts`, `src/main.ts`, `src/views/GTDPanel.svelte`, `styles.css`. Create `src/views/WhatsNewModal.ts`.

- [ ] **Step 1: Setting.** `lastNoticeSeen: string`, default `""`, doc comment like `weekStartNoticeSeen`'s. In `loadSettings`: seed with `seedLastNoticeSeen(raw == null, PANEL_NOTICES)` when missing, then always `settleUnknownNotice`.
- [ ] **Step 2: Modal.** Title `t("whatsNew.title")`. Renders `changelogFor(i18next.language)` into a child div with `MarkdownRenderer.render(app, text, el, "", component)`. When `!isEnglish`, a link `t("whatsNew.readInEnglish")` (class `gtd-whats-new-english`) above it re-renders with `en` and removes itself. `onClose` unloads the component and empties `contentEl`.
- [ ] **Step 3: Plugin wiring.** `openWhatsNew()`; command `show-whats-new` after `review-completed-tasks`; panel props `onDismissNotice(id)`, `onOpenChangelog()`.
- [ ] **Step 4: Banner.** `$: panelNotice = noticeToShow(PANEL_NOTICES, settings.lastNoticeSeen)`, last `{:else if}`, buttons: action (if not dismiss), What's new, Dismiss. Each also calls `onDismissNotice`. Update the "One banner at a time" comment.
- [ ] **Step 5:** `npm run build` and `npm test` → pass.

### Task 5: Settings page button

**Files:** Modify `src/settings-tab.ts` (`renderBanner`), `styles.css`.

- [ ] **Step 1:** Wrap the feedback button and a new "What's new" button in `div.gtd-settings-banner-buttons` (column flex, `gap: var(--size-4-2)`, `flex-shrink: 0`). Click → `this.plugin.openWhatsNew()`.
- [ ] **Step 2: Manual:** buttons stack at the banner's right on Obsidian 1.14; message keeps its width; both buttons work.

### Task 6: End-to-end spec

**Files:** Create `e2e/specs/notices.e2e.ts` (no imports; copy the helper style from `report.e2e.ts`). Modify `e2e/README.md`.

- [ ] **Step 1:** Cases:
  - `lastNoticeSeen = ""`, other notices seen → one banner with the note text. Dismiss removes it, `lastNoticeSeen === "1"`, still gone after plugin reload.
  - `weekStartNoticeSeen = false`, `lastNoticeSeen = ""` → only week-start shows; dismissing it reveals the note.
  - `lastNoticeSeen = "gone"` + reload → no note banner, `lastNoticeSeen === "1"`.
  - Command `gtd-tasks:show-whats-new` opens a modal titled "What's new" containing `Unreleased`, and no `.gtd-whats-new-english` link (English UI).
  - Settings tab "What's new" button opens the same modal.
- [ ] **Step 2:** `npm run test:e2e -- --spec notices` → PASS. Takes the keyboard while it runs.

### Task 7: Release stamping and docs

**Files:** Modify `.github/workflows/release.yml`, `README.md`, `CLAUDE.md`.

- [ ] **Step 1:** Step "Stamp the changelog" after "Record version in versions.json": `sed -i "s/^## Unreleased$/## $TAG/" src/changelog/*.md`. Add `src/changelog` to the `git add`.
- [ ] **Step 2: Verify locally** on a copy of `en.md`: only the `## Unreleased` line changes (`diff`).
- [ ] **Step 3: Docs.** README Usage "What's new" subsection; CLAUDE.md key-files rows.
- [ ] **Step 4:** `npm run build`, `npm test` → pass. `validate-translations` fails on the new keys and missing changelogs until translations are requested.
