import { t, i18next } from "../i18n/i18n";
import type { TaskRecord, TaskPriority } from "./TaskParser";
import type { DueStatus } from "./DueStatus";
import { formatDueLine } from "./DueStatusText";

/** One line of the hover popover's metadata block. */
export interface FieldRow {
  emoji: string;
  text: string;
}

const PRIORITY_EMOJI: Record<TaskPriority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};

/** Locale-aware short date, e.g. "Wed, Aug 5". Matches DueStatusText's format. */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(i18next.language, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * The glyph leading the due row. A flag supersedes 📅 rather than joining it:
 * it already means "this is a due date, and there is a problem with it", which
 * is strictly more than 📅 says. On-track tasks fall back to 📅 so the popover's
 * first column is never ragged.
 */
function dueEmoji(status: DueStatus): string {
  if (status.kind === "overdue") return "❢";
  if (status.kind === "misfiled") return "⚑";
  return "📅";
}

/**
 * The metadata rows for a task's hover popover, already in display order and
 * already filtered to fields that are present. TaskItem renders these with an
 * {#each} and owns no ordering logic of its own.
 *
 * `dueStatus` is null when the panel has no status for this task; the due row
 * is then omitted, since its text is entirely status-derived.
 */
export function formatTasksFields(task: TaskRecord, dueStatus: DueStatus | null): FieldRow[] {
  const rows: FieldRow[] = [];

  if (task.dueDate && dueStatus) {
    rows.push({ emoji: dueEmoji(dueStatus), text: formatDueLine(task.dueDate, dueStatus) });
  }
  if (task.priority) {
    rows.push({ emoji: PRIORITY_EMOJI[task.priority], text: t(`task.priority.${task.priority}`) });
  }
  if (task.recurrence) {
    rows.push({ emoji: "🔁", text: t("task.fields.recurrence", { rule: task.recurrence }) });
  }
  if (task.scheduledDate) {
    rows.push({ emoji: "⏳", text: t("task.fields.scheduled", { date: formatDate(task.scheduledDate) }) });
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
