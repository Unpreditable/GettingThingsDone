import { App, PluginSettingTab, Setting, SettingGroup, SettingPage, TFile, TFolder, SettingDefinitionItem, debounce, requireApiVersion } from "obsidian";
import type GtdTasksPlugin from "./main";
import { BucketConfig, StorageMode, ScopeType, PathEntry, DEFAULT_BUCKETS, WEEK_STARTS, MOBILE_DRAG_CHOICES, isReservedFieldName, normalizeTaskFilters } from "./settings";
import type { MobileDragBy } from "./settings";
import { dragZone } from "./core/DragZone";
import { getTagValue, getInlineFieldValue } from "./core/TaskParser";
import { migrateStorageMode } from "./core/StorageMigrator";
import { renderIcon } from "./views/icon";
import { ConfirmModal } from "./views/ConfirmModal";
import { t, i18next } from "./i18n/i18n";

/**
 * Localized long weekday names, keyed by WeekStart. Feb 22 2026 is a Sunday, so
 * `22 + index` walks WEEK_STARTS' Sunday-first order — which keeps seven day
 * names per language out of the locale files entirely, and stays right for a
 * language the plugin has no translation for.
 */
function weekStartOptions(): Record<string, string> {
  const format = new Intl.DateTimeFormat(i18next.language, { weekday: "long" });
  const options: Record<string, string> = {};
  WEEK_STARTS.forEach((day, index) => {
    options[day] = format.format(new Date(2026, 1, 22 + index));
  });
  return options;
}

/**
 * Two lines, each led by the badge itself in the colour it has on the task row.
 * A fragment rather than a string because the badges need their own spans to be
 * coloured; Obsidian searches the fragment's textContent, so this stays findable.
 *
 * Must render the same icon names the task rows do, or the preview stops
 * depicting reality without anything failing.
 */
function markDueFlagsDesc(): DocumentFragment {
  return createFragment((frag) => {
    const line = (cls: string, iconName: string, text: string) => {
      const row = frag.createDiv({ cls: "gtd-flag-preview-row" });
      renderIcon(row.createSpan({ cls }), iconName);
      row.appendText(" " + text);
    };
    line("gtd-flag-overdue", "alert-triangle", t("settings.behaviour.markDueFlags.descriptionOverdue"));
    line("gtd-flag-misfiled", "flag", t("settings.behaviour.markDueFlags.descriptionMisfiled", {
      later: t("buckets.defaults.this-week.name"),
    }));
  });
}

/** Two rows, so the caveat reads as its own statement rather than trailing off
 *  the end of the sentence above it. */
function autoAssignmentDateDesc(): DocumentFragment {
  return createFragment((frag) => {
    frag.createDiv({ text: t("settings.tasksIntegration.planBy.description") });
    frag.createDiv({ text: t("settings.tasksIntegration.planBy.descriptionPinned") });
  });
}

const EMOJI_CATEGORIES: Array<{ icon: string; emojis: string[] }> = [
  {
    icon: "⚡",
    emojis: [
      "⚡", "🔥", "⏰", "⏳", "⌛", "🚨", "⚠️", "🏃", "🚀", "🎯",
      "🔴", "🟠", "🟡", "🟢", "🔵", "🏁", "🚩", "🎪", "🎲", "🃏",
      "🏅", "🥇", "🥈", "🥉", "🎖️", "🏆", "🎗️", "🎫", "🎟️", "🎀",
      "💥", "✨", "🌟", "⭐", "💫", "🌠", "☄️", "🌀", "🌊", "🌪️",
      "🔆", "🔅", "♨️", "🔰", "♻️", "🔱", "📛", "🔮", "🧿", "🪬",
      "🏮", "🪔", "💡", "🔦", "🕯️", "🧲", "🔋", "🪫", "🔌", "📡",
      "⏱️", "⏲️", "🕰️", "⌚", "🔭", "🔬", "🧪", "🧫", "🧬", "⚗️",
      "🎯", "🎱", "🎳", "🏹", "🥊", "🥋", "🤺", "🏋️", "🤸", "🚴",
      "🏄", "🧗", "🤼", "🤾", "🏌️", "🏊", "🤽", "🚣", "🧘", "🏇",
      "🌋", "⛰️", "🏔️", "🗻", "🏕️", "🏖️", "🏜️", "🏝️", "🏞️", "🌅",
    ],
  },
  {
    icon: "📋",
    emojis: [
      "📋", "📝", "✅", "📌", "📎", "✏️", "🖊️", "💼", "🗃️", "📂",
      "🗂️", "📁", "📊", "📈", "📉", "🗒️", "📐", "📏", "🔖", "📍",
      "🗝️", "🔑", "🔐", "🔒", "🔓", "🖇️", "🗄️", "🗑️", "📦", "📫",
      "📬", "📭", "📮", "📯", "📜", "📃", "📄", "📑", "🗞️", "📰",
      "📓", "📔", "📒", "📕", "📗", "📘", "📙", "📚", "📖", "🔍",
      "🔎", "✂️", "🖍️", "🖋️", "✒️", "🗺️", "🧭", "🏷️", "🔗", "🖨️",
      "🖱️", "⌨️", "🖥️", "💾", "💿", "📀", "✔️", "☑️", "🔲", "🔳",
      "⬛", "⬜", "◼️", "◻️", "▪️", "▫️", "🔷", "🔶", "🔹", "🔸",
      "🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "⚫", "⚪", "🟫", "🔺",
      "🔻", "💠", "🔘", "🔳", "🔲", "▶️", "⏩", "⏫", "⏬", "⏪",
    ],
  },
  {
    icon: "📅",
    emojis: [
      "📅", "🗓️", "📆", "📇", "⏱️", "⏲️", "🕰️", "⌚", "⏰", "⌛",
      "⏳", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘",
      "🕙", "🕚", "🕛", "🕜", "🕝", "🕞", "🕟", "🕠", "🕡", "🕢",
      "🕣", "🕤", "🕥", "🕦", "🕧", "🌅", "🌄", "🌇", "🌆", "🌃",
      "🌉", "🌌", "🌠", "🌙", "🌛", "🌜", "🌝", "🌞", "☀️", "🌤️",
      "⛅", "🌥️", "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "🌨️", "❄️", "☃️",
      "⛄", "🌬️", "🌀", "🌈", "🌂", "☂️", "☔", "⛱️", "⚡", "🌡️",
      "🗒️", "📓", "📔", "📒", "📕", "📗", "📘", "📙", "📚", "📖",
      "🏮", "🪔", "🕯️", "💡", "🔦", "🔆", "🔅", "🌟", "⭐", "✨",
      "🌍", "🌎", "🌏", "🗺️", "🧭", "⛰️", "🌋", "🏔️", "🗻", "🏕️",
    ],
  },
  {
    icon: "💡",
    emojis: [
      "💡", "💭", "🧠", "🏆", "🎓", "🌟", "⭐", "💫", "🔮", "🎨",
      "🎵", "🧩", "🎬", "🎭", "🎪", "🏅", "🥇", "🎁", "💎", "👑",
      "🌈", "🦄", "🧸", "🎠", "🎡", "🎢", "🎆", "🎇", "✨", "🎉",
      "🎊", "🎋", "🎍", "🎎", "🎏", "🎐", "🎑", "🎃", "🎄", "🧨",
      "🪅", "🪆", "🃏", "🎴", "🀄", "🎲", "🎮", "🕹️", "🎰", "🧸",
      "🪀", "🪁", "🎯", "🎱", "🎳", "🏹", "🧩", "🪄", "🎭", "🖼️",
      "🎤", "🎧", "🎼", "🎹", "🎸", "🎺", "🎻", "🥁", "🪘", "🪗",
      "🎷", "🪈", "🎵", "🎶", "🎙️", "📻", "📺", "📷", "📸", "📹",
      "🎥", "📽️", "🎞️", "🔭", "🔬", "🧪", "🧫", "🧬", "🩺", "🩻",
      "💊", "🧲", "⚗️", "🧰", "🛠️", "⚙️", "🔩", "🔧", "🔨", "⚒️",
    ],
  },
  {
    icon: "👥",
    emojis: [
      "👥", "🤝", "💬", "📣", "🔔", "📧", "📱", "💻", "🔧", "🔑",
      "🛠️", "⚙️", "🔩", "🧰", "📡", "🖥️", "🖨️", "⌨️", "🖱️", "💾",
      "👤", "🙋", "🙌", "👐", "🤲", "🤜", "🤛", "👊", "✊", "🤞",
      "🤟", "🤘", "🤙", "👋", "🤚", "🖐️", "✋", "🖖", "👆", "☝️",
      "👇", "👈", "👉", "🫵", "👍", "👎", "✌️", "💬", "💭", "🗯️",
      "💌", "📩", "📨", "📧", "📤", "📥", "📦", "📫", "📪", "📬",
      "📭", "📮", "📯", "📢", "📣", "🔔", "🔕", "🏠", "🏡", "🏢",
      "🏣", "🏤", "🏥", "🏦", "🏧", "🏨", "🏩", "🏪", "🏫", "🏬",
      "🏭", "🏯", "🏰", "💒", "🗼", "🗽", "⛪", "🕌", "🕍", "⛩️",
      "🕋", "⛲", "⛺", "🏗️", "🏘️", "🏚️", "🏛️", "🏟️", "🏠", "🏡",
    ],
  },
  {
    icon: "🌱",
    emojis: [
      "🌱", "🌿", "🌊", "☀️", "🌙", "🌈", "💧", "🏠", "🌺", "🍀",
      "🦋", "🌻", "🏝️", "🌄", "🌅", "🍃", "🌲", "🌸", "🍄", "🌾",
      "🌵", "🎋", "🎍", "🍁", "🍂", "☘️", "🌴", "🌳", "🎄", "🪴",
      "🪨", "🪵", "🪸", "🌼", "🌹", "🥀", "🌷", "💐", "🏵️", "🪷",
      "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝",
      "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕",
      "🐾", "🦁", "🐯", "🐻", "🐼", "🐨", "🐮", "🐷", "🐸", "🐵",
      "🐦", "🦜", "🦚", "🦩", "🦢", "🦆", "🐧", "🐓", "🦃", "🦉",
      "🌍", "🌎", "🌏", "🗺️", "🧭", "⛰️", "🌋", "🏔️", "🗻", "🏕️",
      "🏖️", "🏜️", "🏞️", "🌇", "🌆", "🌃", "🌉", "🌌", "🌠", "🎑",
    ],
  },
];

