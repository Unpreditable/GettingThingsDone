import {
  getActiveScope,
  isPathInScope,
  matchesEntry,
  migrateSettingsData,
  normalizeSettingsShapes,
  shouldAdoptCatchAll,
  shouldRecommendCatchAll,
  DEFAULT_BUCKETS,
  DEFAULT_SETTINGS,
} from "../src/settings";
import type { BucketConfig, PathEntry, PluginSettings } from "../src/settings";

describe("getActiveScope", () => {
  const folder = (path: string): PathEntry => ({ type: "folder", path });
  const file = (path: string): PathEntry => ({ type: "file", path });

  it("returns a vault scope carrying the exclusion list", () => {
    const scope = getActiveScope({
      scopeType: "vault",
      scopePaths: [folder("parked")],
      ignoredPaths: [folder("Templates")],
    });
    expect(scope).toEqual({ type: "vault", ignored: [folder("Templates")] });
  });

  it("returns a paths scope using scopePaths", () => {
    const scope = getActiveScope({
      scopeType: "paths",
      scopePaths: [folder("Tasks"), file("Work/inbox.md")],
      ignoredPaths: [folder("parked")],
    });
    expect(scope).toEqual({ type: "paths", included: [folder("Tasks"), file("Work/inbox.md")] });
  });
});

describe("migrateSettingsData", () => {
  it("returns an empty object for null/undefined input", () => {
    expect(migrateSettingsData(null)).toEqual({});
    expect(migrateSettingsData(undefined)).toEqual({});
  });

  it("passes through data that has no legacy taskScope field", () => {
    const data = { scopeType: "vault", tagPrefix: "gtd" };
    expect(migrateSettingsData(data)).toEqual({ ...data, planBy: "due-only" });
  });

  it("migrates a legacy vault taskScope", () => {
    const data = { taskScope: { type: "vault" }, tagPrefix: "gtd" };
    expect(migrateSettingsData(data)).toEqual({ tagPrefix: "gtd", scopeType: "vault", planBy: "due-only" });
  });

  // Two generations of scope shape in one call: the taskScope object becomes
  // folderPaths, which then becomes a typed scopePaths entry.
  it("migrates a legacy folders taskScope all the way to scopePaths", () => {
    const data = { taskScope: { type: "folders", paths: ["Tasks", "Work"] } };
    expect(migrateSettingsData(data)).toEqual({
      scopeType: "paths",
      scopePaths: [
        { type: "folder", path: "Tasks" },
        { type: "folder", path: "Work" },
      ],
      planBy: "due-only",
    });
  });

  it("migrates a legacy files taskScope all the way to scopePaths", () => {
    const data = { taskScope: { type: "files", paths: ["Tasks/inbox.md"] } };
    expect(migrateSettingsData(data)).toEqual({
      scopeType: "paths",
      scopePaths: [{ type: "file", path: "Tasks/inbox.md" }],
      planBy: "due-only",
    });
  });

  it("merges the folders scope into scopePaths, discarding the parked file list", () => {
    const data = { scopeType: "folders", folderPaths: ["Tasks"], filePaths: ["parked.md"] };
    expect(migrateSettingsData(data)).toEqual({
      scopeType: "paths",
      scopePaths: [{ type: "folder", path: "Tasks" }],
      planBy: "due-only",
    });
  });

  it("merges the files scope into scopePaths, discarding the parked folder list", () => {
    const data = { scopeType: "files", folderPaths: ["parked"], filePaths: ["a.md"] };
    expect(migrateSettingsData(data)).toEqual({
      scopeType: "paths",
      scopePaths: [{ type: "file", path: "a.md" }],
      planBy: "due-only",
    });
  });

  it("drops both path lists from a vault install without inventing entries", () => {
    const data = { scopeType: "vault", folderPaths: ["parked"], filePaths: ["parked.md"] };
    expect(migrateSettingsData(data)).toEqual({ scopeType: "vault", planBy: "due-only" });
  });

  // A newer build can write scopePaths before the legacy fields are gone, so
  // the migration keys off the legacy scopeType instead of that field's absence.
  it("still migrates when a stale empty scopePaths sits alongside the legacy fields", () => {
    const data = {
      scopeType: "folders",
      scopePaths: [],
      folderPaths: ["Tasks", "Templates"],
      filePaths: ["parked.md"],
    };
    expect(migrateSettingsData(data)).toEqual({
      scopeType: "paths",
      scopePaths: [
        { type: "folder", path: "Tasks" },
        { type: "folder", path: "Templates" },
      ],
      planBy: "due-only",
    });
  });

  it("leaves already-migrated data alone", () => {
    const data = {
      scopeType: "paths",
      scopePaths: [{ type: "folder", path: "Tasks" }],
      ignoredPaths: [{ type: "folder", path: "Templates" }],
    };
    expect(migrateSettingsData(data)).toEqual({ ...data, planBy: "due-only" });
  });

  it("drops the removed readTasksPlugin field", () => {
    expect(migrateSettingsData({ scopeType: "vault", readTasksPlugin: true })).toEqual({
      scopeType: "vault",
      planBy: "due-only",
    });
  });

  it("drops readTasksPlugin while also migrating a legacy taskScope", () => {
    expect(migrateSettingsData({ taskScope: { type: "vault" }, readTasksPlugin: false })).toEqual({
      scopeType: "vault",
      planBy: "due-only",
    });
  });

  // DEFAULT_SETTINGS ships "scheduled-first", which would move every task
  // carrying a ⏳ the moment the user updated the plugin.
  it("pins an existing install to due-only, preserving today's placement", () => {
    expect(migrateSettingsData({ tagPrefix: "gtd" }).planBy).toBe("due-only");
  });

  it("leaves an explicit planBy alone", () => {
    expect(migrateSettingsData({ planBy: "earliest" }).planBy).toBe("earliest");
  });

  it("does not pin a fresh install, which has no data.json to load", () => {
    expect(migrateSettingsData(null).planBy).toBeUndefined();
    expect(DEFAULT_SETTINGS.planBy).toBe("scheduled-first");
  });
});

