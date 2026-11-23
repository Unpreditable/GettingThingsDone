import { parseFile } from "../TaskParser";
import type { TaskRecord } from "../TaskParser";
import { computeOrderKeys, entryId } from "../TaskOrder";
import type { OrderEntry } from "../TaskOrder";
import { groupTasksIntoBuckets } from "../BucketManager";
import type { BucketGroup } from "../BucketManager";
import { activeOrderKeyScheme } from "../../settings";
import type { PluginSettings } from "../../settings";
import { writePlanFields } from "./PlanFields";
import type { PlannedChange, PlanSnapshot } from "./Plan";

export function plannedLine(task: TaskRecord, change: PlannedChange | undefined, settings: PluginSettings): string {
  if (!change) return task.rawLine;
  const { unpinnedByDate: _flag, ...fields } = change;
  return writePlanFields(task.rawLine, fields, settings);
}

/**
 * The tasks as the plan shows them. A changed task keeps its id, line number
 * and hierarchy, so the panel's maps and the real order keys still match it;
 * only the fields the planned line changes are taken from a fresh parse.
 */
export function overlayTasks(
  real: TaskRecord[],
  changes: Record<string, PlannedChange>,
  orderKeys: Map<string, OrderEntry>,
  settings: PluginSettings
): TaskRecord[] {
  const bucketField = settings.storageMode === "inline-field" ? settings.tagPrefix : undefined;
  return real.map((task) => {
    const entry = orderKeys.get(task.id);
    const change = entry ? changes[entryId(entry)] : undefined;
    if (!change) return task;
    const line = plannedLine(task, change, settings);
    if (line === task.rawLine) return task;
    const parsed = parseFile(task.filePath, line, { strings: [], includeSubtasks: false, bucketField })[0];
    if (!parsed) return task;
    return {
      ...task,
      rawLine: line,
      dueDate: parsed.dueDate,
      scheduledDate: parsed.scheduledDate,
      tags: parsed.tags,
      inlineField: parsed.inlineField,
    };
  });
}

export function groupPlanned(
  real: TaskRecord[],
  snapshot: PlanSnapshot,
  settings: PluginSettings
): { planned: BucketGroup[]; realGroups: BucketGroup[]; orderKeys: Map<string, OrderEntry> } {
  const orderKeys = computeOrderKeys(real, activeOrderKeyScheme(settings));
  const realGroups = groupTasksIntoBuckets(real, settings, orderKeys);
  const planned = groupTasksIntoBuckets(
    overlayTasks(real, snapshot.changes, orderKeys, settings),
    { ...settings, taskOrder: snapshot.taskOrder },
    orderKeys
  );
  return { planned, realGroups, orderKeys };
}
