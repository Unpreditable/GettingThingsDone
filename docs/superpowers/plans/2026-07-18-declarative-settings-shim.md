# Declarative Settings API Adoption (Phase 1: Foundation Shim) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `PluginSettingTab.getSettingDefinitions()` on `GtdSettingsTab` so the reviewer warning ("This PluginSettingTab does not implement getSettingDefinitions()... settings will not appear in Obsidian's settings search") is resolved, and convert the one section where full declarative conversion is low-risk (Behaviour) to get real per-setting search.

**Architecture:** `getSettingDefinitions()` is additive to the existing `display()`/`refresh()` imperative path, not a replacement — `manifest.json` declares `minAppVersion: "1.8.7"`, well before the 1.13.0 API, so `display()` must keep working unchanged for older Obsidian. The four existing render methods (`renderBanner`, `renderGeneralSection`, `renderBehaviourSection`, `renderBucketsSection`) are wrapped one-for-one as `SettingDefinitionRender` escape-hatch rows so 1.13.0+ users get the new declarative tree with *zero* behavior change, while pre-1.13.0 users keep going through `display()`. The Behaviour section (4 self-contained toggle/dropdown rows, no complex side effects except one) is then upgraded from the escape hatch to real `SettingDefinitionControl` entries, which is what actually makes those specific settings show up in Obsidian's settings search by name.

**Tech Stack:** TypeScript, Obsidian Plugin API (`obsidian` package, declarative settings types added in 1.13.0 — already present in `node_modules/obsidian/obsidian.d.ts`), i18next (via `src/i18n/i18n.ts`).

## Global Constraints

- `manifest.json minAppVersion` is `1.8.7` — `display()` must remain fully functional as the fallback for pre-1.13.0 Obsidian. Never remove it.
- This codebase's automated Jest tests only cover pure logic with no Obsidian API dependency (`tests/` — TaskParser, TasksPluginParser, BucketManager, TaskWriter, StorageMigrator; see `CLAUDE.md`). `settings-tab.ts` has zero automated test coverage today and this plan does not add any — every step's "test" is a manual verification checklist run inside a real Obsidian vault with Hot Reload, matching how the rest of this file has always been verified (see the banner feature built earlier in this project).
- New user-facing strings must be added to **all** locale files (`en` + the 12 translations: de, es, et, fr, ja, ko, lt, lv, pt, ru, uk, zh) plus the `sample_lang.json` template, or `npm run validate-translations` (part of `npm run build`) fails the build.
- CSS rules from `CLAUDE.md`: no `!important`, no inline styles, no partially-supported `text-decoration` sub-properties, use Obsidian CSS variables only. (This plan adds no new CSS, but any follow-up must obey this.)
- Run `npm run build` (typecheck + lint + translation validation + bundle) after every task and confirm it's clean before committing.

---

## File Structure

- **Modify:** `src/settings-tab.ts` — add `getSettingDefinitions()`, `getControlValue()`/`setControlValue()` overrides, a `rerender()` helper, and change the four section-render methods to take an explicit `container: HTMLElement` parameter instead of reading `this.containerEl` implicitly.
- **Modify:** `src/i18n/locales/en.json` + 12 translations + `sample_lang.json` — one new key, `settings.behaviour.heading`.

No new files. This is a targeted modification of one existing file plus its i18n keys.

---

### Task 1: Foundation shim — implement `getSettingDefinitions()` without changing behavior

**Files:**
- Modify: `src/settings-tab.ts:1` (imports), `src/settings-tab.ts:260-397` (`display`/`refresh`/`renderBanner`/`renderGeneralSection`), `src/settings-tab.ts:500-602` (`renderBehaviourSection`/`renderBucketsSection`), and the 8 internal `this.refresh()` call sites.