describe("catch-all adoption", () => {
  const defaults = () => DEFAULT_BUCKETS.map((b) => ({ ...b }));

  /** DEFAULT_BUCKETS as they shipped before the catch-all rule existed. */
  function legacyBuckets(): BucketConfig[] {
    const buckets = defaults();
    buckets[buckets.length - 1].dateRangeRule = null;
    return buckets;
  }

  it("adopts on an install whose rules are untouched", () => {
    expect(shouldAdoptCatchAll(legacyBuckets())).toBe(true);
  });

  it("does not adopt twice", () => {
    expect(shouldAdoptCatchAll(defaults())).toBe(false);
  });

  it("ignores cosmetic edits — only date rules count as customisation", () => {
    const buckets = legacyBuckets();
    buckets[0].name = "Aujourd'hui";
    buckets[0].emoji = "🔥";
    buckets[1].quickMoveTargets = ["someday", undefined];
    expect(shouldAdoptCatchAll(buckets)).toBe(true);
  });

  it("refuses when any date rule was customised", () => {
    const buckets = legacyBuckets();
    buckets[1].dateRangeRule = { type: "within-days", days: 3 };
    expect(shouldAdoptCatchAll(buckets)).toBe(false);
  });

  it("refuses when the bucket set was changed", () => {
    expect(shouldAdoptCatchAll(legacyBuckets().slice(0, 3))).toBe(false);

    const renamedId = legacyBuckets();
    renamedId[2].id = "later";
    expect(shouldAdoptCatchAll(renamedId)).toBe(false);
  });

  it("recommends instead of rewriting when the config is customised", () => {
    const buckets = legacyBuckets();
    buckets[1].dateRangeRule = { type: "within-days", days: 3 };
    expect(shouldRecommendCatchAll(buckets)).toBe(true);
  });

  it("stays quiet once there is nothing to recommend", () => {
    expect(shouldRecommendCatchAll(defaults())).toBe(false);
    // An untouched install is adopted silently, so it is never nagged.
    expect(shouldRecommendCatchAll(legacyBuckets())).toBe(false);
  });

  // loadSettings derives the flag this way, once, after the silent adoption.
  // These pin the three shapes that derivation has to get right.
  const noticeSeenFor = (buckets: BucketConfig[]) => !shouldRecommendCatchAll(buckets);

  it("marks the notice seen on a fresh install, whose defaults already catch all", () => {
    expect(noticeSeenFor(defaults())).toBe(true);
  });

  it("marks the notice seen for an install that was adopted silently", () => {
    const adopted = legacyBuckets();
    adopted[adopted.length - 1].dateRangeRule = { type: "catch-all" };
    expect(noticeSeenFor(adopted)).toBe(true);
  });

  it("leaves the notice unseen only where rules were genuinely left alone", () => {
    const customised = legacyBuckets();
    customised[1].dateRangeRule = { type: "within-days", days: 3 };
    expect(noticeSeenFor(customised)).toBe(false);
  });

  it("does not fire for a customised config whose last bucket already claims a range", () => {
    const customised = legacyBuckets();
    customised[1].dateRangeRule = { type: "within-days", days: 3 };
    customised[customised.length - 1].dateRangeRule = { type: "beyond-days", days: 90 };
    expect(noticeSeenFor(customised)).toBe(true);
  });
});

