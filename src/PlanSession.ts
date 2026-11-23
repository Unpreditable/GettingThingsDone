import { Notice, TFile } from "obsidian";
import { writable, type Writable } from "svelte/store";

import { activeOrderKeyScheme, getTaskFilter } from "./settings";
import { groupTasksIntoBuckets, TO_REVIEW_ID } from "./core/BucketManager";
import type { BucketGroup } from "./core/BucketManager";
import { parseFile } from "./core/TaskParser";
import type { TaskRecord } from "./core/TaskParser";
import { computeOrderKeys, entryId, mapToOrderEntries } from "./core/TaskOrder";
import type { OrderEntry } from "./core/TaskOrder";
import { editedLines, replaceTaskLine } from "./core/TaskWriter";
import type { DateField } from "./core/DateMenu";
import { t } from "./i18n/i18n";
import {
  answerConflict,
  canRevert,
  planStep,
  planSteps,
  redo as redoPlan,
  revert as revertPlan,
  startPlan,
  undo as undoPlan,
  undoBlocked,
} from "./core/plan/Plan";
import type { Conflict, Plan, PlannedChange, PlanStep } from "./core/plan/Plan";
import { readPlanFields, writePlanFields } from "./core/plan/PlanFields";
import { groupPlanned, plannedLine } from "./core/plan/PlanOverlay";
import { reconcilePlan, syncFileChange, syncPurge, syncRename } from "./core/plan/PlanSync";
import { computeIndicators } from "./core/plan/PlanIndicators";
import { conflictWording } from "./core/plan/ConflictWording";
import { planNotes } from "./core/plan/PlanNotes";
import type { ConflictWording } from "./core/plan/ConflictWording";
import type { PlanSummary } from "./core/plan/PlanIndicators";
import { applyLineEdits, buildFileEdits, remainingPlan, translateOrderState } from "./core/plan/PlanApply";
import type { WrittenFile } from "./core/plan/PlanApply";
import type GtdTasksPlugin from "./main";

export interface PlanViewState {
  phase: "off" | "planning" | "applying" | "applied";
  /** For peek. */
  realGroups: BucketGroup[];
  summary: PlanSummary;
  canUndo: boolean;
  undoBlocked: boolean;
  canRedo: boolean;
  /** Each open conflict, with its banner row's wording. */
  conflicts: { conflict: Conflict; wording: ConflictWording }[];
  /** Task id → which Revert items its menu shows. */
  revertable: Record<string, { bucket: boolean; date: boolean }>;
  /** Task id → its popover's lines about what the plan changed. */
  notes: Record<string, string[]>;
  /** For the success strip. */
  appliedCount: number;
}

const EMPTY_SUMMARY: PlanSummary = { indicators: {}, deltas: {}, count: 0 };

function offState(): PlanViewState {
  return {
    phase: "off",
    realGroups: [],
    summary: EMPTY_SUMMARY,
    canUndo: false,
    undoBlocked: false,
    canRedo: false,
    conflicts: [],
    revertable: {},
    notes: {},
    appliedCount: 0,
  };
}

/** Ends an applied session if no panel reports its animation finished. */
const ANIMATION_FALLBACK_MS = 2500;
/** Moving a panel to another window closes it before the new one opens: how long to wait for it. */
const PANEL_REOPEN_MS = 2000;

/**
 * The one plan of this vault, shared by every open panel. In memory only:
 * closing the last panel, reloading the plugin or restarting discards it.
 */
export class PlanSession {
  readonly state$: Writable<PlanViewState> = writable(offState());
  private phase: PlanViewState["phase"] = "off";
  private plan: Plan | null = null;
  /** Entry id → task text, from the last render, for naming tasks that are gone. */
  private texts = new Map<string, string>();
  private droppedNotice: Notice | null = null;
  private appliedCount = 0;
  private frozenSummary: PlanSummary = EMPTY_SUMMARY;
  private endTimer?: number;
  /** Steps collected by `batch`, applied as one undo step when it ends. */
  private pending: PlanStep[] | null = null;
  private closeTimer?: number;

