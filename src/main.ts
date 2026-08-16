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

import { PluginSettings, DEFAULT_SETTINGS, DEFAULT_BUCKETS, getActiveScope, isPathInScope, migrateSettingsData, normalizeSettingsShapes, shouldAdoptCatchAll, shouldRecommendCatchAll } from "./settings";
import { GtdSettingsTab } from "./settings-tab";
import { TaskIndex } from "./core/TaskIndex";
import { groupTasksIntoBuckets, TO_REVIEW_ID } from "./core/BucketManager";
import type { BucketGroup as BucketGroupData } from "./core/BucketManager";
import { moveTaskToBucket, toggleTaskCompletion } from "./core/TaskWriter";
import type { TaskRecord } from "./core/TaskParser";
import { computeOrderKeys, mapToOrderEntries, purgeOrderEntry } from "./core/TaskOrder";
import { diffFileTasks, applyTaskDiff, renameFileInState, migrateOrderFormat } from "./core/OrderMigration";
import type { OrderState } from "./core/OrderMigration";
import { purgeAgedEntries, reconcileDanglingEntries } from "./core/OrderPurge";
import { dayKey, msUntilNextMidnight } from "./core/DueStatus";
import GTDPanel from "./views/GTDPanel.svelte";
import { t } from "./i18n/i18n";
import { BucketLocalizer } from "./core/BucketLocalizer";
import { celebrationImages } from "./assets/celebrationImages";

const VIEW_TYPE_GTD = "gtd-tasks-panel";

