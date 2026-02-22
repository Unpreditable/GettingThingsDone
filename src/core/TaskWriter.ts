import { App, TFile, Notice } from "obsidian";
import { TaskRecord } from "./TaskParser";
import { BucketConfig, PluginSettings } from "../settings";
import { setTagValue, setInlineFieldValue } from "./TaskParser";
import { formatDate } from "../integrations/TasksPluginParser";

export interface MoveResult {
  success: boolean;
  error?: string;
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

  let content: string;
  try {
    content = await app.vault.read(file);
  } catch (e) {
    return { success: false, error: String(e) };
  }

  const lines = content.split("\n");
  const lineIdx = findTaskLine(lines, task);

  if (lineIdx === -1) {
    new Notice(
      `GTD Tasks: Could not locate task in ${file.basename}. Re-indexing…`
    );
    return { success: false, error: "Task line not found in file (stale index)" };
  }

  const updatedLine = applyBucketChange(
    lines[lineIdx],
    targetBucket,
    settings
  );

  lines[lineIdx] = updatedLine;
  const newContent = lines.join("\n");

  try {
    await app.vault.modify(file, newContent);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function confirmTaskPlacement(
  app: App,
  task: TaskRecord,
  bucketId: string,
  settings: PluginSettings
): Promise<MoveResult> {
  const bucket = settings.buckets.find((b) => b.id === bucketId) ?? null;
  return moveTaskToBucket(app, task, bucket, settings);
}

export async function toggleTaskCompletion(
  app: App,
  task: TaskRecord,
  settings: PluginSettings
): Promise<MoveResult> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) {
    return { success: false, error: `File not found: ${task.filePath}` };
  }

  let content: string;
  try {
    content = await app.vault.read(file);
  } catch (e) {
    return { success: false, error: String(e) };
  }

  const lines = content.split("\n");
  const lineIdx = findTaskLine(lines, task);

  if (lineIdx === -1) {
    new Notice(`GTD Tasks: Could not locate task in ${file.basename}.`);
    return { success: false, error: "Task line not found in file (stale index)" };
  }

  let line = lines[lineIdx];
  if (task.isCompleted) {
    line = line.replace(/\[[ xX]\]/, "[ ]");
    line = line.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trimEnd();
  } else {
    line = line.replace(/\[ \]/, "[x]");
    if (settings.readTasksPlugin) {
      line = line.trimEnd() + ` ✅ ${formatDate(new Date())}`;
    }
  }

  lines[lineIdx] = line;

  try {
    await app.vault.modify(file, lines.join("\n"));
    return { success: true };
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
