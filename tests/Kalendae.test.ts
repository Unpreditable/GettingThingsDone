import { enableKalendae, kalendaeState } from "../src/integrations/Kalendae";
import type { DatePicker } from "../src/integrations/Kalendae";
import type { App } from "obsidian";

interface Setup {
  /** The installed version; left out, Kalendae is not installed. */
  version?: string;
  enabled?: boolean;
  /** The loaded plugin, present only while it is on. */
  loaded?: unknown;
}

function appWith({ version, enabled = false, loaded }: Setup): App {
  return {
    plugins: {
      manifests: version === undefined ? {} : { kalendae: { id: "kalendae", version } },
      enabledPlugins: new Set(enabled ? ["kalendae"] : []),
      plugins: loaded === undefined ? {} : { kalendae: loaded },
    },
  } as unknown as App;
}

function pickerOf(app: App): DatePicker {
  const state = kalendaeState(app);
  if (state.kind !== "ready") throw new Error(`expected ready, got ${state.kind}`);
  return state.pick;
}

describe("kalendaeState", () => {
  it("is missing without Kalendae", () => {
    expect(kalendaeState(appWith({})).kind).toBe("missing");
  });

  it("is outdated below 1.7.0, whether on or off", () => {
    const pickDate = jest.fn();
    expect(kalendaeState(appWith({ version: "1.6.9" })).kind).toBe("outdated");
    expect(kalendaeState(appWith({ version: "1.5.0", enabled: true, loaded: { api: { pickDate } } })).kind).toBe(
      "outdated"
    );
    expect(kalendaeState(appWith({ version: "0.10.0" })).kind).toBe("outdated");
  });

  it("carries the installed version when outdated", () => {
    expect(kalendaeState(appWith({ version: "1.5.0" }))).toEqual({ kind: "outdated", version: "1.5.0" });
  });

  it("compares versions by number, not by text", () => {
    const loaded = { api: { pickDate: jest.fn() } };
    expect(kalendaeState(appWith({ version: "1.10.0", enabled: true, loaded })).kind).toBe("ready");
    expect(kalendaeState(appWith({ version: "2.0.0", enabled: true, loaded })).kind).toBe("ready");
  });

  it("is disabled at 1.7.0 or later while off", () => {
    expect(kalendaeState(appWith({ version: "1.7.0" })).kind).toBe("disabled");
  });

  it("is unloaded when on without a usable API", () => {
    expect(kalendaeState(appWith({ version: "1.7.0", enabled: true })).kind).toBe("unloaded");
    expect(kalendaeState(appWith({ version: "1.7.0", enabled: true, loaded: {} })).kind).toBe("unloaded");
    expect(
      kalendaeState(appWith({ version: "1.7.0", enabled: true, loaded: { api: { pickDate: "nope" } } })).kind
    ).toBe("unloaded");
  });

  it("reads the version of the loaded plugin first", () => {
    const app = {
      plugins: {
        manifests: {},
        enabledPlugins: new Set(["kalendae"]),
        plugins: { kalendae: { manifest: { version: "1.7.0" }, api: { pickDate: jest.fn() } } },
      },
    } as unknown as App;
    expect(kalendaeState(app).kind).toBe("ready");
  });
});

describe("the ready picker", () => {
  const anchor = {} as MouseEvent;
  const ready = (pickDate: unknown) => appWith({ version: "1.7.0", enabled: true, loaded: { api: { pickDate } } });

  it("passes the value and anchor through and resolves the picked day", async () => {
    const pickDate = jest.fn().mockResolvedValue("2026-10-25");
    await expect(pickerOf(ready(pickDate))("2026-10-18", anchor)).resolves.toBe("2026-10-25");
    expect(pickDate).toHaveBeenCalledWith({ value: "2026-10-18", anchor });
  });

  it("passes an allowed range through to pickDate", async () => {
    const pickDate = jest.fn().mockResolvedValue("2026-11-13");
    await pickerOf(ready(pickDate))("2026-11-12", anchor, [{ from: "2026-11-12", to: "2026-11-15" }]);
    expect(pickDate).toHaveBeenCalledWith({
      value: "2026-11-12",
      anchor,
      allowed: [{ from: "2026-11-12", to: "2026-11-15" }],
    });
  });

  it("resolves null when the picker is closed", async () => {
    await expect(pickerOf(ready(() => Promise.resolve(null)))("2026-10-18", anchor)).resolves.toBeNull();
  });

  it("resolves null when the picker fails", async () => {
    await expect(pickerOf(ready(() => Promise.reject(new Error("boom"))))("2026-10-18", anchor)).resolves.toBeNull();
  });

  it("resolves null for a day not written YYYY-MM-DD", async () => {
    await expect(pickerOf(ready(() => Promise.resolve("25/10/2026")))("2026-10-18", anchor)).resolves.toBeNull();
  });
});

describe("enableKalendae", () => {
  it("enables Kalendae through Obsidian and reports success", async () => {
    const enablePluginAndSave = jest.fn().mockResolvedValue(true);
    const app = { plugins: { enablePluginAndSave } } as unknown as App;
    await expect(enableKalendae(app)).resolves.toBe(true);
    expect(enablePluginAndSave).toHaveBeenCalledWith("kalendae");
  });

  it("reports failure when Obsidian cannot enable it", async () => {
    await expect(enableKalendae({ plugins: {} } as unknown as App)).resolves.toBe(false);
    const rejects = { plugins: { enablePluginAndSave: () => Promise.reject(new Error("x")) } } as unknown as App;
    await expect(enableKalendae(rejects)).resolves.toBe(false);
  });
});
