export type TaskPriority = "highest" | "high" | "medium" | "low" | "lowest";

export type TasksField =
  | "due" | "done" | "scheduled" | "start" | "created" | "cancelled"
  | "priority" | "recurrence" | "onCompletion" | "id" | "dependsOn";

export interface TokenSpan {
  field: TasksField;
  /** Index of the marker emoji in the scanned string. */
  start: number;
  /** Index one past the last character of the token (marker + value). */
  end: number;
  /** Date fields: "YYYY-MM-DD". Priority: the level. Others: the raw value. */
  value: string | null;
}

type TokenKind = "date" | "level" | "freeText" | "id";

interface TokenDef {
  field: TasksField;
  kind: TokenKind;
  /** Only for kind "level". */
  level?: TaskPriority;
}

/**
 * The single source of truth for Tasks-plugin syntax. Adding a marker here is
 * the whole cost of supporting it — no other pattern in the codebase needs to
 * learn about it, which is the property the old per-field regexes lacked.
 */
const TOKENS: Record<string, TokenDef> = {
  "📅": { field: "due",          kind: "date" },
  "✅": { field: "done",         kind: "date" },
  "⏳": { field: "scheduled",    kind: "date" },
  "🛫": { field: "start",        kind: "date" },
  "➕": { field: "created",      kind: "date" },
  "❌": { field: "cancelled",    kind: "date" },
  "🔺": { field: "priority",     kind: "level", level: "highest" },
  "⏫": { field: "priority",     kind: "level", level: "high" },
  "🔼": { field: "priority",     kind: "level", level: "medium" },
  "🔽": { field: "priority",     kind: "level", level: "low" },
  "⏬": { field: "priority",     kind: "level", level: "lowest" },
  "🔁": { field: "recurrence",   kind: "freeText" },
  "🏁": { field: "onCompletion", kind: "freeText" },
  "🆔": { field: "id",           kind: "id" },
  "⛔": { field: "dependsOn",    kind: "id" },
};

/** Alternation over every marker. The `u` flag keeps non-BMP markers intact. */
const MARKER_REGEX = new RegExp(Object.keys(TOKENS).join("|"), "gu");

