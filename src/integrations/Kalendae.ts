import type { App } from "obsidian";

/** Inclusive YYYY-MM-DD bounds. */
export interface DayRange {
  from: string;
  to: string;
}

/**
 * Opens a calendar by `anchor` and resolves with the picked day, or null if none
 * was picked.
 */
export type DatePicker = (
  value: string,
  anchor: HTMLElement | MouseEvent,
  allowed?: DayRange[]
) => Promise<string | null>;

/** Where Kalendae stands, and so what a Custom… click does. */
export type KalendaeState =
  | { kind: "ready"; pick: DatePicker }
  | { kind: "outdated"; version: string }
  | { kind: "missing" }
  | { kind: "disabled" }
  | { kind: "unloaded" };

/** The first release whose `pickDate` honours `allowed`. */
export const MIN_KALENDAE_VERSION = "1.7.0";

export const KALENDAE_ID = "kalendae";

interface KalendaeApi {
  pickDate?: (options: {
    value: string;
    anchor: HTMLElement | MouseEvent;
    allowed?: DayRange[];
  }) => Promise<string | null>;
}

/** The parts of Obsidian's plugin manager this file reads; obsidian.d.ts leaves them out. */
interface PluginManager {
  manifests?: Record<string, { version?: string }>;
  enabledPlugins?: Set<string>;
  plugins?: Record<string, { manifest?: { version?: string }; api?: KalendaeApi }>;
  enablePluginAndSave?: (id: string) => Promise<boolean>;
}

const DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function pluginManager(app: App): PluginManager | undefined {
  return (app as App & { plugins?: PluginManager }).plugins;
}

function isAtLeast(version: string, minimum: string): boolean {
  const parts = (v: string) => v.split(".").map((part) => parseInt(part, 10) || 0);
  const have = parts(version);
  const need = parts(minimum);
  for (let i = 0; i < need.length; i++) {
    if ((have[i] ?? 0) !== need[i]) return (have[i] ?? 0) > need[i];
  }
  return true;
}

/** Values on both sides of the picker are YYYY-MM-DD. */
export function kalendaeState(app: App): KalendaeState {
  const plugins = pluginManager(app);
  const loaded = plugins?.plugins?.[KALENDAE_ID];
  // The manifest list holds every installed plugin, on or off.
  const version = loaded?.manifest?.version ?? plugins?.manifests?.[KALENDAE_ID]?.version;
  if (version === undefined) return { kind: "missing" };
  if (!isAtLeast(version, MIN_KALENDAE_VERSION)) return { kind: "outdated", version };
  if (!loaded && !plugins?.enabledPlugins?.has(KALENDAE_ID)) return { kind: "disabled" };

  const api = loaded?.api;
  const pickDate = api?.pickDate;
  if (typeof pickDate !== "function") return { kind: "unloaded" };

  return {
    kind: "ready",
    pick: async (value, anchor, allowed) => {
      try {
        const day = await pickDate.call(api, allowed ? { value, anchor, allowed } : { value, anchor });
        return typeof day === "string" && DAY_REGEX.test(day) ? day : null;
      } catch {
        return null;
      }
    },
  };
}

/** Enables Kalendae, as its toggle in Settings → Community plugins does. */
export async function enableKalendae(app: App): Promise<boolean> {
  const enable = pluginManager(app)?.enablePluginAndSave;
  if (typeof enable !== "function") return false;
  try {
    return (await enable.call(pluginManager(app), KALENDAE_ID)) !== false;
  } catch {
    return false;
  }
}