describe("normalizeSettingsShapes", () => {
  it("passes through already-well-formed settings unchanged", () => {
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      taskOrder: { today: [{ file: "a.md", key: "k1" }] },
      completionSeen: { "a.md::k1": 123 },
      scopePaths: [{ type: "folder", path: "Tasks" }],
      ignoredPaths: [{ type: "file", path: "a.md" }],
    };
    expect(normalizeSettingsShapes(settings)).toEqual(settings);
  });

  it("keeps a recognised week start and falls back to Monday otherwise", () => {
    const sunday = { ...DEFAULT_SETTINGS, weekStartsOn: "sunday" as const };
    expect(normalizeSettingsShapes(sunday).weekStartsOn).toBe("sunday");

    const junk = { ...DEFAULT_SETTINGS, weekStartsOn: "caturday" } as unknown as PluginSettings;
    expect(normalizeSettingsShapes(junk).weekStartsOn).toBe("monday");
  });

  it("drops taskOrder bucket values that are not arrays", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      taskOrder: { today: 5, week: null, ok: [{ file: "a.md", key: "k1" }] },
    } as unknown as PluginSettings;
    expect(normalizeSettingsShapes(settings).taskOrder).toEqual({
      ok: [{ file: "a.md", key: "k1" }],
    });
  });

  it("tolerates taskOrder itself being null or a primitive", () => {
    const asNull = { ...DEFAULT_SETTINGS, taskOrder: null } as unknown as PluginSettings;
    expect(normalizeSettingsShapes(asNull).taskOrder).toEqual({});

    const asPrimitive = { ...DEFAULT_SETTINGS, taskOrder: 5 } as unknown as PluginSettings;
    expect(normalizeSettingsShapes(asPrimitive).taskOrder).toEqual({});
  });

  it("drops completionSeen values that are not finite numbers", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      completionSeen: { a: "not-a-number", b: NaN, c: Infinity, d: 42 },
    } as unknown as PluginSettings;
    expect(normalizeSettingsShapes(settings).completionSeen).toEqual({ d: 42 });
  });

  it("rejects an order key scheme that is not one this build knows", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      orderKeyScheme: "by-vibes",
    } as unknown as PluginSettings;
    expect(normalizeSettingsShapes(settings).orderKeyScheme).toBeNull();
  });

  it("keeps a recognised order key scheme", () => {
    const settings: PluginSettings = { ...DEFAULT_SETTINGS, orderKeyScheme: "due-only" };
    expect(normalizeSettingsShapes(settings).orderKeyScheme).toBe("due-only");
  });

  it("forces the path lists to an array if they are not one", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      scopePaths: "Tasks",
      ignoredPaths: null,
    } as unknown as PluginSettings;
    const result = normalizeSettingsShapes(settings);
    expect(result.scopePaths).toEqual([]);
    expect(result.ignoredPaths).toEqual([]);
  });

  it("drops path entries that are not well-formed, keeping the rest", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      scopePaths: [
        { type: "folder", path: "Tasks" },
        "Tasks",
        null,
        { type: "symlink", path: "Tasks" },
        { type: "file" },
        { type: "file", path: 5 },
        { type: "file", path: "a.md" },
      ],
    } as unknown as PluginSettings;
    expect(normalizeSettingsShapes(settings).scopePaths).toEqual([
      { type: "folder", path: "Tasks" },
      { type: "file", path: "a.md" },
    ]);
  });
});

