import {
  getActiveScope,
  isPathInScope,
  migrateSettingsData,
  normalizeSettingsShapes,
  shouldAdoptCatchAll,
  shouldRecommendCatchAll,
  DEFAULT_BUCKETS,
  DEFAULT_SETTINGS,
} from "../src/settings";
import type { BucketConfig, PluginSettings } from "../src/settings";

describe("getActiveScope", () => {
  it("returns a vault scope when scopeType is vault", () => {
    const scope = getActiveScope({ scopeType: "vault", folderPaths: ["ignored"], filePaths: ["ignored"] });
    expect(scope).toEqual({ type: "vault" });
  });

  it("returns a folders scope using folderPaths when scopeType is folders", () => {
    const scope = getActiveScope({ scopeType: "folders", folderPaths: ["Tasks", "Work"], filePaths: [] });
    expect(scope).toEqual({ type: "folders", paths: ["Tasks", "Work"] });
  });

  it("returns a files scope using filePaths when scopeType is files", () => {
    const scope = getActiveScope({ scopeType: "files", folderPaths: [], filePaths: ["Tasks/inbox.md"] });
    expect(scope).toEqual({ type: "files", paths: ["Tasks/inbox.md"] });
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

  it("migrates a legacy folders taskScope into folderPaths", () => {
    const data = { taskScope: { type: "folders", paths: ["Tasks", "Work"] } };
    expect(migrateSettingsData(data)).toEqual({
      scopeType: "folders",
      folderPaths: ["Tasks", "Work"],
      planBy: "due-only",
    });
  });

  it("migrates a legacy files taskScope into filePaths", () => {
    const data = { taskScope: { type: "files", paths: ["Tasks/inbox.md"] } };
    expect(migrateSettingsData(data)).toEqual({
      scopeType: "files",
      filePaths: ["Tasks/inbox.md"],
      planBy: "due-only",
    });
  });

  it("does not re-migrate data that already has scopeType", () => {
    const data = { scopeType: "folders", folderPaths: ["Tasks"] };
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
      folderPaths: ["Tasks"],
      filePaths: ["a.md"],
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

  it("forces folderPaths/filePaths to an array if they are not one", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      folderPaths: "Tasks",
      filePaths: null,
    } as unknown as PluginSettings;
    const result = normalizeSettingsShapes(settings);
    expect(result.folderPaths).toEqual([]);
    expect(result.filePaths).toEqual([]);
  });
});

describe("isPathInScope", () => {
  it("accepts every path under a vault scope", () => {
    expect(isPathInScope("anything/at/all.md", { type: "vault" })).toBe(true);
  });

  it("matches folder scopes by prefix, with or without a trailing slash", () => {
    expect(isPathInScope("Tasks/a.md", { type: "folders", paths: ["Tasks"] })).toBe(true);
    expect(isPathInScope("Tasks/a.md", { type: "folders", paths: ["Tasks/"] })).toBe(true);
    expect(isPathInScope("TasksArchive/a.md", { type: "folders", paths: ["Tasks"] })).toBe(false);
  });

  it("matches file scopes by exact path", () => {
    expect(isPathInScope("Tasks/a.md", { type: "files", paths: ["Tasks/a.md"] })).toBe(true);
    expect(isPathInScope("Tasks/b.md", { type: "files", paths: ["Tasks/a.md"] })).toBe(false);
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
