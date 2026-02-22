/**
 * Assignment priority (highest first):
 *   1. Storage-mode assignment (inline-tag or inline-field)
 *   2. Auto-assignment from 📅 due date matching a bucket's dateRangeRule
 *   3. No assignment → "to-review" system bucket
 */

import { TaskRecord, getTagValue, getInlineFieldValue } from "./TaskParser";
import { BucketConfig, PluginSettings } from "../settings";
import { today } from "../integrations/TasksPluginParser";

export const TO_REVIEW_ID = "to-review";

export interface BucketGroup {
  bucketId: string;
  name: string;
  emoji: string;
  tasks: TaskRecord[];
  staleTaskIds: string[];
  autoPlacedTaskIds: string[];
  isSystem: boolean;
}

export function groupTasksIntoBuckets(
  tasks: TaskRecord[],
  settings: PluginSettings
): BucketGroup[] {
  const now = today();

  const bucketMap = new Map<string, BucketGroup>();

  bucketMap.set(TO_REVIEW_ID, {
    bucketId: TO_REVIEW_ID,
    name: "To Review",
    emoji: settings.toReviewEmoji,
    tasks: [],
    staleTaskIds: [],
    autoPlacedTaskIds: [],
    isSystem: true,
  });

  for (const b of settings.buckets) {
    bucketMap.set(b.id, {
      bucketId: b.id,
      name: b.name,
      emoji: b.emoji,
      tasks: [],
      staleTaskIds: [],
      autoPlacedTaskIds: [],
      isSystem: false,
    });
  }

  // Sort parents before children so inheritance works in a single pass
  const sorted = [...tasks].sort((a, b) => {
    if (a.filePath < b.filePath) return -1;
    if (a.filePath > b.filePath) return 1;
    return a.lineNumber - b.lineNumber;
  });

  const effectiveBucket = new Map<string, string | null>();
  const autoPlacedIds = new Set<string>();

  for (const task of sorted) {
    const manualId = resolveManualAssignment(task, settings);
    if (manualId) {
      effectiveBucket.set(task.id, manualId);
      continue;
    }

    if (task.dueDate && settings.readTasksPlugin) {
      const autoId = autoAssign(task.dueDate, settings.buckets, now);
      if (autoId) {
        effectiveBucket.set(task.id, autoId);
        autoPlacedIds.add(task.id);
        continue;
      }
    }

    if (task.parentId !== null) {
      effectiveBucket.set(task.id, effectiveBucket.get(task.parentId) ?? null);
    } else {
      effectiveBucket.set(task.id, null);
    }
  }

  for (const task of tasks) {
    const bucketId = effectiveBucket.get(task.id) ?? null;

    if (bucketId !== null) {
      const group = bucketMap.get(bucketId);
      if (group) {
        group.tasks.push(task);

        if (autoPlacedIds.has(task.id)) {
          group.autoPlacedTaskIds.push(task.id);
        }

        if (settings.staleIndicatorEnabled && task.dueDate) {
          const bucket = settings.buckets.find((b) => b.id === bucketId);
          if (bucket && isStale(task.dueDate, bucket, now)) {
            group.staleTaskIds.push(task.id);
          }
        }
        continue;
      }
    }

    bucketMap.get(TO_REVIEW_ID)!.tasks.push(task);
  }

  const result: BucketGroup[] = [bucketMap.get(TO_REVIEW_ID)!];
  for (const b of settings.buckets) {
    result.push(bucketMap.get(b.id)!);
  }

  return result;
}

function resolveManualAssignment(
  task: TaskRecord,
  settings: PluginSettings
): string | null {
  const { storageMode, tagPrefix, buckets } = settings;

  if (storageMode === "inline-tag") {
    const val = getTagValue(task.rawLine, tagPrefix);
    if (val && buckets.some((b) => b.id === val)) return val;
  } else if (storageMode === "inline-field") {
    const val = getInlineFieldValue(task.rawLine, tagPrefix);
    if (val && buckets.some((b) => b.id === val)) return val;
  }

  return null;
}

function autoAssign(
  dueDate: Date,
  buckets: BucketConfig[],
  now: Date
): string | null {
  const diffDays = diffInDays(dueDate, now);
  const day = now.getDay();

  for (const b of buckets) {
    if (!b.dateRangeRule) continue;

    switch (b.dateRangeRule.type) {
      case "today":
        if (diffDays <= 0) return b.id;
        break;

      case "this-week": {
        const daysToSunday = day === 0 ? 0 : 7 - day;
        if (diffDays >= 1 && diffDays <= daysToSunday) return b.id;
        break;
      }

      case "next-week": {
        const daysToNextMonday = day === 0 ? 1 : 8 - day;
        if (diffDays >= daysToNextMonday && diffDays <= daysToNextMonday + 6) return b.id;
        break;
      }

      case "this-month": {
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const daysToEndOfMonth = diffInDays(endOfMonth, now);
        if (diffDays >= 1 && diffDays <= daysToEndOfMonth) return b.id;
        break;
      }

      case "next-month": {
        const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        const daysToStart = diffInDays(startOfNextMonth, now);
        const daysToEnd = diffInDays(endOfNextMonth, now);
        if (diffDays >= daysToStart && diffDays <= daysToEnd) return b.id;
        break;
      }

      case "within-days":
        if (diffDays >= 1 && diffDays <= b.dateRangeRule.days) return b.id;
        break;

      case "within-days-range":
        if (diffDays >= b.dateRangeRule.from && diffDays <= b.dateRangeRule.to)
          return b.id;
        break;

      case "beyond-days":
        if (diffDays > b.dateRangeRule.days) return b.id;
        break;
    }
  }

  return null;
}

function diffInDays(date: Date, now: Date): number {
  const d = new Date(date);
  const n = new Date(now);
  d.setHours(0, 0, 0, 0);
  n.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - n.getTime()) / (1000 * 60 * 60 * 24));
}

function isStale(dueDate: Date, bucket: BucketConfig, now: Date): boolean {
  if (!bucket.dateRangeRule) return false;
  const diff = diffInDays(dueDate, now);
  const day = now.getDay();

  switch (bucket.dateRangeRule.type) {
    case "today":
      return diff < 0;

    case "this-week":
      return diff < 1;

    case "next-week": {
      const daysToNextMonday = day === 0 ? 1 : 8 - day;
      return diff < daysToNextMonday;
    }

    case "this-month":
      return diff < 1;

    case "next-month": {
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return diff < diffInDays(startOfNextMonth, now);
    }

    case "within-days":
      return diff < 1;

    case "within-days-range":
      return diff < bucket.dateRangeRule.from - 1;

    case "beyond-days":
      return diff <= bucket.dateRangeRule.days;

    default:
      return false;
  }
}
