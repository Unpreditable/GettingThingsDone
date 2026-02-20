/**
 * Writes bucket assignment changes back to source markdown files.
 *
 * Locates the task by exact rawLine match, applies the relevant changes
 * (tags or inline field), and writes via vault.modify().
 *
 * Safety: if the rawLine is not found in the current file content (because
 * the file was edited since the last index), the operation is aborted and
 * an error is returned. The caller should trigger a re-index.
 */

import { App, TFile, Notice } from "obsidian";
import { TaskRecord } from "./TaskParser";
import { BucketConfig, PluginSettings } from "../settings";
import { setTagValue, setInlineFieldValue } from "./TaskParser";
import { formatDate } from "../integrations/TasksPluginParser";

export interface MoveResult {
  success: boolean;
  error?: string;
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
  const lineIdx = lines.findIndex((l) => l === task.rawLine);

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

/**
 * Confirm an auto-placed task by writing the explicit bucket marker,
 * without changing any dates or other task content.
 */
export async function confirmTaskPlacement(
  app: App,
  task: TaskRecord,
  bucketId: string,
  settings: PluginSettings
): Promise<MoveResult> {
  const bucket = settings.buckets.find((b) => b.id === bucketId) ?? null;
  return moveTaskToBucket(app, task, bucket, settings);
}

/**
 * Toggle the completion state of a task in its source file.
 */
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
  const lineIdx = lines.findIndex((l) => l === task.rawLine);

  if (lineIdx === -1) {
    new Notice(`GTD Tasks: Could not locate task in ${file.basename}.`);
    return { success: false, error: "Task line not found in file (stale index)" };
  }

  let line = lines[lineIdx];
  if (task.isCompleted) {
    // Uncheck: replace [x] with [ ], remove ✅ date
    line = line.replace(/\[[ xX]\]/, "[ ]");
    line = line.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trimEnd();
  } else {
    // Check: replace [ ] with [x], add ✅ date if Tasks plugin is on
    line = line.replace(/\[ \]/, "[x]");
    if (settings.readTasksPlugin) {
      line = line.trimEnd() + ` ✅ ${formatDate(new Date())}`;
    }
  }

  lines[lineIdx] = line;
  await app.vault.modify(file, lines.join("\n"));
  return { success: true };
}

// ---------------------------------------------------------------------------
// Internal: build the updated line
// ---------------------------------------------------------------------------

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