**Interfaces:**
- Produces: `private rerender(): void` — replaces every internal "state changed, need a full re-render" call site. Calls `this.update()` when running under the declarative path (1.13.0+), else falls back to the old `this.refresh()` (`containerEl.empty()` + manual rebuild) for pre-1.13.0 Obsidian.
- Produces: `getSettingDefinitions(): SettingDefinitionItem[]` — returns 4 `SettingDefinitionRender` rows (banner, general, behaviour, buckets), each delegating to the existing render method, now parameterized on an explicit container.

- [ ] **Step 1: Change the import line to bring in the declarative types**

In `src/settings-tab.ts`, replace line 1:

```ts
import { App, PluginSettingTab, Setting, TFolder, Modal } from "obsidian";
```

with:

```ts
import { App, PluginSettingTab, Setting, TFolder, Modal, SettingDefinitionItem } from "obsidian";
```

- [ ] **Step 2: Change `display()`/`refresh()` and add `rerender()`**

Replace (currently `src/settings-tab.ts:260-272`):

```ts
  display(): void {
    this.refresh();
  }

  private refresh(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderBanner();
    this.renderGeneralSection();
    this.renderBehaviourSection();
    this.renderBucketsSection();
  }
```

with:

```ts
  display(): void {
    this.refresh();
  }

  private refresh(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderBanner(containerEl);
    this.renderGeneralSection(containerEl);
    this.renderBehaviourSection(containerEl);
    this.renderBucketsSection(containerEl);
  }

  /**
   * Triggers a full re-render after settings state changes. Uses the
   * declarative `update()` API on Obsidian 1.13.0+ (re-invokes
   * getSettingDefinitions() and re-renders from the result); falls back to
   * the legacy imperative refresh() on older Obsidian, where update() does
   * not exist on the prototype at runtime.
   */
  private rerender(): void {
    if (typeof this.update === "function") {
      this.update();
    } else {
      this.refresh();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t("settings.banner.buttonText"),
        searchable: false,
        render: (setting) => {
          setting.settingEl.empty();
          this.renderBanner(setting.settingEl);
        },
      },
      {
        name: t("settings.heading"),
        render: (setting) => {
          setting.settingEl.empty();
          this.renderGeneralSection(setting.settingEl);
        },
      },
      {
        name: t("settings.behaviour.heading"),
        render: (setting) => {
          setting.settingEl.empty();
          this.renderBehaviourSection(setting.settingEl);
        },
      },
      {
        name: t("settings.buckets.heading"),
        render: (setting) => {
          setting.settingEl.empty();
          this.renderBucketsSection(setting.settingEl);
        },
      },
    ];
  }
```

Note: the banner row has `searchable: false` and reuses `settings.banner.buttonText` purely as a non-empty required `name` (the type requires `name: string`); since it's not searchable, its exact text never surfaces to the user. The other three reuse their existing on-screen heading text so search results read naturally.

- [ ] **Step 3: Parameterize `renderBanner()` on an explicit container**

Replace (currently `src/settings-tab.ts:274-288`):

```ts
  private renderBanner() {
    const { containerEl } = this;
    const banner = containerEl.createDiv({ cls: "gtd-settings-banner" });
```

with:

```ts
  private renderBanner(containerEl: HTMLElement) {
    const banner = containerEl.createDiv({ cls: "gtd-settings-banner" });
```

(The rest of the method body is unchanged — it only used `containerEl` at that one call.)

- [ ] **Step 4: Parameterize `renderGeneralSection()` and update its internal `this.refresh()` calls**

Replace the method signature (currently `src/settings-tab.ts:290-291`):

```ts
  private renderGeneralSection() {
    const { containerEl } = this;
    new Setting(containerEl).setName(t("settings.heading")).setHeading();
```

with:

```ts
  private renderGeneralSection(containerEl: HTMLElement) {
    new Setting(containerEl).setName(t("settings.heading")).setHeading();
```

Within the same method, there are three `this.refresh()` calls (annotation-style dropdown onChange, migrate button onClick, scope-type dropdown onChange — currently at `src/settings-tab.ts:313`, `:332`, `:389`). Replace each occurrence of `this.refresh();` inside this method with `this.rerender();`.

