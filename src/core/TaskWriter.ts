import { App, TFile } from "obsidian";
import { TaskRecord } from "./TaskParser";
import { BucketConfig, PluginSettings } from "../settings";
import { setTagValue, setInlineFieldValue, splitLines, lineEnding, CHECKBOX_REGEX, setTaskDate } from "./TaskParser";
import type { DateField } from "./DateMenu";

export interface MoveResult {
  success: boolean;
  error?: string;
}

/** The subset of the Tasks plugin's documented apiV1 that this plugin uses. */
export interface TasksPluginApiV1 {
  executeToggleTaskDoneCommand: (line: string, path: string) => string;
  /**
   * Opens Tasks' edit modal. Resolves with the edited line(s) on Apply. On
   * Cancel, newer versions resolve with an empty string and older ones never
   * settle; closing the modal any other way never settles.
   */
  editTaskLineModal?: (line: string) => Promise<string>;
}

/** Tasks' edit modal, if the installed Tasks version has one. */
export function getTaskEditor(app: App): ((line: string) => Promise<string>) | null {
  const api = getTasksApi(app);
  return typeof api?.editTaskLineModal === "function" ? api.editTaskLineModal.bind(api) : null;
}

/**
 * The lines to write back for what Tasks' edit modal resolved with, or null
 * when nothing should be written. An empty string is Cancel: writing it would
 * blank the task's line in the note.
 */
export function editedLines(edited: string, originalLine: string): string[] | null {
  if (edited === "" || edited === originalLine) return null;
  return edited.split("\n");
}

/** The Tasks community plugin's apiV1, if it is installed and enabled. */
export function getTasksApi(app: App): TasksPluginApiV1 | null {
  const plugins = (app as App & {
    plugins?: { plugins?: Record<string, { apiV1?: TasksPluginApiV1 }> };
  }).plugins;
  const api = plugins?.plugins?.["obsidian-tasks-plugin"]?.apiV1;
  return typeof api?.executeToggleTaskDoneCommand === "function" ? api : null;
}

/**
 * The line(s) that replace `rawLine` when its checkbox is toggled. Delegates
 * to Tasks whenever it is installed, for both completing and reopening, so
 * the panel behaves exactly like the editor does on the same device: Tasks
 * applies its own ✅-date setting, global filter, 🔁 recurrence (two lines
 * back) and 🏁 on-completion delete (no lines back). Without Tasks — or if
 * the call fails — this flips the checkbox and writes no date; visibility
 * still works, via the witnessed completionSeen clock.
 */
export function toggleTaskLine(
  rawLine: string,
  filePath: string,
  isCompleted: boolean,
  api: TasksPluginApiV1 | null
): string[] {
  if (api) {
    try {
      const result = api.executeToggleTaskDoneCommand(rawLine, filePath);
      if (typeof result === "string") return result === "" ? [] : result.split("\n");
    } catch {
      // Fall through to the minimal flip — a valid outcome, not an error.
    }
  }

  if (isCompleted) {
    return [
      rawLine
        .replace(CHECKBOX_REGEX, "$1[ ]")
        .replace(/\s*✅\uFE0F?\s*\d{4}-\d{2}-\d{2}/, "")
        .replace(/\s*❌\uFE0F?\s*\d{4}-\d{2}-\d{2}/, "")
        .trimEnd(),
    ];
  }
  return [rawLine.replace(CHECKBOX_REGEX, "$1[x]")];
}

/** The statuses the status commands and menu items set. */
export type SettableStatus = "/" | "-";

/** Whether `line` is a task whose status `setStatusLine` changes: open, in progress, done or cancelled. */
export function hasSettableStatus(line: string): boolean {
  const current = line.match(CHECKBOX_REGEX)?.[2];
  return current !== undefined && " /xX-".includes(current);
}

/**
 * The line(s) that replace `rawLine` when it is set to `symbol`, or set back
 * to `[ ]` if it already has it. The ✅ and ❌ dates are Tasks' to write and
 * clear, so a task leaving `[x]` or `[-]` is first reopened through Tasks'
 * toggle; only a plain `[ ]` result is then changed to `symbol`. Without Tasks
 * only the symbol changes, and any dates stay on the line.
 */
