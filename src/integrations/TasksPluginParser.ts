/**
 * Parses and writes metadata in the format used by the Obsidian Tasks plugin.
 *
 * Tasks plugin uses emoji-based inline syntax on the task line:
 *   📅 2026-02-18   due date
 *   ✅ 2026-02-17   completion date
 *   🔁 every week   recurrence
 *   ⏫ / 🔼 / 🔽    priority
 *
 * This module only handles due-date reading/writing; other fields are
 * preserved but not interpreted.
 */

const DUE_DATE_REGEX = /📅\s*(\d{4}-\d{2}-\d{2})/;
const COMPLETION_DATE_REGEX = /✅\s*(\d{4}-\d{2}-\d{2})/;

export function parseDueDate(rawLine: string): Date | null {
  const match = rawLine.match(DUE_DATE_REGEX);
  if (!match) return null;
  const d = new Date(match[1] + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

export function parseCompletionDate(rawLine: string): Date | null {
  const match = rawLine.match(COMPLETION_DATE_REGEX);
  if (!match) return null;
  const d = new Date(match[1] + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Replace (or insert) the 📅 due date on a task line.
 * If date is null, removes the 📅 field entirely.
 */
export function setDueDate(rawLine: string, date: Date | null): string {
  const hasDue = DUE_DATE_REGEX.test(rawLine);

  if (date === null) {
    // Remove the due date token
    return rawLine.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/, "").trimEnd();
  }

  const dateStr = formatDate(date);
  const token = `📅 ${dateStr}`;

  if (hasDue) {
    return rawLine.replace(DUE_DATE_REGEX, `📅 ${dateStr}`);
  }

  // Insert before any trailing metadata (✅, 🔁, priority emojis, tags)
  // Simple approach: append before the first trailing emoji block or at end
  return rawLine.trimEnd() + " " + token;
}

/**
 * Format a Date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns today as a Date at midnight local time.
 */
export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
