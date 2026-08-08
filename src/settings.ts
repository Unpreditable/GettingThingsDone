import type { OrderEntry } from "./core/TaskOrder";

export type DateRangeRule =
  | { type: "today" }
  | { type: "this-week" }               // tomorrow → end of current Sunday
  | { type: "next-week" }               // next Monday → following Sunday
  | { type: "this-month" }              // 1 day out → end of current calendar month
  | { type: "next-month" }              // 1st of next month → last day of next month
  | { type: "within-days"; days: number }
  | { type: "within-days-range"; from: number; to: number }
  | { type: "beyond-days"; days: number }; // for catch-all buckets (e.g. Someday)


export interface BucketConfig {
  id: string;
  name: string;
  /** Emoji shown before the bucket name in the panel and on quick-move buttons. */
  emoji: string;
  /** Which tasks fall into this bucket (by date). null = no auto-assign. */
  dateRangeRule: DateRangeRule | null;
  /** 1–2 bucket IDs shown as quick-move buttons on each task row. */
  quickMoveTargets: [string?, string?];
  /** Show this bucket's task count in Obsidian's status bar. */
  showInStatusBar: boolean;
}


export type StorageMode = "inline-tag" | "inline-field";

export type CelebrationMode = "off" | "confetti" | "creature" | "all";

/** Which Tasks-plugin priority levels get an emoji badge on the task row. */
export type PriorityDisplay = "all" | "medium-up" | "high-up" | "hidden";

export type TaskScope =
  | { type: "vault" }
  | { type: "folders"; paths: string[] }
  | { type: "files"; paths: string[] };

export type ScopeType = "vault" | "folders" | "files";

export interface PluginSettings {
  storageMode: StorageMode;
  /** Which scope mode is active. Path lists below persist independently of this. */
  scopeType: ScopeType;
  /** Folder paths for "folders" scope. Preserved even while a different scope mode is active. */
  folderPaths: string[];
  /** File paths for "files" scope. Preserved even while a different scope mode is active. */
  filePaths: string[];
  buckets: BucketConfig[];
  /** Last Obsidian language seen on load — used to detect language changes. */
  lastSeenLanguage: string;
  /**
   * Set once the panel has been opened for this install. Afterwards the plugin
   * never opens it itself: Obsidian restores a panel that was left open, and
   * a panel the user actually closed should stay closed.
   */
  panelOpenedOnce: boolean;
  /**
   * Used as the tag prefix in Inline tag mode (#<prefix>/bucket-id)
   * and as the field name in Inline field mode ([<prefix>:: bucket-id]).
   */
  tagPrefix: string;
  /** Completed tasks remain visible (as strikethrough) until midnight. */
  completedVisibilityUntilMidnight: boolean;
  /** Show the ! (overdue) and ⚑ (misfiled) badges on task rows. The field name
   *  predates the two-state split; it stays because it is persisted in
   *  data.json and renaming it would need a migration for no visible gain. */
  staleIndicatorEnabled: boolean;
  /** Emoji for the To Review system bucket. */
  toReviewEmoji: string;
  /** Quick-move button targets for the To Review bucket. */
  toReviewQuickMoveTargets: [string?, string?];
  /** Show the To Review bucket's task count in Obsidian's status bar. */
  toReviewShowInStatusBar: boolean;
  /** Reduce padding on headers and task rows for a more compact layout. */
  compactView: boolean;
  /** Which priority levels show a badge on the row. The popover is unaffected. */
  priorityDisplay: PriorityDisplay;
  /** Show the 🔁 badge on rows of repeating tasks. The popover is unaffected. */
  showRecurrenceBadge: boolean;
  /** Show the Tasks-plugin metadata block in the hover popover. */
  showTasksFieldsInPopover: boolean;
  /** Controls which celebration animations play on task completion. */
  celebrationMode: CelebrationMode;
  /**
   * Manual per-bucket task order from drag-and-drop, keyed by bucket ID.
   * Each value is an array of order entries (see core/TaskOrder.ts) in
   * display order. Tasks not present in a bucket's array render after it,
   * in their natural (file scan) order.
   */
  taskOrder: Record<string, OrderEntry[]>;
  /**
   * Epoch-ms timestamps for dateless completions the index actually
   * witnessed, keyed by `${file}::${key}`. Only today's records are kept —
   * OrderPurge drops older ones, and an unwitnessed completion never gets a
   * record at all, so this map cannot accumulate history.
   */
  completionSeen: Record<string, number>;
}


