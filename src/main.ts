import {
  Plugin,
  Editor,
  EditorPosition,
  WorkspaceLeaf,
  ItemView,
  Notice,
  TFile,
  App,
  getLanguage,
  getLinkpath,
} from "obsidian";
import { mount, unmount } from "svelte";
import { writable, type Writable } from "svelte/store";

import { PluginSettings, DEFAULT_SETTINGS, DEFAULT_BUCKETS, activeOrderKeyScheme, getActiveScope, getTaskFilter, isPathInScope, migrateSettingsData, normalizeSettingsShapes, shouldAdoptCatchAll, shouldRecommendCatchAll } from "./settings";
import { GtdSettingsTab } from "./settings-tab";
import { TaskIndex } from "./core/TaskIndex";
import { groupTasksIntoBuckets, TO_REVIEW_ID } from "./core/BucketManager";
import type { BucketGroup as BucketGroupData } from "./core/BucketManager";
import { editedLines, getTaskEditor, getTasksApi, hasSettableStatus, moveTaskToBucket, replaceTaskLine, setDateLine, setStatusLine, setTaskStatus, toggleTaskCompletion, toggleTaskLine } from "./core/TaskWriter";
import type { ReplaceResult, SettableStatus, TasksPluginApiV1 } from "./core/TaskWriter";
import type { DateField } from "./core/DateMenu";
import { pickWithKalendae } from "./views/KalendaeModal";
import { CLOSED_SYMBOLS, parseFile, statusSymbol } from "./core/TaskParser";
import type { TaskRecord } from "./core/TaskParser";
import { computeOrderKeys, mapToOrderEntries, purgeOrderEntry } from "./core/TaskOrder";
import {
  diffFileTasks,
  diffForEdit,
  applyTaskDiff,
  dismissCompletions,
  renameFileInState,
  migrateOrderFormat,
  migrateOrderKeys,
} from "./core/OrderMigration";
import type { OrderState, TaskDiff } from "./core/OrderMigration";
import type { Conflict } from "./core/plan/Plan";
import { purgeAgedEntries, reconcileDanglingEntries } from "./core/OrderPurge";
import { dayKey, msUntilNextMidnight } from "./core/DueStatus";
import GTDPanel from "./views/GTDPanel.svelte";
import { ConfirmModal } from "./views/ConfirmModal";
import { t } from "./i18n/i18n";
import { BucketLocalizer } from "./core/BucketLocalizer";
import { celebrationImages } from "./assets/celebrationImages";
import { lineFlashField } from "./views/lineFlash";
import { revealTaskLine } from "./views/revealTaskLine";
import { CompletionReportModal } from "./views/CompletionReportModal";
import { WhatsNewModal } from "./views/WhatsNewModal";
import { PANEL_NOTICES, seedLastNoticeSeen, settleUnknownNotice } from "./core/PanelNotices";
import { PlanSession } from "./PlanSession";
import { PlanIntroModal } from "./views/PlanIntroModal";

const VIEW_TYPE_GTD = "gtd-tasks-panel";

/** The line numbers under every cursor and selection, each once. */
function selectedLines(editor: Editor): number[] {
  const lines = new Set<number>();
  for (const { anchor, head } of editor.listSelections()) {
    for (let line = Math.min(anchor.line, head.line); line <= Math.max(anchor.line, head.line); line++) {
      lines.add(line);
    }
  }
  return [...lines];
}