function openEmojiPicker(
  anchor: HTMLElement,
  onSelect: (emoji: string) => void
): void {
  activeDocument.querySelectorAll(".gtd-emoji-picker").forEach((el) => el.remove());

  const picker = createDiv({ cls: "gtd-emoji-picker" });

  const tabs = picker.createDiv({ cls: "gtd-emoji-tabs" });
  const gridEl = picker.createDiv({ cls: "gtd-emoji-grid" });

  const renderGrid = (categoryIndex: number) => {
    gridEl.empty();
    for (const emoji of EMOJI_CATEGORIES[categoryIndex].emojis) {
      const item = gridEl.createDiv({ cls: "gtd-emoji-item", text: emoji });
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(emoji);
        picker.remove();
      });
    }
  };

  EMOJI_CATEGORIES.forEach((cat, i) => {
    const tab = tabs.createDiv({ cls: "gtd-emoji-tab", text: cat.icon });
    if (i === 0) tab.addClass("active");
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      tabs.querySelectorAll(".gtd-emoji-tab").forEach((t) => t.removeClass("active"));
      tab.addClass("active");
      renderGrid(i);
    });
  });

  renderGrid(0);

  const rect = anchor.getBoundingClientRect();
  picker.addClass("gtd-emoji-picker-measuring");
  activeDocument.body.appendChild(picker);

  // Measure picker dimensions
  const pickerRect = picker.getBoundingClientRect();
  const pickerWidth = pickerRect.width;
  const pickerHeight = pickerRect.height;

  let top = rect.bottom + 4;
  if (top + pickerHeight > activeWindow.innerHeight) {
    top = rect.top - pickerHeight - 4;
  }

  // The button sits at the right edge of its row, so the picker opens leftward
  // from the button's right edge, keeping it over the settings page.
  const left = Math.max(4, rect.right - pickerWidth);

  picker.style.setProperty("--gtd-picker-top", `${top}px`);
  picker.style.setProperty("--gtd-picker-left", `${left}px`);
  picker.removeClass("gtd-emoji-picker-measuring");
  picker.addClass("gtd-emoji-picker-positioned");

  const removePicker = () => {
    picker.remove();
    activeDocument.removeEventListener("mousedown", closeOnOutside);
    activeDocument.removeEventListener("scroll", closeOnScroll, true);
    activeDocument.removeEventListener("keydown", closeOnEscape);
  };

  const closeOnOutside = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node)) removePicker();
  };
  const closeOnScroll = () => removePicker();
  const closeOnEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") removePicker();
  };

  window.setTimeout(() => {
    activeDocument.addEventListener("mousedown", closeOnOutside);
    activeDocument.addEventListener("scroll", closeOnScroll, true);
    activeDocument.addEventListener("keydown", closeOnEscape);
  }, 100);
}

function renderEmojiSetting(
  container: HTMLElement,
  name: string,
  currentEmoji: string,
  fallback: string,
  onChange: (emoji: string) => void
): void {
  const setting = new Setting(container).setName(name);
  const btn = setting.controlEl.createEl("button", {
    cls: "gtd-emoji-btn-display",
    text: currentEmoji || fallback,
    attr: { type: "button", title: t("settings.emojiButtonTooltip") },
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    openEmojiPicker(btn, (emoji) => {
      btn.textContent = emoji;
      onChange(emoji);
    });
  });
}


function generateBucketId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}


/**
 * Settles a path list for storage: blank rows an add button created but the
 * user never filled in are dropped, and what remains is ordered for reading —
 * folders above files, alphabetical within each, the way the file explorer
 * reads. Order carries no meaning to matching, which is set-based. Applied on
 * close rather than on edit so a row never leaps away mid-keystroke.
 */
function tidyPathList(entries: PathEntry[]): PathEntry[] {
  return entries
    .filter((entry) => entry.path !== "")
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
}

