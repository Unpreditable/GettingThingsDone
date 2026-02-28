import { App, PluginSettingTab, Setting, TFolder, Modal } from "obsidian";
import type GtdTasksPlugin from "./main";
import { BucketConfig, CelebrationMode, DateRangeRule, StorageMode, DEFAULT_BUCKETS } from "./settings";
import { getTagValue, getInlineFieldValue } from "./core/TaskParser";
import { migrateStorageMode } from "./core/StorageMigrator";


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
  document.querySelectorAll(".gtd-emoji-picker").forEach((el) => el.remove());

  const picker = document.createElement("div");
  picker.className = "gtd-emoji-picker";

  const tabs = picker.createEl("div", { cls: "gtd-emoji-tabs" });
  const gridEl = picker.createEl("div", { cls: "gtd-emoji-grid" });

  const renderGrid = (categoryIndex: number) => {
    gridEl.empty();
    for (const emoji of EMOJI_CATEGORIES[categoryIndex].emojis) {
      const item = gridEl.createEl("div", { cls: "gtd-emoji-item", text: emoji });
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(emoji);
        picker.remove();
      });
    }
  };

  EMOJI_CATEGORIES.forEach((cat, i) => {
    const tab = tabs.createEl("div", { cls: "gtd-emoji-tab", text: cat.icon });
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
  document.body.appendChild(picker);

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
    document.removeEventListener("mousedown", closeOnOutside);
    document.removeEventListener("scroll", closeOnScroll, true);
    document.removeEventListener("keydown", closeOnEscape);
  };

  const closeOnOutside = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node)) removePicker();
  };
  const closeOnScroll = () => removePicker();
  const closeOnEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") removePicker();
  };

  setTimeout(() => {
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("scroll", closeOnScroll, true);
    document.addEventListener("keydown", closeOnEscape);
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
    attr: { type: "button", title: "Click to choose emoji" },
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
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("GTD Tasks");
    this.contentEl.createEl("p", { text: this.message });

    const footer = this.contentEl.createEl("div", {
      cls: "modal-button-container",
    });

    const confirmBtn = footer.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-warning",
    });
    confirmBtn.onclick = () => {
      this.onConfirm();
      this.close();
    };

    const cancelBtn = footer.createEl("button", { text: "Cancel" });
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
    new Setting(containerEl).setName("Getting Things Done").setHeading();

    // Annotation Style (storage mode)
    const oppositeMode: StorageMode = this.plugin.settings.storageMode === "inline-tag" ? "inline-field" : "inline-tag";
    const allTasks = this.plugin.taskIndex.getAllTasks();
    const migrateCount = allTasks.filter((t) => {
      const id = oppositeMode === "inline-tag"
        ? getTagValue(t.rawLine, this.plugin.settings.tagPrefix)
        : getInlineFieldValue(t.rawLine, this.plugin.settings.tagPrefix);
      return id !== null && this.plugin.settings.buckets.some((b) => b.id === id);
    }).length;

    const annotationSetting = new Setting(containerEl)
      .setName("Annotation style")
      .addDropdown((dd) => {
        dd.addOption("inline-tag", "Inline tag (#tag)");
        dd.addOption("inline-field", "Inline field ([field:: value])");
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
            ? `Migrate ${migrateCount} task${migrateCount === 1 ? "" : "s"}`
            : "No tasks to migrate"
        );
        btn.setDisabled(migrateCount === 0);
        btn.onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText("Migrating…");
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

    annotationSetting.descEl.appendText(
      "Controls how the plugin stores which bucket each task belongs to:"
    );
    const ul = annotationSetting.descEl.createEl("ul", { cls: "gtd-desc-list" });
    ul.createEl("li", {
      text: "Inline tag — appends #prefix/bucket-id to the task line (e.g. #gtd/today)",
    });
    ul.createEl("li", {
      text: "Inline field — appends [prefix:: bucket-id] to the task line (Dataview-compatible)",
    });

    // Tag / Field name
    new Setting(containerEl)
      .setName("Tag / field name")
      .setDesc(
        "Used as the tag prefix in Inline tag mode (#<name>/bucket-id) and as the field key in Inline field mode ([<name>:: bucket-id])."
      )
      .addText((t) => {
        t.setValue(this.plugin.settings.tagPrefix);
        t.setPlaceholder("gtd");
        t.onChange(async (val) => {
          this.plugin.settings.tagPrefix = val.trim() || "gtd";
          await this.plugin.saveSettings();
        });
      });

    // Read Tasks plugin
    new Setting(containerEl)
      .setName("Read Tasks plugin metadata")
      .setDesc("Read 📅 due dates and ✅ completion dates written by the Tasks plugin.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.readTasksPlugin);
        t.onChange(async (val) => {
          this.plugin.settings.readTasksPlugin = val;
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
        });
      });

    // Scope type selector
    new Setting(containerEl)
      .setName("Files to scan")
      .setDesc("Which files the plugin searches for tasks.")
      .addDropdown((dd) => {
        dd.addOption("vault", "Entire vault");
        dd.addOption("folders", "Specific folders");
        dd.addOption("files", "Specific files");
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

    const listEl = container.createEl("div", { cls: "gtd-scope-list" });

    const renderEntries = () => {
      listEl.empty();

      // Autocomplete options
      const datalistId = "gtd-scope-datalist";
      let datalist = container.querySelector<HTMLDataListElement>(`#${datalistId}`);
      if (!datalist) {
        datalist = container.createEl("datalist", {
          attr: { id: datalistId },
        }) as HTMLDataListElement;
      }
      datalist.empty();
      const options =
        scopeType === "folders" ? this.getFolderPaths() : this.getFilePaths();
      for (const opt of options) {
        datalist.createEl("option", { attr: { value: opt } });
      }

      scope.paths.forEach((path, idx) => {
        const row = listEl.createEl("div", { cls: "gtd-scope-entry" });

        const input = row.createEl("input", {
          type: "text",
          cls: "gtd-scope-input",
          value: path,
          attr: { list: datalistId },
        }) as HTMLInputElement;
        input.placeholder =
          scopeType === "folders" ? "e.g. Tasks" : "e.g. Tasks/inbox.md";

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
        text: `+ Add ${scopeType === "folders" ? "folder" : "file"}`,
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
      .setName("Show completed tasks until midnight")
      .setDesc(
        "Completed tasks remain visible as strikethrough in the panel until midnight, then disappear on next load."
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.completedVisibilityUntilMidnight);
        t.onChange(async (val) => {
          this.plugin.settings.completedVisibilityUntilMidnight = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Mark overdue tasks with !")
      .setDesc(
        "Tasks that are past their bucket's scheduled window show a ! indicator in the panel."
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.staleIndicatorEnabled);
        t.onChange(async (val) => {
          this.plugin.settings.staleIndicatorEnabled = val;
          await this.plugin.saveSettings();
          await this.plugin.refreshIndex();
        });
      });

    new Setting(containerEl)
      .setName("Compact view")
      .setDesc(
        "Reduce padding on bucket headers and task rows to fit more tasks on screen."
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.compactView);
        t.onChange(async (val) => {
          this.plugin.settings.compactView = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Celebration animations")
      .setDesc("Choose which animations play when you complete a task.")
      .addDropdown((dd) => {
        dd.addOption("off", "Off");
        dd.addOption("confetti", "Confetti only");
        dd.addOption("creature", "Celebration only");
        dd.addOption("all", "Confetti and celebration");
        dd.setValue(this.plugin.settings.celebrationMode ?? "all");
        dd.onChange(async (val) => {
          this.plugin.settings.celebrationMode = val as CelebrationMode;
          await this.plugin.saveSettings();
        });
      });
  }

  private renderBucketsSection() {
    const { containerEl } = this;
    new Setting(containerEl).setName("Buckets").setHeading();

    // To Review (expandable)
    this.renderToReviewConfig(containerEl);

    // User-defined buckets
    const bucketsContainer = containerEl.createEl("div", {
      cls: "gtd-settings-buckets",
    });
    this.renderBucketList(bucketsContainer);

    // Action row
    const actionRow = containerEl.createEl("div", { cls: "gtd-bucket-actions" });

    const addBtn = actionRow.createEl("button", {
      text: "Add bucket",
      cls: "mod-cta gtd-add-bucket-btn",
    });
    addBtn.onclick = async () => {
      this.plugin.settings.buckets.push({
        id: generateBucketId(),
        name: "New Bucket",
        emoji: "📌",
        dateRangeRule: null,
        quickMoveTargets: [],
        showInStatusBar: false,
      });
      await this.plugin.saveSettings();
      this.display();
    };

    const resetBtn = actionRow.createEl("button", {
      text: "Reset to defaults",
      cls: "mod-warning gtd-reset-btn",
    });
    resetBtn.onclick = () => {
      new ConfirmModal(
        this.app,
        "Reset all buckets to defaults? This will discard your current bucket configuration.",
        "Reset",
        async () => {
          this.plugin.settings.buckets = JSON.parse(JSON.stringify(DEFAULT_BUCKETS));
          await this.plugin.saveSettings();
          this.display();
        }
      ).open();
    };
  }

  private renderToReviewConfig(container: HTMLElement) {
    const itemEl = container.createEl("div", {
      cls: "gtd-bucket-setting-item gtd-to-review-item",
    });
    const headerEl = itemEl.createEl("div", { cls: "gtd-bucket-setting-header" });

    const emojiSpan = headerEl.createEl("span", {
      text: this.plugin.settings.toReviewEmoji || "📥",
      cls: "gtd-bucket-emoji-display",
    });

    headerEl.createEl("span", {
      text: "To Review",
      cls: "gtd-bucket-name",
    });
    headerEl.createEl("span", {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text: "system · cannot be removed",
      cls: "gtd-bucket-system-label",
    });

    let expanded = false;
    const bodyEl = itemEl.createEl("div", { cls: "gtd-bucket-setting-body gtd-hidden" });

    headerEl.onclick = () => {
      expanded = !expanded;
      bodyEl.toggleClass("gtd-hidden", !expanded);
    };

    // Emoji
    renderEmojiSetting(bodyEl, "Emoji", this.plugin.settings.toReviewEmoji, "📥", (emoji) => {
      this.plugin.settings.toReviewEmoji = emoji;
      emojiSpan.textContent = emoji;
      this.plugin.saveSettings();
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
      .setName("Show in status bar")
      .setDesc("Display the To Review count in the status bar.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.toReviewShowInStatusBar ?? false);
        t.onChange(async (val) => {
          this.plugin.settings.toReviewShowInStatusBar = val;
          await this.plugin.saveSettings();
        });
      });
  }

  private renderBucketList(container: HTMLElement) {
    container.empty();
    const buckets = this.plugin.settings.buckets;

    buckets.forEach((bucket, idx) => {
      const itemEl = container.createEl("div", { cls: "gtd-bucket-setting-item" });
      const headerEl = itemEl.createEl("div", { cls: "gtd-bucket-setting-header" });

      // Emoji display
      const emojiSpan = headerEl.createEl("span", {
        text: bucket.emoji || "📌",
        cls: "gtd-bucket-emoji-display",
      });

      // Name
      headerEl.createEl("span", {
        text: `${bucket.name}`,
        cls: "gtd-bucket-name",
      });

      // Spacer
      headerEl.createEl("span", { cls: "gtd-bucket-header-spacer" });

      // Order buttons (side by side, on the right)
      const orderBtns = headerEl.createEl("div", { cls: "gtd-bucket-order-btns" });
      const upBtn = orderBtns.createEl("button", {
        text: "↑",
        cls: "gtd-bucket-order-btn",
        attr: { title: "Move up" },
      });
      const downBtn = orderBtns.createEl("button", {
        text: "↓",
        cls: "gtd-bucket-order-btn",
        attr: { title: "Move down" },
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
      const bodyEl = itemEl.createEl("div", { cls: "gtd-bucket-setting-body gtd-hidden" });

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
    renderEmojiSetting(container, "Emoji", bucket.emoji, "📌", (emoji) => {
      bucket.emoji = emoji;
      emojiSpan.textContent = emoji;
      save();
    });

    new Setting(container).setName("Name").addText((t) => {
      t.setValue(bucket.name);
      t.onChange(async (val) => {
        bucket.name = val;
        await save();
      });
    });

    let idErrorEl: HTMLElement;
    const idSetting = new Setting(container)
      .setName("ID / slug")
      .setDesc("Internal identifier used in tags/fields. No spaces.")
      .addText((t) => {
        t.setValue(bucket.id);
        let savedId = bucket.id;

        t.inputEl.addEventListener("focus", () => {
          savedId = bucket.id;
        });

        t.onChange((val) => {
          const normalized = val.replace(/\s+/g, "-").toLowerCase();
          const duplicate = this.plugin.settings.buckets.find(
            (b, i) => i !== idx && b.id === normalized
          );
          if (duplicate) {
            idErrorEl.setText(`ID "${normalized}" is already used by "${duplicate.name}".`);
            idErrorEl.toggleClass("gtd-field-error-visible", true);
            t.inputEl.addClass("gtd-input-error");
          } else {
            idErrorEl.toggleClass("gtd-field-error-visible", false);
            t.inputEl.removeClass("gtd-input-error");
          }
        });

        t.inputEl.addEventListener("blur", async () => {
          const normalized = t.getValue().replace(/\s+/g, "-").toLowerCase();
          const duplicate = this.plugin.settings.buckets.find(
            (b, i) => i !== idx && b.id === normalized
          );
          if (duplicate) {
            t.setValue(savedId);
            idErrorEl.toggleClass("gtd-field-error-visible", false);
            t.inputEl.removeClass("gtd-input-error");
          } else {
            bucket.id = normalized;
            await save();
          }
        });
      });
    idErrorEl = document.createElement("p");
    idErrorEl.classList.add("gtd-field-error");
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
      .setName("Show in status bar")
      .setDesc("Display this bucket's task count in the status bar.")
      .addToggle((t) => {
        t.setValue(bucket.showInStatusBar ?? false);
        t.onChange(async (val) => {
          bucket.showInStatusBar = val;
          await save();
        });
      });

    // Delete button — small, bottom-right, with confirmation
    const deleteRow = container.createEl("div", { cls: "gtd-bucket-delete-row" });
    const deleteBtn = deleteRow.createEl("button", {
      cls: "gtd-bucket-delete-btn mod-warning",
      attr: { title: "Delete this bucket" },
    });
    deleteBtn.textContent = "Delete";
    deleteBtn.onclick = () => {
      new ConfirmModal(
        this.app,
        `Delete bucket "${bucket.name}"? This cannot be undone.`,
        "Delete",
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
      { value: "none",              label: "None (manual/tag only)" },
      { value: "today",             label: "Today (due today or overdue)" },
      { value: "this-week",         label: "This week (tomorrow \u2013 end of current Sunday)" },
      { value: "next-week",         label: "Next week (next Monday \u2013 following Sunday)" },
      { value: "this-month",        label: "This month (1 day out \u2013 end of current month)" },
      { value: "next-month",        label: "Next month (1st \u2013 last day of next month)" },
      { value: "within-days",       label: "Within N days" },
      { value: "within-days-range", label: "Within day range (from\u2013to)" },
      { value: "beyond-days",       label: "Beyond N days (catch-all)" },
    ];

    const getCurrentType = () => bucket.dateRangeRule?.type ?? "none";

    const setting = new Setting(container)
      .setName("Date range rule")
      .setDesc("Auto-assign tasks based on their 📅 due date. If multiple buckets have overlapping rules, the first matching bucket (top to bottom) wins.");

    // Stable placeholder immediately after the dropdown row — ensures extra
    // inputs always render here, not at the end of the container.
    const extraPlaceholder = container.createEl("div", { cls: "gtd-date-range-extra" });

    const renderExtra = (type: string) => {
      extraPlaceholder.empty();

      if (type === "within-days") {
        const rule = bucket.dateRangeRule as { type: "within-days"; days: number } | null;
        new Setting(extraPlaceholder)
          .setName("Days")
          .setDesc("Tasks due within this many days from today are assigned here.")
          .addText((t) => {
            t.setValue(String(rule?.days ?? 7));
            t.inputEl.type = "number";
            t.inputEl.min = "1";
            t.onChange(async (val) => {
              bucket.dateRangeRule = { type: "within-days", days: Math.max(1, parseInt(val) || 7) };
              await save();
            });
          });
      } else if (type === "within-days-range") {
        const rule = bucket.dateRangeRule as { type: "within-days-range"; from: number; to: number } | null;
        new Setting(extraPlaceholder)
          .setName("From day")
          .setDesc("Start of the window: number of days from today (e.g. 1 = tomorrow, 7 = one week from today).")
          .addText((t) => {
            t.setValue(String(rule?.from ?? 1));
            t.inputEl.type = "number";
            t.inputEl.min = "1";
            t.onChange(async (val) => {
              const r = bucket.dateRangeRule as { type: "within-days-range"; from: number; to: number };
              bucket.dateRangeRule = { type: "within-days-range", from: parseInt(val) || 1, to: r?.to ?? 14 };
              await save();
            });
          });
        new Setting(extraPlaceholder)
          .setName("To day")
          .setDesc("End of the window: number of days from today (e.g. 14 = two weeks from today).")
          .addText((t) => {
            t.setValue(String(rule?.to ?? 14));
            t.inputEl.type = "number";
            t.inputEl.min = "1";
            t.onChange(async (val) => {
              const r = bucket.dateRangeRule as { type: "within-days-range"; from: number; to: number };
              bucket.dateRangeRule = { type: "within-days-range", from: r?.from ?? 1, to: parseInt(val) || 14 };
              await save();
            });
          });
      } else if (type === "beyond-days") {
        const rule = bucket.dateRangeRule as { type: "beyond-days"; days: number } | null;
        new Setting(extraPlaceholder)
          .setName("Days threshold")
          .setDesc("Tasks due more than this many days from today are assigned here.")
          .addText((t) => {
            t.setValue(String(rule?.days ?? 30));
            t.inputEl.type = "number";
            t.inputEl.min = "0";
            t.onChange(async (val) => {
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
      const label = i === 0 ? "Quick-move button 1" : "Quick-move button 2";
      new Setting(container)
        .setName(label)
        .setDesc(i === 0 ? "Primary quick-move target shown on each task row" : "Optional second quick-move target")
        .addDropdown((dd) => {
          dd.addOption("", "(none)");
          dd.addOption("to-review", "📥 To Review");
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
