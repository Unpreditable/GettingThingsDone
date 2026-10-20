import type { PlanBy } from "../settings";
import type { TaskRecord } from "./TaskParser";
import { statusSymbol } from "./TaskParser";
import { planningDate } from "./PlanningDate";
import { dayKey } from "./DueStatus";

export type DateField = "due" | "scheduled";

export type PresetId = "today" | "tomorrow" | "startOfNextWeek" | "inOneWeek" | "inTwoWeeks";

export interface DatePreset {
  id: PresetId;
  date: Date;
  /** YYYY-MM-DD, what gets written to the line. */
  key: string;
}

/** One "Change … date" or "Set … date" item in a task row's menu. */
export interface DateEntry {
  kind: "change" | "set";
  field: DateField;
  /** The date decides placement, so a pick also removes the task's pin. */
  unpins: boolean;
}

/**
 * The date items a task's menu offers. A Change item per date the task has,
 * and a Set item when it has no date Plan by uses. Only the date that decides
 * placement unpins: changing the other one would drop the pin and leave the
 * task moving by a date nobody touched.
 */
export function dateEntries(task: TaskRecord, planBy: PlanBy, pinned: boolean): DateEntry[] {
  const status = statusSymbol(task.rawLine);
  if (planBy === "manual" || (status !== " " && status !== "/")) return [];

  const plan = planningDate(task, planBy);
  const entries: DateEntry[] = [];
  if (task.dueDate) entries.push({ kind: "change", field: "due", unpins: pinned && plan?.source === "due" });
  if (task.scheduledDate) {
    entries.push({ kind: "change", field: "scheduled", unpins: pinned && plan?.source === "scheduled" });
  }
  if (!plan) {
    const field = planBy === "due-only" || planBy === "due-first" ? "due" : "scheduled";
    entries.push({ kind: "set", field, unpins: pinned });
  }
  return entries;
}

/**
 * The preset days, counted from today. A day that an earlier preset already
 * offers, or that the date already holds, is left out — except that on the
 * week's first day, In 1 week wins over the start of next week.
 */
export function datePresets(today: Date, weekStart: number, current: Date | null): DatePreset[] {
  const plus = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const toNextWeek = 7 - ((today.getDay() - weekStart + 7) % 7);

  const candidates: [PresetId, Date][] = [
    ["today", plus(0)],
    ["tomorrow", plus(1)],
    ...(toNextWeek < 7 ? [["startOfNextWeek", plus(toNextWeek)] as [PresetId, Date]] : []),
    ["inOneWeek", plus(7)],
    ["inTwoWeeks", plus(14)],
  ];

  const seen = new Set<string>(current ? [dayKey(current)] : []);
  const presets: DatePreset[] = [];
  for (const [id, date] of candidates) {
    const key = dayKey(date);
    if (seen.has(key)) continue;
    seen.add(key);
    presets.push({ id, date, key });
  }
  return presets;
}
