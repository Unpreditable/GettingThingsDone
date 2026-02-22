/**
 * Core types and default settings for the GTD Tasks plugin.
 */

// ---------------------------------------------------------------------------
// Date rule types
// ---------------------------------------------------------------------------

export type DateRangeRule =
  | { type: "today" }
  | { type: "this-week" }               // tomorrow → end of current Sunday
  | { type: "next-week" }               // next Monday → following Sunday
  | { type: "this-month" }              // 1 day out → end of current calendar month
  | { type: "next-month" }              // 1st of next month → last day of next month
  | { type: "within-days"; days: number }
  | { type: "within-days-range"; from: number; to: number }
  | { type: "beyond-days"; days: number }; // for catch-all buckets (e.g. Someday)

// ---------------------------------------------------------------------------
// Bucket configuration
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Plugin settings
// ---------------------------------------------------------------------------

export type StorageMode = "inline-tag" | "inline-field";

export type TaskScope =
  | { type: "vault" }
  | { type: "folders"; paths: string[] }
  | { type: "files"; paths: string[] };

export interface PluginSettings {
  storageMode: StorageMode;
  taskScope: TaskScope;
  buckets: BucketConfig[];
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
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

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
  taskScope: { type: "vault" },
  buckets: DEFAULT_BUCKETS,
  tagPrefix: "gtd",
  readTasksPlugin: true,
  completedVisibilityUntilMidnight: true,
  staleIndicatorEnabled: true,
  toReviewEmoji: "📥",
  toReviewQuickMoveTargets: ["today", "this-week"],
  toReviewShowInStatusBar: false,
  compactView: false,
};
