import { App, PluginSettingTab, Setting, TFolder, Modal } from "obsidian";
import type GtdTasksPlugin from "./main";
import { BucketConfig, CelebrationMode, DateRangeRule, StorageMode, DEFAULT_BUCKETS } from "./settings";
import { getTagValue, getInlineFieldValue } from "./core/TaskParser";
import { migrateStorageMode } from "./core/StorageMigrator";
import { t } from "./i18n/i18n";
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

  // Calculate position with viewport constraints
  let top = rect.bottom + 4;
  let left = rect.left;

  // Check if picker would overflow bottom; if so, position above
  if (top + pickerHeight > window.innerHeight) {
    top = rect.top - pickerHeight - 4;
  }

  // Check if picker would overflow right; if so, shift left
  if (left + pickerWidth > window.innerWidth) {
    left = Math.max(0, window.innerWidth - pickerWidth - 4);
  }

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


class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private confirmLabel: string,
    private onConfirm: () => void | Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(t("panel.title"));
    this.contentEl.createEl("p", { text: this.message });

    const footer = this.contentEl.createDiv({
      cls: "modal-button-container",
    });

    const confirmBtn = footer.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-warning",
    });
    confirmBtn.onclick = () => {
      void this.onConfirm();
      this.close();
    };

    const cancelBtn = footer.createEl("button", { text: t("common.cancel") });
    cancelBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}


function generateBucketId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}


export class GtdSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: GtdTasksPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderGeneralSection();
    this.renderBehaviourSection();
    this.renderBucketsSection();
  }

  private renderGeneralSection() {
    const { containerEl } = this;
    new Setting(containerEl).setName(t("settings.heading")).setHeading();

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
      .setName(t("settings.annotationStyle.name"))
      .addDropdown((dd) => {
        dd.addOption("inline-tag", t("settings.annotationStyle.inlineTag"));
        dd.addOption("inline-field", t("settings.annotationStyle.inlineField"));
        dd.setValue(this.plugin.settings.storageMode);
        dd.onChange(async (val) => {
          this.plugin.settings.storageMode = val as StorageMode;
          await this.plugin.saveSettings();
          this.display();
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
          await migrateStorageMode(
            this.app,
            this.plugin.taskIndex.getAllTasks(),
            oppositeMode,
            this.plugin.settings
          );
          this.display();
        });
      });

    annotationSetting.controlEl.addClass("gtd-annotation-control");

    annotationSetting.descEl.appendText(t("settings.annotationStyle.descHeader"));
    const ul = annotationSetting.descEl.createEl("ul", { cls: "gtd-desc-list" });
    ul.createEl("li", { text: t("settings.annotationStyle.descInlineTag") });
    ul.createEl("li", { text: t("settings.annotationStyle.descInlineField") });

    // Tag / Field name
    new Setting(containerEl)
      .setName(t("settings.tagFieldName.name"))
      .setDesc(t("settings.tagFieldName.description"))
      .addText((txt) => {
        txt.setValue(this.plugin.settings.tagPrefix);
        txt.setPlaceholder(t("settings.tagFieldName.placeholder"));
        txt.onChange(async (val) => {
          this.plugin.settings.tagPrefix = val.trim() || "gtd";
          await this.plugin.saveSettings();
        });
      });

    // Read Tasks plugin
    const pluginName: string = "Tasks";
    new Setting(containerEl)
      .setName(t("settings.tasksPlugin.name", { pluginName }))
      .setDesc(t("settings.tasksPlugin.description", { pluginName }))
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.readTasksPlugin);
        tog.onChange(async (val) => {
          this.plugin.settings.readTasksPlugin = val;
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
        });
      });

    // Scope type selector
    new Setting(containerEl)
      .setName(t("settings.filesToScan.name"))
      .setDesc(t("settings.filesToScan.description"))
      .addDropdown((dd) => {
        dd.addOption("vault", t("settings.filesToScan.entireVault"));
        dd.addOption("folders", t("settings.filesToScan.specificFolders"));
        dd.addOption("files", t("settings.filesToScan.specificFiles"));
        dd.setValue(this.plugin.settings.taskScope.type);
        dd.onChange(async (val) => {
          if (val === "vault") {
            this.plugin.settings.taskScope = { type: "vault" };
          } else if (val === "folders") {
            this.plugin.settings.taskScope = { type: "folders", paths: [] };
          } else {
            this.plugin.settings.taskScope = { type: "files", paths: [] };
          }
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
          this.display();
        });
      });

    const scope = this.plugin.settings.taskScope;
    if (scope.type === "folders" || scope.type === "files") {
      this.renderScopePathList(containerEl, scope.type);
    }
  }

  private renderScopePathList(
    container: HTMLElement,
    scopeType: "folders" | "files"
  ) {
    const scope = this.plugin.settings.taskScope as
      | { type: "folders"; paths: string[] }
      | { type: "files"; paths: string[] };

    const listEl = container.createDiv({ cls: "gtd-scope-list" });

    const renderEntries = () => {
      listEl.empty();

      // Autocomplete options
      const datalistId = "gtd-scope-datalist";
      let datalist = container.querySelector<HTMLDataListElement>(`#${datalistId}`);
      if (!datalist) {
        datalist = container.createEl("datalist", {
          attr: { id: datalistId },
        });
      }
      datalist.empty();
      const options =
        scopeType === "folders" ? this.getFolderPaths() : this.getFilePaths();
      for (const opt of options) {
        datalist.createEl("option", { attr: { value: opt } });
      }

      scope.paths.forEach((path, idx) => {
        const row = listEl.createDiv({ cls: "gtd-scope-entry" });

        const input = row.createEl("input", {
          type: "text",
          cls: "gtd-scope-input",
          value: path,
          attr: { list: datalistId },
        });
        input.placeholder =
          scopeType === "folders" ? t("settings.filesToScan.folderPlaceholder") : t("settings.filesToScan.filePlaceholder");

        input.onblur = async () => {
          scope.paths[idx] = input.value.trim();
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
        };

        const removeBtn = row.createEl("button", {
          text: "✕",
          cls: "gtd-scope-remove-btn",
        });
        removeBtn.onclick = async () => {
          scope.paths.splice(idx, 1);
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
          renderEntries();
        };
      });

      // Add entry button
      const addBtn = listEl.createEl("button", {
        text: scopeType === "folders" ? t("settings.filesToScan.addFolder") : t("settings.filesToScan.addFile"),
        cls: "gtd-scope-add-btn",
      });
      addBtn.onclick = () => {
        scope.paths.push("");
        renderEntries();
      };
    };

    renderEntries();
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

  private renderBehaviourSection() {
    const { containerEl } = this;

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
        dd.setValue(this.plugin.settings.celebrationMode ?? "all");
        dd.onChange(async (val) => {
          this.plugin.settings.celebrationMode = val as CelebrationMode;
          await this.plugin.saveSettings();
        });
      });
  }

  private renderBucketsSection() {
    const { containerEl } = this;
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
      this.display();
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
          this.display();
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
        this.display();
      };
      downBtn.onclick = async (e) => {
        e.stopPropagation();
        [buckets[idx + 1], buckets[idx]] = [buckets[idx], buckets[idx + 1]];
        await this.plugin.saveSettings();
        this.display();
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
          this.display();
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
        } else if (val === "today" || val === "this-week" || val === "next-week" || val === "this-month" || val === "next-month") {
          bucket.dateRangeRule = { type: val } as DateRangeRule;
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
