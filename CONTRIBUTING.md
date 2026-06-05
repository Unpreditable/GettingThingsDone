# Contributing

Thanks for your interest in GTD Tasks! There are four ways to contribute:

- [Report a bug](#report-a-bug)
- [Request a feature](#request-a-feature)
- [Submit a translation](#submit-a-translation)
- [Submit a code change](#submit-a-code-change)

---

## Report a Bug

[Open an issue](https://github.com/Unpreditable/GettingThingsDone/issues) — check for duplicates first.

A useful report includes:

- **Obsidian version** — Settings → About
- **GTD Tasks version** — Settings → Community plugins
- **Steps to reproduce** — what you did, what you expected, what happened instead
- **Relevant task line** (optional) — the raw markdown of the misbehaving task, with any sensitive text removed

---

## Request a Feature

[Open an issue](https://github.com/Unpreditable/GettingThingsDone/issues) and label it `enhancement`.

Describe the problem you are trying to solve rather than the specific solution — this helps evaluate whether the request fits the plugin's direction. Feature implementation is handled by the maintainer.

---

## Submit a Translation

The plugin uses Obsidian's interface language setting and defaults to English for unsupported languages.

### Improve an existing translation

1. Browse to the [locales folder](https://github.com/Unpreditable/GettingThingsDone/tree/main/src/i18n/locales) and open your language file.
2. Click the pencil icon to edit on GitHub (fork when prompted).
3. Fix or fill in any strings. For context on what each key means, refer to the `_comment` fields in [`en.json`](https://github.com/Unpreditable/GettingThingsDone/blob/main/src/i18n/locales/en.json).
4. Open a pull request.

### Add a new language

1. Open [`sample_lang.json`](https://github.com/Unpreditable/GettingThingsDone/blob/main/src/i18n/locales/sample_lang.json) — it contains every translatable key with blank values.
2. Click the pencil icon to edit on GitHub (fork when prompted).
3. Fill in every blank value with your translation. For context on what each key means, refer to the `_comment` fields in [`en.json`](https://github.com/Unpreditable/GettingThingsDone/blob/main/src/i18n/locales/en.json).
4. Save the file as `<locale>.json`, where `<locale>` is the BCP 47 language tag for your language — typically a two-letter [ISO 639-1 code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) such as `fr`, `de`, or `zh`. For regional variants add a subtag: `zh-TW` for Traditional Chinese, `pt-BR` for Brazilian Portuguese, and so on.
5. Optionally, register the language in `src/i18n/i18n.ts` by adding an import line and an entry in the `resources` object, following the pattern of the existing languages. This step is optional — if you would rather skip it, submit the JSON file and the maintainer will wire it up.
6. Open a pull request.

---

## Submit a Code Change

Logic and feature changes are not actively solicited — please [open an issue](https://github.com/Unpreditable/GettingThingsDone/issues) first to discuss. Translation PRs are always welcome without prior discussion.

If you do proceed with a code change:

**Setup**

1. Fork the repository and create a branch from `main`.
2. Install dependencies: `npm install`
3. Start the dev build: `npm run dev`
4. Symlink the repository folder into `<vault>/.obsidian/plugins/gtd-tasks/` and install the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin — changes rebuild and reload automatically.

**Requirements before opening a PR**

- `npm run build` passes (TypeScript check + lint)
- `npm test` passes
- Any new logic is covered by Jest tests in `tests/`
- CSS changes follow the project rules:
  - No `!important` — raise selector specificity instead
  - No inline styles — use scoped `<style>` blocks in Svelte components
  - All colors, fonts, and spacing use Obsidian CSS variables
