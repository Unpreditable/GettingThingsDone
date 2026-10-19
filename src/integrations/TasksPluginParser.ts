export type TaskPriority = "highest" | "high" | "medium" | "low" | "lowest";

export type TasksField =
  | "due" | "done" | "scheduled" | "start" | "created" | "cancelled"
  | "priority" | "recurrence" | "onCompletion" | "id" | "dependsOn";

export interface TokenSpan {
  field: TasksField;
  /** Index of the marker emoji, or of a Dataview field's opening bracket. */
  start: number;
  /** Index one past the last character of the token (marker + value, or the closing bracket). */
  end: number;
  /** Date fields: "YYYY-MM-DD". Priority: the level. Others: the raw value. */
  value: string | null;
  /** Which of Tasks' two formats the token is written in. */
  format: "emoji" | "dataview";
}

/** "level" is an emoji that is the value itself; "levelName" spells the level out. */
type TokenKind = "date" | "level" | "levelName" | "freeText" | "id";

interface TokenDef {
  field: TasksField;
  kind: TokenKind;
  /** Only for kind "level". */
  level?: TaskPriority;
}

const LEVELS: readonly string[] = ["highest", "high", "medium", "low", "lowest"];

/**
 * The single source of truth for Tasks-plugin syntax. Adding a marker here is
 * the whole cost of supporting it — no other pattern in the codebase needs to
 * learn about it, which is the property the old per-field regexes lacked.
 *
 * 📆 and 🗓 for due, and ⌛ for scheduled, are spellings Tasks reads but never
 * writes.
 */
