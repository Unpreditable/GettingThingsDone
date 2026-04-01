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
const LIST_ITEM_REGEX = /^(\s*)(?:[-*+]|\d+[.)]) /;

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

  // Build parent/child hierarchy using all list items (tasks + bullets) as context.
  // Plain bullets are tracked on the stack but are transparent to parenthood: a task
  // walks up the stack to find the nearest task ancestor. A bullet only severs the
  // relationship when it causes a task to be popped (sibling case); bullets nested
  // under a task leave that task reachable on the stack.
  const taskByLine = new Map<number, TaskRecord>(records.map((r) => [r.lineNumber, r]));
  const taskLookup = new Map<string, TaskRecord>(records.map((t) => [t.id, t]));
  const stack: Array<{ indentLevel: number; taskId: string | null }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTask = taskByLine.has(i);
    if (!isTask && !LIST_ITEM_REGEX.test(line)) continue;

    const indentLevel = extractIndentLevel(line);
    while (stack.length > 0 && stack[stack.length - 1].indentLevel >= indentLevel) {
      stack.pop();
    }

    if (isTask) {
      const task = taskByLine.get(i)!;
      // Walk up the stack to find the nearest task ancestor (skipping bullet entries).
      let parentTaskId: string | null = null;
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].taskId != null) { parentTaskId = stack[j].taskId; break; }
      }
      if (parentTaskId != null) {
        task.parentId = parentTaskId;
        const parentTask = taskLookup.get(parentTaskId);
        if (parentTask) parentTask.childIds.push(task.id);
      }
      stack.push({ indentLevel, taskId: task.id });
    } else {
      stack.push({ indentLevel, taskId: null });
    }
  }

  return records;
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
    .replace(/🔁[^#[📅✅]*/gu, "")
    .replace(/[⏫🔼🔽⏬]/gu, "")
    .replace(/#[\w/-]+/g, "")
    .replace(/\[[\w-]+::\s*[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strips all inline markup to plain text for tooltips/search. */
export function stripWikilinks(text: string): string {
  return text
    .replace(/%%.*?%%/g, "")                          // %%comments%% → remove
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")   // [[page|alias]] → alias
    .replace(/\[\[([^\]]+)\]\]/g, "$1")               // [[page]] → page
    .replace(/(?<!\[)\[([^\]]+)\]\([^)]*\)/g, "$1")  // [text](url) → text
    .replace(/`([^`]+)`/g, "$1")                      // `code` → code
    .replace(/\*\*(.+?)\*\*/g, "$1")                  // **bold** → bold
    .replace(/__(.+?)__/g, "$1")                      // __bold__ → bold
    .replace(/~~(.+?)~~/g, "$1")                      // ~~strike~~ → strike
    .replace(/==(.+?)==/g, "$1")                      // ==highlight== → highlight
    .replace(/\*(.+?)\*/g, "$1")                      // *italic* → italic
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1");          // _italic_ → italic
}

export interface TextSegment {
  type: "text" | "wikilink" | "mdlink" | "bold" | "italic" | "strike" | "code" | "highlight";
  content: string;
}

/** Splits text into typed segments for safe DOM rendering without {@html}.
 *  Handles: [[wikilinks]], [md](links), **bold**, __bold__, *italic*, _italic_,
 *  ~~strike~~, ==highlight==, `code`, and strips %%comments%%. */
export function parseWikilinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const cleaned = text.replace(/%%.*?%%/g, "");

  // Order matters: longer/more specific patterns before shorter ones.
  // Group 1: `code`   2: **bold**   3: __bold__   4: ~~strike~~   5: ==highlight==
  // Group 6: *italic*   7: _italic_ (word-boundary)
  // Group 8: [[wikilink]]   Group 9: [md](link)
  const regex = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|==(.+?)==|\*(.+?)\*|(?<!\w)_(.+?)_(?!\w)|\[\[(?:[^\]|]+\|)?([^\]]+)\]\]|(?<!\[)\[([^\]]+)\]\([^)]*\)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: cleaned.slice(lastIndex, match.index) });
    }
    if      (match[1] !== undefined) segments.push({ type: "code",      content: match[1] });
    else if (match[2] !== undefined) segments.push({ type: "bold",      content: match[2] });
    else if (match[3] !== undefined) segments.push({ type: "bold",      content: match[3] });
    else if (match[4] !== undefined) segments.push({ type: "strike",    content: match[4] });
    else if (match[5] !== undefined) segments.push({ type: "highlight", content: match[5] });
    else if (match[6] !== undefined) segments.push({ type: "italic",    content: match[6] });
    else if (match[7] !== undefined) segments.push({ type: "italic",    content: match[7] });
    else if (match[8] !== undefined) segments.push({ type: "wikilink",  content: match[8] });
    else if (match[9] !== undefined) segments.push({ type: "mdlink",    content: match[9] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < cleaned.length) {
    segments.push({ type: "text", content: cleaned.slice(lastIndex) });
  }
  return segments;
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