export default class GtdTasksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  taskIndex!: TaskIndex;
  languageChangeNotice = false;
  private statusBarItem?: HTMLElement;
  /** Set when an event handler has changed order state that isn't saved yet. */
  private orderStateDirty = false;
  /** False until startup reconciliation has run against a complete vault view. */
  private orderStateReady = false;
  /** Calendar day the last renderAll() was computed for. */
  private lastRenderedDay = "";
  private midnightTimer?: number;

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

    // The panel is this plugin's whole UI, and nothing else reopens it: the
    // one-time auto-open never fires again after the first install, and the
    // status bar entry only exists if a bucket opted into it. Without this the
    // command palette is the sole way back to a closed panel.
    this.addRibbonIcon("check-square", t("ribbon.openPanel"), () => {
      void this.activateView();
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

    this.taskIndex.onFileReplaced((filePath, oldTasks, newTasks) => {
      const diff = diffFileTasks(oldTasks, newTasks);
      const applied = applyTaskDiff(this.orderState(), filePath, diff, Date.now());
      if (applied.changed) {
        this.applyOrderState(applied.state);
        this.orderStateDirty = true;
      }
    });

    // Fires before TaskIndex scope-checks the new path, so updating a
    // "specific files" scope list here keeps the file indexed across a rename.
    this.taskIndex.onRename((oldPath, newPath) => {
      const renamed = renameFileInState(this.orderState(), oldPath, newPath);
      if (renamed.changed) {
        this.applyOrderState(renamed.state);
        this.orderStateDirty = true;
      }
      const idx = this.settings.filePaths.indexOf(oldPath);
      if (idx !== -1) {
        this.settings.filePaths[idx] = newPath;
        this.orderStateDirty = true;
      }
    });

    this.taskIndex.onChange(() => {
      void this.handleIndexChanged();
    });

    this.app.workspace.onLayoutReady(async () => {
      await this.taskIndex.initialScan();
      await this.reconcileOrderState();

      // Deliberately does NOT open the panel on every load. Obsidian restores a
      // leaf that was left open by rebuilding its view once registerView makes
      // the type available again — but it does that ASYNCHRONOUSLY, a beat
      // after onload. Opening the panel here used to race that restore:
      // getLeavesOfType() still reported zero while the rebuild was pending, so
      // the "no panel exists" branch fired and created a SECOND one, every
      // reload and every plugin update. Only a genuinely fresh install has
      // nothing to restore, and that is the one case handled here.
      if (!this.settings.panelOpenedOnce) {
        this.settings.panelOpenedOnce = true;
        await this.saveSettings();
        await this.activateView();
      }

      this.updateStatusBar();
    });

    this.armMidnightTimer();

    // Focus is the event that means "the user came back", and it is the only
    // reliable signal after a system suspend: Chromium measures a setTimeout
    // delay on a clock that generally does not advance while the machine
    // sleeps, so a timer armed before the lid closed can fire hours late.
    // Re-arming from wall-clock time here discards that drift.
    this.registerDomEvent(window, "focus", () => {
      this.maybeRolloverDay();
      this.armMidnightTimer();
    });
  }

  onunload() {
    if (this.midnightTimer !== undefined) window.clearTimeout(this.midnightTimer);
  }

  async loadSettings() {
    const raw: unknown = await this.loadData();
    const migrated = migrateSettingsData(raw);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
    // An install that already has a data.json has had its panel opened long
    // ago; treating it as fresh would fire the one-time auto-open exactly once
    // more, which is the duplicate-panel race this flag exists to avoid.
    if (migrated.panelOpenedOnce === undefined) {
      this.settings.panelOpenedOnce = raw != null;
    }
    if (!this.settings.buckets || this.settings.buckets.length === 0) {
      this.settings.buckets = DEFAULT_BUCKETS.map((b) => ({ ...b }));
    }
    // Trust boundary for raw data.json: guarantees taskOrder/completionSeen/
    // folderPaths/filePaths hold the shapes every downstream consumer
    // assumes, even if the file was hand-edited or corrupted.
    this.settings = normalizeSettingsShapes(this.settings);
    // Always start a session with no witnessed completions, discarding any
    // records an older build persisted — nothing completed before this run
    // should be on screen.
    this.settings.completionSeen = {};
    // Untouched date rules get the catch-all silently; a customised config is
    // left alone and shown a recommendation instead.
    if (shouldAdoptCatchAll(this.settings.buckets)) {
      this.settings.buckets[this.settings.buckets.length - 1].dateRangeRule = { type: "catch-all" };
    }
    // Settled once, after the silent adoption above, so only a config we
    // genuinely left alone stays unseen.
    if (migrated.catchAllNoticeSeen === undefined) {
      this.settings.catchAllNoticeSeen = !shouldRecommendCatchAll(this.settings.buckets);
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
    // completionSeen is session state, not user data: it records completions
    // this run watched happen, so that a task the user just ticked doesn't
    // vanish under them. Writing it would resurrect completed tasks after a
    // reload, which is exactly what we don't want.
    const { completionSeen: _sessionOnly, ...persisted } = this.settings;
    await this.saveData(persisted);
    this.renderAll();
  }

  /**
   * One grouping pass, shared by the panel and the status bar. They always
   * redraw together, and grouping is by far the most expensive per-change
   * work (it walks every indexed task and computes an order key for each),
   * so computing it twice doubled the cost of every vault edit.
   */
  private renderAll(): void {
    this.lastRenderedDay = dayKey(new Date());
    const bucketGroups = groupTasksIntoBuckets(this.taskIndex.getAllTasks(), this.settings);
    // Every panel gets the update, not a single remembered one. Holding one
    // reference meant any second panel — whether the user opened it or Obsidian
    // restored it — was frozen forever at whatever mountSvelte seeded it with.
    for (const view of this.panelViews()) view.setBucketGroups(bucketGroups);
    this.renderStatusBar(bucketGroups);
  }

  /** (Re)arms the rollover timer, replacing any previously armed one. */
  private armMidnightTimer(): void {
    if (this.midnightTimer !== undefined) window.clearTimeout(this.midnightTimer);
    this.midnightTimer = window.setTimeout(() => {
      this.maybeRolloverDay();
      this.armMidnightTimer();
    }, msUntilNextMidnight(new Date()));
  }

  /** Re-renders only when the calendar day actually changed, so the frequent
   *  focus events cost one string comparison each. */
  private maybeRolloverDay(): void {
    if (dayKey(new Date()) === this.lastRenderedDay) return;
    this.renderAll();
  }

  /** Every live panel view belonging to this plugin instance. */
  private panelViews(): GtdPanelView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_GTD)
      .map((leaf) => leaf.view)
      .filter((view): view is GtdPanelView => view instanceof GtdPanelView);
  }

  private updateStatusBar(): void {
    this.renderStatusBar(groupTasksIntoBuckets(this.taskIndex.getAllTasks(), this.settings));
  }

  private renderStatusBar(bucketGroups: BucketGroupData[]): void {
    if (!this.statusBarItem) return;
    this.statusBarItem.empty();

    for (const group of bucketGroups) {
      const showInBar = group.isSystem
        ? this.settings.toReviewShowInStatusBar
        : (this.settings.buckets.find((b) => b.id === group.bucketId)?.showInStatusBar ?? false);
      if (!showInBar) continue;

      const active = group.tasks.filter((t) => !t.isCompleted).length;
      let total = active;
      if (this.settings.completedVisibilityUntilMidnight) {
        const aged = new Set(group.agedCompletedTaskIds);
        total = active + group.tasks.filter((t) => t.isCompleted && !aged.has(t.id)).length;
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

  private orderState(): OrderState {
    return {
      taskOrder: this.settings.taskOrder,
      completionSeen: this.settings.completionSeen,
    };
  }

  private applyOrderState(state: OrderState): void {
    this.settings.taskOrder = state.taskOrder;
    this.settings.completionSeen = state.completionSeen;
  }

  /**
   * Per-index-change housekeeping. The aged-out purge rides on work that
   * already happens on every refresh, so nothing needs a timer. It stays off
   * until reconcileOrderState() has run: purging against a partially-scanned
   * vault would discard positions for files that simply hadn't loaded yet.
   */
  private async handleIndexChanged(): Promise<void> {
    if (this.orderStateReady) {
      const purged = purgeAgedEntries(this.orderState(), this.taskIndex.getAllTasks(), new Date());
      if (purged.changed) {
        this.applyOrderState(purged.state);
        this.orderStateDirty = true;
      }
    }

    if (this.orderStateDirty) {
      this.orderStateDirty = false;
      await this.saveSettings();
      return;
    }

    this.renderAll();
  }

  /**
   * One-time startup pass, run only after initialScan resolves so the vault
   * view is complete: upgrades pre-0.2 flat keys to structured entries, drops
   * entries whose task is genuinely gone (keeping out-of-scope ones dormant),
   * and runs the first aged-out purge.
   */
  private async reconcileOrderState(): Promise<void> {
    const tasks = this.taskIndex.getAllTasks();
    const scope = getActiveScope(this.settings);

    const migrated = migrateOrderFormat(this.settings.taskOrder, tasks);
    const reconciled = reconcileDanglingEntries(
      { taskOrder: migrated.taskOrder, completionSeen: this.settings.completionSeen },
      tasks,
      (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      (path) => isPathInScope(path, scope)
    );
    const purged = purgeAgedEntries(reconciled.state, tasks, new Date());

    this.applyOrderState(purged.state);
    this.orderStateReady = true;

    if (migrated.changed || reconciled.changed || purged.changed || this.orderStateDirty) {
      this.orderStateDirty = false;
      await this.saveSettings();
    } else {
      this.renderAll();
    }
  }

  private async activateView(bucketId?: string) {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(VIEW_TYPE_GTD)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_GTD, active: true });
    }

    await workspace.revealLeaf(leaf);

    // Read the view AFTER revealLeaf: revealing can rebuild a leaf's view, so a
    // reference captured earlier can already be a discarded instance.
    if (bucketId && leaf.view instanceof GtdPanelView) {
      leaf.view.scrollToBucket(bucketId);
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

  /** Renders groups the caller already computed, so grouping runs once per change. */
  setBucketGroups(bucketGroups: BucketGroupData[]) {
    if (!this.svelteInstance) return;
    this.bucketGroups$.set(bucketGroups);
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
        onReorder: this.handleReorder.bind(this),
        onOpenSettings: openSettings,
        // Only an explicit dismiss sets this. Opening settings settles nothing;
        // actually fixing the rule hides the banner on its own.
        onDismissCatchAllNotice: async () => {
          this.plugin.settings.catchAllNoticeSeen = true;
          await this.plugin.saveSettings();
        },
        onDismissLanguageBanner: () => {
          this.plugin.languageChangeNotice = false;
          this.languageChangeNotice$.set(false);
        },
      },
    });
  }

  private async handleReorder(bucketId: string, orderedTaskIds: string[]) {
    const orderEntries = computeOrderKeys(this.plugin.taskIndex.getAllTasks());
    this.plugin.settings.taskOrder[bucketId] = mapToOrderEntries(orderedTaskIds, orderEntries);
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

    const orderEntries = computeOrderKeys(this.plugin.taskIndex.getAllTasks());
    const entry = orderEntries.get(task.id);
    if (entry) {
      const purged = purgeOrderEntry(this.plugin.settings.taskOrder, entry);
      this.plugin.settings.taskOrder = purged.taskOrder;
    }

    if (orderedTaskIds) {
      const targetId = targetBucketId ?? TO_REVIEW_ID;
      this.plugin.settings.taskOrder[targetId] = mapToOrderEntries(orderedTaskIds, orderEntries);
    }

    // Always refresh once here, now that the index and taskOrder are both
    // settled — the moved task's bucket assignment changed regardless of
    // whether taskOrder itself did, so the panel always needs to redraw.
    await this.plugin.saveSettings();
  }

  private async handleToggle(task: TaskRecord) {
    const result = await toggleTaskCompletion(this.app, task);

    if (!result.success) {
      new Notice(t("notices.toggleFailed", { error: result.error }));
    }

    // Catch the index up on our OWN write rather than waiting for Obsidian's
    // async metadataCache event, the way handleMove already does. That event
    // can coalesce away, and the panel would then keep handing back a record
    // whose rawLine no longer exists in the file — every later toggle on it
    // fails to locate its line. Reindexing here also re-runs the diff, so a
    // dateless completion still gets its completionSeen record.
    await this.plugin.taskIndex.reindexFile(task.filePath);
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
