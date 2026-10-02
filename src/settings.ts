import type { OrderEntry, OrderKeyScheme } from "./core/TaskOrder";

export type DateRangeRule =
  | { type: "today" }
  | { type: "this-week" }               // tomorrow → last day of the current week
  | { type: "next-week" }               // the seven days of the following week
  | { type: "this-month" }              // 1 day out → end of current calendar month
  | { type: "next-month" }              // 1st of next month → last day of next month
  | { type: "within-days"; days: number }
  | { type: "within-days-range"; from: number; to: number }
  | { type: "beyond-days"; days: number }
  | { type: "catch-all" };              // matches any date; only useful on the last bucket


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

/**
 * Which Tasks-plugin date decides a task's bucket and its order within it.
 * core/PlanningDate.ts is the only place the precedence rules live.
 */
export type PlanBy =
  | "manual"
  | "due-only"
  | "due-first"
  | "scheduled-first"
  | "scheduled-only"
  | "earliest";

export type CelebrationMode = "off" | "confetti" | "creature" | "all";

/** Which Tasks-plugin priority levels get an emoji badge on the task row. */
export type PriorityDisplay = "all" | "medium-up" | "high-up" | "hidden";

export type WeekStart =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

/**
 * Sunday first, so an entry's index is its JS `Date.getDay()` value. Both the
 * settings dropdown and weekStartIndex() read the order from here.
 */
export const WEEK_STARTS: readonly WeekStart[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** A WeekStart as the 0–6 day number `Date.getDay()` uses. */
export function weekStartIndex(weekStart: WeekStart): number {
  return WEEK_STARTS.indexOf(weekStart);
}

/**
 * One entry in a scope or exclusion list. The type is stored rather than
 * inferred from what the path currently resolves to, so an entry whose target
 * has been renamed away can still be reported as a missing folder or a missing
 * file rather than an untyped dead path.
 */
export type PathEntry = { type: "folder" | "file"; path: string };

export type TaskScope =
  | { type: "vault"; ignored: PathEntry[] }
  | { type: "paths"; included: PathEntry[] };

export type ScopeType = "vault" | "paths";

export interface PluginSettings {
  storageMode: StorageMode;
  planBy: PlanBy;
  /** Which scope mode is active. Both lists below persist independently of this. */
  scopeType: ScopeType;
  /** Paths scanned in "paths" scope. Preserved even while vault scope is active. */
  scopePaths: PathEntry[];
  /** Paths skipped in "vault" scope. Preserved even while paths scope is active. */
  ignoredPaths: PathEntry[];
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
  /** Show the overdue and misfiled badges on task rows. The field name
   *  predates the two-state split; it stays because it is persisted in
   *  data.json and renaming it would need a migration for no visible gain. */
  staleIndicatorEnabled: boolean;
  /** Emoji for the To Review system bucket. */
  toReviewEmoji: string;
  /** Quick-move button targets for the To Review bucket. */
  toReviewQuickMoveTargets: [string?, string?];
  /** Show the To Review bucket's task count in Obsidian's status bar. */
  toReviewShowInStatusBar: boolean;
  /** Whether the catch-all recommendation has been settled for this install.
   *  Written once on first load and never revisited, so customising a bucket
   *  rule months later cannot resurrect a banner about a migration that never
   *  applied here. */
  catchAllNoticeSeen: boolean;
  /** First day of the week, for the this-week and next-week date rules only. */
  weekStartsOn: WeekStart;
  /** Whether the one-off "the week start is configurable now" panel notice has
   *  been settled for this install. Seeded once on load, like catchAllNoticeSeen:
   *  fresh installs never see the notice, since the setting is right there. */
  weekStartNoticeSeen: boolean;
  /** A click on a link in a task row opens the link; off, it reveals the task like any other click. */
  openLinksOnClick: boolean;
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
  /**
   * Which scheme the keys in taskOrder were hashed under, since the planning
   * date is part of a key and planBy chooses it. Null means a data.json
   * written before this release, whose keys are in the "dual-date" scheme.
   * reconcileOrderState re-keys and then keeps this in step.
   */
  orderKeyScheme: OrderKeyScheme | null;
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
    // Without a catch-all here, anything dated past the end of the calendar
    // month matches no rule and pools in To Review.
    dateRangeRule: { type: "catch-all" },
    quickMoveTargets: ["today", "this-week"],
    showInStatusBar: false,
  },
];

