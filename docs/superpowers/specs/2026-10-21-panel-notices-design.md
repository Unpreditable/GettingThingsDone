# What's new: panel notices and a changelog

**Date:** 2026-10-21
**Status:** Approved in conversation

## Problem

Features that sit behind a ribbon icon, a command or the right-click menu go unnoticed by people
who already use the plugin. They read the README once, when they install. The 0.3.0 features are
the first case: the completion report (🏆, "See what you got done") and changing dates from the
right-click menu.

The panel already has three one-time banners (language change, catch-all rule, week start). Each
one was added by hand: a settings flag, a store or prop, a dismiss handler and a Svelte block.
Doing that for every release is too much work.

## Goals

- Announcing a release takes one entry in a list plus its text in `en.json`. No Svelte, settings
  or handler code.
- Each note picks its action: just Read more and Dismiss, or also open the GTD settings tab.
- **Existing users only.** A fresh install never sees a note that was in the list when it was
  installed.
- **One note at most.** Someone who upgrades across five releases sees only the newest note, once.
  Dismissing it settles all the older ones. Older notes never come back as banners.
- **A changelog lists every release's highlights**, newest first, in the user's language. It is
  reachable from the banner, from a button in settings, and from a command.
- **The version is never typed by hand.** The release workflow stamps it, so the changelog matches
  what actually shipped.
- **A release can't ship an untranslated changelog.** The translation check covers it.

## Non-goals

- Moving the three existing banners onto this system. Their conditions (session-only language
  change, a catch-all rule that depends on bucket config) don't fit a static list.
- A link to GitHub from the banner or the changelog.

## Anti-goals

- A stack of banners, or one note after another to dismiss.
- A note appearing on a fresh install, describing things the user has never seen any other way.
- A release shipping a note with no text, a changelog with a missing translation, or a version
  that doesn't match the release.

## Design

### The list of notes

`src/notices.json` is an array, oldest first. Each entry has:

| Field | Meaning |
|---|---|
| `id` | A number, one higher than the note before it, so the newest note has the highest number in both `notices.json` and `en.json`. It is also the key of the note's text in `en.json`. A deleted note's number is never reused: an install that settled it would take the new note for the one it had already seen. |
| `action` | `"dismiss"` or `"settings"` |

The text lives at `whatsNew.notes.<id>.message` in `en.json`. Action button labels are shared per
action (`whatsNew.openSettings`), not written per note.

The first entry is `{ "id": "1", "action": "dismiss" }`. Its placeholder text is "New:
see what you got done (🏆), and change dates from the right-click menu." The user will rewrite it.

A note is for a major change. A minor change only goes into the changelog, where people see it
when they open it themselves.

### Which note shows

There is one setting, `lastNoticeSeen: string`, the id of the newest note this install has
settled.

- If the list is empty, or the newest entry's id equals `lastNoticeSeen`, nothing shows.
  Otherwise the newest entry shows.
- On load, if `lastNoticeSeen` is missing from `data.json`:
  - **Fresh install** (no `data.json`): it is set to the newest id, so nothing shows.
  - **Existing install**: it is set to `""`, so the newest note shows.

  This is the same pattern as `weekStartNoticeSeen` in [main.ts](../../../src/main.ts).
- On every load, if `lastNoticeSeen` is non-empty and not an id in the list (the note it named was
  deleted), it is reset to the newest id. Without this the next-newest note would show again.
- A note added in a later release is newer than anything a past install has seen, so it shows for
  everyone who installed before it. No per-note bookkeeping is needed.

### The banner

The note joins the existing chain of banners in [GTDPanel.svelte](../../../src/views/GTDPanel.svelte)
as the last `{:else if}`, so the language, catch-all and week-start banners come first and nothing
stacks. It uses the same `gtd-language-banner` styles. Its buttons, in order:

1. **Open Settings**, when the note's action is `settings`.
2. **Read more**, which opens the changelog. Someone who clicks it on a what's new note expects more
   about what's new, so it doesn't lead to the README.
3. **Dismiss**.

Every button settles the note by saving its id to `lastNoticeSeen`. The changelog keeps the text
reachable afterwards, so clicking through doesn't leave a banner behind to dismiss.

### The changelog

`src/changelog/<lang>.md`, one file per locale, starting with `en.md`. Each file has a
`## <version>` heading per release, newest first, with bullets under a `#### Features` and a
`#### Fixes` section, each only when it has entries. Work not yet released
sits under `## Unreleased` at the top. `src/changelog/index.ts` imports every file that exists and
maps language code to text, the same way [i18n.ts](../../../src/i18n/i18n.ts) imports the JSON
locales.

`WhatsNewModal` is a plain Obsidian `Modal`, titled "What's new". It renders the current
language's file with `MarkdownRenderer.render`, falling back to `en.md`. It owns a `Component`,
loaded in `onOpen` and unloaded in `onClose`.

When the UI language isn't English and that language has its own file, a **Read in English** link
sits above the text. Clicking it re-renders the modal with `en.md`, and the link becomes one back to
the translation (`whatsNew.readTranslated`, which each locale words in its own language, e.g.
"Читать на русском"). Reopening the modal shows the translation again.

Three ways to open it:

- the banner's **What's new** button
- a **What's new** button next to **Share feedback & ideas** in the settings banner
  ([settings-tab.ts](../../../src/settings-tab.ts) `renderBanner`)
- a command, `show-whats-new`, named "What's new"

### Version stamping

A new step in [release.yml](../../../.github/workflows/release.yml), after "Record version in
versions.json":

```bash
sed -i "s/^## Unreleased$/## $TAG/" src/changelog/*.md
```

`src/changelog/` joins the `git add` in "Commit and tag". A release with no `## Unreleased`
section changes nothing. The step runs before the build, so the shipped `main.js` carries the
stamped headings. A release that fails before "Commit and tag" commits nothing, so a rerun stamps
the right version.

### Translation check

[validate-translations.mjs](../../../scripts/validate-translations.mjs) also checks the
changelog. Every locale with a JSON file (except the `sample_lang.json` template) must have
`src/changelog/<lang>.md`, imported in `src/changelog/index.ts`, with the same `##` headings as
`en.md` in the same order. Under each release it must have the same `####` sections (Features,
Fixes) in the same places, with the same number of bullets in each; section titles are translated,
so only their places are compared. Like the key check, it catches missing entries, not stale
wording.
The release workflow already runs this script as a hard gate.

### Build

- esbuild: add `".md": "text"` to `loader`.
- [global.d.ts](../../../src/global.d.ts): `declare module "*.md"`, a string default export.
- Jest: a `\.md$` transform that exports the file's text.

### Strings

All new strings go into `en.json` only, each with a `_comment`, under a new top-level `whatsNew`
key. The `notices` key is already taken by toasts. The translation check fails until they're
translated, as usual.

### Docs

- README Usage: one line on the **What's new** command and settings button.
- CLAUDE.md key-files table: add `src/core/PanelNotices.ts`, `src/notices.json` and
  `src/changelog/`.
- e2e/README.md table: add the new spec.

## Calls made without the user

- Action button labels are shared per action, not written per note.
- The first note's action is `dismiss`.
- The banner text (`en.json`) and the changelog (markdown) are written separately. A new note
  doesn't need a matching changelog bullet, and nothing checks that they agree.
- The modal falls back to English only while a translation is missing; the translation check fails
  during that time anyway.
- The link back to the translation is a per-locale string, not built from the language's name:
  "Read in {{language}}" doesn't decline in languages like Russian.
- The `## Unreleased` heading is literal markdown, not translated. Only dev builds show it.
