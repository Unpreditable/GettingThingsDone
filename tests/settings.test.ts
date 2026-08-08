import { getActiveScope, isPathInScope, migrateSettingsData, normalizeSettingsShapes, DEFAULT_SETTINGS } from "../src/settings";
import type { PluginSettings } from "../src/settings";

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
    expect(migrateSettingsData(data)).toEqual(data);
  });

  it("migrates a legacy vault taskScope", () => {
    const data = { taskScope: { type: "vault" }, tagPrefix: "gtd" };
    expect(migrateSettingsData(data)).toEqual({ tagPrefix: "gtd", scopeType: "vault" });
  });

  it("migrates a legacy folders taskScope into folderPaths", () => {
    const data = { taskScope: { type: "folders", paths: ["Tasks", "Work"] } };
    expect(migrateSettingsData(data)).toEqual({ scopeType: "folders", folderPaths: ["Tasks", "Work"] });
  });

  it("migrates a legacy files taskScope into filePaths", () => {
    const data = { taskScope: { type: "files", paths: ["Tasks/inbox.md"] } };
    expect(migrateSettingsData(data)).toEqual({ scopeType: "files", filePaths: ["Tasks/inbox.md"] });
  });

  it("does not re-migrate data that already has scopeType", () => {
    const data = { scopeType: "folders", folderPaths: ["Tasks"] };
    expect(migrateSettingsData(data)).toEqual(data);
  });

  it("drops the removed readTasksPlugin field", () => {
    expect(migrateSettingsData({ scopeType: "vault", readTasksPlugin: true })).toEqual({
      scopeType: "vault",
    });
  });

  it("drops readTasksPlugin while also migrating a legacy taskScope", () => {
    expect(migrateSettingsData({ taskScope: { type: "vault" }, readTasksPlugin: false })).toEqual({
      scopeType: "vault",
    });
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
