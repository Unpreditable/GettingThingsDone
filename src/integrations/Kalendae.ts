import type { App } from "obsidian";

/** Inclusive YYYY-MM-DD bounds. */
export interface DayRange {
  from: string;
  to: string;
}

/**
 * Opens a calendar by `anchor` and resolves with the picked day, or null if none
 * was picked. A Kalendae too old to know `allowed` ignores it.
 */
export type DatePicker = (
  value: string,
  anchor: HTMLElement | MouseEvent,
  allowed?: DayRange[]
) => Promise<string | null>;

interface KalendaeApi {
  pickDate?: (options: {
    value: string;
    anchor: HTMLElement | MouseEvent;
    allowed?: DayRange[];
  }) => Promise<string | null>;
}

const DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar of the Kalendae plugin, if it is installed, enabled and new
 * enough to expose one. Values on both sides are YYYY-MM-DD.
 */
export function getDatePicker(app: App): DatePicker | null {
  const plugins = (app as App & {
    plugins?: { plugins?: Record<string, { api?: KalendaeApi }> };
  }).plugins;
  const api = plugins?.plugins?.["kalendae"]?.api;
  const pickDate = api?.pickDate;
  if (typeof pickDate !== "function") return null;

  return async (value, anchor, allowed) => {
    try {
      const day = await pickDate.call(api, allowed ? { value, anchor, allowed } : { value, anchor });
      return typeof day === "string" && DAY_REGEX.test(day) ? day : null;
    } catch {
      return null;
    }
  };
}