export const DEFAULT_SETTINGS: PluginSettings = {
  storageMode: "inline-tag",
  planBy: "scheduled-first",
  scopeType: "vault",
  scopePaths: [],
  ignoredPaths: [],
  buckets: DEFAULT_BUCKETS,
  lastSeenLanguage: "",
  panelOpenedOnce: false,
  tagPrefix: "gtd",
  completedVisibilityUntilMidnight: true,
  staleIndicatorEnabled: true,
  toReviewEmoji: "📥",
  toReviewQuickMoveTargets: ["today", "this-week"],
  toReviewShowInStatusBar: false,
  catchAllNoticeSeen: false,
  weekStartsOn: "monday",
  weekStartNoticeSeen: false,
  openLinksOnClick: true,
  compactView: false,
  priorityDisplay: "all",
  showRecurrenceBadge: true,
  showTasksFieldsInPopover: true,
  celebrationMode: "confetti",
  taskOrder: {},
  completionSeen: {},
  orderKeyScheme: null,
};

/**
 * The scheme the keys currently sitting in taskOrder are hashed under — which
 * is NOT necessarily planBy, since a data.json predating this field holds
 * dual-date keys until reconcileOrderState re-keys them. Everything that reads
 * or writes a stored entry must go through this; only the date merge itself
 * reads planBy directly.
 */
export function activeOrderKeyScheme(
  settings: Pick<PluginSettings, "orderKeyScheme">
): OrderKeyScheme {
  return settings.orderKeyScheme ?? "dual-date";
}

/** Builds the scope TaskIndex scans with, from the active scopeType and its matching persistent path list. */
export function getActiveScope(
  settings: Pick<PluginSettings, "scopeType" | "scopePaths" | "ignoredPaths">
): TaskScope {
  switch (settings.scopeType) {
    case "vault":
      return { type: "vault", ignored: settings.ignoredPaths };
    case "paths":
      return { type: "paths", included: settings.scopePaths };
  }
}

type LegacyScopeType = "vault" | "folders" | "files";

/** Scope fields as they sit in a data.json written before the lists merged. */
interface LegacyScopeFields {
  taskScope?: { type: LegacyScopeType; paths?: string[] };
  scopeType?: LegacyScopeType | ScopeType;
  folderPaths?: string[];
  filePaths?: string[];
}

/**
 * Normalizes raw loaded plugin data. Four migrations live here, and the two
 * scope ones run in sequence so a data.json old enough to need both is carried
 * all the way forward in a single load:
 *
 * 1. The pre-persistence `taskScope: {type, paths}` object splits into
 *    scopeType plus the two typed path lists.
 * 2. Those two lists merge into one `scopePaths` list of typed entries, and
 *    the "folders"/"files" scope types collapse into "paths".
 * 3. The removed `readTasksPlugin` field is dropped — 📅/✅ parsing and
 *    due-date auto-assign are unconditional now.
 * 4. An install that predates `planBy` is pinned to "due-only" —
 *    DEFAULT_SETTINGS ships "scheduled-first", which would rearrange the board
 *    of every existing user with a ⏳ anywhere. Reaching this function at all
 *    means a data.json existed, which is exactly the "existing install" test.
 */
export function migrateSettingsData(raw: unknown): Partial<PluginSettings> {
  if (!raw || typeof raw !== "object") return {};
  const data = { ...(raw as Record<string, unknown> & LegacyScopeFields) };
  delete data.readTasksPlugin;

  if (data.planBy === undefined) data.planBy = "due-only";

  if (data.taskScope && !("scopeType" in data)) {
    const { taskScope } = data;
    delete data.taskScope;
    data.scopeType = taskScope.type;
    if (taskScope.type === "folders") data.folderPaths = taskScope.paths ?? [];
    if (taskScope.type === "files") data.filePaths = taskScope.paths ?? [];
  }

  // Keyed on the legacy scopeType rather than on scopePaths being absent: only
  // a pre-merge data.json can say "folders" or "files", so the branch cannot
  // fire twice, and a stale scopePaths left behind by a newer build cannot
  // suppress a migration that still needs to happen.
  //
  // Only the list belonging to the mode that was actually active carries over.
  // Merging both would hand a "specific files" user the folders they had parked
  // in the other list, widening what gets scanned without them asking.
  const active = data.scopeType;
  if (active === "folders" || active === "files") {
    const type = active === "folders" ? "folder" : "file";
    const paths = (active === "folders" ? data.folderPaths : data.filePaths) ?? [];
    data.scopeType = "paths";
    data.scopePaths = paths.map((path) => ({ type, path }));
  }
  delete data.folderPaths;
  delete data.filePaths;

  return data as Partial<PluginSettings>;
}