describe("matchesEntry", () => {
  it("matches a folder entry against everything beneath it", () => {
    expect(matchesEntry("Tasks/a.md", { type: "folder", path: "Tasks" })).toBe(true);
    expect(matchesEntry("Tasks/deep/a.md", { type: "folder", path: "Tasks" })).toBe(true);
  });

  it("tolerates a trailing slash on a folder entry", () => {
    expect(matchesEntry("Tasks/a.md", { type: "folder", path: "Tasks/" })).toBe(true);
  });

  it("does not let a folder entry swallow a sibling sharing its prefix", () => {
    expect(matchesEntry("TasksArchive/a.md", { type: "folder", path: "Tasks" })).toBe(false);
  });

  it("matches a file entry only against itself", () => {
    expect(matchesEntry("Tasks/a.md", { type: "file", path: "Tasks/a.md" })).toBe(true);
    expect(matchesEntry("Tasks/b.md", { type: "file", path: "Tasks/a.md" })).toBe(false);
  });
});

describe("isPathInScope", () => {
  it("accepts every path when nothing is excluded", () => {
    expect(isPathInScope("anything/at/all.md", { type: "vault", ignored: [] })).toBe(true);
  });

  it("rejects a path covered by an exclusion entry and admits the rest", () => {
    const scope = {
      type: "vault" as const,
      ignored: [
        { type: "folder" as const, path: "Templates" },
        { type: "file" as const, path: "Notes/scratch.md" },
      ],
    };
    expect(isPathInScope("Templates/daily.md", scope)).toBe(false);
    expect(isPathInScope("Notes/scratch.md", scope)).toBe(false);
    expect(isPathInScope("Notes/real.md", scope)).toBe(true);
  });

  it("admits only what a paths scope lists, mixing folders and files", () => {
    const scope = {
      type: "paths" as const,
      included: [
        { type: "folder" as const, path: "Projects" },
        { type: "file" as const, path: "Inbox.md" },
      ],
    };
    expect(isPathInScope("Projects/a.md", scope)).toBe(true);
    expect(isPathInScope("Inbox.md", scope)).toBe(true);
    expect(isPathInScope("Archive/a.md", scope)).toBe(false);
  });

  it("admits nothing when a paths scope is empty", () => {
    expect(isPathInScope("a.md", { type: "paths", included: [] })).toBe(false);
  });
});

describe("Tasks integration defaults", () => {
  it("shows all priority levels by default", () => {
    expect(DEFAULT_SETTINGS.priorityDisplay).toBe("all");
  });

  it("keeps the recurrence badge and popover fields on, matching current behaviour", () => {
    expect(DEFAULT_SETTINGS.showRecurrenceBadge).toBe(true);
    expect(DEFAULT_SETTINGS.showTasksFieldsInPopover).toBe(true);
  });
});
