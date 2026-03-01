import {
  Plugin,
  WorkspaceLeaf,
  ItemView,
  Notice,
  TFile,
  normalizePath,
  FileSystemAdapter,
  App,
} from "obsidian";
import { mount, unmount } from "svelte";
import { writable, type Writable } from "svelte/store";

import { PluginSettings, DEFAULT_SETTINGS, DEFAULT_BUCKETS } from "./settings";
import { GtdSettingsTab } from "./settings-tab";
import { TaskIndex } from "./core/TaskIndex";
import { groupTasksIntoBuckets } from "./core/BucketManager";
import type { BucketGroup as BucketGroupData } from "./core/BucketManager";
import { moveTaskToBucket, toggleTaskCompletion, confirmTaskPlacement } from "./core/TaskWriter";
import type { TaskRecord } from "./core/TaskParser";
import GTDPanel from "./views/GTDPanel.svelte";

const VIEW_TYPE_GTD = "gtd-tasks-panel";

export default class GtdTasksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  taskIndex!: TaskIndex;
  private panelView?: GtdPanelView;
  private statusBarItem?: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.taskIndex = new TaskIndex(this.app, this, () => this.settings.taskScope);

    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass("gtd-status-bar-item");
    this.addSettingTab(new GtdSettingsTab(this.app, this));

    this.registerView(VIEW_TYPE_GTD, (leaf) => new GtdPanelView(leaf, this));

    this.addCommand({
      id: "open-gtd-panel",
      name: "Open panel",
      callback: () => this.activateView(),
    });

    await this.taskIndex.initialScan();
    this.taskIndex.registerVaultEvents();

    this.taskIndex.onChange(() => {
      this.panelView?.refresh();
      this.updateStatusBar();
    });

    this.app.workspace.onLayoutReady(() => {
      void this.activateView();
      this.updateStatusBar();
    });
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<PluginSettings>);
    if (!this.settings.buckets || this.settings.buckets.length === 0) {
      this.settings.buckets = DEFAULT_BUCKETS.map((b) => ({ ...b }));
    }
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
      const span = this.statusBarItem.createEl("span", {
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

    if (!this.panelView || this.panelView.leaf !== leaf) {
      // If the panelView doesn't exist or is associated with a different leaf (e.g., re-opened in a new leaf)
      this.panelView = new GtdPanelView(leaf, this);
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
  private celebrationImageUrls$ = writable<string[]>([]);

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

  private loadCelebrationImageUrls(): string[] {
    const assetDir = normalizePath(this.plugin.manifest.dir + '/assets/celebration');
    const filenames = [
      'elephant.png', 'flamingo.png', 'iguana.png', 'penguin.png',
      'red panda.png', 'sloth.png', 'stork.png',
    ];
    try {
      return filenames.map((name) =>
        (this.app.vault.adapter as FileSystemAdapter).getResourcePath(normalizePath(assetDir + '/' + name))
      );
    } catch {
      return [];
    }
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("gtd-panel-root");
    this.mountSvelte();
    this.celebrationImageUrls$.set(this.loadCelebrationImageUrls());
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

    this.svelteInstance = mount(GTDPanel, {
      target: this.contentEl,
      props: {
        bucketGroups$: this.bucketGroups$,
        settings$: this.settings$,
        celebrationImageUrls$: this.celebrationImageUrls$,
        onMove: this.handleMove.bind(this) as (task: TaskRecord, targetBucketId: string | null) => Promise<void>,
        onToggle: this.handleToggle.bind(this) as (task: TaskRecord) => Promise<void>,
        onNavigate: this.handleNavigate.bind(this) as (task: TaskRecord) => void,
        onConfirm: this.handleConfirmPlacement.bind(this) as (task: TaskRecord, bucketId: string) => Promise<void>,
        onOpenSettings: () => {
          const appWithSetting = this.app as App & { setting: { open: () => void; openTabById: (id: string) => void; }; };
          appWithSetting.setting?.open();
          appWithSetting.setting?.openTabById(this.plugin.manifest.id);
        },
      },
    }) as unknown as Record<string, unknown>;
  }

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
      await this.plugin.taskIndex.reindexFile(task.filePath);
    }
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

  scrollToBucket(bucketId: string) {
    const el = this.contentEl.querySelector<HTMLElement>(`.gtd-bucket[data-bucket-id="${bucketId}"]`);
    el?.scrollIntoView({ behavior: "instant", block: "start" });
  }

  private handleNavigate(task: TaskRecord) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;

    void this.app.workspace.getLeaf(false).openFile(file, {
      eState: { line: task.lineNumber },
    });
  }
}
