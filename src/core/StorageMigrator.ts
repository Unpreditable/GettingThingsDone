import { App, TFile, Notice } from "obsidian";
import { TaskRecord } from "./TaskParser";
import { PluginSettings, StorageMode } from "../settings";
import { getTagValue, getInlineFieldValue, setTagValue, setInlineFieldValue } from "./TaskParser";
import { findTaskLine } from "./TaskWriter";

export async function migrateStorageMode(
  app: App,
  allTasks: TaskRecord[],
  fromMode: StorageMode,
  toSettings: PluginSettings
): Promise<void> {
  const { storageMode: toMode, tagPrefix, buckets } = toSettings;
  if (fromMode === toMode) return;

  const byFile = new Map<string, TaskRecord[]>();
  for (const t of allTasks) {
    if (!byFile.has(t.filePath)) byFile.set(t.filePath, []);
    byFile.get(t.filePath)!.push(t);
  }

  let migrated = 0;
  let failed = 0;

  for (const [filePath, tasks] of byFile) {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) continue;

    let fileMigrated = 0;
    let fileFailed = 0;

    await app.vault.process(file, (content) => {
      const lines = content.split("\n");
      let changed = false;

      for (const task of tasks) {
        const bucketId = readBucketId(task, fromMode, tagPrefix);
        if (!bucketId) continue;
        if (!buckets.some((b) => b.id === bucketId)) continue;

        const lineIdx = findTaskLine(lines, task);
        if (lineIdx === -1) { fileFailed++; continue; }

        lines[lineIdx] = writeBucketId(lines[lineIdx], bucketId, toMode, tagPrefix, fromMode);
        changed = true;
        fileMigrated++;
      }

      return changed ? lines.join("\n") : content;
    });

    migrated += fileMigrated;
    failed += fileFailed;
  }

  new Notice(`GTD Tasks: Migration complete. ${migrated} tasks updated, ${failed} skipped.`);
}

function readBucketId(
  task: TaskRecord,
  mode: StorageMode,
  tagPrefix: string
): string | null {
  switch (mode) {
    case "inline-tag":
      return getTagValue(task.rawLine, tagPrefix);
    case "inline-field":
      return getInlineFieldValue(task.rawLine, tagPrefix);
  }
}

function writeBucketId(
  rawLine: string,
  bucketId: string,
  toMode: StorageMode,
  tagPrefix: string,
  fromMode: StorageMode
): string {
  let line = rawLine;

  switch (fromMode) {
    case "inline-tag":
      line = setTagValue(line, tagPrefix, null);
      break;
    case "inline-field":
      line = setInlineFieldValue(line, tagPrefix, null);
      break;
  }

  switch (toMode) {
    case "inline-tag":
      return setTagValue(line, tagPrefix, bucketId);
    case "inline-field":
      return setInlineFieldValue(line, tagPrefix, bucketId);
  }
}