  constructor(private plugin: GtdTasksPlugin) {}

  get active(): boolean {
    return this.phase !== "off";
  }

  get planning(): boolean {
    return this.phase === "planning";
  }

  /** How many changes the Apply button counts. */
  get changeCount(): number {
    return this.currentSummary().count;
  }

  private get settings() {
    return this.plugin.settings;
  }

  private orderKeys(): Map<string, OrderEntry> {
    return computeOrderKeys(this.plugin.taskIndex.getAllTasks(), activeOrderKeyScheme(this.settings));
  }

  private realTask(task: TaskRecord): TaskRecord | undefined {
    return this.plugin.taskIndex.getAllTasks().find((t) => t.id === task.id);
  }

  enter(): void {
    if (this.active) return;
    const keys = [...this.orderKeys().values()];
    this.plan = startPlan(this.settings.taskOrder, keys.map(entryId));
    this.phase = "planning";
    this.plugin.renderAll();
    this.plugin.refreshSettingsTab();
  }

  discard(): void {
    if (!this.active) return;
    this.end();
  }

  /** The last panel closed: discards the plan, unless a panel opens again soon. */
  panelClosed(): void {
    if (!this.active || this.closeTimer !== undefined) return;
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = undefined;
      if (!this.active || this.plugin.panelViews().length > 0) return;
      const planning = this.planning;
      this.end();
      if (planning) new Notice(t("plan.notice.discardedOnClose"));
    }, PANEL_REOPEN_MS);
  }

  unload(): void {
    if (this.closeTimer !== undefined) window.clearTimeout(this.closeTimer);
    if (this.endTimer !== undefined) window.clearTimeout(this.endTimer);
    this.droppedNotice?.hide();
  }

  private end(): void {
    if (this.endTimer !== undefined) window.clearTimeout(this.endTimer);
    this.endTimer = undefined;
    this.plan = null;
    this.phase = "off";
    this.appliedCount = 0;
    this.frozenSummary = EMPTY_SUMMARY;
    this.droppedNotice?.hide();
    this.droppedNotice = null;
    this.state$.set(offState());
    this.plugin.renderAll();
    this.plugin.refreshSettingsTab();
  }

  /** The panel's groups and the real ones (for the status bar), in one grouping pass each. */
  render(real: TaskRecord[]): { panel: BucketGroup[]; real: BucketGroup[] } {
    if (!this.plan || this.phase !== "planning") {
      const groups = groupTasksIntoBuckets(real, this.settings);
      if (this.phase === "applying" || this.phase === "applied") this.publish(groups, null);
      return { panel: groups, real: groups };
    }
    const { planned, realGroups, orderKeys } = groupPlanned(real, this.plan.current, this.settings);
    this.texts = new Map(real.flatMap((task) => {
      const entry = orderKeys.get(task.id);
      return entry ? [[entryId(entry), task.text] as [string, string]] : [];
    }));
    this.publish(realGroups, { planned, real, orderKeys });
    return { panel: planned, real: realGroups };
  }

  private publish(
    realGroups: BucketGroup[],
    planning: { planned: BucketGroup[]; real: TaskRecord[]; orderKeys: Map<string, OrderEntry> } | null
  ): void {
    const plan = this.plan;
    if (!planning || !plan) {
      this.state$.set({
        ...offState(),
        phase: this.phase,
        realGroups,
        summary: this.frozenSummary,
        appliedCount: this.appliedCount,
      });
      return;
    }
    const changed = new Set<string>();
    const revertable: PlanViewState["revertable"] = {};
    const byEntry = new Map<string, TaskRecord>();
    for (const task of planning.real) {
      const entry = planning.orderKeys.get(task.id);
      if (!entry) continue;
      const id = entryId(entry);
      byEntry.set(id, task);
      const change = plan.current.changes[id];
      if (!change) continue;
      if (plannedLine(task, change, this.settings) !== task.rawLine) changed.add(task.id);
      revertable[task.id] = canRevert(plan, id);
    }
    const summary = computeIndicators(realGroups, planning.planned, changed);
    const notes: PlanViewState["notes"] = {};
    for (const [id, task] of byEntry) {
      const change = plan.current.changes[id];
      const indicator = summary.indicators[task.id] ?? null;
      if (!change && !indicator) continue;
      const real = readPlanFields(task.rawLine, this.settings);
      const planned = change ? readPlanFields(plannedLine(task, change, this.settings), this.settings) : real;
      const lines = planNotes(indicator, real, planned, (bucketId) => this.bucketLabel(bucketId));
      if (lines.length > 0) notes[task.id] = lines;
    }
    this.state$.set({
      phase: this.phase,
      realGroups,
      summary,
      canUndo: plan.past.length > 0,
      undoBlocked: undoBlocked(plan),
      canRedo: plan.future.length > 0,
      conflicts: plan.conflicts.flatMap((conflict) => {
        const task = byEntry.get(conflict.entryId);
        if (!task) return [];
        const note = readPlanFields(task.rawLine, this.settings);
        const planned = readPlanFields(plannedLine(task, plan.current.changes[conflict.entryId], this.settings), this.settings);
        return [{ conflict, wording: conflictWording(conflict, note, planned, (id) => this.bucketName(id)) }];
      }),
      revertable,
      notes,
      appliedCount: 0,
    });
  }

  /** A bucket's emoji and name, as the popover names it. */
  private bucketLabel(id: string): string {
    const bucket = this.settings.buckets.find((b) => b.id === id);
    return bucket ? `${bucket.emoji} ${bucket.name}` : id;
  }

  private bucketName(id: string): string {
    const bucket = this.settings.buckets.find((b) => b.id === id);
    return bucket ? bucket.name : id;
  }

  private update(next: Plan): void {
    if (!this.plan || next === this.plan) return;
    this.plan = next;
    this.plugin.renderAll();
  }

  private step(step: PlanStep): void {
    if (!this.plan || this.phase !== "planning") return;
    if (this.pending) this.pending.push(step);
    else this.update(planStep(this.plan, step));
  }

  /** Runs `run`, and makes every plan step it takes one undo step. */
  async batch(run: () => Promise<void>): Promise<void> {
    if (!this.planning || this.pending) return run();
    this.pending = [];
    try {
      await run();
    } finally {
      const steps = this.pending;
      this.pending = null;
      if (this.plan && this.planning && steps.length > 0) this.update(planSteps(this.plan, steps));
    }
  }

  /** The step entry for one task: its id, and its change measured against its real fields. */
  private changeFor(task: TaskRecord, change: PlannedChange, keys = this.orderKeys()): PlanStep["changes"] {
    const real = this.realTask(task);
    const entry = real ? keys.get(real.id) : undefined;
    if (!real || !entry) return {};
    return { [entryId(entry)]: { change, real: readPlanFields(real.rawLine, this.settings) } };
  }

  private dropOrder(task: TaskRecord, bucketId: string, orderedTaskIds: string[] | null | undefined, keys: Map<string, OrderEntry>) {
    const entry = keys.get(task.id);
    return {
      ...(entry ? { purge: entry } : {}),
      ...(orderedTaskIds ? { order: { bucketId, entries: mapToOrderEntries(orderedTaskIds, keys) } } : {}),
    };
  }

  move(task: TaskRecord, targetBucketId: string | null, orderedTaskIds: string[] | null | undefined): void {
    const keys = this.orderKeys();
    this.step({
      changes: this.changeFor(task, { bucket: targetBucketId }, keys),
      ...this.dropOrder(task, targetBucketId ?? TO_REVIEW_ID, orderedTaskIds, keys),
    });
  }

  reorder(bucketId: string, orderedTaskIds: string[]): void {
    this.step({ order: { bucketId, entries: mapToOrderEntries(orderedTaskIds, this.orderKeys()) } });
  }

  setDate(task: TaskRecord, field: DateField, date: string, unpin: boolean): void {
    const change: PlannedChange = { [field]: date, ...(unpin ? { bucket: null, unpinnedByDate: true as const } : {}) };
    this.step({ changes: this.changeFor(task, change) });
  }

  /** A drop menu date: the date, the unpin it implies, and the drop position, as one step. */
  dropDate(task: TaskRecord, field: DateField, date: string, targetBucketId: string, orderedTaskIds: string[] | null): void {
    const keys = this.orderKeys();
    this.step({
      changes: this.changeFor(task, { [field]: date, bucket: null, unpinnedByDate: true }, keys),
      ...this.dropOrder(task, targetBucketId, orderedTaskIds, keys),
    });
  }

  /** The line the Tasks popup opens with: the planned one, so it shows the panel's dates. */
  lineForEdit(task: TaskRecord): string {
    const real = this.realTask(task) ?? task;
    const entry = this.orderKeys().get(real.id);
    const change = entry && this.plan ? this.plan.current.changes[entryId(entry)] : undefined;
    return plannedLine(real, change, this.settings);
  }

  /**
   * The Tasks popup's result, split: dates and bucket go to the plan, the rest
   * is written to the note with the real dates and bucket put back.
   */
  async edit(task: TaskRecord, edited: string): Promise<void> {
    const real = this.realTask(task);
    if (!real || this.phase !== "planning") return;
    const lines = editedLines(edited, this.lineForEdit(real));
    if (!lines) return;
    const realFields = readPlanFields(real.rawLine, this.settings);
    if (lines.length !== 1) {
      // Several lines (a completed recurrence): a status change, saved as is.
      const result = await replaceTaskLine(this.plugin.app, real, () => lines);
      await this.plugin.settleLineWrite(real, result, lines.length, "notices.editFailed");
      return;
    }
    const planned = readPlanFields(lines[0], this.settings);
    const noteLine = writePlanFields(lines[0], realFields, this.settings);
    let target = real;
    if (noteLine !== real.rawLine) {
      const result = await replaceTaskLine(this.plugin.app, real, () => [noteLine]);
      const ok = await this.plugin.settleLineWrite(real, result, 1, "notices.editFailed");
      if (!ok || result.lineIdx === undefined) return;
      const written = this.plugin.taskIndex
        .getAllTasks()
        .find((t) => t.filePath === real.filePath && t.lineNumber === result.lineIdx);
      if (!written) return;
      target = written;
    }
    const entry = this.orderKeys().get(target.id);
    if (!entry || !this.plan) return;
    this.update(
      planStep(this.plan, {
        changes: { [entryId(entry)]: { change: planned, real: readPlanFields(target.rawLine, this.settings) } },
      })
    );
  }

  undo(): void {
    if (this.plan && this.planning) this.update(undoPlan(this.plan));
  }

  redo(): void {
    if (this.plan && this.planning) this.update(redoPlan(this.plan));
  }

  revert(task: TaskRecord, what: "bucket" | "date"): void {
    const real = this.realTask(task);
    const entry = real ? this.orderKeys().get(real.id) : undefined;
    if (!this.plan || !real || !entry || !this.planning) return;
    this.update(revertPlan(this.plan, entryId(entry), what, readPlanFields(real.rawLine, this.settings)));
  }

  answer(conflict: Conflict, choice: "note" | "plan"): void {
    if (this.plan && this.planning) this.update(answerConflict(this.plan, conflict, choice));
  }

  async apply(): Promise<void> {
    const plan = this.plan;
    if (!plan || this.phase !== "planning") return;
    const summary = this.currentSummary();
    // Kept through the writes and the animation, so the marks don't blink out meanwhile.
    this.frozenSummary = summary;
    this.phase = "applying";

    const settings = this.settings;
    const scheme = activeOrderKeyScheme(settings);
    const filter = getTaskFilter(settings);
    const seen = settings.completionSeen;
    const real = this.plugin.taskIndex.getAllTasks();
    const edits = buildFileEdits(real, plan.current.changes, computeOrderKeys(real, scheme), settings);

    const written: WrittenFile[] = [];
    const failed: { file: string; count: number }[] = [];
    for (const path of [...edits.keys()].sort()) {
      const fileEdits = edits.get(path)!;
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      // Filled inside vault.process: the content it saw, and what was written.
      const io: { before: string | null; after: string | null } = { before: null, after: null };
      if (file instanceof TFile) {
        try {
          await this.plugin.app.vault.process(file, (content) => {
            io.before = content;
            io.after = applyLineEdits(content, fileEdits);
            return io.after ?? content;
          });
        } catch {
          io.after = null;
        }
      }
      const { before, after } = io;
      if (before === null || after === null) {
        failed.push({ file: path, count: fileEdits.length });
        continue;
      }
      await this.plugin.taskIndex.reindexFileSilently(path);
      written.push({ file: path, before: parseFile(path, before, filter), after: parseFile(path, after, filter) });
    }

    const translated = translateOrderState(
      { taskOrder: plan.current.taskOrder, completionSeen: seen },
      written,
      scheme
    );
    settings.taskOrder = translated.taskOrder;
    settings.completionSeen = translated.completionSeen;

    if (failed.length === 0) {
      this.plan = null;
      this.phase = "applied";
      this.appliedCount = summary.count;
      this.droppedNotice?.hide();
      this.droppedNotice = null;
      this.endTimer = window.setTimeout(() => this.animationDone(), ANIMATION_FALLBACK_MS);
      await this.plugin.saveSettings();
      return;
    }

    this.plan = remainingPlan(
      plan,
      new Set(written.map((w) => w.file)),
      translated,
      this.orderKeys()
    );
    this.phase = "planning";
    this.frozenSummary = EMPTY_SUMMARY;
    for (const { file, count } of failed) new Notice(t("plan.notice.applyFailed", { count, file }));
    await this.plugin.saveSettings();
  }

  private currentSummary(): PlanSummary {
    let summary = EMPTY_SUMMARY;
    const unsubscribe = this.state$.subscribe((state) => (summary = state.summary));
    unsubscribe();
    return summary;
  }

  /** A panel reports its success animation finished; the first report, or the fallback timer, ends the session. */
  animationDone(): void {
    if (this.phase === "applied") this.end();
  }

  onFileReplaced(filePath: string, oldTasks: TaskRecord[], newTasks: TaskRecord[]): void {
    if (!this.plan || this.phase !== "planning") return;
    this.plan = syncFileChange(this.plan, filePath, oldTasks, newTasks, this.settings);
  }

  onRename(oldPath: string, newPath: string): void {
    if (!this.plan || this.phase !== "planning") return;
    this.plan = syncRename(this.plan, oldPath, newPath);
  }

  onPurge(purge: (taskOrder: Record<string, OrderEntry[]>) => Record<string, OrderEntry[]>): void {
    if (!this.plan || this.phase !== "planning") return;
    this.plan = syncPurge(this.plan, purge);
  }

  /** Drops changes whose task is gone, revives returning ones, and keeps the dropped notice current. */
  onIndexChanged(real: TaskRecord[]): void {
    if (!this.plan || this.phase !== "planning") return;
    const keys = computeOrderKeys(real, activeOrderKeyScheme(this.settings));
    const { plan } = reconcilePlan(this.plan, keys, (id) => this.texts.get(id) ?? "");
    this.plan = plan;
    this.showDropped();
  }

  private showDropped(): void {
    const dropped = this.plan?.dropped ?? [];
    if (dropped.length === 0) {
      this.droppedNotice?.hide();
      this.droppedNotice = null;
      return;
    }
    const message = [t("plan.notice.dropped"), ...dropped.map((d) => `• ${d.text}`)].join("\n");
    if (this.droppedNotice) this.droppedNotice.setMessage(message);
    else this.droppedNotice = new Notice(message, 0);
  }
}