const DATE_VALUE_REGEX = /^\s*(\d{4}-\d{2}-\d{2})/;
const ID_VALUE_REGEX = /^\s*([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)/;

/**
 * Parses "YYYY-MM-DD" at local midnight. Null if the calendar date is
 * invalid — including a date whose day-of-month doesn't exist (e.g.
 * 2026-02-30), which `Date` would otherwise silently roll over into the
 * following month rather than reject.
 */
function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const d = new Date(`${value}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  // A rolled-over date (2026-02-30 → Mar 2) is not the date the user wrote.
  // Reject it, so the marker stays visible rather than silently shifting.
  const [year, month, day] = value.split("-").map(Number);
  if (d.getFullYear() !== year || d.getMonth() + 1 !== month || d.getDate() !== day) {
    return null;
  }
  return d;
}

/** A half-open [start, end) range of the scanned string. */
export interface Hole {
  start: number;
  end: number;
}

/** Sorts and merges, so back-to-front removal can never use a stale index. */
function mergeHoles(holes: Hole[]): Hole[] {
  const sorted = [...holes].sort((a, b) => a.start - b.start);
  const merged: Hole[] = [];
  for (const hole of sorted) {
    const last = merged[merged.length - 1];
    if (last && hole.start <= last.end) last.end = Math.max(last.end, hole.end);
    else merged.push({ ...hole });
  }
  return merged;
}

/**
 * `text.slice(valueStart, bound)` with any part of it that falls inside a hole
 * removed. Whitespace is collapsed afterwards, the way TaskParser's `cutSpans`
 * does, so a hole excised from the middle of a value leaves no double space.
 */
function readFreeText(
  text: string,
  valueStart: number,
  bound: number,
  holes: Hole[]
): string {
  const slice = text.slice(valueStart, bound);
  const overlapping = holes.filter((h) => h.end > valueStart && h.start < bound);
  if (overlapping.length === 0) return slice.trim();

  const merged = mergeHoles(overlapping);
  let result = slice;
  for (let i = merged.length - 1; i >= 0; i--) {
    const from = Math.max(merged[i].start, valueStart) - valueStart;
    const to = Math.min(merged[i].end, bound) - valueStart;
    result = result.slice(0, from) + result.slice(to);
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

/**
 * Locates every Tasks-plugin token in `text`.
 *
 * Runs in two phases, and the split is what fixes the bug this replaced. Phase
 * 1 records the index of every marker emoji, so the complete set of boundaries
 * exists before any value is interpreted. Phase 2 then reads each marker's
 * value bounded by the NEXT marker's index — so a free-text value (🔁, 🏁) ends
 * at a known position instead of at whatever characters a hand-maintained
 * stop-list happened to list. The old code's recurrence regex listed four stop
 * characters and silently ate 🏁, 🛫 and ⏳ along with their values.
 *
 * A marker whose value fails to parse is REJECTED: it yields no span, so it is
 * not stripped and stays visible to the user. It is still a phase-1 boundary,
 * which is what stops `🔁 every week 📅 soon` from letting the recurrence value
 * run to end of line.
 *
 * `holes` are ranges of `text` that free-text VALUES must exclude — other
 * modules' syntax, which a Tasks token cannot know the shape of, so the caller
 * that owns that syntax passes it in rather than this scanner growing a
 * stop-list describing it. Only the value changes; the SPAN is unaffected, so
 * stripping behaviour is identical with or without holes. It matters because
 * the last Tasks marker on a line has no next marker to bound it, so its value
 * runs to end of line and swallows whatever else is there — including this
 * plugin's own bucket tag, which `moveTaskToBucket` appends at exactly that
 * position. That makes a nominally read-only field transitively writable, and
 * `recurrence` is in `computeOrderKeys`' disambiguator: without holes, every
 * cross-bucket move of a recurring task rehashes it and orphans the user's
 * saved manual order (see the invariant at TaskOrder.ts).
 */
export function scanTasksMetadata(text: string, holes: Hole[] = []): TokenSpan[] {
  const markers = [...text.matchAll(MARKER_REGEX)];
  const spans: TokenSpan[] = [];

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const def = TOKENS[marker[0]];
    const start = marker.index;
    const valueStart = start + marker[0].length;
    const bound = i + 1 < markers.length ? markers[i + 1].index : text.length;
    const slice = text.slice(valueStart, bound);

    if (def.kind === "level") {
      spans.push({ field: def.field, start, end: valueStart, value: def.level! });
      continue;
    }

    if (def.kind === "date") {
      const m = slice.match(DATE_VALUE_REGEX);
      if (!m || toDate(m[1]) === null) continue; // rejected
      spans.push({ field: def.field, start, end: valueStart + m[0].length, value: m[1] });
      continue;
    }

    if (def.kind === "id") {
      const m = slice.match(ID_VALUE_REGEX);
      if (!m) continue; // rejected
      spans.push({
        field: def.field,
        start,
        end: valueStart + m[0].length,
        value: m[1].replace(/\s*,\s*/g, ","),
      });
      continue;
    }

    // freeText. The span end comes from the untouched slice — holes narrow the
    // value only, never what gets stripped.
    const value = readFreeText(text, valueStart, bound, holes);
    if (value === "") continue; // rejected
    spans.push({
      field: def.field,
      start,
      end: valueStart + slice.trimEnd().length,
      value,
    });
  }

  return spans;
}

export interface TasksFields {
  dueDate: Date | null;
  completedAt: Date | null;
  scheduledDate: Date | null;
  startDate: Date | null;
  createdDate: Date | null;
  cancelledDate: Date | null;
  priority: TaskPriority | null;
  recurrence: string | null;
  onCompletion: string | null;
}

/** Folds spans into fields. First occurrence wins, matching Tasks' own behavior. */
export function foldTasksFields(spans: TokenSpan[]): TasksFields {
  const first = new Map<TasksField, string | null>();
  for (const span of spans) {
    if (!first.has(span.field)) first.set(span.field, span.value);
  }
  const get = (f: TasksField) => first.get(f) ?? null;

  return {
    dueDate: toDate(get("due")),
    completedAt: toDate(get("done")),
    scheduledDate: toDate(get("scheduled")),
    startDate: toDate(get("start")),
    createdDate: toDate(get("created")),
    cancelledDate: toDate(get("cancelled")),
    priority: (get("priority") as TaskPriority | null) ?? null,
    recurrence: get("recurrence"),
    onCompletion: get("onCompletion"),
  };
}

export function parseDueDate(rawLine: string): Date | null {
  return foldTasksFields(scanTasksMetadata(rawLine)).dueDate;
}

export function parseCompletionDate(rawLine: string): Date | null {
  return foldTasksFields(scanTasksMetadata(rawLine)).completedAt;
}

export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