const TOKENS: Record<string, TokenDef> = {
  "📅": { field: "due",          kind: "date" },
  "📆": { field: "due",          kind: "date" },
  "🗓": { field: "due",          kind: "date" },
  "✅": { field: "done",         kind: "date" },
  "⏳": { field: "scheduled",    kind: "date" },
  "⌛": { field: "scheduled",    kind: "date" },
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

/**
 * The same fields in Tasks' Dataview format, written `[key:: value]` or
 * `(key:: value)`, with spaces allowed inside the brackets and a comma after
 * them. Keys match in their exact case, as they do in Tasks.
 */
const DATAVIEW_TOKENS: Record<string, TokenDef> = {
  due:          { field: "due",          kind: "date" },
  completion:   { field: "done",         kind: "date" },
  scheduled:    { field: "scheduled",    kind: "date" },
  start:        { field: "start",        kind: "date" },
  created:      { field: "created",      kind: "date" },
  cancelled:    { field: "cancelled",    kind: "date" },
  priority:     { field: "priority",     kind: "levelName" },
  repeat:       { field: "recurrence",   kind: "freeText" },
  onCompletion: { field: "onCompletion", kind: "freeText" },
  id:           { field: "id",           kind: "id" },
  dependsOn:    { field: "dependsOn",    kind: "id" },
};

/** The keys of Tasks' Dataview format. */
export const DATAVIEW_KEYS: readonly string[] = Object.keys(DATAVIEW_TOKENS);

/**
 * Alternation over every marker, each with the variation selector (U+FE0F)
 * that emoji pickers often add and Tasks tolerates. The `u` flag keeps non-BMP
 * markers intact.
 */
const MARKER_REGEX = new RegExp(`(${Object.keys(TOKENS).join("|")})\\uFE0F?`, "gu");

const DATAVIEW_KEY_GROUP = `(${DATAVIEW_KEYS.join("|")})`;
const DATAVIEW_FIELD_REGEX = new RegExp(
  `(?:\\[ *${DATAVIEW_KEY_GROUP}::([^\\]]*)\\]|\\( *${DATAVIEW_KEY_GROUP}::([^)]*)\\))(?: *,)?`,
  "g"
);

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

/**
 * A date or id value at the start of `slice`, and how much of `slice` it
 * covers. Null if there is none, or the date is not a real calendar day.
 */
function leadingValue(kind: TokenKind, slice: string): { value: string; length: number } | null {
  const m = slice.match(kind === "date" ? DATE_VALUE_REGEX : ID_VALUE_REGEX);
  if (!m) return null;
  if (kind === "date") return toDate(m[1]) === null ? null : { value: m[1], length: m[0].length };
  return { value: m[1].replace(/\s*,\s*/g, ","), length: m[0].length };
}

/**
 * A Dataview field's value, or null to reject it. The value has to fill the
 * brackets: `[due:: 2026-10-20 or so]` is not a due date.
 */
function dataviewValue(def: TokenDef, inner: string): string | null {
  const trimmed = inner.trim();
  if (def.kind === "freeText") return trimmed === "" ? null : trimmed;
  if (def.kind === "levelName") return LEVELS.includes(trimmed) ? trimmed : null;
  const v = leadingValue(def.kind, inner);
  return v && inner.slice(v.length).trim() === "" ? v.value : null;
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

interface Marker {
  def: TokenDef;
  format: "emoji" | "dataview";
  start: number;
  /** One past the emoji, or past a Dataview field's closing bracket and comma. */
  end: number;
  /** Dataview only: what stands between `::` and the closing bracket. */
  inner?: string;
}

/**
 * Every emoji marker and Dataview field in `text`, in order. An emoji inside a
 * Dataview field's brackets is part of that field's value, not a marker.
 */
function findMarkers(text: string, ignoreKey: string | undefined): Marker[] {
  const ignored = ignoreKey?.toLowerCase();
  const fields: Marker[] = [];
  for (const m of text.matchAll(DATAVIEW_FIELD_REGEX)) {
    const key = m[1] ?? m[3];
    if (key.toLowerCase() === ignored) continue;
    fields.push({
      def: DATAVIEW_TOKENS[key],
      format: "dataview",
      start: m.index,
      end: m.index + m[0].length,
      inner: m[2] ?? m[4],
    });
  }
  const emoji: Marker[] = [];
  for (const m of text.matchAll(MARKER_REGEX)) {
    if (fields.some((f) => m.index >= f.start && m.index < f.end)) continue;
    emoji.push({ def: TOKENS[m[1]], format: "emoji", start: m.index, end: m.index + m[0].length });
  }
  return [...fields, ...emoji].sort((a, b) => a.start - b.start);
}

/**
 * Locates every Tasks-plugin token in `text`, in either of Tasks' formats.
 *
 * Runs in two phases, and the split is what fixes the bug this replaced. Phase
 * 1 records the index of every marker emoji and Dataview field, so the
 * complete set of boundaries exists before any value is interpreted. Phase 2
 * then reads each emoji's value bounded by the NEXT marker's index — so a
 * free-text value (🔁, 🏁) ends at a known position instead of at whatever
 * characters a hand-maintained stop-list happened to list. The old code's
 * recurrence regex listed four stop characters and silently ate 🏁, 🛫 and ⏳
 * along with their values. A Dataview field's value is bounded by its own
 * brackets and needs no such help.
 *
 * A marker whose value fails to parse is REJECTED: it yields no span, so it is
 * not stripped and stays visible to the user. It is still a phase-1 boundary,
 * which is what stops `🔁 every week 📅 soon` from letting the recurrence value
 * run to end of line.
 *
 * `holes` are ranges of `text` that free-text emoji VALUES must exclude —
 * other modules' syntax, which a Tasks token cannot know the shape of, so the
 * caller that owns that syntax passes it in rather than this scanner growing a
 * stop-list describing it. Only the value changes; the SPAN is unaffected, so
 * stripping behaviour is identical with or without holes. It matters because
 * the last Tasks marker on a line has no next marker to bound it, so its value
 * runs to end of line and swallows whatever else is there — including this
 * plugin's own bucket tag, which `moveTaskToBucket` appends at exactly that
 * position. That makes a nominally read-only field transitively writable, and
 * `recurrence` is in `computeOrderKeys`' disambiguator: without holes, every
 * cross-bucket move of a recurring task rehashes it and orphans the user's
 * saved manual order (see the invariant at TaskOrder.ts). Holes are not
 * applied to Dataview values: a square-bracket field is itself a hole.
 *
 * `ignoreKey` is the bucket field's key, compared in any case the way the
 * bucket reader compares it. Settings refuse a Tasks key as the bucket field,
 * but one saved before that rule would otherwise be read as a Tasks field too,
 * and turn the same transitively-writable problem into a direct one.
 */
export function scanTasksMetadata(text: string, holes: Hole[] = [], ignoreKey?: string): TokenSpan[] {
  const markers = findMarkers(text, ignoreKey);
  const spans: TokenSpan[] = [];

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const { def, format, start } = marker;

    if (format === "dataview") {
      const value = dataviewValue(def, marker.inner!);
      if (value === null) continue; // rejected
      spans.push({ field: def.field, start, end: marker.end, value, format });
      continue;
    }

    const valueStart = marker.end;
    const bound = i + 1 < markers.length ? markers[i + 1].start : text.length;
    const slice = text.slice(valueStart, bound);

    if (def.kind === "level") {
      spans.push({ field: def.field, start, end: valueStart, value: def.level!, format });
      continue;
    }

    if (def.kind === "date" || def.kind === "id") {
      const v = leadingValue(def.kind, slice);
      if (!v) continue; // rejected
      spans.push({ field: def.field, start, end: valueStart + v.length, value: v.value, format });
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
      format,
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
  /** The 🆔 value. */
  tasksId: string | null;
  /** The ⛔ ids, in line order. */
  dependsOn: string[];
}

/**
 * Folds spans into fields. Emoji outrank Dataview field by field, so a line
 * mixing the two formats keeps every field either one gives. Within a format
 * the first occurrence wins, matching Tasks' own behavior.
 */
export function foldTasksFields(spans: TokenSpan[]): TasksFields {
  const first = new Map<TasksField, string | null>();
  for (const format of ["emoji", "dataview"] as const) {
    for (const span of spans) {
      if (span.format === format && !first.has(span.field)) first.set(span.field, span.value);
    }
  }
  const get = (f: TasksField) => first.get(f) ?? null;
  const ids = (f: TasksField) =>
    (get(f) ?? "").split(",").map((id) => id.trim()).filter((id) => id !== "");

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
    // The value scan admits a list for either kind, but Tasks gives a task one id.
    tasksId: ids("id")[0] ?? null,
    dependsOn: ids("dependsOn"),
  };
}

export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
