import { t } from "../i18n/i18n";
import type { TaskRecord, TaskPriority } from "./TaskParser";
import type { DueStatus } from "./DueStatus";
import type { BucketConfig } from "../settings";
import { formatDate, formatDueLine, formatMisfiledLine } from "./DueStatusText";

/**
 * One line of the hover popover's metadata block.
 *
 * A row leads with either an `emoji` or an `icon`, never both: rows mirroring
 * Tasks-plugin syntax keep the literal glyph the user typed into the file, while
 * rows describing this plugin's own state use a Lucide icon, which inherits
 * currentColor and cannot collide with a bucket emoji (📌 and ⚡ are both taken
 * by DEFAULT_BUCKETS).
 */
export interface FieldRow {
  emoji?: string;
  icon?: string;
  text: string;
  /** Drives the row's colour. Carried as data so it survives a glyph change. */
  tone?: "overdue" | "misfiled";
  /** Trailing Lucide marker, set on the date row currently driving placement. */
  marker?: string;
}

/** How the task came to be in the bucket it's rendered under. */
export interface PlacementInfo {
  autoPlacedFrom: "due" | "scheduled" | null;
  pinnedIn: BucketConfig | null;
  /** Set when it's filed later than its planning date warrants. */
  misfiledIn: BucketConfig | null;
}

export const PRIORITY_EMOJI: Record<TaskPriority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};

/**
 * The metadata rows for a task's hover popover, already in display order and
 * already filtered to fields that are present. TaskItem renders these with an
 * {#each} and owns no ordering logic of its own.
 *
 * A pinned task gets its own row, since its bucket name appears nowhere else in
 * the popover. An automatic task gets none: its winning date row carries a
 * trailing marker instead, rather than repeating a date already on screen.
 *
 * `dueStatus` is null when the panel has no status for this task; the due row is
 * then omitted, since its text is entirely status-derived.
 */
export function formatTasksFields(
  task: TaskRecord,
  dueStatus: DueStatus | null,
  placement: PlacementInfo
): FieldRow[] {
  const rows: FieldRow[] = [];
  const { autoPlacedFrom, pinnedIn, misfiledIn } = placement;

  if (pinnedIn) {
    rows.push({ icon: "pin", text: t("task.fields.pinnedTo", { bucket: pinnedIn.name }) });
  }
  if (misfiledIn) {
    rows.push({ icon: "flag", tone: "misfiled", text: formatMisfiledLine(misfiledIn) });
  }

  if (task.dueDate && dueStatus) {
    const overdue = dueStatus.kind === "overdue";
    rows.push({
      ...(overdue ? { icon: "alert-triangle", tone: "overdue" as const } : { emoji: "📅" }),
      text: formatDueLine(task.dueDate, dueStatus),
      ...(autoPlacedFrom === "due" ? { marker: "zap" } : {}),
    });
  }
  if (task.priority) {
    rows.push({ emoji: PRIORITY_EMOJI[task.priority], text: t(`task.priority.${task.priority}`) });
  }
  if (task.recurrence) {
    rows.push({ emoji: "🔁", text: t("task.fields.recurrence", { rule: task.recurrence }) });
  }
  if (task.scheduledDate) {
    rows.push({
      emoji: "⏳",
      text: t("task.fields.scheduled", { date: formatDate(task.scheduledDate) }),
      ...(autoPlacedFrom === "scheduled" ? { marker: "zap" } : {}),
    });
  }
  if (task.startDate) {
    rows.push({ emoji: "🛫", text: t("task.fields.start", { date: formatDate(task.startDate) }) });
  }
  if (task.createdDate) {
    rows.push({ emoji: "➕", text: t("task.fields.created", { date: formatDate(task.createdDate) }) });
  }
  if (task.cancelledDate) {
    rows.push({ emoji: "❌", text: t("task.fields.cancelled", { date: formatDate(task.cancelledDate) }) });
  }
  if (task.completedAt) {
    rows.push({ emoji: "✅", text: t("task.fields.done", { date: formatDate(task.completedAt) }) });
  }
  if (task.onCompletion) {
    rows.push({ emoji: "🏁", text: t("task.fields.onCompletion", { action: task.onCompletion }) });
  }

  return rows;
}
