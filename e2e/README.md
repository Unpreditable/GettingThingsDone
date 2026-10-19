# End-to-end tests

These tests drive a real Obsidian, and check what a person using the panel would see and what ends
up in the note. They run on your own machine only; they are not part of `release-check` or CI.

The code that runs them is not here. It is the
[ObsidianE2EHarness](https://github.com/Unpreditable/ObsidianE2EHarness) repo, checked out in the
folder beside this one (`../ObsidianE2EHarness`) with `npm install` run in it once. Its README has
the helpers a spec can use and what to look at when a test fails.

```bash
npm run test:e2e                    # build the plugin, then run every spec
npm run test:e2e -- --spec panel    # only the spec files whose path contains "panel"
npm run test:all                    # the unit tests, then every spec
```

Each ends with a line to read at a glance; `test:all` with two, one for the unit tests and one for
these.

An Obsidian window opens and takes the keyboard until the run ends, so leave the machine alone
meanwhile.

## What is here

| Path | What |
|---|---|
| `e2e.config.json` | The Obsidian version, and the Tasks plugin version the specs run with |
| `vault/` | The notes every run starts from |
| `specs/panel.e2e.ts` | The panel by itself: what it lists, and what ticking or moving a task writes |
| `specs/settings.e2e.ts` | Settings that change what the panel lists or what a move writes |
| `specs/tasks.e2e.ts` | The panel with Tasks installed: a tick goes through Tasks, as it does in the editor |
| `specs/dataview.e2e.ts` | Tasks' Dataview-format fields: what the panel reads from them, the tag / field name that may not reuse their keys, and ticking and editing them through Tasks |
| `specs/waiting.e2e.ts` | Tasks that can't be done yet: a 🛫 date after today or an open ⛔ blocker dims the row; the popover explains, and the menu jumps to the blocker |
| `specs/status.e2e.ts` | The "Toggle task in progress" and "Toggle task cancelled" commands in the editor, with and without Tasks |
| `tsconfig.json` | Type-checks the specs |
| `harness.d.ts` | The harness's declarations of everything a spec can use. A copy: do not edit it |

The fixture's tasks carry no dates: a `📅` would land in a different bucket depending on the day the
suite runs. A test that needs a dated task writes the note itself, with a date worked out from today.

The spec files have no imports, and must stay that way: `describe`, `it`, `expect`, `browser` and
the helpers are globals the harness provides. Obsidian's plugin review reads every TypeScript file
in this repo as plugin code, and objects to an import of anything that is not a dependency of the
plugin.

`harness.d.ts` is here, and not only in the harness's repo, for the same review: it type-checks the
specs with no harness beside them, and without the declarations every helper call is a warning. A
run refuses to start while the copy differs from the harness's own; refresh it with
`node ../ObsidianE2EHarness/bin/obsidian-e2e.mjs --update-types`.
