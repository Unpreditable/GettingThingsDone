import { App, TFile, Notice } from "obsidian";
import { TaskRecord } from "./TaskParser";
import { BucketConfig, PluginSettings } from "../settings";
import { setTagValue, setInlineFieldValue, CHECKBOX_REGEX } from "./TaskParser";

export interface MoveResult {
  success: boolean;
  error?: string;
}

/** The subset of the Tasks plugin's documented apiV1 that this plugin uses. */
export interface TasksPluginApiV1 {
  executeToggleTaskDoneCommand: (line: string, path: string) => string;
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
        .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "")
        .replace(/\s*❌\s*\d{4}-\d{2}-\d{2}/, "")
        .trimEnd(),
    ];
  }
  return [rawLine.replace(CHECKBOX_REGEX, "$1[x]")];
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
      const lines = content.split("\n");
      const lineIdx = findTaskLine(lines, task);

      if (lineIdx === -1) {
        new Notice(
          `GTD Tasks: Could not locate task in ${file.basename}. Re-indexing…`
        );
        return content;
      }

      lines[lineIdx] = applyBucketChange(lines[lineIdx], targetBucket, settings);
      result = { success: true };
      return lines.join("\n");
    });
    return result;
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function toggleTaskCompletion(
  app: App,
  task: TaskRecord
): Promise<MoveResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) {
    return { success: false, error: `File not found: ${task.filePath}` };
  }

  const api = getTasksApi(app);
  let result: MoveResult = { success: false, error: "Task line not found in file (stale index)" };

  try {
    await app.vault.process(file, (content) => {
      const lines = content.split("\n");
      const lineIdx = findTaskLine(lines, task);

      if (lineIdx === -1) {
        new Notice(`GTD Tasks: Could not locate task in ${file.basename}.`);
        return content;
      }

      lines.splice(lineIdx, 1, ...toggleTaskLine(lines[lineIdx], task.filePath, task.isCompleted, api));
      result = { success: true };
      return lines.join("\n");
    });
    return result;
  } catch (e) {
    return { success: false, error: String(e) };
  }
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