export const DEFAULT_BUCKETS: BucketConfig[] = [
  {
    id: "today",
    name: "Today",
    emoji: "⚡",
    dateRangeRule: { type: "today" },
    quickMoveTargets: ["this-week", "someday"],
    showInStatusBar: true,
  },
  {
    id: "this-week",
    name: "This Week",
    emoji: "📌",
    dateRangeRule: { type: "this-week" },
    quickMoveTargets: ["today", "next-week"],
    showInStatusBar: false,
  },
  {
    id: "next-week",
    name: "Next Week",
    emoji: "🔭",
    dateRangeRule: { type: "next-week" },
    quickMoveTargets: ["this-week", "this-month"],
    showInStatusBar: false,
  },
  {
    id: "this-month",
    name: "This Month",
    emoji: "📅",
    dateRangeRule: { type: "this-month" },
    quickMoveTargets: ["next-week", "someday"],
    showInStatusBar: false,
  },
  {
    id: "someday",
    name: "Someday / Maybe",
    emoji: "💭",
    dateRangeRule: null,
    quickMoveTargets: ["today", "this-week"],
    showInStatusBar: false,
  },
];

export const DEFAULT_SETTINGS: PluginSettings = {
  storageMode: "inline-tag",
  scopeType: "vault",
  folderPaths: [],
  filePaths: [],
  buckets: DEFAULT_BUCKETS,
  lastSeenLanguage: "",
  panelOpenedOnce: false,
  tagPrefix: "gtd",
  completedVisibilityUntilMidnight: true,
  staleIndicatorEnabled: true,
  toReviewEmoji: "📥",
  toReviewQuickMoveTargets: ["today", "this-week"],
  toReviewShowInStatusBar: false,
  compactView: false,
  priorityDisplay: "all",
  showRecurrenceBadge: true,
  showTasksFieldsInPopover: true,
  celebrationMode: "confetti",
  taskOrder: {},
  completionSeen: {},
};

/** Builds the scope TaskIndex scans with, from the active scopeType and its matching persistent path list. */
export function getActiveScope(
  settings: Pick<PluginSettings, "scopeType" | "folderPaths" | "filePaths">
): TaskScope {
  switch (settings.scopeType) {
    case "vault":
      return { type: "vault" };
    case "folders":
      return { type: "folders", paths: settings.folderPaths };
    case "files":
      return { type: "files", paths: settings.filePaths };
  }
}

interface LegacyTaskScope {
  type: ScopeType;
  paths?: string[];
}

/**
 * Normalizes raw loaded plugin data. Two migrations live here:
 * the pre-persistence `taskScope: {type, paths}` object is split into
 * scopeType/folderPaths/filePaths (seeded once, without losing the user's
 * existing selections), and the removed `readTasksPlugin` field is dropped —
 * 📅/✅ parsing and due-date auto-assign are unconditional now.
 */
export function migrateSettingsData(raw: unknown): Partial<PluginSettings> {
  if (!raw || typeof raw !== "object") return {};
  const data = { ...(raw as Record<string, unknown> & { taskScope?: LegacyTaskScope }) };
  delete data.readTasksPlugin;

  if (!data.taskScope || "scopeType" in data) return data as Partial<PluginSettings>;

  const { taskScope, ...rest } = data;
  const migrated: Partial<PluginSettings> = { ...rest, scopeType: taskScope.type };
  if (taskScope.type === "folders") migrated.folderPaths = taskScope.paths ?? [];
  if (taskScope.type === "files") migrated.filePaths = taskScope.paths ?? [];
  return migrated;
}

/**
 * Guards the shapes the rest of the code assumes taskOrder/completionSeen/
 * folderPaths/filePaths hold, once loadSettings() has merged raw data.json
 * onto DEFAULT_SETTINGS. A hand-edited or corrupted data.json can put any
 * JSON value under these keys (e.g. a bucket's taskOrder value being a
 * number instead of an array), which would otherwise throw deep inside
 * OrderMigration/OrderPurge. This is the single trust boundary: everything
 * downstream keeps assuming the typed shape and stays unguarded.
 */
export function normalizeSettingsShapes(settings: PluginSettings): PluginSettings {
  const rawTaskOrder = settings.taskOrder as unknown;
  const taskOrder: Record<string, OrderEntry[]> = {};
  if (rawTaskOrder && typeof rawTaskOrder === "object") {
    for (const [bucketId, value] of Object.entries(rawTaskOrder as Record<string, unknown>)) {
      if (Array.isArray(value)) taskOrder[bucketId] = value as OrderEntry[];
    }
  }

  const rawCompletionSeen = settings.completionSeen as unknown;
  const completionSeen: Record<string, number> = {};
  if (rawCompletionSeen && typeof rawCompletionSeen === "object") {
    for (const [id, value] of Object.entries(rawCompletionSeen as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) completionSeen[id] = value;
    }
  }

  return {
    ...settings,
    taskOrder,
    completionSeen,
    folderPaths: Array.isArray(settings.folderPaths) ? settings.folderPaths : [],
    filePaths: Array.isArray(settings.filePaths) ? settings.filePaths : [],
  };
}

/** Whether `path` falls inside `scope`. Extension filtering is the caller's job. */
export function isPathInScope(path: string, scope: TaskScope): boolean {
  switch (scope.type) {
    case "vault":
      return true;
    case "folders":
      return scope.paths.some((p) => path.startsWith(p.endsWith("/") ? p : p + "/"));
    case "files":
      return scope.paths.includes(path);
  }
}
