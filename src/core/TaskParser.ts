/**
 * Parses markdown checkbox tasks from a file's content.
 *
 * Supports:
 *   - [ ] Incomplete task
 *   - [x] Completed task  (x or X)
 *   - [ ] Task with inline field [horizon:: today]
 *   - [ ] Task with #gtd/today tag
 *   - [ ] Task with 📅 2026-02-18 due date
 */

import { parseDueDate, parseCompletionDate } from "../integrations/TasksPluginParser";

export interface TaskRecord {
  /** Unique-ish identifier: hash of filePath + lineNumber + text. */
  id: string;
  filePath: string;
  lineNumber: number; // 0-indexed
  /** Full original line, used for exact write-back matching. */
  rawLine: string;
  /** Task text with all metadata stripped. */
  text: string;
  isCompleted: boolean;
  completedAt: Date | null;
  dueDate: Date | null;
  /** All tags found on this task line (without #). */
  tags: string[];
  /** Value of inline field, e.g. 'today' for [horizon:: today]. Null if absent. */
  inlineField: string | null;
}

// Matches: optional leading whitespace, list marker, checkbox
const TASK_REGEX = /^(\s*[-*+]|\s*\d+[.)]) \[([ xX])\] (.*)$/;

export function parseFile(filePath: string, content: string): TaskRecord[] {
  const lines = content.split("\n");
  const records: TaskRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TASK_REGEX);
    if (!match) continue;

    const checkMark = match[2];
    const rawRest = match[3];

    const isCompleted = checkMark === "x" || checkMark === "X";
    const dueDate = parseDueDate(line);
    const completedAt = isCompleted ? parseCompletionDate(line) : null;
    const tags = extractTags(rawRest);
    const inlineField = extractInlineField(rawRest);
    const text = stripMetadata(rawRest);

    records.push({
      id: makeId(filePath, i, text),
      filePath,
      lineNumber: i,
      rawLine: line,
      text,
      isCompleted,
      completedAt,
      dueDate,
      tags,
      inlineField,
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all #tag values from a string (without the #). */
function extractTags(text: string): string[] {
  const matches = text.match(/#[\w/-]+/g) ?? [];
  return matches.map((t) => t.slice(1));
}

/**
 * Extract value from first inline field matching [key:: value].
 * The key to look for is whatever the caller passed; we return the first match.
 */
function extractInlineField(text: string): string | null {
  const match = text.match(/\[[\w-]+::\s*([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

/**
 * Strip known metadata from task text to get the human-readable label:
 * - 📅 / ✅ dates
 * - #tags
 * - [key:: value] inline fields
 * - trailing whitespace
 */
function stripMetadata(text: string): string {
  return text
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/✅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/🔁[^#\[📅✅]*/g, "")
    .replace(/[⏫🔼🔽⏬]/g, "")
    .replace(/#[\w/-]+/g, "")
    .replace(/\[[\w-]+::\s*[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function makeId(filePath: string, lineNumber: number, text: string): string {
  // Simple non-cryptographic hash for stable IDs within a session.
  // Collisions are extremely unlikely for normal usage.
  let h = 0;
  const s = `${filePath}:${lineNumber}:${text}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

/**
 * Extract the inline field value for a specific key (case-insensitive).
 * E.g. getInlineFieldValue(line, 'horizon') returns 'today' from [horizon:: today].
 */
export function getInlineFieldValue(rawLine: string, key: string): string | null {
  const re = new RegExp(`\\[${key}::\\s*([^\\]]+)\\]`, "i");
  const match = rawLine.match(re);
  return match ? match[1].trim() : null;
}

/**
 * Set or replace an inline field value on a raw line.
 * If value is null, removes the field entirely.
 */
export function setInlineFieldValue(
  rawLine: string,
  key: string,
  value: string | null
): string {
  const re = new RegExp(`\\s*\\[${key}::\\s*[^\\]]*\\]`, "gi");
  const hasField = re.test(rawLine);

  if (value === null) {
    return rawLine.replace(new RegExp(`\\s*\\[${key}::\\s*[^\\]]*\\]`, "gi"), "").trimEnd();
  }

  const token = `[${key}:: ${value}]`;
  if (hasField) {
    return rawLine.replace(new RegExp(`\\[${key}::\\s*[^\\]]*\\]`, "i"), token);
  }
  return rawLine.trimEnd() + " " + token;
}

/**
 * Get the GTD tag value (e.g. 'today' from '#gtd/today') for a given prefix.
 */
export function getTagValue(rawLine: string, prefix: string): string | null {
  const re = new RegExp(`#${prefix}/([\\w-]+)`, "i");
  const match = rawLine.match(re);
  return match ? match[1] : null;
}

/**
 * Set or remove a prefixed tag (#prefix/value) on a raw line.
 * If value is null, removes the tag.
 */
export function setTagValue(
  rawLine: string,
  prefix: string,
  value: string | null
): string {
  const re = new RegExp(`\\s*#${prefix}/[\\w-]+`, "gi");
  const cleaned = rawLine.replace(re, "").trimEnd();

  if (value === null) return cleaned;
  return cleaned + ` #${prefix}/${value}`;
}

/**
 * Add or remove a simple tag (#tag) on a raw line.
 */
export function setSimpleTag(
  rawLine: string,
  tag: string,
  present: boolean
): string {
  const re = new RegExp(`\\s*#${tag}(?=[\\s,]|$)`, "gi");
  const cleaned = rawLine.replace(re, "").trimEnd();
  if (!present) return cleaned;
  return cleaned + ` #${tag}`;
}