export default class GtdTasksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  taskIndex!: TaskIndex;
  planSession!: PlanSession;
  private settingsTab?: GtdSettingsTab;
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

    this.taskIndex = new TaskIndex(
      this.app,
      this,
      () => getActiveScope(this.settings),
      () => getTaskFilter(this.settings)
    );

    this.planSession = new PlanSession(this);

    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass("gtd-status-bar-item");
    this.settingsTab = new GtdSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.registerView(VIEW_TYPE_GTD, (leaf) => new GtdPanelView(leaf, this));
    this.registerEditorExtension(lineFlashField);

    this.addCommand({
      id: "open-gtd-panel",
      name: t("commands.openPanel"),
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "enter-plan-mode",
      name: t("commands.enterPlanMode"),
      checkCallback: (checking) => {
        if (this.planSession.active) return false;
        if (!checking) void this.enterPlanMode();
        return true;
      },
    });

    this.addCommand({
      id: "review-completed-tasks",
      name: t("commands.reviewCompleted"),
      callback: () => new CompletionReportModal(this).open(),
    });

    this.addCommand({
      id: "show-whats-new",
      name: t("whatsNew.title"),
      callback: () => this.openWhatsNew(),
    });

    // Fill the gap Obsidian's own "Toggle checkbox status" leaves: it only
    // knows [ ] and [x], and never calls Tasks. Each one sets its status, or
    // clears it on a repeat; the done toggle is Tasks' own, as in the panel.
    type LineChange = (line: string, path: string, api: TasksPluginApiV1 | null) => string[];
    const toStatus = (symbol: SettableStatus): LineChange => (line, path, api) => setStatusLine(line, path, symbol, api);
    const statusCommands: [string, string, LineChange][] = [
      ["toggle-done", t("commands.toggleDone"), (line, path, api) =>
        toggleTaskLine(line, path, CLOSED_SYMBOLS.includes(statusSymbol(line)), api)],
      ["toggle-in-progress", t("commands.toggleInProgress"), toStatus("/")],
      ["toggle-cancelled", t("commands.toggleCancelled"), toStatus("-")],
    ];
    for (const [id, name, change] of statusCommands) {
      this.addCommand({
        id,
        name,
        editorCheckCallback: (checking, editor, ctx) => {
          const lines = selectedLines(editor).filter((line) => hasSettableStatus(editor.getLine(line)));
          if (checking) return lines.length > 0;
          const api = getTasksApi(this.app);
          const path = ctx.file?.path ?? "";
          const after = new Map(
            lines.map((line) => [line, change(editor.getLine(line), path, api).join("\n")])
          );
          // Tasks may also drop a date from the end of the line, so the caret
          // is put back where it was rather than left to the replaced text.
          const clamp = ({ line, ch }: EditorPosition) => ({
            line,
            ch: Math.min(ch, (after.get(line) ?? editor.getLine(line)).length),
          });
          editor.transaction({
            changes: lines.map((line) => ({
              from: { line, ch: 0 },
              to: { line, ch: editor.getLine(line).length },
              text: after.get(line) ?? "",
            })),
            selections: editor.listSelections().map(({ anchor, head }) => ({ from: clamp(anchor), to: clamp(head) })),
          });
        },
      });
    }

    // The panel is this plugin's whole UI, and nothing else reopens it: the
    // one-time auto-open never fires again after the first install, and the
    // status bar entry only exists if a bucket opted into it. Without this the
    // command palette is the sole way back to a closed panel.
    this.addRibbonIcon("check-square", t("ribbon.openPanel"), () => {
      void this.activateView();
    });
    // Named like the command palette names it, so the trophy says whose it is.
    this.addRibbonIcon("trophy", `${t("panel.title")}: ${t("commands.reviewCompleted")}`, () =>
      new CompletionReportModal(this).open()
    );

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
      const diff = diffFileTasks(oldTasks, newTasks, activeOrderKeyScheme(this.settings));
      const applied = applyTaskDiff(this.orderState(), filePath, diff, Date.now());
      if (applied.changed) {
        this.applyOrderState(applied.state);
        this.orderStateDirty = true;
      }
      this.planSession.onFileReplaced(filePath, oldTasks, newTasks);
    });

    // Fires before TaskIndex scope-checks the new path, so updating a
    // "specific files" scope list here keeps the file indexed across a rename.
    this.taskIndex.onRename((oldPath, newPath) => {
      const renamed = renameFileInState(this.orderState(), oldPath, newPath);
      if (renamed.changed) {
        this.applyOrderState(renamed.state);
        this.orderStateDirty = true;
      }
      this.planSession.onRename(oldPath, newPath);
      // Obsidian fires this once per markdown file, so only file entries can be
      // repaired here: renaming a folder arrives as one event per child and
      // never carries the folder's own old path.
      for (const list of [this.settings.scopePaths, this.settings.ignoredPaths]) {
        for (const entry of list) {
          if (entry.type === "file" && entry.path === oldPath) {
            entry.path = newPath;
            this.orderStateDirty = true;
          }
        }
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
    this.planSession.unload();
  }

  openWhatsNew() {
    new WhatsNewModal(this.app).open();
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
    // scopePaths/ignoredPaths hold the shapes every downstream consumer
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
    // A fresh install has the week-start dropdown sitting in settings from the
    // start, so there is nothing to announce; only an existing install, whose
    // weeks were hardcoded to Monday until now, gets the notice.
    if (migrated.weekStartNoticeSeen === undefined) {
      this.settings.weekStartNoticeSeen = raw == null;
    }
    if (migrated.lastNoticeSeen === undefined) {
      this.settings.lastNoticeSeen = seedLastNoticeSeen(raw == null, PANEL_NOTICES);
    }
    this.settings.lastNoticeSeen = settleUnknownNotice(this.settings.lastNoticeSeen, PANEL_NOTICES);
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
    this.rekeyOrderForPlanBy();
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
  renderAll(): void {
    this.lastRenderedDay = dayKey(new Date());
    // In plan mode the panels show the plan; the status bar always counts real tasks.
    const { panel, real } = this.planSession.render(this.taskIndex.getAllTasks());
    // Every panel gets the update, not a single remembered one. Holding one
    // reference meant any second panel — whether the user opened it or Obsidian
    // restored it — was frozen forever at whatever mountSvelte seeded it with.
    for (const view of this.panelViews()) view.setBucketGroups(panel);
    this.renderStatusBar(real);
  }

  /** What a newly mounted panel shows first. */
  panelGroups(): BucketGroupData[] {
    return this.planSession.render(this.taskIndex.getAllTasks()).panel;
  }

  /** Redraws the settings tab when it is open, so the plan mode lock follows the session. */
  refreshSettingsTab(): void {
    if (this.settingsTab?.containerEl.isConnected) this.settingsTab.rerender();
  }

  /** Opens the panel and starts a plan. */
  async enterPlanMode(): Promise<void> {
    await this.activateView();
    if (this.settings.planIntroSeen) {
      this.planSession.enter();
      return;
    }
    new PlanIntroModal(this.app, "enter", (dontShowAgain) => {
      this.planSession.enter();
      if (dontShowAgain) {
        this.settings.planIntroSeen = true;
        void this.saveSettings();
      }
    }).open();
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
  panelViews(): GtdPanelView[] {
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

  /**
   * The planning date is part of every order key, so switching planBy would
   * otherwise strand every saved position at once. Gated on orderStateReady
   * for the same reason the startup migrations are — mapping keys against a
   * half-scanned vault would drop positions for files that hadn't loaded.
   * A flip made before then is picked up by reconcileOrderState instead,
   * since orderKeyScheme is persisted.
   */
  private rekeyOrderForPlanBy(): void {
    if (!this.orderStateReady) return;
    const stored = activeOrderKeyScheme(this.settings);
    if (stored === this.settings.planBy) return;

    const rekeyed = migrateOrderKeys(
      this.orderState(),
      this.taskIndex.getAllTasks(),
      stored,
      this.settings.planBy
    );
    this.applyOrderState(rekeyed.state);
    this.settings.orderKeyScheme = this.settings.planBy;
  }

  /**
   * The order-key diff is built here, where it's known which line became
   * which, and applied before the reindex runs its own heuristic diff. That
   * one then finds the old key already gone and changes nothing.
   */
  async settleLineWrite(task: TaskRecord, result: ReplaceResult, lineCount: number, failNotice: string): Promise<boolean> {
    if (!result.success || result.lineIdx === undefined || result.before === undefined || result.after === undefined) {
      new Notice(t(failNotice, { error: result.error }));
      await this.taskIndex.reindexFile(task.filePath);
      return false;
    }

    const diff = diffForEdit(
      parseFile(task.filePath, result.before, getTaskFilter(this.settings)),
      parseFile(task.filePath, result.after, getTaskFilter(this.settings)),
      result.lineIdx,
      lineCount,
      activeOrderKeyScheme(this.settings)
    );
    this.recordTaskDiff(task.filePath, diff);
    await this.taskIndex.reindexFile(task.filePath);
    return true;
  }

  /** Folds in a diff the caller built itself; saved by the next index change. */
  recordTaskDiff(filePath: string, diff: TaskDiff): void {
    const applied = applyTaskDiff(this.orderState(), filePath, diff, Date.now());
    if (applied.changed) {
      this.applyOrderState(applied.state);
      this.orderStateDirty = true;
    }
  }

  /** Hides these completed tasks for the rest of the session. */
  dismissCompleted(tasks: TaskRecord[]): void {
    const orderKeys = computeOrderKeys(this.taskIndex.getAllTasks(), activeOrderKeyScheme(this.settings));
    const entries = tasks.flatMap((task) => orderKeys.get(task.id) ?? []);
    const dismissed = dismissCompletions(this.orderState(), entries);
    if (!dismissed.changed) return;
    this.applyOrderState(dismissed.state);
    this.renderAll();
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
      const purged = purgeAgedEntries(
        this.orderState(),
        this.taskIndex.getAllTasks(),
        new Date(),
        activeOrderKeyScheme(this.settings)
      );
      if (purged.changed) {
        this.applyOrderState(purged.state);
        this.orderStateDirty = true;
        const tasks = this.taskIndex.getAllTasks();
        const now = new Date();
        const scheme = activeOrderKeyScheme(this.settings);
        const completionSeen = this.settings.completionSeen;
        this.planSession.onPurge(
          (taskOrder) => purgeAgedEntries({ taskOrder, completionSeen }, tasks, now, scheme).state.taskOrder
        );
      }
    }
    this.planSession.onIndexChanged(this.taskIndex.getAllTasks());

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

    const stored = activeOrderKeyScheme(this.settings);
    const migrated = migrateOrderFormat(this.settings.taskOrder, tasks, stored);
    const rekeyed = migrateOrderKeys(
      { taskOrder: migrated.taskOrder, completionSeen: this.settings.completionSeen },
      tasks,
      stored,
      this.settings.planBy
    );
    this.settings.orderKeyScheme = this.settings.planBy;
    const reconciled = reconcileDanglingEntries(
      rekeyed.state,
      tasks,
      (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      (path) => isPathInScope(path, scope),
      this.settings.planBy
    );
    const purged = purgeAgedEntries(reconciled.state, tasks, new Date(), this.settings.planBy);

    this.applyOrderState(purged.state);
    this.orderStateReady = true;

    if (
      stored !== this.settings.planBy ||
      migrated.changed ||
      rekeyed.changed ||
      reconciled.changed ||
      purged.changed ||
      this.orderStateDirty
    ) {
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
    // The plan lives as long as a panel shows it.
    if (this.plugin.panelViews().every((view) => view === this)) this.plugin.planSession.panelClosed();
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
    this.bucketGroups$.set(this.plugin.panelGroups());
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
        plan$: this.plugin.planSession.state$,
        onRevert: (task: TaskRecord, what: "bucket" | "date") => this.plugin.planSession.revert(task, what),
        onUndo: () => this.plugin.planSession.undo(),
        onRedo: () => this.plugin.planSession.redo(),
        onApply: () => void this.plugin.planSession.apply(),
        onDiscard: () => {
          const session = this.plugin.planSession;
          if (session.changeCount === 0) session.discard();
          else new ConfirmModal(this.app, t("plan.discard.message"), t("plan.discard.confirm"), () => session.discard()).open();
        },
        onAnswerConflict: (conflict: Conflict, choice: "note" | "plan") => this.plugin.planSession.answer(conflict, choice),
        onToggleDropMode: async () => {
          const settings = this.plugin.settings;
          settings.dropIntoBucket = settings.dropIntoBucket === "pin" ? "ask" : "pin";
          await this.plugin.saveSettings();
        },
        onOpenPlanIntro: () => new PlanIntroModal(this.app, "info").open(),
        onAnimationDone: () => this.plugin.planSession.animationDone(),
        onBatch: (run: () => Promise<void>) => this.plugin.planSession.batch(run),
        onMove: this.handleMove.bind(this),
        onToggle: this.handleToggle.bind(this),
        onNavigate: this.handleNavigate.bind(this),
        onOpenLink: this.handleOpenLink.bind(this),
        canEditTask: () => getTaskEditor(this.app) !== null,
        onEdit: this.handleEdit.bind(this),
        onSetStatus: this.handleSetStatus.bind(this),
        onSetDate: this.handleSetDate.bind(this),
        onDropDate: this.handleDropDate.bind(this),
        pickDay: pickWithKalendae(this.app),
        onReorder: this.handleReorder.bind(this),
        onDismiss: (tasks: TaskRecord[]) => this.plugin.dismissCompleted(tasks),
        onOpenSettings: openSettings,
        onEnterPlanMode: () => void this.plugin.enterPlanMode(),
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
        onDismissWeekStartNotice: async () => {
          this.plugin.settings.weekStartNoticeSeen = true;
          await this.plugin.saveSettings();
        },
        onDismissNotice: async (id: string) => {
          this.plugin.settings.lastNoticeSeen = id;
          await this.plugin.saveSettings();
        },
        onOpenChangelog: () => this.plugin.openWhatsNew(),
      },
    });
  }

  /** The indexed record behind a row: in plan mode a row carries its planned line, not the note's. */
  private realTask(task: TaskRecord): TaskRecord {
    return this.plugin.taskIndex.getAllTasks().find((t) => t.id === task.id) ?? task;
  }

  private async handleReorder(bucketId: string, orderedTaskIds: string[]) {
    if (this.plugin.planSession.active) return this.plugin.planSession.reorder(bucketId, orderedTaskIds);
    const orderEntries = computeOrderKeys(
      this.plugin.taskIndex.getAllTasks(),
      activeOrderKeyScheme(this.plugin.settings)
    );
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
    if (this.plugin.planSession.active) return this.plugin.planSession.move(task, targetBucketId, orderedTaskIds);
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

    const orderEntries = computeOrderKeys(
      this.plugin.taskIndex.getAllTasks(),
      activeOrderKeyScheme(this.plugin.settings)
    );
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

  /**
   * A drop that gives the task a date from the target bucket's range. Unpins in
   * the same write, since a pin would override the date, then settles the index
   * and the drop position before the one refresh, as handleMove does.
   */
  async handleDropDate(
    task: TaskRecord,
    field: DateField,
    date: string,
    targetBucketId: string,
    orderedTaskIds: string[] | null
  ) {
    if (this.plugin.planSession.active) {
      return this.plugin.planSession.dropDate(task, field, date, targetBucketId, orderedTaskIds);
    }
    const settings = this.plugin.settings;
    const result = await replaceTaskLine(this.app, task, (line) => [setDateLine(line, field, date, true, settings)]);
    if (!result.success || result.lineIdx === undefined || result.before === undefined || result.after === undefined) {
      new Notice(t("notices.dateFailed", { error: result.error }));
      await this.plugin.taskIndex.reindexFile(task.filePath);
      return;
    }

    const diff = diffForEdit(
      parseFile(task.filePath, result.before, getTaskFilter(settings)),
      parseFile(task.filePath, result.after, getTaskFilter(settings)),
      result.lineIdx,
      1,
      activeOrderKeyScheme(settings)
    );
    this.plugin.recordTaskDiff(task.filePath, diff);
    await this.plugin.taskIndex.reindexFileSilently(task.filePath);

    const orderEntries = computeOrderKeys(this.plugin.taskIndex.getAllTasks(), activeOrderKeyScheme(settings));
    const entry = orderEntries.get(task.id);
    if (entry) settings.taskOrder = purgeOrderEntry(settings.taskOrder, entry).taskOrder;
    if (orderedTaskIds) settings.taskOrder[targetBucketId] = mapToOrderEntries(orderedTaskIds, orderEntries);

    await this.plugin.saveSettings();
  }

  private async handleToggle(row: TaskRecord) {
    const task = this.realTask(row);
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

  private async handleSetStatus(row: TaskRecord, symbol: SettableStatus) {
    const task = this.realTask(row);
    const result = await setTaskStatus(this.app, task, symbol);

    if (!result.success) {
      new Notice(t("notices.statusFailed", { error: result.error }));
    }

    // Same as handleToggle: catch the index up on our own write.
    await this.plugin.taskIndex.reindexFile(task.filePath);
  }

  /**
   * Tasks' modal may never settle its promise (see editTaskLineModal), so
   * nothing may wait on it: the write-back lives in .then(), and Cancel is a
   * no-op whether it settles with an empty string or not at all.
   */
  private handleEdit(task: TaskRecord) {
    const edit = getTaskEditor(this.app);
    if (!edit) return;

    const session = this.plugin.planSession;
    if (session.active) {
      edit(session.lineForEdit(task)).then(
        (edited) => session.edit(task, edited),
        (e: unknown) => new Notice(t("notices.editFailed", { error: String(e) }))
      );
      return;
    }

    edit(task.rawLine).then(
      async (edited) => {
        const lines = editedLines(edited, task.rawLine);
        if (!lines) return;
        const result = await replaceTaskLine(this.app, task, () => lines);
        await this.plugin.settleLineWrite(task, result, lines.length, "notices.editFailed");
      },
      (e: unknown) => new Notice(t("notices.editFailed", { error: String(e) }))
    );
  }

  /** Writes a date picked from the row's menu, unpinning in the same write when asked. */
  private async handleSetDate(task: TaskRecord, field: DateField, date: string, unpin: boolean) {
    if (this.plugin.planSession.active) return this.plugin.planSession.setDate(task, field, date, unpin);
    const result = await replaceTaskLine(this.app, task, (line) => [
      setDateLine(line, field, date, unpin, this.plugin.settings),
    ]);
    await this.plugin.settleLineWrite(task, result, 1, "notices.dateFailed");
  }

  scrollToBucket(bucketId: string) {
    const el = this.contentEl.querySelector<HTMLElement>(`.gtd-bucket[data-bucket-id="${bucketId}"]`);
    el?.scrollIntoView({ behavior: "instant", block: "start" });
  }

  private handleNavigate(task: TaskRecord) {
    void revealTaskLine(this.app, task);
  }

  private handleOpenLink(task: TaskRecord, target: string, external: boolean, newTab: boolean) {
    if (external) {
      window.open(target);
      return;
    }

    const open = () => void this.app.workspace.openLinkText(target, task.filePath, newTab);
    // Empty for a `#Heading` link into the task's own note, which always exists.
    const notePath = getLinkpath(target);
    if (notePath === "" || this.app.metadataCache.getFirstLinkpathDest(notePath, task.filePath)) {
      open();
      return;
    }

    // openLinkText creates a missing note without asking.
    new ConfirmModal(
      this.app,
      t("panel.createNote.message", { name: notePath }),
      t("panel.createNote.confirmButton"),
      open
    ).open();
  }

}