function sameRule(a: DateRangeRule | null, b: DateRangeRule | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "within-days":
    case "beyond-days":
      return a.days === (b as typeof a).days;
    case "within-days-range":
      return a.from === (b as typeof a).from && a.to === (b as typeof a).to;
    default:
      return true;
  }
}

/**
 * Whether the catch-all can be given to the last bucket without overwriting a
 * deliberate choice. Names, emoji and quick-move targets are ignored: they are
 * cosmetic and cannot move a task.
 *
 * The last bucket is compared against `null`, not DEFAULT_BUCKETS, because null
 * is the rule it shipped with before the catch-all existed.
 */
export function shouldAdoptCatchAll(buckets: BucketConfig[]): boolean {
  if (buckets.length !== DEFAULT_BUCKETS.length) return false;
  const lastIdx = buckets.length - 1;
  return buckets.every((b, i) => {
    if (b.id !== DEFAULT_BUCKETS[i].id) return false;
    return i === lastIdx ? b.dateRangeRule === null : sameRule(b.dateRangeRule, DEFAULT_BUCKETS[i].dateRangeRule);
  });
}

/**
 * A customised config whose last bucket still can't catch far-future dates. The
 * panel recommends a fix rather than rewriting rules the user chose themselves.
 */
export function shouldRecommendCatchAll(buckets: BucketConfig[]): boolean {
  const last = buckets[buckets.length - 1];
  return last !== undefined && last.dateRangeRule === null && !shouldAdoptCatchAll(buckets);
}

/** Drops anything in a stored path list that is not a well-formed PathEntry. */
function normalizePathEntries(raw: unknown): PathEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is PathEntry => {
    if (!entry || typeof entry !== "object") return false;
    const { type, path } = entry as Partial<PathEntry>;
    return (type === "folder" || type === "file") && typeof path === "string";
  });
}

/**
 * Guards the shapes the rest of the code assumes taskOrder/completionSeen/
 * scopePaths/ignoredPaths hold, once loadSettings() has merged raw data.json
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

  // An unrecognised scheme reads as "unknown", which re-keys from dual-date —
  // the same safe path a data.json predating the field takes.
  const knownSchemes: OrderKeyScheme[] = [
    "dual-date",
    "manual",
    "due-only",
    "due-first",
    "scheduled-first",
    "scheduled-only",
    "earliest",
  ];
  const scheme = settings.orderKeyScheme;

  // An unrecognised week start reads as Monday, which is what every install
  // predating the setting was hardcoded to.
  const weekStart = settings.weekStartsOn;

  return {
    ...settings,
    taskOrder,
    completionSeen,
    orderKeyScheme:
      scheme !== null && knownSchemes.includes(scheme) ? scheme : null,
    weekStartsOn: WEEK_STARTS.includes(weekStart) ? weekStart : "monday",
    scopePaths: normalizePathEntries(settings.scopePaths),
    ignoredPaths: normalizePathEntries(settings.ignoredPaths),
  };
}

/**
 * Whether `path` matches one scope or exclusion entry. A folder entry covers
 * everything beneath it but not a sibling that merely shares its prefix
 * ("Tasks" must not swallow "TasksArchive/a.md"); a file entry covers only
 * itself.
 */
export function matchesEntry(path: string, entry: PathEntry): boolean {
  if (entry.type === "file") return path === entry.path;
  const prefix = entry.path.endsWith("/") ? entry.path : entry.path + "/";
  return path.startsWith(prefix);
}

/** Whether `path` falls inside `scope`. Extension filtering is the caller's job. */
export function isPathInScope(path: string, scope: TaskScope): boolean {
  switch (scope.type) {
    case "vault":
      return !scope.ignored.some((entry) => matchesEntry(path, entry));
    case "paths":
      return scope.included.some((entry) => matchesEntry(path, entry));
  }
}
