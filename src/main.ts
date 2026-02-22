import {
  Plugin,
  WorkspaceLeaf,
  ItemView,
  Notice,
  TFile,
  normalizePath,
} from "obsidian";
import type { SvelteComponent } from "svelte";

import { PluginSettings, DEFAULT_SETTINGS, DEFAULT_BUCKETS } from "./settings";
import { GtdSettingsTab } from "./settings-tab";
import { TaskIndex } from "./core/TaskIndex";
import { groupTasksIntoBuckets, TO_REVIEW_ID } from "./core/BucketManager";
import { moveTaskToBucket, toggleTaskCompletion, confirmTaskPlacement } from "./core/TaskWriter";
import type { TaskRecord } from "./core/TaskParser";
import GTDPanel from "./views/GTDPanel.svelte";

const VIEW_TYPE_GTD = "gtd-tasks-panel";

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class GtdTasksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  taskIndex!: TaskIndex;
  private panelView?: GtdPanelView;
  private statusBarItem?: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.taskIndex = new TaskIndex(this.app, this, () => this.settings.taskScope);

    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.style.order = "-1";
    this.addSettingTab(new GtdSettingsTab(this.app, this));

    this.registerView(VIEW_TYPE_GTD, (leaf) => {
      this.panelView = new GtdPanelView(leaf, this);
      return this.panelView;
    });

    // Register commands
    this.addCommand({
      id: "open-gtd-panel",
      name: "Open GTD Tasks panel",
      callback: () => this.activateView(),
    });

    // Initial scan then open view
    await this.taskIndex.initialScan();
    this.taskIndex.registerVaultEvents();

    // Keep the panel and status bar up-to-date as the index changes
    this.taskIndex.onChange(() => {
      this.panelView?.refresh();
      this.updateStatusBar();
    });

    // Auto-open panel on startup
    this.app.workspace.onLayoutReady(() => {
      this.activateView();
      this.updateStatusBar();
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GTD);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Ensure buckets array is never empty after load
    if (!this.settings.buckets || this.settings.buckets.length === 0) {
      this.settings.buckets = DEFAULT_BUCKETS.map((b) => ({ ...b }));
    }
    // Backfill missing fields added in newer versions (e.g. emoji)
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
    const allTasks = this.taskIndex.getAllTasks();
    const bucketGroups = groupTasksIntoBuckets(allTasks, this.settings);
    const parts: string[] = [];

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
      parts.push(label);
    }

    this.statusBarItem.setText(parts.join("  "));
  }

  /** Force a full re-index (e.g. after scope changes). */
  async refreshIndex(): Promise<void> {
    await this.taskIndex.initialScan();
  }

  // ---------------------------------------------------------------------------
  // View management
  // ---------------------------------------------------------------------------

  private async activateView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_GTD)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_GTD, active: true });
    }

    workspace.revealLeaf(leaf);
  }
}

// ---------------------------------------------------------------------------
// ItemView wrapper — bridges Obsidian lifecycle to Svelte component
// ---------------------------------------------------------------------------

class GtdPanelView extends ItemView {
  private svelteComponent?: SvelteComponent;
  private celebrationImageUrls: string[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: GtdTasksPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GTD;
  }

  getDisplayText(): string {
    return "GTD Tasks";
  }

  getIcon(): string {
    return "check-square";
  }

  private async loadCelebrationImageUrls(): Promise<string[]> {
    const assetDir = normalizePath(this.plugin.manifest.dir + '/assets/celebration');
    try {
      const listing = await this.app.vault.adapter.list(assetDir);
      return listing.files
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .map((f) => (this.app.vault.adapter as any).getResourcePath(f));
    } catch {
      return [];
    }
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("gtd-panel-root");
    this.mountSvelte();
    this.celebrationImageUrls = await this.loadCelebrationImageUrls();
    this.svelteComponent?.$set({ celebrationImageUrls: this.celebrationImageUrls });
  }

  async onClose() {
    this.svelteComponent?.$destroy();
  }

  refresh() {
    if (!this.svelteComponent) return;

    const allTasks = this.plugin.taskIndex.getAllTasks();
    const bucketGroups = groupTasksIntoBuckets(allTasks, this.plugin.settings);

    this.svelteComponent.$set({
      bucketGroups,
      settings: this.plugin.settings,
      onConfirm: this.handleConfirmPlacement.bind(this),
    });
  }

  private mountSvelte() {
    const allTasks = this.plugin.taskIndex.getAllTasks();
    const bucketGroups = groupTasksIntoBuckets(allTasks, this.plugin.settings);

    this.svelteComponent = new GTDPanel({
      target: this.contentEl,
      props: {
        bucketGroups,
        settings: this.plugin.settings,
        celebrationImageUrls: this.celebrationImageUrls,
        onMove: this.handleMove.bind(this),
        onToggle: this.handleToggle.bind(this),
        onNavigate: this.handleNavigate.bind(this),
        onConfirm: this.handleConfirmPlacement.bind(this),
        onOpenSettings: () => {
          // @ts-ignore — private API but stable
          this.app.setting.open();
          // @ts-ignore
          this.app.setting.openTabById(this.plugin.manifest.id);
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------

  private async handleMove(task: TaskRecord, targetBucketId: string | null) {
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
      new Notice(`GTD Tasks: Move failed — ${result.error}`);
      // Trigger re-index so the UI reflects actual file state
      await this.plugin.taskIndex.reindexFile(task.filePath);
    }
    // On success, the vault modify event triggers re-index → refresh automatically
  }

  private async handleToggle(task: TaskRecord) {
    const result = await toggleTaskCompletion(
      this.app,
      task,
      this.plugin.settings
    );

    if (!result.success) {
      new Notice(`GTD Tasks: Toggle failed — ${result.error}`);
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
      new Notice(`GTD Tasks: Confirm failed — ${result.error}`);
      await this.plugin.taskIndex.reindexFile(task.filePath);
    }
  }

  private handleNavigate(task: TaskRecord) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;

    this.app.workspace.getLeaf(false).openFile(file, {
      eState: { line: task.lineNumber },
    });
  }
}