export function setStatusLine(
  rawLine: string,
  filePath: string,
  symbol: SettableStatus,
  api: TasksPluginApiV1 | null
): string[] {
  if (!hasSettableStatus(rawLine)) return [rawLine];
  const current = rawLine.match(CHECKBOX_REGEX)?.[2];
  const withSymbol = (line: string, s: string) => line.replace(CHECKBOX_REGEX, `$1[${s}]`);

  if (current === " " || current === "/") {
    return [withSymbol(rawLine, current === symbol ? " " : symbol)];
  }

  const target = current === symbol ? " " : symbol;
  if (api) {
    try {
      const result = api.executeToggleTaskDoneCommand(rawLine, filePath);
      if (typeof result === "string") {
        const lines = result === "" ? [] : result.split("\n");
        if (lines.length !== 1 || lines[0].match(CHECKBOX_REGEX)?.[2] !== " ") return lines;
        return [withSymbol(lines[0], target)];
      }
    } catch {
      // Fall through to changing the symbol alone.
    }
  }
  return [withSymbol(rawLine, target)];
}

export function setTaskStatus(
  app: App,
  task: TaskRecord,
  symbol: SettableStatus
): Promise<MoveResult> {
  const api = getTasksApi(app);
  return replaceTaskLine(app, task, (line) => setStatusLine(line, task.filePath, symbol, api));
}

/**
 * Locate a task's line index in the file. Tries lineNumber first for O(1) lookup;
 * falls back to scanning for rawLine if the file has shifted since last index.
 * Returns -1 if not found.
 */
export function findTaskLine(lines: string[], task: TaskRecord): number {
  if (task.lineNumber < lines.length && lines[task.lineNumber] === task.rawLine) {
    return task.lineNumber;
  }
  return lines.findIndex((l) => l === task.rawLine);
}

export async function moveTaskToBucket(
  app: App,
  task: TaskRecord,
  targetBucket: BucketConfig | null, // null = To Review
  settings: PluginSettings
): Promise<MoveResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) {
    return { success: false, error: `File not found: ${task.filePath}` };
  }

  let result: MoveResult = { success: false, error: "Task line not found in file (stale index)" };

  try {
    await app.vault.process(file, (content) => {
      const lines = splitLines(content);
      const lineIdx = findTaskLine(lines, task);

      // The caller shows the notice and reindexes.
      if (lineIdx === -1) return content;

      lines[lineIdx] = applyBucketChange(lines[lineIdx], targetBucket, settings);
      result = { success: true };
      return lines.join(lineEnding(content));
    });
    return result;
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function toggleTaskCompletion(
  app: App,
  task: TaskRecord
): Promise<MoveResult> {
  const api = getTasksApi(app);
  return replaceTaskLine(app, task, (line) =>
    toggleTaskLine(line, task.filePath, task.isCompleted, api)
  );
}

export interface ReplaceResult extends MoveResult {
  /** Where the task's line was actually found; differs from task.lineNumber if the file shifted. */
  lineIdx?: number;
  /** File content before and after the write, for callers that diff the edit themselves. */
  before?: string;
  after?: string;
}

/**
 * Replaces the task's line with whatever `replace` returns: none, one or
 * several lines. Locates the line the same way as every other write, and
 * leaves the file untouched if it can't; the caller shows the notice.
 */
export async function replaceTaskLine(
  app: App,
  task: TaskRecord,
  replace: (line: string) => string[]
): Promise<ReplaceResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) {
    return { success: false, error: `File not found: ${task.filePath}` };
  }

  let result: ReplaceResult = { success: false, error: "Task line not found in file (stale index)" };

  try {
    await app.vault.process(file, (content) => {
      const lines = splitLines(content);
      const lineIdx = findTaskLine(lines, task);

      if (lineIdx === -1) return content;

      lines.splice(lineIdx, 1, ...replace(lines[lineIdx]));
      const after = lines.join(lineEnding(content));
      result = { success: true, lineIdx, before: content, after };
      return after;
    });
    return result;
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** The line with its due or scheduled date set, and its pin removed when `unpin`. */
export function setDateLine(
  line: string,
  field: DateField,
  date: string,
  unpin: boolean,
  settings: PluginSettings
): string {
  const bucketKey = settings.storageMode === "inline-field" ? settings.tagPrefix : undefined;
  const dated = setTaskDate(line, field, date, bucketKey);
  return unpin ? applyBucketChange(dated, null, settings) : dated;
}

function applyBucketChange(
  rawLine: string,
  targetBucket: BucketConfig | null,
  settings: PluginSettings
): string {
  const { storageMode, tagPrefix } = settings;
  const value = targetBucket?.id ?? null;

  if (storageMode === "inline-tag") {
    return setTagValue(rawLine, tagPrefix, value);
  }

  if (storageMode === "inline-field") {
    return setInlineFieldValue(rawLine, tagPrefix, value);
  }

  return rawLine;
}
