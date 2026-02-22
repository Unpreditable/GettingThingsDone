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

export function setDueDate(rawLine: string, date: Date | null): string {
  const hasDue = DUE_DATE_REGEX.test(rawLine);

  if (date === null) {
    return rawLine.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/, "").trimEnd();
  }

  const dateStr = formatDate(date);
  const token = `📅 ${dateStr}`;

  if (hasDue) {
    return rawLine.replace(DUE_DATE_REGEX, `📅 ${dateStr}`);
  }

  return rawLine.trimEnd() + " " + token;
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