- [ ] **Step 5: Parameterize `renderBehaviourSection()`**

Replace the method signature (currently `src/settings-tab.ts:500-501`):

```ts
  private renderBehaviourSection() {
    const { containerEl } = this;
```

with:

```ts
  private renderBehaviourSection(containerEl: HTMLElement) {
```

No internal `this.refresh()` calls in this method — nothing else to change here (Task 2 rewrites this method's body entirely, so keep it minimal now).

- [ ] **Step 6: Parameterize `renderBucketsSection()` and update its internal `this.refresh()` call**

Replace the method signature (currently `src/settings-tab.ts:553-554`):

```ts
  private renderBucketsSection() {
    const { containerEl } = this;
```

with:

```ts
  private renderBucketsSection(containerEl: HTMLElement) {
```

Within this method there's one `this.refresh()` call (add-bucket button onclick, currently `src/settings-tab.ts:583`). Replace it with `this.rerender();`.

- [ ] **Step 7: Replace the remaining `this.refresh()` call sites in bucket/reorder/delete handlers**

These four are inside methods that don't take a `containerEl` parameter (`renderBucketsSection`'s reset-button handler, `renderBucketList`'s up/down reorder handlers, `renderBucketFields`'s delete handler) and don't need any other change — just the call itself. Replace `this.refresh();` with `this.rerender();` at each of these locations (originally `src/settings-tab.ts:598`, `:705`, `:711`, `:840` — line numbers will have shifted slightly after Steps 2-6; find them by the surrounding context below):

```ts
          this.plugin.settings.buckets = JSON.parse(JSON.stringify(DEFAULT_BUCKETS)) as BucketConfig[];
          await this.plugin.saveSettings();
          this.refresh();   // <-- change to this.rerender();
```

```ts
      upBtn.onclick = async (e) => {
        e.stopPropagation();
        [buckets[idx - 1], buckets[idx]] = [buckets[idx], buckets[idx - 1]];
        await this.plugin.saveSettings();
        this.refresh();   // <-- change to this.rerender();
      };
      downBtn.onclick = async (e) => {
        e.stopPropagation();
        [buckets[idx + 1], buckets[idx]] = [buckets[idx], buckets[idx + 1]];
        await this.plugin.saveSettings();
        this.refresh();   // <-- change to this.rerender();
      };
```

```ts
        async () => {
          this.plugin.settings.buckets.splice(idx, 1);
          await this.plugin.saveSettings();
          this.refresh();   // <-- change to this.rerender();
        }
```

- [ ] **Step 8: Add the `settings.behaviour.heading` i18n key to `en.json`**

`getSettingDefinitions()` (Step 2) references `t("settings.behaviour.heading")` as the Behaviour row's search name — that key doesn't exist yet. In `src/i18n/locales/en.json`, inside the `"settings"` object's `"behaviour"` block (currently starts at line 148 with `"behaviour": {`), add a `heading`/`heading_comment` pair as the first entries:

```json
    "behaviour": {
      "heading_comment": "Section heading for the Behaviour group of settings (completed-task visibility, overdue marking, compact view, celebration animations). Shown above the group and used as its search label in Obsidian 1.13.0+.",
      "heading": "Behaviour",
      "showCompleted": {
```

(Everything after `"showCompleted": {` stays exactly as it already is — this only inserts two new lines before it.)

- [ ] **Step 9: Add the translated key to all 12 locale files**

