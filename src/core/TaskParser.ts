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
  /** Indentation depth: 0 = top-level, 1 = child, 2 = grandchild, etc. */
  indentLevel: number;
  /** ID of the parent TaskRecord, or null if this is a top-level task. */
  parentId: string | null;
  /** IDs of direct child TaskRecords. */
  childIds: string[];
}

const TASK_REGEX = /^(\s*[-*+]|\s*\d+[.)]) \[([ xX])\] (.*)$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
      indentLevel: extractIndentLevel(line),
      parentId: null,
      childIds: [],
    });
  }

  return buildTaskHierarchy(records);
}

function extractTags(text: string): string[] {
  const matches = text.match(/#[\w/-]+/g) ?? [];
  return matches.map((t) => t.slice(1));
}

/** Returns the value of the first [key:: value] field found, regardless of key name. */
function extractInlineField(text: string): string | null {
  const match = text.match(/\[[\w-]+::\s*([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

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

function extractIndentLevel(rawLine: string): number {
  let spaces = 0;
  for (const ch of rawLine) {
    if (ch === " ") spaces += 1;
    else if (ch === "\t") spaces += 2;
    else break;
  }
  return Math.floor(spaces / 2);
}

/**
 * Link parent/child relationships across a set of TaskRecords.
 * Groups by filePath, sorts by lineNumber, and uses a stack to assign
 * parentId / childIds based on indentLevel changes.
 *
 * Mutates the tasks in place and returns the same array.
 */
export function buildTaskHierarchy(tasks: TaskRecord[]): TaskRecord[] {
  const byFile = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (!byFile.has(task.filePath)) byFile.set(task.filePath, []);
    byFile.get(task.filePath)!.push(task);
  }

  const taskLookup = new Map<string, TaskRecord>(tasks.map((t) => [t.id, t]));

  for (const fileTasks of byFile.values()) {
    fileTasks.sort((a, b) => a.lineNumber - b.lineNumber);

    const stack: Array<{ indentLevel: number; id: string }> = [];

    for (const task of fileTasks) {
      while (stack.length > 0 && stack[stack.length - 1].indentLevel >= task.indentLevel) {
        stack.pop();
      }

      if (stack.length > 0) {
        const parentEntry = stack[stack.length - 1];
        task.parentId = parentEntry.id;
        const parent = taskLookup.get(parentEntry.id);
        if (parent) parent.childIds.push(task.id);
      }

      stack.push({ indentLevel: task.indentLevel, id: task.id });
    }
  }

  return tasks;
}

function makeId(filePath: string, lineNumber: number, text: string): string {
  let h = 0;
  const s = `${filePath}:${lineNumber}:${text}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

export function getInlineFieldValue(rawLine: string, key: string): string | null {
  const re = new RegExp(`\\[${escapeRegExp(key)}::\\s*([^\\]]+)\\]`, "i");
  const match = rawLine.match(re);
  return match ? match[1].trim() : null;
}

export function setInlineFieldValue(
  rawLine: string,
  key: string,
  value: string | null
): string {
  const escaped = escapeRegExp(key);
  const re = new RegExp(`\\s*\\[${escaped}::\\s*[^\\]]*\\]`, "gi");
  const hasField = re.test(rawLine);

  if (value === null) {
    return rawLine.replace(re, "").trimEnd();
  }

  const token = `[${key}:: ${value}]`;
  if (hasField) {
    return rawLine.replace(new RegExp(`\\[${escaped}::\\s*[^\\]]*\\]`, "i"), token);
  }
  return rawLine.trimEnd() + " " + token;
}

export function getTagValue(rawLine: string, prefix: string): string | null {
  const re = new RegExp(`#${escapeRegExp(prefix)}/([\\w-]+)`, "i");
  const match = rawLine.match(re);
  return match ? match[1] : null;
}

export function setTagValue(
  rawLine: string,
  prefix: string,
  value: string | null
): string {
  const re = new RegExp(`\\s*#${escapeRegExp(prefix)}/[\\w-]+`, "gi");
  const cleaned = rawLine.replace(re, "").trimEnd();

  if (value === null) return cleaned;
  return cleaned + ` #${prefix}/${value}`;
}

export function setSimpleTag(
  rawLine: string,
  tag: string,
  present: boolean
): string {
  const re = new RegExp(`\\s*#${escapeRegExp(tag)}(?=[\\s,]|$)`, "gi");
  const cleaned = rawLine.replace(re, "").trimEnd();
  if (!present) return cleaned;
  return cleaned + ` #${tag}`;
}
