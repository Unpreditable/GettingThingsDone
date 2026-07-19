import { getActiveScope, migrateSettingsData } from "../src/settings";

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
});
