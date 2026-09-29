import { t, i18next } from "../i18n/i18n";
import type { DueStatus } from "./DueStatus";
import type { BucketConfig } from "../settings";

/** Locale-aware short date, e.g. "Fri, Aug 7". */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(i18next.language, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** The lead phrase for a flagged task, whose parenthetical carries the reason. */
function flaggedLine(dueDate: Date, diffDays: number): string {
  return diffDays === 0
    ? t("task.due.today")
    : t("task.due.date", { date: formatDate(dueDate) });
}

/** The lead phrase for an unflagged task: relative where that reads better than a date. */
function onTrackLine(dueDate: Date, diffDays: number): string {
  if (diffDays === 0) return t("task.due.today");
  // Negative diffDays reaches here only for completed or To Review tasks, which are
  // never flagged: show the plain date rather than "in -3 days" or an overdue phrase.
  if (diffDays < 0) return t("task.due.date", { date: formatDate(dueDate) });
  const main =
    diffDays === 1 ? t("task.due.tomorrow") : t("task.due.inDays", { count: diffDays });
  return t("task.due.withDetail", { main, detail: formatDate(dueDate) });
}

/**
 * The due line shown in a task's hover popover. Returns text only: the glyph is
 * rendered by the caller as its own span so it can carry the same theme color
 * as the badge on the row.
 */
export function formatDueLine(dueDate: Date, status: DueStatus): string {
  if (status.kind === "overdue") {
    return t("task.due.withDetail", {
      main: flaggedLine(dueDate, status.diffDays),
      detail: t("task.due.overdue", { count: -status.diffDays }),
    });
  }

  return onTrackLine(dueDate, status.diffDays);
}

export function formatMisfiledLine(belongsIn: BucketConfig): string {
  return t("task.fields.belongsIn", { bucket: belongsIn.name });
}
