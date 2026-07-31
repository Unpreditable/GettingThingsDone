import {
  Plugin,
  WorkspaceLeaf,
  ItemView,
  MarkdownView,
  Notice,
  TFile,
  App,
  getLanguage,
} from "obsidian";
import { mount, unmount } from "svelte";
import { writable, type Writable } from "svelte/store";

import { PluginSettings, DEFAULT_SETTINGS, DEFAULT_BUCKETS, getActiveScope, migrateSettingsData } from "./settings";
import { GtdSettingsTab } from "./settings-tab";
import { TaskIndex } from "./core/TaskIndex";
import { groupTasksIntoBuckets, TO_REVIEW_ID } from "./core/BucketManager";
import type { BucketGroup as BucketGroupData } from "./core/BucketManager";
import { moveTaskToBucket, toggleTaskCompletion, confirmTaskPlacement } from "./core/TaskWriter";
import type { TaskRecord } from "./core/TaskParser";
import { computeOrderKeys, mapToOrderKeys, purgeOrderKey } from "./core/TaskOrder";
import GTDPanel from "./views/GTDPanel.svelte";
import { t } from "./i18n/i18n";
import { BucketLocalizer } from "./core/BucketLocalizer";
import { celebrationImages } from "./assets/celebrationImages";

const VIEW_TYPE_GTD = "gtd-tasks-panel";

export default class GtdTasksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  taskIndex!: TaskIndex;
  languageChangeNotice = false;
  private panelView?: GtdPanelView;
  private statusBarItem?: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.taskIndex = new TaskIndex(this.app, this, () => getActiveScope(this.settings));

    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass("gtd-status-bar-item");
    this.addSettingTab(new GtdSettingsTab(this.app, this));

    this.registerView(VIEW_TYPE_GTD, (leaf) => new GtdPanelView(leaf, this));

    this.addCommand({
      id: "open-gtd-panel",
      name: t("commands.openPanel"),
      callback: () => this.activateView(),
    });

    const currentLang = getLanguage() ?? "en";
    if (this.settings.lastSeenLanguage !== currentLang) {
      if (this.settings.lastSeenLanguage !== "") {
        BucketLocalizer.renameBuckets(this.settings, this.settings.lastSeenLanguage, currentLang);
        this.languageChangeNotice = true;
      }
      this.settings.lastSeenLanguage = currentLang;
      await this.saveSettings();
    }

    this.taskIndex.registerVaultEvents();

    this.taskIndex.onChange(() => {
      this.panelView?.refresh();
      this.updateStatusBar();
    });

    this.app.workspace.onLayoutReady(async () => {
      await this.activateView();
      await this.taskIndex.initialScan();
      this.updateStatusBar();
    });
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, migrateSettingsData(await this.loadData()));
    if (!this.settings.buckets || this.settings.buckets.length === 0) {
      this.settings.buckets = DEFAULT_BUCKETS.map((b) => ({ ...b }));
    }
    this.settings.taskOrder = { ...(this.settings.taskOrder ?? {}) };
    for (const bucket of this.settings.buckets) {
      if (!bucket.emoji) {
        const def = DEFAULT_BUCKETS.find((b) => b.id === bucket.id);
        bucket.emoji = def?.emoji ?? "📌";
      }
      if (bucket.showInStatusBar === undefined) {
        bucket.showInStatusBar = false;
      }
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.panelView?.refresh();
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    if (!this.statusBarItem) return;
    this.statusBarItem.empty();
    const allTasks = this.taskIndex.getAllTasks();
    const bucketGroups = groupTasksIntoBuckets(allTasks, this.settings);

    for (const group of bucketGroups) {
      const showInBar = group.isSystem
        ? this.settings.toReviewShowInStatusBar
        : (this.settings.buckets.find((b) => b.id === group.bucketId)?.showInStatusBar ?? false);
      if (!showInBar) continue;

      const active = group.tasks.filter((t) => !t.isCompleted).length;
      let total = active;
      if (this.settings.completedVisibilityUntilMidnight) {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const visibleCompleted = group.tasks.filter(
          (t) => t.isCompleted && (!t.completedAt || t.completedAt >= midnight)
        ).length;
        total = active + visibleCompleted;
      }

      const label = active < total ? `${active}/${total}${group.emoji}` : `${total}${group.emoji}`;
      const bucketId = group.bucketId;
      const span = this.statusBarItem.createSpan({
        cls: "gtd-status-bucket",
        text: label,
      });
      span.addEventListener("click", () => void this.activateView(bucketId));
    }
  }

  async refreshIndex(): Promise<void> {
    await this.taskIndex.initialScan();
  }

  private async activateView(bucketId?: string) {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(VIEW_TYPE_GTD)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_GTD, active: true });
    }

    if (leaf.view instanceof GtdPanelView) {
      this.panelView = leaf.view;
    }

    await workspace.revealLeaf(leaf);

    if (bucketId) {
      this.panelView?.scrollToBucket(bucketId);
    }
  }
}

class GtdPanelView extends ItemView {
  private svelteInstance?: Record<string, unknown>;
  private bucketGroups$ = writable<BucketGroupData[]>([]);
  private settings$!: Writable<PluginSettings>;
  private celebrationImageUrls$ = writable<string[]>(celebrationImages);
  private languageChangeNotice$ = writable<boolean>(false);

  constructor(leaf: WorkspaceLeaf, private plugin: GtdTasksPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GTD;
  }

  getDisplayText(): string {
    return t("panel.title");
  }

  getIcon(): string {
    return "check-square";
  }

  onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("gtd-panel-root");
    this.mountSvelte();
    if (this.plugin.languageChangeNotice) {
      this.languageChangeNotice$.set(true);
    }
    return Promise.resolve();
  }

  async onClose() {
    if (this.svelteInstance) {
      await unmount(this.svelteInstance);
      this.svelteInstance = undefined;
    }
  }

  refresh() {
    if (!this.svelteInstance) return;

    const allTasks = this.plugin.taskIndex.getAllTasks();
    this.bucketGroups$.set(groupTasksIntoBuckets(allTasks, this.plugin.settings));
    this.settings$.set(this.plugin.settings);
  }

  private mountSvelte() {
    const allTasks = this.plugin.taskIndex.getAllTasks();
    this.bucketGroups$.set(groupTasksIntoBuckets(allTasks, this.plugin.settings));
    this.settings$ = writable(this.plugin.settings);

    const openSettings = () => {
      const appWithSetting = this.app as App & { setting: { open: () => void; openTabById: (id: string) => void; }; };
      appWithSetting.setting?.open();
      appWithSetting.setting?.openTabById(this.plugin.manifest.id);
    };

    this.svelteInstance = mount(GTDPanel, {
      target: this.contentEl,
      props: {
        bucketGroups$: this.bucketGroups$,
        settings$: this.settings$,
        celebrationImageUrls$: this.celebrationImageUrls$,
        languageChangeNotice$: this.languageChangeNotice$,
        onMove: this.handleMove.bind(this),
        onToggle: this.handleToggle.bind(this),
        onNavigate: this.handleNavigate.bind(this),
        onConfirm: this.handleConfirmPlacement.bind(this),
        onReorder: this.handleReorder.bind(this),
        onOpenSettings: openSettings,
        onDismissLanguageBanner: () => {
          this.plugin.languageChangeNotice = false;
          this.languageChangeNotice$.set(false);
        },
      },
    });
  }

  private async handleReorder(bucketId: string, orderedTaskIds: string[]) {
    const orderKeys = computeOrderKeys(this.plugin.taskIndex.getAllTasks());
    this.plugin.settings.taskOrder[bucketId] = mapToOrderKeys(orderedTaskIds, orderKeys);
    await this.plugin.saveSettings();
  }

  /**
   * Reindexes and settles taskOrder BEFORE the single refresh at the end
   * (via saveSettings()), rather than refreshing once per step. Refreshing
   * after each step (reindex, then separately after taskOrder is saved)
   * would render the same drop as two visibly different in-between states —
   * correct bucket but stale position, then correct position a beat later —
   * instead of one settled result. reindexFileSilently is used instead of
   * reindexFile so this doesn't ALSO trigger its own premature refresh.
   */
  private async handleMove(
    task: TaskRecord,
    targetBucketId: string | null,
    orderedTaskIds?: string[] | null
  ) {
    const targetBucket =
      targetBucketId === null
        ? null
        : this.plugin.settings.buckets.find((b) => b.id === targetBucketId) ?? null;

    const result = await moveTaskToBucket(
      this.app,
      task,
      targetBucket,
      this.plugin.settings
    );

    if (!result.success) {
      new Notice(t("notices.moveFailed", { error: result.error }));
      await this.plugin.taskIndex.reindexFile(task.filePath);
      return;
    }

    await this.plugin.taskIndex.reindexFileSilently(task.filePath);

    const orderKeys = computeOrderKeys(this.plugin.taskIndex.getAllTasks());
    const key = orderKeys.get(task.id);
    if (key) {
      const purged = purgeOrderKey(this.plugin.settings.taskOrder, key);
      this.plugin.settings.taskOrder = purged.taskOrder;
    }

    if (orderedTaskIds) {
      const targetId = targetBucketId ?? TO_REVIEW_ID;
      this.plugin.settings.taskOrder[targetId] = mapToOrderKeys(orderedTaskIds, orderKeys);
    }

    // Always refresh once here, now that the index and taskOrder are both
    // settled — the moved task's bucket assignment changed regardless of
    // whether taskOrder itself did, so the panel always needs to redraw.
    await this.plugin.saveSettings();
  }

  private async handleToggle(task: TaskRecord) {
    const result = await toggleTaskCompletion(
      this.app,
      task,
      this.plugin.settings
    );

    if (!result.success) {
      new Notice(t("notices.toggleFailed", { error: result.error }));
      await this.plugin.taskIndex.reindexFile(task.filePath);
    }
  }

  private async handleConfirmPlacement(task: TaskRecord, bucketId: string) {
    const result = await confirmTaskPlacement(
      this.app,
      task,
      bucketId,
      this.plugin.settings
    );
    if (!result.success) {
      new Notice(t("notices.confirmFailed", { error: result.error }));
      await this.plugin.taskIndex.reindexFile(task.filePath);
    }
  }

  scrollToBucket(bucketId: string) {
    const el = this.contentEl.querySelector<HTMLElement>(`.gtd-bucket[data-bucket-id="${bucketId}"]`);
    el?.scrollIntoView({ behavior: "instant", block: "start" });
  }

  private handleNavigate(task: TaskRecord) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;

    const { workspace } = this.app;
    const existingLeaf = workspace.getLeavesOfType("markdown")
      .find((leaf) => (leaf.view as MarkdownView).file?.path === task.filePath);

    if (existingLeaf) {
      void workspace.revealLeaf(existingLeaf);
      (existingLeaf.view as MarkdownView).editor?.setCursor({ line: task.lineNumber, ch: 0 });
    } else {
      void workspace.getLeaf(false).openFile(file, { eState: { line: task.lineNumber } });
    }
  }
}
