# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # esbuild watch mode (rebuilds on save — use with Hot Reload plugin)
npm run build     # TypeScript check + production bundle → main.js
npm test          # Jest unit tests (pure logic only, no Obsidian API)
npm test -- --testPathPattern=BucketManager  # run a single test file
```

**During development**: symlink this folder into `<vault>/.obsidian/plugins/gtd-tasks/` and install the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin. With `npm run dev` running, any source change auto-reloads the plugin without restarting Obsidian.

## Architecture

**Purpose**: Obsidian plugin that groups markdown checkbox tasks into GTD time-horizon buckets (Today, This Week, Someday, etc.) via a sidebar panel, with one-click moves between buckets.

### Data flow

```
Vault files (*.md)
  → TaskIndex       scans on load; watches vault modify/create/delete events
  → TaskParser      regex-parses checkbox lines → TaskRecord[]
  → TasksPluginParser  reads 📅 / ✅ emoji dates from Tasks plugin syntax
  → BucketManager   maps TaskRecords to BucketGroup[] using date range rules + tags
  → GTDPanel.svelte renders the grouped list

User move action
  → TaskWriter      locates line by rawLine match, writes new 📅 date / tag / field
  → vault.modify()  triggers vault event → TaskIndex re-indexes → UI refreshes
```

### Key files

| File | Role |
|---|---|
| [src/settings.ts](src/settings.ts) | Types (`BucketConfig`, `PluginSettings`, `DateRangeRule`) and defaults |
| [src/core/TaskParser.ts](src/core/TaskParser.ts) | Markdown checkbox parser; also exports `setTagValue`, `setInlineFieldValue`, `setSimpleTag` for write-back |
| [src/core/BucketManager.ts](src/core/BucketManager.ts) | Assignment logic (manual → auto date → To Review); date range matching |
| [src/core/TaskIndex.ts](src/core/TaskIndex.ts) | Live index; vault event registration |
| [src/core/TaskWriter.ts](src/core/TaskWriter.ts) | File write-back; locates task by lineNumber/rawLine, delegates to storage adapters |
| [src/core/StorageMigrator.ts](src/core/StorageMigrator.ts) | Rewrites bucket assignments when switching between storage modes |
| [src/integrations/TasksPluginParser.ts](src/integrations/TasksPluginParser.ts) | Read/write `📅 YYYY-MM-DD` on task lines |
| [src/views/GTDPanel.svelte](src/views/GTDPanel.svelte) | Root sidebar; handles context menu and drag-drop coordination |
| [src/views/BucketGroup.svelte](src/views/BucketGroup.svelte) | Collapsible bucket section; SortableJS drag-and-drop |
| [src/views/TaskItem.svelte](src/views/TaskItem.svelte) | Task row; checkbox, truncated text (tooltip on hover), quick-move buttons |
| [src/main.ts](src/main.ts) | Plugin entry point; `ItemView` wrapper bridging Obsidian lifecycle to Svelte |
| [src/settings-tab.ts](src/settings-tab.ts) | Single-page settings UI; bucket list at bottom with ↑/↓ reorder |

### Storage modes

Two modes (user-selectable in settings):
- **`inline-tag`** (default) — appends `#<prefix>/<bucket-id>` (e.g. `#gtd/today`)
- **`inline-field`** — appends `[<fieldname>:: <bucket-id>]` (Dataview-compatible)

Migration between modes via the settings tab.

### Bucket assignment priority

1. Manual (storage-mode tag/field)
2. Tasks plugin `📅` due date matched against bucket `dateRangeRule`
3. No assignment → **To Review** (system bucket, always first)

### Write-back safety

`TaskWriter` locates a task by `lineNumber` first (O(1)), falling back to `rawLine` scan if the file has shifted. If neither matches, it aborts with a notice and re-indexes rather than corrupting the file.

### Tests

Unit tests in `tests/` cover `TaskParser`, `TasksPluginParser`, `BucketManager`, `TaskWriter`, and `StorageMigrator` — pure logic with no Obsidian API dependency. The mock at `tests/__mocks__/obsidian.ts` stubs the `obsidian` module for Jest.

## CSS rules

- **No `!important`** — increase selector specificity or use CSS variables instead. Exception: utility classes like `.gtd-hidden` where `!important` is semantically required may be kept, but prefer avoiding even there.
- **No partially-supported CSS properties** — Obsidian's embedded Chromium lags behind the latest spec. Known problematic properties: `text-decoration-color`, `text-decoration-thickness`, `text-decoration-skip-ink`. Use `text-decoration: underline` without sub-properties; style links via `color` and the shorthand only.
- **Use Obsidian CSS variables** for all colors, fonts, spacing — never hardcode values that themes should control.