export class GtdSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: GtdTasksPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.refresh();
  }

  private async applyTaskFilter() {
    this.applyTaskFilterWhenTypingStops.cancel();
    await this.plugin.saveSettings();
    await this.plugin.refreshIndex();
  }

  /**
   * Each change to the global filter rescans the vault, so typing waits for
   * a pause. hide() runs a pending one at once: otherwise an edit made just
   * before the plugin is disabled, or Obsidian quit, would never be saved.
   */
  private applyTaskFilterWhenTypingStops = debounce(() => void this.applyTaskFilter(), 2000, true);

  /** Saves the tag / field name as typed. Run on leaving the field, and by hide(): closing settings need not blur it. */
  private commitTagPrefix: (() => void) | null = null;

  /**
   * Settling the path lists happens here rather than on open because 1.13+
   * never calls display() for a tab that returns setting definitions — it
   * renders those instead — while hide() runs on every path away from the tab.
   */
  hide(): void {
    this.applyTaskFilterWhenTypingStops.run();
    this.commitTagPrefix?.();
    const settings = this.plugin.settings;
    const before = JSON.stringify([settings.scopePaths, settings.ignoredPaths]);
    settings.scopePaths = tidyPathList(settings.scopePaths);
    settings.ignoredPaths = tidyPathList(settings.ignoredPaths);
    if (JSON.stringify([settings.scopePaths, settings.ignoredPaths]) !== before) {
      void this.plugin.saveSettings();
    }
  }

  private refresh(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderBanner(containerEl);
    new Setting(containerEl).setName(t("settings.heading")).setHeading();
    this.renderAnnotation(containerEl, false);
    this.renderFilesToScan(containerEl, false);
    this.renderTaskFilter(containerEl, false);
    this.renderLegacyBehaviourFallback(containerEl);
    this.renderLegacyTasksIntegrationFallback(containerEl);
    this.renderBucketsSection(containerEl);
  }

  /**
   * Triggers a full re-render after settings state changes. Uses the
   * declarative `update()` API on Obsidian 1.13.0+ (re-invokes
   * getSettingDefinitions() and re-renders from the result); falls back to
   * the legacy imperative refresh() on older Obsidian, where update() is
   * unavailable.
   */
  private rerender(): void {
    if (requireApiVersion("1.13.0")) {
      this.update();
      // update() leaves a page built by a SettingPage factory as it was.
      this.openPage?.display();
    } else {
      this.refresh();
    }
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    // Picking a first day answers the one-off notice, whichever day is picked.
    // Without this the banner would blink out and back as the value moved off
    // and onto Monday, since Monday is also what it exists to talk about.
    if (key === "weekStartsOn") this.plugin.settings.weekStartNoticeSeen = true;
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t("settings.banner.buttonText"),
        searchable: false,
        render: (setting) => {
          setting.settingEl.addClass("gtd-settings-escape-hatch");
          setting.settingEl.empty();
          this.renderBanner(setting.settingEl);
        },
      },
      {
        type: "group",
        cls: "gtd-settings-group gtd-settings-first-section",
        heading: t("settings.heading"),
        items: [
          {
            type: "page",
            name: t("settings.pinning.pageName"),
            desc: this.annotationSummary(),
            page: () => this.createSubPage((el) => this.renderAnnotation(el, true)),
          },
          {
            name: t("settings.filesToScan.name"),
            render: (setting) => {
              setting.settingEl.addClass("gtd-settings-escape-hatch", "gtd-settings-section");
              setting.settingEl.empty();
              this.renderFilesToScan(setting.settingEl, true);
            },
          },
          {
            type: "page",
            name: t("settings.taskFilter.name"),
            desc: this.plugin.settings.taskFilters.join(", ") || t("settings.taskFilter.summaryOff"),
            page: () => this.createSubPage((el) => this.renderTaskFilter(el, true)),
          },
        ],
      },
      {
        type: "group",
        cls: "gtd-settings-group",
        heading: t("settings.behaviour.heading"),
        items: [
          {
            name: t("settings.behaviour.weekStart.name"),
            desc: t("settings.behaviour.weekStart.description"),
            control: {
              type: "dropdown",
              key: "weekStartsOn",
              options: weekStartOptions(),
            },
          },
          {
            name: t("settings.behaviour.showCompleted.name"),
            desc: t("settings.behaviour.showCompleted.description"),
            control: { type: "toggle", key: "completedVisibilityUntilMidnight" },
          },
          {
            name: t("settings.behaviour.dropIntoBucket.name"),
            desc: t("settings.behaviour.dropIntoBucket.description"),
            control: {
              type: "dropdown",
              key: "dropIntoBucket",
              options: {
                pin: t("settings.behaviour.dropIntoBucket.pin"),
                ask: t("settings.behaviour.dropIntoBucket.ask"),
              },
            },
          },
          {
            type: "page",
            name: t("settings.behaviour.dragBy.name"),
            desc: t(`settings.behaviour.dragBy.choices.${this.plugin.settings.mobileDragBy}`),
            page: () => this.createSubPage((el) => this.renderDragBy(el)),
          },
          {
            name: t("settings.behaviour.markDueFlags.name"),
            desc: markDueFlagsDesc(),
            control: { type: "toggle", key: "staleIndicatorEnabled" },
          },
          {
            name: t("settings.behaviour.openLinks.name"),
            desc: t("settings.behaviour.openLinks.description"),
            control: { type: "toggle", key: "openLinksOnClick" },
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
      {
        type: "group",
        cls: "gtd-settings-group",
        heading: t("settings.tasksIntegration.heading"),
        items: [
          {
            // SettingDefinitionGroup has no description field, so the section
            // blurb rides in as a control-less item.
            name: "",
            desc: t("settings.tasksIntegration.blurb"),
            searchable: false,
          },
          // If the empty name column renders with awkward spacing in Obsidian
          // 1.13+, swap that item for a `render:` one following the banner
          // pattern already in this file: add the `gtd-settings-escape-hatch`
          // class, `empty()` the element, and write the blurb into it.
          {
            name: t("settings.tasksIntegration.planBy.name"),
            desc: autoAssignmentDateDesc(),
            control: {
              type: "dropdown",
              key: "planBy",
              options: {
                manual: t("settings.tasksIntegration.planBy.manual"),
                "due-only": t("settings.tasksIntegration.planBy.dueOnly"),
                "due-first": t("settings.tasksIntegration.planBy.dueFirst"),
                "scheduled-first": t("settings.tasksIntegration.planBy.scheduledFirst"),
                "scheduled-only": t("settings.tasksIntegration.planBy.scheduledOnly"),
                earliest: t("settings.tasksIntegration.planBy.earliest"),
              },
            },
          },
          {
            name: t("settings.tasksIntegration.priority.name"),
            control: {
              type: "dropdown",
              key: "priorityDisplay",
              options: {
                all: t("settings.tasksIntegration.priority.all"),
                "medium-up": t("settings.tasksIntegration.priority.mediumUp"),
                "high-up": t("settings.tasksIntegration.priority.highUp"),
                hidden: t("settings.tasksIntegration.priority.hidden"),
              },
            },
          },
          {
            name: t("settings.tasksIntegration.recurrence.name"),
            control: { type: "toggle", key: "showRecurrenceBadge" },
          },
          {
            name: t("settings.tasksIntegration.popoverFields.name"),
            desc: t("settings.tasksIntegration.popoverFields.description"),
            control: { type: "toggle", key: "showTasksFieldsInPopover" },
          },
        ],
      },
      {
        name: t("settings.buckets.heading"),
        render: (setting) => {
          setting.settingEl.addClass("gtd-settings-escape-hatch", "gtd-settings-section");
          setting.settingEl.empty();
          this.renderBucketsSection(setting.settingEl);
        },
      },
    ];
  }

  private renderBanner(containerEl: HTMLElement) {
    const banner = containerEl.createDiv({ cls: "gtd-settings-banner" });

    const text = banner.createDiv({ cls: "gtd-settings-banner-text" });
    text.createDiv({ cls: "gtd-settings-banner-message", text: t("settings.banner.message") });
    text.createDiv({ cls: "gtd-settings-banner-signature", text: t("settings.banner.signature") });

    const buttons = banner.createDiv({ cls: "gtd-settings-banner-buttons" });
    buttons.createEl("button", {
      cls: "mod-cta gtd-settings-banner-button",
      text: t("settings.banner.buttonText"),
    }).addEventListener("click", () => {
      new ConfirmModal(
        this.app,
        t("settings.banner.confirmMessage"),
        t("settings.banner.confirmButton"),
        () => {
          window.open("https://github.com/Unpreditable/GettingThingsDone/issues/new/choose", "_blank");
        }
      ).open();
    });
    buttons.createEl("button", {
      cls: "gtd-settings-banner-button",
      text: t("whatsNew.title"),
    }).addEventListener("click", () => this.plugin.openWhatsNew());
  }

  /** The Pinning entry's value: the marker a pin writes, with a placeholder for the bucket. */
  private annotationSummary(): string {
    const { storageMode, tagPrefix } = this.plugin.settings;
    return storageMode === "inline-tag" ? `#${tagPrefix}/bucket-id` : `[${tagPrefix}:: bucket-id]`;
  }

  /**
   * Annotation style and the tag / field name. On the 1.13+ Pinning page they
   * read as Format and Name under a line on what a pin writes; older Obsidian
   * keeps the original wording, translations included.
   */
  private renderAnnotation(containerEl: HTMLElement, pinningPage: boolean) {
    if (pinningPage) new Setting(containerEl).setDesc(t("settings.pinning.intro"));

    // Annotation Style (storage mode)
    const oppositeMode: StorageMode = this.plugin.settings.storageMode === "inline-tag" ? "inline-field" : "inline-tag";
    const allTasks = this.plugin.taskIndex.getAllTasks();
    const migrateCount = allTasks.filter((task) => {
      const id = oppositeMode === "inline-tag"
        ? getTagValue(task.rawLine, this.plugin.settings.tagPrefix)
        : getInlineFieldValue(task.rawLine, this.plugin.settings.tagPrefix);
      return id !== null && this.plugin.settings.buckets.some((b) => b.id === id);
    }).length;

    const annotationSetting = new Setting(containerEl)
      .setName(t(pinningPage ? "settings.pinning.format.name" : "settings.annotationStyle.name"))
      .addDropdown((dd) => {
        dd.addOption("inline-tag", t(pinningPage ? "settings.pinning.format.tag" : "settings.annotationStyle.inlineTag"));
        dd.addOption("inline-field", t(pinningPage ? "settings.pinning.format.field" : "settings.annotationStyle.inlineField"));
        dd.setValue(this.plugin.settings.storageMode);
        dd.onChange(async (val) => {
          this.plugin.settings.storageMode = val as StorageMode;
          await this.plugin.saveSettings();
          this.rerender();
        });
      })
      .addButton((btn) => {
        btn.setButtonText(
          migrateCount > 0
            ? t("settings.migrate.button", { count: migrateCount })
            : t("settings.migrate.none")
        );
        btn.setDisabled(migrateCount === 0);
        btn.onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText(t("settings.migrate.inProgress"));
          const changedPaths = await migrateStorageMode(
            this.app,
            this.plugin.taskIndex.getAllTasks(),
            oppositeMode,
            this.plugin.settings
          );
          await Promise.all(changedPaths.map((p) => this.plugin.taskIndex.reindexFile(p)));
          this.rerender();
        });
      });

    annotationSetting.controlEl.addClass("gtd-annotation-control");

    // On the Pinning page the bullets show the name as typed in the field
    // below, before it is saved.
    if (!pinningPage) annotationSetting.descEl.appendText(t("settings.annotationStyle.descHeader"));
    const ul = annotationSetting.descEl.createEl("ul", { cls: "gtd-desc-list" });
    const tagFormat = ul.createEl("li");
    const fieldFormat = ul.createEl("li");
    const showFormats = (name: string) => {
      if (pinningPage) {
        tagFormat.setText(t("settings.pinning.format.tagBullet", { name }));
        fieldFormat.setText(t("settings.pinning.format.fieldBullet", { name }));
      } else {
        tagFormat.setText(t("settings.annotationStyle.descInlineTag"));
        fieldFormat.setText(t("settings.annotationStyle.descInlineField"));
      }
    };
    showFormats(this.plugin.settings.tagPrefix);

    // Tag / Field name. Saved when the field is left, not on each keystroke:
    // every name typed on the way would otherwise be the live prefix in turn,
    // and stopping at a refused one ("due") would leave "du" saved. A Tasks
    // Dataview key is refused, and leaving puts the saved name back. A refused
    // name already in data.json is shown with the same error.
    const prefixErrorEl = createEl("p", { cls: "gtd-field-error" });
    const prefixSetting = new Setting(containerEl)
      .setName(t(pinningPage ? "settings.pinning.name.name" : "settings.tagFieldName.name"))
      .addText((txt) => {
        const showError = (name: string) => {
          const reserved = isReservedFieldName(name);
          const message = pinningPage ? "settings.pinning.name.reserved" : "settings.tagFieldName.reserved";
          prefixErrorEl.setText(reserved ? t(message, { name }) : "");
          prefixErrorEl.toggleClass("gtd-field-error-visible", reserved);
          txt.inputEl.toggleClass("gtd-input-error", reserved);
        };
        txt.setValue(this.plugin.settings.tagPrefix);
        txt.setPlaceholder(t("settings.tagFieldName.placeholder"));
        showError(this.plugin.settings.tagPrefix);
        txt.onChange((val) => {
          showError(val.trim() || "gtd");
          showFormats(val.trim() || "gtd");
        });
        this.commitTagPrefix = () => {
          const name = txt.getValue().trim() || "gtd";
          if (isReservedFieldName(name)) {
            txt.setValue(this.plugin.settings.tagPrefix);
            showError(this.plugin.settings.tagPrefix);
            showFormats(this.plugin.settings.tagPrefix);
            return;
          }
          if (name === this.plugin.settings.tagPrefix) return;
          this.plugin.settings.tagPrefix = name;
          void this.plugin.saveSettings();
        };
        txt.inputEl.addEventListener("blur", () => this.commitTagPrefix?.());
      });
    if (pinningPage) prefixSetting.settingEl.addClass("gtd-settings-undivided");
    else prefixSetting.setDesc(t("settings.tagFieldName.description"));
    prefixSetting.settingEl.after(prefixErrorEl);
  }

  /**
   * Files to scan and its path list. On 1.13+ the dropdown's own options say
   * enough; older Obsidian keeps a description, which carries the polarity of
   * the list below it, so it swaps with the mode.
   */
  private renderFilesToScan(containerEl: HTMLElement, newLayout: boolean) {
    const scopeType = this.plugin.settings.scopeType;
    const scopeSetting = new Setting(containerEl).setName(t("settings.filesToScan.name"));
    if (!newLayout) {
      scopeSetting.setDesc(
        scopeType === "vault"
          ? t("settings.filesToScan.descriptionVault")
          : t("settings.filesToScan.descriptionPaths")
      );
    }
    scopeSetting
      .addDropdown((dd) => {
        dd.addOption("vault", t("settings.filesToScan.entireVault"));
        dd.addOption("paths", t("settings.filesToScan.selectedPaths"));
        dd.setValue(scopeType);
        dd.onChange(async (val) => {
          this.plugin.settings.scopeType = val as ScopeType;
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
          this.rerender();
        });
      });

    this.renderScopePathList(containerEl, scopeType);
  }

  /** The sub-page open now, if any, so rerender() can redraw it. */
  private openPage: SettingPage | null = null;

  /**
   * A sub-page on 1.13+. SettingPage does not exist before 1.13, so the
   * subclass is made when the page opens, not at load.
   */
  private createSubPage(render: (el: HTMLElement) => void): SettingPage {
    const setOpenPage = (page: SettingPage | null) => {
      this.openPage = page;
    };
    // Obsidian reads the definitions only when told to, so the entries'
    // values are rebuilt on the way back to them.
    const close = () => {
      this.applyTaskFilterWhenTypingStops.run();
      this.commitTagPrefix?.();
      this.rerender();
    };
    return new (class extends SettingPage {
      display(): void {
        setOpenPage(this);
        // Always true here, since only 1.13+ opens a sub-page; the API linter needs to see it.
        if (requireApiVersion("1.13.0")) {
          this.containerEl.empty();
          render(new SettingGroup(this.containerEl).listEl);
        }
      }

      hide(): void {
        setOpenPage(null);
        close();
      }
    })();
  }

  /** The global task filter — one string per line — and its two toggles. */
  /**
   * The "Drag tasks by (Mobile)" controls: its own page on 1.13+, a block in
   * the Behaviour section before. The same either way, since the explanation
   * is what tells a desktop reader the setting does nothing there.
   */
  private renderDragBy(containerEl: HTMLElement) {
    const key = (name: string) => `settings.behaviour.dragBy.${name}`;
    new Setting(containerEl).setDesc(t(key("intro")));

    const setting = new Setting(containerEl).setName(t(key("name")));
    // A real row, so the heading and the mock panel get Obsidian's own indent.
    const previewSetting = new Setting(containerEl)
      .setName(t(key("previewHeading")))
      .setDesc(t(key("previewDescription")));
    const preview = previewSetting.descEl.createDiv({ cls: "gtd-drag-preview" });
    const show = (mode: MobileDragBy) => {
      setting.setDesc(t(key(`descriptions.${mode}`)));
      this.renderDragPreview(preview, mode);
    };
    setting.addDropdown((dd) => {
      for (const mode of MOBILE_DRAG_CHOICES) dd.addOption(mode, t(key(`choices.${mode}`)));
      dd.setValue(this.plugin.settings.mobileDragBy);
      dd.onChange(async (val) => {
        show(val as MobileDragBy);
        await this.setControlValue("mobileDragBy", val);
      });
    });
    show(this.plugin.settings.mobileDragBy);
  }

  /** A mock of three panel rows, drawn the way a phone would draw them for `mode`. */
  private renderDragPreview(el: HTMLElement, mode: MobileDragBy) {
    el.empty();
    const key = (name: string) => `settings.behaviour.dragBy.${name}`;
    const zone = dragZone(mode, true);
    const frame = el.createDiv({ cls: "gtd-drag-preview-frame" });
    const panel = frame.createDiv({ cls: "gtd-drag-preview-panel" });
    const rows = [
      { text: t(key("previewTask1")), sub: false },
      { text: t(key("previewTask2")), sub: false },
      { text: t(key("previewTask3")), sub: true },
    ];
    for (const { text, sub } of rows) {
      const row = panel.createDiv({ cls: "gtd-drag-preview-row" });
      row.toggleClass("is-sub", sub);
      const handle = () => {
        if (zone.kind !== "handle") return;
        const h = row.createSpan({ cls: `gtd-drag-preview-handle is-${zone.side}` });
        if (zone.look === "bar") h.addClass("is-bar");
        else renderIcon(h, "grip-vertical");
      };
      if (zone.kind === "handle" && zone.side === "left") {
        row.addClass("has-left-handle");
        handle();
      }
      row.createSpan({ cls: "gtd-drag-preview-checkbox" });
      row.createSpan({ cls: "gtd-drag-preview-text", text });
      if (zone.kind === "handle" && zone.side === "right") {
        row.addClass("has-right-handle");
        handle();
      }
    }
    if (zone.kind === "half") {
      panel.createDiv({ cls: "gtd-drag-preview-split" });
      const labels = frame.createDiv({ cls: "gtd-drag-preview-labels" });
      const drag = t(key("previewDrag"));
      const scroll = t(key("previewScroll"));
      labels.createSpan({ text: zone.side === "left" ? drag : scroll });
      labels.createSpan({ text: zone.side === "left" ? scroll : drag });
      frame.createDiv({ cls: "gtd-drag-preview-caption", text: t(key("previewCaption")) });
    }
  }

  private renderTaskFilter(containerEl: HTMLElement, filterPage: boolean) {
    // The 1.13+ page opens with a line on what the filter is for, so its rows
    // carry shorter names and descriptions; older Obsidian keeps the originals.
    const key = (name: string) => (filterPage ? `settings.filterPage.${name}` : `settings.taskFilter.${name}`);
    if (filterPage) new Setting(containerEl).setDesc(t("settings.filterPage.intro"));

    new Setting(containerEl)
      .setName(t(key("name")))
      .setDesc(t(key("description")))
      .addTextArea((area) => {
        area.setValue(this.plugin.settings.taskFilters.join("\n"));
        area.setPlaceholder(t("settings.taskFilter.placeholder"));
        area.inputEl.rows = 3;
        area.onChange((val) => {
          this.plugin.settings.taskFilters = normalizeTaskFilters(val.split("\n"));
          this.applyTaskFilterWhenTypingStops();
        });
      });

    const includeSubtasks = new Setting(containerEl)
      .setName(t(key("includeSubtasks.name")))
      .setDesc(t(key("includeSubtasks.description")))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.taskFilterIncludeSubtasks);
        tog.onChange(async (val) => {
          this.plugin.settings.taskFilterIncludeSubtasks = val;
          await this.applyTaskFilter();
        });
      });

    const hideText = new Setting(containerEl)
      .setName(t(key("hideText.name")))
      .setDesc(t(key("hideText.description")))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.taskFilterHideText);
        tog.onChange(async (val) => {
          this.plugin.settings.taskFilterHideText = val;
          await this.plugin.saveSettings();
        });
      });

    if (filterPage) {
      includeSubtasks.settingEl.addClass("gtd-settings-undivided");
      hideText.settingEl.addClass("gtd-settings-undivided");
    }
  }

  /**
   * Renders one path list: the scanned paths under "paths" scope, or the
   * skipped ones under vault scope. Both modes share the widget — the mode
   * only decides which list is written, how the add buttons read, and whether
   * an empty list deserves a warning.
   */
  private renderScopePathList(container: HTMLElement, scopeType: ScopeType) {
    const isExclusion = scopeType === "vault";
    const entries = isExclusion
      ? this.plugin.settings.ignoredPaths
      : this.plugin.settings.scopePaths;

    const listEl = container.createDiv({ cls: "gtd-scope-list" });

    // One datalist per entry type, so a folder row autocompletes folders and a
    // file row files. Rebuilt on every render: the vault moves under us.
    const buildDatalist = (type: PathEntry["type"]): string => {
      const id = `gtd-scope-datalist-${type}`;
      let datalist = container.querySelector<HTMLDataListElement>(`#${id}`);
      if (!datalist) datalist = container.createEl("datalist", { attr: { id } });
      datalist.empty();
      const options = type === "folder" ? this.getFolderPaths() : this.getFilePaths();
      for (const opt of options) datalist.createEl("option", { attr: { value: opt } });
      return id;
    };

    const renderEntries = () => {
      listEl.empty();
      const datalistIds = { folder: buildDatalist("folder"), file: buildDatalist("file") };

      // An empty exclusion list is the ordinary state and needs no comment. An
      // empty scan list means nothing is indexed at all, which does.
      if (entries.length === 0 && !isExclusion) {
        listEl.createDiv({
          cls: "gtd-scope-empty",
          text: t("settings.filesToScan.noPathsSelected"),
        });
      }

      entries.forEach((entry, idx) => {
        const row = listEl.createDiv({ cls: "gtd-scope-entry" });

        // A blank row is one the user has only just added, not a broken path.
        const missing = entry.path !== "" && !this.entryExists(entry);
        const iconEl = row.createSpan({ cls: "gtd-scope-icon" });
        if (missing) {
          iconEl.addClass("gtd-scope-icon-missing");
          renderIcon(iconEl, "alert-triangle");
          iconEl.setAttribute(
            "aria-label",
            entry.type === "folder"
              ? t("settings.filesToScan.folderNotFound")
              : t("settings.filesToScan.fileNotFound")
          );
        } else if (entry.type === "folder") {
          renderIcon(iconEl, "folder");
        } else {
          renderIcon(iconEl, "file");
        }

        const input = row.createEl("input", {
          type: "text",
          cls: "gtd-scope-input",
          value: entry.path,
          attr: { list: datalistIds[entry.type] },
        });
        input.placeholder =
          entry.type === "folder"
            ? t("settings.filesToScan.folderPlaceholder")
            : t("settings.filesToScan.filePlaceholder");

        input.onblur = async () => {
          if (input.value.trim() === entry.path) return;
          entry.path = input.value.trim();
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
          // Re-rendered so the icon catches up with what the new path resolves
          // to. Safe on blur specifically: focus is leaving the input anyway.
          renderEntries();
        };

        const removeBtn = row.createEl("button", {
          text: "✕",
          cls: "gtd-scope-remove-btn",
        });
        removeBtn.onclick = async () => {
          entries.splice(idx, 1);
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
          renderEntries();
        };
      });

      const addRow = listEl.createDiv({ cls: "gtd-scope-add-row" });
      const addButton = (type: PathEntry["type"], label: string) => {
        const btn = addRow.createEl("button", { text: label, cls: "gtd-scope-add-btn" });
        btn.onclick = () => {
          entries.push({ type, path: "" });
          renderEntries();
        };
      };
      addButton(
        "folder",
        isExclusion ? t("settings.filesToScan.excludeFolder") : t("settings.filesToScan.addFolder")
      );
      addButton(
        "file",
        isExclusion ? t("settings.filesToScan.excludeFile") : t("settings.filesToScan.addFile")
      );
    };

    renderEntries();
  }

  /** Whether an entry's path resolves to something of the type it claims. */
  private entryExists(entry: PathEntry): boolean {
    const target = this.app.vault.getAbstractFileByPath(entry.path);
    return entry.type === "folder" ? target instanceof TFolder : target instanceof TFile;
  }

  private getFolderPaths(): string[] {
    const paths: string[] = [];
    const traverse = (folder: TFolder) => {
      if (folder.path && folder.path !== "/") paths.push(folder.path);
      for (const child of folder.children) {
        if (child instanceof TFolder) traverse(child);
      }
    };
    traverse(this.app.vault.getRoot());
    return paths.sort();
  }

  private getFilePaths(): string[] {
    return this.app.vault
      .getMarkdownFiles()
      .map((f) => f.path)
      .sort();
  }

  /**
   * Pre-1.13.0 fallback: renders the Behaviour group's 4 rows imperatively,
   * since those Obsidian versions never call getSettingDefinitions() and
   * would otherwise lose this section entirely after its declarative
   * conversion. Mirrors the control definitions in getSettingDefinitions().
   */
  private renderLegacyBehaviourFallback(containerEl: HTMLElement) {
    new Setting(containerEl).setName(t("settings.behaviour.heading")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.behaviour.weekStart.name"))
      .setDesc(t("settings.behaviour.weekStart.description"))
      .addDropdown((dd) => {
        for (const [value, label] of Object.entries(weekStartOptions())) {
          dd.addOption(value, label);
        }
        dd.setValue(this.plugin.settings.weekStartsOn ?? "monday");
        dd.onChange(async (val) => {
          await this.setControlValue("weekStartsOn", val);
        });
      });

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
      .setName(t("settings.behaviour.dropIntoBucket.name"))
      .setDesc(t("settings.behaviour.dropIntoBucket.description"))
      .addDropdown((dd) => {
        dd.addOption("pin", t("settings.behaviour.dropIntoBucket.pin"));
        dd.addOption("ask", t("settings.behaviour.dropIntoBucket.ask"));
        dd.setValue(this.plugin.settings.dropIntoBucket ?? "pin");
        dd.onChange(async (val) => {
          await this.setControlValue("dropIntoBucket", val);
        });
      });

    this.renderDragBy(containerEl);

    new Setting(containerEl)
      .setName(t("settings.behaviour.markDueFlags.name"))
      .setDesc(markDueFlagsDesc())
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.staleIndicatorEnabled);
        tog.onChange(async (val) => {
          await this.setControlValue("staleIndicatorEnabled", val);
        });
      });

    new Setting(containerEl)
      .setName(t("settings.behaviour.openLinks.name"))
      .setDesc(t("settings.behaviour.openLinks.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.openLinksOnClick);
        tog.onChange(async (val) => {
          await this.setControlValue("openLinksOnClick", val);
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

  /**
   * Imperative mirror of the Tasks integration group, for Obsidian below
   * 1.13.0. Those versions never call getSettingDefinitions(), so without this
   * the section would not exist for them at all.
   */
  private renderLegacyTasksIntegrationFallback(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName(t("settings.tasksIntegration.heading"))
      .setDesc(t("settings.tasksIntegration.blurb"))
      .setHeading();

    new Setting(containerEl)
      .setName(t("settings.tasksIntegration.priority.name"))
      .addDropdown((dd) => {
        dd.addOption("all", t("settings.tasksIntegration.priority.all"));
        dd.addOption("medium-up", t("settings.tasksIntegration.priority.mediumUp"));
        dd.addOption("high-up", t("settings.tasksIntegration.priority.highUp"));
        dd.addOption("hidden", t("settings.tasksIntegration.priority.hidden"));
        dd.setValue(this.plugin.settings.priorityDisplay ?? "all");
        dd.onChange(async (val) => {
          await this.setControlValue("priorityDisplay", val);
        });
      });

    new Setting(containerEl)
      .setName(t("settings.tasksIntegration.recurrence.name"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.showRecurrenceBadge);
        tog.onChange(async (val) => {
          await this.setControlValue("showRecurrenceBadge", val);
        });
      });

    new Setting(containerEl)
      .setName(t("settings.tasksIntegration.popoverFields.name"))
      .setDesc(t("settings.tasksIntegration.popoverFields.description"))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.showTasksFieldsInPopover);
        tog.onChange(async (val) => {
          await this.setControlValue("showTasksFieldsInPopover", val);
        });
      });
  }

  private renderBucketsSection(containerEl: HTMLElement) {
    new Setting(containerEl).setName(t("settings.buckets.heading")).setHeading();

    // To Review (expandable)
    this.renderToReviewConfig(containerEl);

    // User-defined buckets
    const bucketsContainer = containerEl.createDiv({
      cls: "gtd-settings-buckets",
    });
    this.renderBucketList(bucketsContainer);

    // Action row
    const actionRow = containerEl.createDiv({ cls: "gtd-bucket-actions" });

    const addBtn = actionRow.createEl("button", {
      text: t("settings.buckets.addBucket"),
      cls: "mod-cta gtd-add-bucket-btn",
    });
    addBtn.onclick = async () => {
      this.plugin.settings.buckets.push({
        id: generateBucketId(),
        name: t("settings.buckets.newBucketName"),
        emoji: "📌",
        dateRangeRule: null,
        quickMoveTargets: [],
        showInStatusBar: false,
      });
      await this.plugin.saveSettings();
      this.rerender();
    };

    const resetBtn = actionRow.createEl("button", {
      text: t("settings.buckets.resetToDefaults"),
      cls: "mod-warning gtd-reset-btn",
    });
    resetBtn.onclick = () => {
      new ConfirmModal(
        this.app,
        t("settings.buckets.resetConfirm"),
        t("settings.buckets.resetButton"),
        async () => {
          this.plugin.settings.buckets = JSON.parse(JSON.stringify(DEFAULT_BUCKETS)) as BucketConfig[];
          await this.plugin.saveSettings();
          this.rerender();
        }
      ).open();
    };
  }

  private renderToReviewConfig(container: HTMLElement) {
    const itemEl = container.createDiv({
      cls: "gtd-bucket-setting-item gtd-to-review-item",
    });
    const headerEl = itemEl.createDiv({ cls: "gtd-bucket-setting-header" });

    const emojiSpan = headerEl.createSpan({
      text: this.plugin.settings.toReviewEmoji || "📥",
      cls: "gtd-bucket-emoji-display",
    });

    headerEl.createSpan({
      text: t("buckets.toReview"),
      cls: "gtd-bucket-name",
    });
    headerEl.createSpan({
      text: t("settings.buckets.systemBucket"),
      cls: "gtd-bucket-system-label",
    });

    let expanded = false;
    const bodyEl = itemEl.createDiv({ cls: "gtd-bucket-setting-body gtd-hidden" });

    headerEl.onclick = () => {
      expanded = !expanded;
      bodyEl.toggleClass("gtd-hidden", !expanded);
    };

    // Emoji
    renderEmojiSetting(bodyEl, t("settings.emoji"), this.plugin.settings.toReviewEmoji, "📥", (emoji) => {
      this.plugin.settings.toReviewEmoji = emoji;
      emojiSpan.textContent = emoji;
      void this.plugin.saveSettings();
    });

    // Quick-move targets
    this.renderQuickMoveDropdowns(
      bodyEl,
      () => this.plugin.settings.toReviewQuickMoveTargets,
      async (idx, val) => {
        this.plugin.settings.toReviewQuickMoveTargets[idx] = val || undefined;
        await this.plugin.saveSettings();
      }
    );

    // Status bar
    new Setting(bodyEl)
      .setName(t("settings.buckets.showInStatusBar.name"))
      .setDesc(t("settings.buckets.showInStatusBar.description", { bucketName: t("buckets.toReview") }))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.toReviewShowInStatusBar ?? false);
        tog.onChange(async (val) => {
          this.plugin.settings.toReviewShowInStatusBar = val;
          await this.plugin.saveSettings();
        });
      });
  }

  private renderBucketList(container: HTMLElement) {
    container.empty();
    const buckets = this.plugin.settings.buckets;

    buckets.forEach((bucket, idx) => {
      const itemEl = container.createDiv({ cls: "gtd-bucket-setting-item" });
      const headerEl = itemEl.createDiv({ cls: "gtd-bucket-setting-header" });

      // Emoji display
      const emojiSpan = headerEl.createSpan({
        text: bucket.emoji || "📌",
        cls: "gtd-bucket-emoji-display",
      });

      // Name
      headerEl.createSpan({
        text: `${bucket.name}`,
        cls: "gtd-bucket-name",
      });

      // Spacer
      headerEl.createSpan({ cls: "gtd-bucket-header-spacer" });

      // Order buttons (side by side, on the right)
      const orderBtns = headerEl.createDiv({ cls: "gtd-bucket-order-btns" });
      const upBtn = orderBtns.createEl("button", {
        text: "↑",
        cls: "gtd-bucket-order-btn",
        attr: { title: t("settings.buckets.moveUp") },
      });
      const downBtn = orderBtns.createEl("button", {
        text: "↓",
        cls: "gtd-bucket-order-btn",
        attr: { title: t("settings.buckets.moveDown") },
      });

      upBtn.disabled = idx === 0;
      downBtn.disabled = idx === buckets.length - 1;

      upBtn.onclick = async (e) => {
        e.stopPropagation();
        [buckets[idx - 1], buckets[idx]] = [buckets[idx], buckets[idx - 1]];
        await this.plugin.saveSettings();
        this.rerender();
      };
      downBtn.onclick = async (e) => {
        e.stopPropagation();
        [buckets[idx + 1], buckets[idx]] = [buckets[idx], buckets[idx + 1]];
        await this.plugin.saveSettings();
        this.rerender();
      };

      // Expand/collapse
      let expanded = false;
      const bodyEl = itemEl.createDiv({ cls: "gtd-bucket-setting-body gtd-hidden" });

      headerEl.onclick = (e) => {
        if ((e.target as HTMLElement).tagName === "BUTTON") return;
        expanded = !expanded;
        bodyEl.toggleClass("gtd-hidden", !expanded);
      };

      this.renderBucketFields(bodyEl, bucket, idx, emojiSpan);
    });
  }

  private renderBucketFields(
    container: HTMLElement,
    bucket: BucketConfig,
    idx: number,
    emojiSpan: HTMLElement
  ) {
    const save = async () => {
      this.plugin.settings.buckets[idx] = bucket;
      await this.plugin.saveSettings();
    };

    // Emoji
    renderEmojiSetting(container, t("settings.emoji"), bucket.emoji, "📌", (emoji) => {
      bucket.emoji = emoji;
      emojiSpan.textContent = emoji;
      void save();
    });

    new Setting(container).setName(t("settings.buckets.field.name")).addText((txt) => {
      txt.setValue(bucket.name);
      txt.onChange(async (val) => {
        bucket.name = val;
        await save();
      });
    });

    let idErrorEl: HTMLElement;
    const idSetting = new Setting(container)
      .setName(t("settings.buckets.field.id"))
      .setDesc(t("settings.buckets.field.idDescription"))
      .addText((txt) => {
        txt.setValue(bucket.id);
        let savedId = bucket.id;

        txt.inputEl.addEventListener("focus", () => {
          savedId = bucket.id;
        });

        txt.onChange((val) => {
          const normalized = val.replace(/\s+/g, "-").toLowerCase();
          const duplicate = this.plugin.settings.buckets.find(
            (b, i) => i !== idx && b.id === normalized
          );
          if (duplicate) {
            idErrorEl.setText(t("settings.buckets.field.idDuplicate", { id: normalized, existing: duplicate.name }));
            idErrorEl.toggleClass("gtd-field-error-visible", true);
            txt.inputEl.addClass("gtd-input-error");
          } else {
            idErrorEl.toggleClass("gtd-field-error-visible", false);
            txt.inputEl.removeClass("gtd-input-error");
          }
        });

        txt.inputEl.addEventListener("blur", () => {
          const normalized = txt.getValue().replace(/\s+/g, "-").toLowerCase();
          const duplicate = this.plugin.settings.buckets.find(
            (b, i) => i !== idx && b.id === normalized
          );
          if (duplicate) {
            txt.setValue(savedId);
            idErrorEl.toggleClass("gtd-field-error-visible", false);
            txt.inputEl.removeClass("gtd-input-error");
          } else {
            bucket.id = normalized;
            void save();
          }
        });
      });
    idErrorEl = createEl("p", { cls: "gtd-field-error" });
    idSetting.settingEl.after(idErrorEl);

    // Date range rule
    this.renderDateRangeField(container, bucket, save);

    // Quick-move targets
    this.renderQuickMoveDropdowns(
      container,
      () => bucket.quickMoveTargets,
      async (dropdownIdx, val) => {
        bucket.quickMoveTargets[dropdownIdx] = val || undefined;
        await save();
      },
      bucket.id
    );

    // Status bar
    new Setting(container)
      .setName(t("settings.buckets.field.showInStatusBar"))
      .setDesc(t("settings.buckets.field.showInStatusBarDescription"))
      .addToggle((tog) => {
        tog.setValue(bucket.showInStatusBar ?? false);
        tog.onChange(async (val) => {
          bucket.showInStatusBar = val;
          await save();
        });
      });

    // Delete button — small, bottom-right, with confirmation
    const deleteRow = container.createDiv({ cls: "gtd-bucket-delete-row" });
    const deleteBtn = deleteRow.createEl("button", {
      cls: "gtd-bucket-delete-btn mod-warning",
      attr: { title: t("settings.buckets.field.deleteTooltip") },
    });
    deleteBtn.textContent = t("settings.buckets.field.delete");
    deleteBtn.onclick = () => {
      new ConfirmModal(
        this.app,
        t("settings.buckets.field.deleteConfirm", { name: bucket.name }),
        t("settings.buckets.field.deleteButton"),
        async () => {
          this.plugin.settings.buckets.splice(idx, 1);
          await this.plugin.saveSettings();
          this.rerender();
        }
      ).open();
    };
  }

  private renderDateRangeField(
    container: HTMLElement,
    bucket: BucketConfig,
    save: () => Promise<void>
  ) {
    const ruleTypes: Array<{ value: string; label: string }> = [
      { value: "none",              label: t("settings.buckets.dateRule.none") },
      { value: "today",             label: t("settings.buckets.dateRule.today") },
      { value: "this-week",         label: t("settings.buckets.dateRule.thisWeek") },
      { value: "next-week",         label: t("settings.buckets.dateRule.nextWeek") },
      { value: "this-month",        label: t("settings.buckets.dateRule.thisMonth") },
      { value: "next-month",        label: t("settings.buckets.dateRule.nextMonth") },
      { value: "within-days",       label: t("settings.buckets.dateRule.withinDays") },
      { value: "within-days-range", label: t("settings.buckets.dateRule.withinRange") },
      { value: "beyond-days",       label: t("settings.buckets.dateRule.beyondDays") },
      // "Beyond N days" is not a substitute: set it to 180 and anything 90 days
      // out matches nothing and falls through to To Review.
      { value: "catch-all",         label: t("settings.buckets.dateRule.everything") },
    ];

    const getCurrentType = () => bucket.dateRangeRule?.type ?? "none";

    const setting = new Setting(container)
      .setName(t("settings.buckets.dateRule.name"))
      .setDesc(t("settings.buckets.dateRule.description"));

    // Stable placeholder immediately after the dropdown row — ensures extra
    // inputs always render here, not at the end of the container.
    const extraPlaceholder = container.createDiv({ cls: "gtd-date-range-extra" });

    const renderExtra = (type: string) => {
      extraPlaceholder.empty();

      if (type === "within-days") {
        const rule = bucket.dateRangeRule as { type: "within-days"; days: number } | null;
        new Setting(extraPlaceholder)
          .setName(t("settings.buckets.dateRule.days.name"))
          .setDesc(t("settings.buckets.dateRule.days.description"))
          .addText((txt) => {
            txt.setValue(String(rule?.days ?? 7));
            txt.inputEl.type = "number";
            txt.inputEl.min = "1";
            txt.onChange(async (val) => {
              bucket.dateRangeRule = { type: "within-days", days: Math.max(1, parseInt(val) || 7) };
              await save();
            });
          });
      } else if (type === "within-days-range") {
        const rule = bucket.dateRangeRule as { type: "within-days-range"; from: number; to: number } | null;
        new Setting(extraPlaceholder)
          .setName(t("settings.buckets.dateRule.fromDay.name"))
          .setDesc(t("settings.buckets.dateRule.fromDay.description"))
          .addText((txt) => {
            txt.setValue(String(rule?.from ?? 1));
            txt.inputEl.type = "number";
            txt.inputEl.min = "1";
            txt.onChange(async (val) => {
              const r = bucket.dateRangeRule as { type: "within-days-range"; from: number; to: number };
              bucket.dateRangeRule = { type: "within-days-range", from: parseInt(val) || 1, to: r?.to ?? 14 };
              await save();
            });
          });
        new Setting(extraPlaceholder)
          .setName(t("settings.buckets.dateRule.toDay.name"))
          .setDesc(t("settings.buckets.dateRule.toDay.description"))
          .addText((txt) => {
            txt.setValue(String(rule?.to ?? 14));
            txt.inputEl.type = "number";
            txt.inputEl.min = "1";
            txt.onChange(async (val) => {
              const r = bucket.dateRangeRule as { type: "within-days-range"; from: number; to: number };
              bucket.dateRangeRule = { type: "within-days-range", from: r?.from ?? 1, to: parseInt(val) || 14 };
              await save();
            });
          });
      } else if (type === "beyond-days") {
        const rule = bucket.dateRangeRule as { type: "beyond-days"; days: number } | null;
        new Setting(extraPlaceholder)
          .setName(t("settings.buckets.dateRule.beyondThreshold.name"))
          .setDesc(t("settings.buckets.dateRule.beyondThreshold.description"))
          .addText((txt) => {
            txt.setValue(String(rule?.days ?? 30));
            txt.inputEl.type = "number";
            txt.inputEl.min = "0";
            txt.onChange(async (val) => {
              bucket.dateRangeRule = { type: "beyond-days", days: Math.max(0, parseInt(val) || 30) };
              await save();
            });
          });
      }
    };

    setting.addDropdown((dd) => {
      for (const opt of ruleTypes) dd.addOption(opt.value, opt.label);
      dd.setValue(getCurrentType());
      dd.onChange(async (val) => {
        if (val === "none") {
          bucket.dateRangeRule = null;
        } else if (
          val === "today" || val === "this-week" || val === "next-week" ||
          val === "this-month" || val === "next-month" || val === "catch-all"
        ) {
          bucket.dateRangeRule = { type: val };
        } else if (val === "within-days") {
          bucket.dateRangeRule = { type: "within-days", days: 7 };
        } else if (val === "within-days-range") {
          bucket.dateRangeRule = { type: "within-days-range", from: 1, to: 14 };
        } else if (val === "beyond-days") {
          bucket.dateRangeRule = { type: "beyond-days", days: 30 };
        }
        await save();
        renderExtra(val);
      });
    });

    renderExtra(getCurrentType());
  }

  private renderQuickMoveDropdowns(
    container: HTMLElement,
    getTargets: () => [string?, string?],
    setTarget: (idx: number, val: string) => Promise<void>,
    excludeId?: string
  ) {
    for (let i = 0; i < 2; i++) {
      const label = i === 0 ? t("settings.buckets.quickMove.button1Name") : t("settings.buckets.quickMove.button2Name");
      new Setting(container)
        .setName(label)
        .setDesc(i === 0 ? t("settings.buckets.quickMove.button1Description") : t("settings.buckets.quickMove.button2Description"))
        .addDropdown((dd) => {
          dd.addOption("", t("settings.buckets.quickMove.none"));
          dd.addOption("to-review", "📥 " + t("buckets.toReview"));
          for (const b of this.plugin.settings.buckets) {
            if (b.id !== excludeId) {
              dd.addOption(b.id, `${b.emoji} ${b.name}`);
            }
          }
          dd.setValue(getTargets()[i] ?? "");
          dd.onChange(async (val) => {
            await setTarget(i, val);
          });
        });
    }
  }
}
