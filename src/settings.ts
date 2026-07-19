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
   * Used as the tag prefix in Inline tag mode (#<prefix>/bucket-id)
   * and as the field name in Inline field mode ([<prefix>:: bucket-id]).
   */
  tagPrefix: string;
  /** If true, read 📅 / ✅ metadata from the Tasks plugin. */
  readTasksPlugin: boolean;
  /** Completed tasks remain visible (as strikethrough) until midnight. */
  completedVisibilityUntilMidnight: boolean;
  /** Show a ! indicator on tasks that are past their bucket's scheduled window. */
  staleIndicatorEnabled: boolean;
  /** Emoji for the To Review system bucket. */
  toReviewEmoji: string;
  /** Quick-move button targets for the To Review bucket. */
  toReviewQuickMoveTargets: [string?, string?];
  /** Show the To Review bucket's task count in Obsidian's status bar. */
  toReviewShowInStatusBar: boolean;
  /** Reduce padding on headers and task rows for a more compact layout. */
  compactView: boolean;
  /** Controls which celebration animations play on task completion. */
  celebrationMode: CelebrationMode;
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
  tagPrefix: "gtd",
  readTasksPlugin: true,
  completedVisibilityUntilMidnight: true,
  staleIndicatorEnabled: true,
  toReviewEmoji: "📥",
  toReviewQuickMoveTargets: ["today", "this-week"],
  toReviewShowInStatusBar: false,
  compactView: false,
  celebrationMode: "confetti",
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
 * Normalizes raw loaded plugin data for the scopeType/folderPaths/filePaths
 * split. Pre-persistence saves stored a single nested `taskScope: {type, paths}`
 * object; this seeds the new fields from it once, without losing the user's
 * existing folder/file selections on upgrade.
 */
export function migrateSettingsData(raw: unknown): Partial<PluginSettings> {
  if (!raw || typeof raw !== "object") return {};
  const data = raw as Record<string, unknown> & { taskScope?: LegacyTaskScope };
  if (!data.taskScope || "scopeType" in data) return data as Partial<PluginSettings>;

  const { taskScope, ...rest } = data;
  const migrated: Partial<PluginSettings> = { ...rest, scopeType: taskScope.type };
  if (taskScope.type === "folders") migrated.folderPaths = taskScope.paths ?? [];
  if (taskScope.type === "files") migrated.filePaths = taskScope.paths ?? [];
  return migrated;
}
