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

export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