In each file below, find the `"behaviour": {` line and insert `"heading": "<translation>",` as the first line inside that block (no `_comment` keys in non-English locales, matching this project's existing convention):

| File | Insert |
|---|---|
| `src/i18n/locales/de.json` | `"heading": "Verhalten",` |
| `src/i18n/locales/es.json` | `"heading": "Comportamiento",` |
| `src/i18n/locales/et.json` | `"heading": "Käitumine",` |
| `src/i18n/locales/fr.json` | `"heading": "Comportement",` |
| `src/i18n/locales/ja.json` | `"heading": "動作",` |
| `src/i18n/locales/ko.json` | `"heading": "동작",` |
| `src/i18n/locales/lt.json` | `"heading": "Elgsena",` |
| `src/i18n/locales/lv.json` | `"heading": "Uzvedība",` |
| `src/i18n/locales/pt.json` | `"heading": "Comportamento",` |
| `src/i18n/locales/ru.json` | `"heading": "Поведение",` |
| `src/i18n/locales/uk.json` | `"heading": "Поведінка",` |
| `src/i18n/locales/zh.json` | `"heading": "行为",` |

- [ ] **Step 10: Add the blank template key to `sample_lang.json`**

In `src/i18n/locales/sample_lang.json`, find `"behaviour": {` and insert `"heading": "",` as the first line inside that block, matching the empty-string template convention already used throughout that file.

- [ ] **Step 11: Run the translation validator**

Run: `npm run validate-translations`
Expected: all 12 locale files print `✅` — this confirms the new key is present with a non-empty value everywhere it's required.

- [ ] **Step 12: Typecheck and build**

Run: `npm run build`
Expected: `validate-translations`, `tsc -noEmit -skipLibCheck`, `eslint src/`, and the esbuild bundle all pass with no errors.

- [ ] **Step 13: Manual verification in Obsidian**

With the plugin loaded via Hot Reload in a test vault, on whatever Obsidian version you have installed, open **Settings → GTD Tasks** and check every one of these still works exactly as before (this task must be behavior-neutral):

1. Banner renders at the top with the message, signature, and "Share feedback & ideas" button (button opens the GitHub issues/new page).
2. General section: switching "Annotation style" dropdown updates the migrate button's label/count live; clicking migrate works and doesn't leave the UI in a broken state.
3. General section: switching "Files to scan" between Entire vault / Specific folders / Specific files correctly shows/hides the path list below it.
4. General section: adding/removing/editing folder or file paths in the scope list works (add button, ✕ remove button, autocomplete datalist).
5. Behaviour section: all 4 toggles/dropdown still present and functional (this task doesn't change their implementation, just where they're mounted from).
6. Buckets section: "To Review" expandable row still expands/collapses, emoji picker still opens/positions/selects correctly.
7. Buckets section: adding a bucket, reordering with ↑/↓, deleting a bucket (with confirm modal), editing name/id (including the duplicate-id validation and revert-on-blur behavior), and the date-range-rule dropdown's conditional extra fields (within-days / within-days-range / beyond-days) all still work.
8. Buckets section: "Reset to defaults" (with confirm modal) still works.
9. No console errors on opening the settings tab or interacting with any control.
10. If you have access to an Obsidian build ≥1.13.0: open Settings, use the global settings search box, and confirm typing "Getting Things Done" (or "GTD Tasks" depending on what's indexed) surfaces this tab's General row — confirming `getSettingDefinitions()` is actually being picked up.

If anything behaves differently from before this task, stop and fix it before moving to Task 2 — Task 2 builds on this being a clean, verified baseline.

- [ ] **Step 14: Commit**

```bash
git add src/settings-tab.ts src/i18n/locales
git commit -m "feat: implement getSettingDefinitions() as a behavior-neutral shim"
```

---

### Task 2: Convert the Behaviour section to real declarative controls

**Files:**
- Modify: `src/settings-tab.ts` (delete `renderBehaviourSection()`, replace its `SettingDefinitionRender` entry in `getSettingDefinitions()` with a `SettingDefinitionGroup`, add `getControlValue`/`setControlValue` overrides)

Note: the `settings.behaviour.heading` i18n key this task's group heading uses was already added in Task 1 (Steps 8-11), since `getSettingDefinitions()` needed it there too. No i18n changes in this task.

**Interfaces:**
- Consumes: `PluginSettings.completedVisibilityUntilMidnight: boolean`, `PluginSettings.staleIndicatorEnabled: boolean`, `PluginSettings.compactView: boolean`, `PluginSettings.celebrationMode: CelebrationMode` (all defined in `src/settings.ts`) — all four are flat top-level properties, which is what makes them safe to bind directly by `key` string.
- Produces: `getControlValue(key: string): unknown` and `setControlValue(key: string, value: unknown): Promise<void>` overrides on `GtdSettingsTab`, used by the framework for every `SettingDefinitionControl` row (not just Behaviour's — any future declarative control added to this class will go through these same two methods).

- [ ] **Step 1: Delete `renderBehaviourSection()` and its call site**

In `src/settings-tab.ts`, delete the entire method (the one Task 1 left with just a changed signature and unchanged body):

```ts
  private renderBehaviourSection(containerEl: HTMLElement) {

    new Setting(containerEl)
      .setName(t("settings.behaviour.showCompleted.name"))
      .setDesc(t("settings.behaviour.showCompleted.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.completedVisibilityUntilMidnight);
        tog.onChange(async (val) => {
          this.plugin.settings.completedVisibilityUntilMidnight = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.behaviour.markOverdue.name"))
      .setDesc(t("settings.behaviour.markOverdue.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.staleIndicatorEnabled);
        tog.onChange(async (val) => {
          this.plugin.settings.staleIndicatorEnabled = val;
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.behaviour.compactView.name"))
      .setDesc(t("settings.behaviour.compactView.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.compactView);
        tog.onChange(async (val) => {
          this.plugin.settings.compactView = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.behaviour.celebration.name"))
      .setDesc(t("settings.behaviour.celebration.description"))
      .addDropdown((dd) => {
        dd.addOption("off", t("settings.behaviour.celebration.off"));
        dd.addOption("confetti", t("settings.behaviour.celebration.confettiOnly"));
        dd.addOption("creature", t("settings.behaviour.celebration.celebrationOnly"));
        dd.addOption("all", t("settings.behaviour.celebration.both"));
        dd.setValue(this.plugin.settings.celebrationMode ?? "confetti");
        dd.onChange(async (val) => {
          this.plugin.settings.celebrationMode = val as CelebrationMode;
          await this.plugin.saveSettings();
        });
      });
  }
```

Also delete its call site in `refresh()`:

```ts
    this.renderBanner(containerEl);
    this.renderGeneralSection(containerEl);
    this.renderBehaviourSection(containerEl);   // <-- delete this line
    this.renderBucketsSection(containerEl);
```

becomes:

```ts
    this.renderBanner(containerEl);
    this.renderGeneralSection(containerEl);
    this.renderBucketsSection(containerEl);
```

Note: on pre-1.13.0 Obsidian, `getSettingDefinitions()` is never called, so this deletion means those users would silently lose the Behaviour section entirely from `display()`. This project's `minAppVersion` is `1.8.7`, so that regression is real. To keep it working on old Obsidian too, add a fallback call in `refresh()` instead of deleting the line outright — replace it with a call into the same declarative definitions so there's exactly one implementation:

```ts
    this.renderBanner(containerEl);
    this.renderGeneralSection(containerEl);
    this.renderLegacyBehaviourFallback(containerEl);
    this.renderBucketsSection(containerEl);
```

and add this small private method right after `refresh()` (it re-renders the same 4 rows imperatively for the pre-1.13.0 path, by reading the same declarative definitions this class now owns):

```ts
  /**
   * Pre-1.13.0 fallback: renders the Behaviour group's 4 rows imperatively,
   * since those Obsidian versions never call getSettingDefinitions() and
   * would otherwise lose this section entirely after its declarative
   * conversion. Mirrors the control definitions in getSettingDefinitions().
   */
  private renderLegacyBehaviourFallback(containerEl: HTMLElement) {
    new Setting(containerEl).setName(t("settings.behaviour.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.behaviour.showCompleted.name"))
      .setDesc(t("settings.behaviour.showCompleted.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.completedVisibilityUntilMidnight);
        tog.onChange(async (val) => {
          await this.setControlValue("completedVisibilityUntilMidnight", val);
        });
      });

    new Setting(containerEl)
      .setName(t("settings.behaviour.markOverdue.name"))
      .setDesc(t("settings.behaviour.markOverdue.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.staleIndicatorEnabled);
        tog.onChange(async (val) => {
          await this.setControlValue("staleIndicatorEnabled", val);
        });
      });

    new Setting(containerEl)
      .setName(t("settings.behaviour.compactView.name"))
      .setDesc(t("settings.behaviour.compactView.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.compactView);
        tog.onChange(async (val) => {
          await this.setControlValue("compactView", val);
        });
      });

    new Setting(containerEl)
      .setName(t("settings.behaviour.celebration.name"))
      .setDesc(t("settings.behaviour.celebration.description"))
      .addDropdown((dd) => {
        dd.addOption("off", t("settings.behaviour.celebration.off"));
        dd.addOption("confetti", t("settings.behaviour.celebration.confettiOnly"));
        dd.addOption("creature", t("settings.behaviour.celebration.celebrationOnly"));
        dd.addOption("all", t("settings.behaviour.celebration.both"));
        dd.setValue(this.plugin.settings.celebrationMode ?? "confetti");
        dd.onChange(async (val) => {
          await this.setControlValue("celebrationMode", val);
        });
      });
  }
```

This reuses `setControlValue` (added in Step 2 below) so there is exactly one place that knows how to persist each of these 4 keys, for both the old and new rendering paths.

- [ ] **Step 2: Add `getControlValue`/`setControlValue` overrides**

Add these two methods to `GtdSettingsTab`, right after `rerender()`:

```ts
  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
    if (key === "staleIndicatorEnabled") {
      await this.plugin.refreshIndex();
    }
  }
```

This deliberately overrides the framework's default (rather than relying on its built-in `this.plugin.settings` read/write behavior) so persistence always goes through this project's own `saveSettings()`, and so the one Behaviour setting with a side effect (`staleIndicatorEnabled` triggers `refreshIndex()`) is handled correctly regardless of whether the change came from the declarative control (1.13.0+) or the imperative fallback (pre-1.13.0).

- [ ] **Step 3: Replace the Behaviour entry in `getSettingDefinitions()` with a real declarative group**

Replace this entry (added in Task 1):

```ts
      {
        name: t("settings.behaviour.heading"),
        render: (setting) => {
          setting.settingEl.empty();
          this.renderBehaviourSection(setting.settingEl);
        },
      },
```

with:

```ts
      {
        type: "group",
        heading: t("settings.behaviour.heading"),
        items: [
          {
            name: t("settings.behaviour.showCompleted.name"),
            desc: t("settings.behaviour.showCompleted.description"),
            control: { type: "toggle", key: "completedVisibilityUntilMidnight" },
          },
          {
            name: t("settings.behaviour.markOverdue.name"),
            desc: t("settings.behaviour.markOverdue.description"),
            control: { type: "toggle", key: "staleIndicatorEnabled" },
          },
          {
            name: t("settings.behaviour.compactView.name"),
            desc: t("settings.behaviour.compactView.description"),
            control: { type: "toggle", key: "compactView" },
          },
          {
            name: t("settings.behaviour.celebration.name"),
            desc: t("settings.behaviour.celebration.description"),
            control: {
              type: "dropdown",
              key: "celebrationMode",
              options: {
                off: t("settings.behaviour.celebration.off"),
                confetti: t("settings.behaviour.celebration.confettiOnly"),
                creature: t("settings.behaviour.celebration.celebrationOnly"),
                all: t("settings.behaviour.celebration.both"),
              },
            },
          },
        ],
      },
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run build`
Expected: clean pass, including `validate-translations` (already confirmed in Task 1 Step 11; this re-confirms nothing else broke).

- [ ] **Step 5: Manual verification in Obsidian**

1. Behaviour section now shows a "Behaviour" heading above the 4 rows (new — it didn't have one before).
2. All 4 controls (2 toggles unchanged in position, overdue toggle, compact view toggle, celebration dropdown) reflect current settings values correctly on open.
3. Toggling "Show completed tasks until midnight" persists (reopen settings tab, value sticks) and doesn't error.
4. Toggling "Mark overdue tasks with !" persists AND causes the panel to visibly re-index (existing overdue tasks show/hide the `!` badge without needing a manual reload) — this confirms the `refreshIndex()` side effect in `setControlValue` fired.
5. Toggling "Compact view" persists and the panel's spacing visibly changes.
6. Changing the "Celebration animations" dropdown persists, and completing a task in the panel afterward plays the newly selected animation combination.
7. If on Obsidian ≥1.13.0: use the global settings search box, type "overdue", confirm the "Mark overdue tasks with !" row now surfaces directly in search results (this is the concrete, user-visible payoff of this task — Task 1 alone did not achieve this for individual settings).
8. If on Obsidian <1.13.0 (or by temporarily forcing the fallback path to test it — e.g., temporarily renaming `this.update` access in a scratch build): confirm `renderLegacyBehaviourFallback` renders the same 4 rows and they still work.
9. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/settings-tab.ts
git commit -m "feat: convert Behaviour settings to the declarative settings API"
```

---

### Task 3: Full regression pass and scope closeout

**Files:** none modified — verification and documentation only.

- [ ] **Step 1: Full manual regression across the entire settings tab**

Re-run the complete checklist from Task 1 Step 9 (all 10 points) plus Task 2 Step 9 (all 9 points) in one pass, in a real Obsidian vault, to confirm nothing regressed from the combination of both tasks together.

- [ ] **Step 2: Run the full build and test suite**

Run: `npm run build && npm test`
Expected: build clean (translate-validate + tsc + eslint + esbuild), all 118 Jest tests pass (this plan doesn't touch anything Jest covers, so this is a pure regression check).

- [ ] **Step 3: Confirm the original reviewer warning is gone**

Re-run whatever check originally produced: *"This PluginSettingTab does not implement getSettingDefinitions(); its settings will not appear in Obsidian's settings search for users on 1.13.0 or later."* against `src/settings-tab.ts:255`. Confirm it no longer fires, now that `getSettingDefinitions()` is implemented.

- [ ] **Step 4: Document remaining scope as a separate future plan**

This plan deliberately does **not** convert the following to real declarative controls — they stay as `SettingDefinitionRender` escape hatches from Task 1:

- **General section**: the annotation-style dropdown + live migrate-button (label/count depends on live task index state), the scope-type dropdown + dynamic folder/file path list (add/remove/autocomplete), and the tag/field-name text input. These have cross-field dependencies and side effects (`refreshIndex()`, live count recomputation) that don't map cleanly onto a single `control` binding.
- **Buckets section**: the "To Review" expandable config and the full bucket list (expand/collapse, emoji picker, duplicate-id validation with revert-on-blur, conditional date-range-rule sub-fields, quick-move dropdowns, drag-order via ↑/↓, delete-with-confirm). Note that `SettingDefinitionList` (with its built-in `onReorder`/`onDelete`/`addItem`) looks like a strong structural fit for the bucket list specifically and is worth investigating first in that follow-up plan — but it needs its own scoped design and live-testing pass, not a bolt-on here.

If/when there's appetite to tackle either of those, they should each get their own `superpowers:brainstorming` + `superpowers:writing-plans` pass, scoped independently, since they're materially riskier and larger than this phase.

- [ ] **Step 5: No commit needed for this task** (verification-only; Steps 1-3 either pass or send you back to fix a regression before considering the phase done).
