import { clearTaskDate, getInlineFieldValue, getTagValue, parseFile, setTaskDate } from "../TaskParser";
import { applyBucketChange } from "../TaskWriter";
import { dayKey } from "../DueStatus";
import type { DateField } from "../DateMenu";
import type { PluginSettings } from "../../settings";

/** The fields a plan can change. Dates are YYYY-MM-DD, the bucket is its stored id, null is absent. */
export interface PlanFields {
  bucket: string | null;
  due: string | null;
  scheduled: string | null;
}

const DATE_FIELDS: DateField[] = ["due", "scheduled"];

function bucketKey(settings: PluginSettings): string | undefined {
  return settings.storageMode === "inline-field" ? settings.tagPrefix : undefined;
}

export function readPlanFields(line: string, settings: PluginSettings): PlanFields {
  const bucket =
    settings.storageMode === "inline-field"
      ? getInlineFieldValue(line, settings.tagPrefix)
      : getTagValue(line, settings.tagPrefix);
  const task = parseFile("", line, { strings: [], includeSubtasks: false, bucketField: bucketKey(settings) })[0];
  return {
    bucket,
    due: task?.dueDate ? dayKey(task.dueDate) : null,
    scheduled: task?.scheduledDate ? dayKey(task.scheduledDate) : null,
  };
}

/** Writes only the fields present in `fields`. */
export function writePlanFields(line: string, fields: Partial<PlanFields>, settings: PluginSettings): string {
  let out = line;
  if ("bucket" in fields) {
    const bucket = fields.bucket ?? null;
    if (bucket !== readPlanFields(out, settings).bucket) {
      out = applyBucketChange(out, bucket === null ? null : { id: bucket }, settings);
    }
  }
  for (const field of DATE_FIELDS) {
    if (!(field in fields)) continue;
    const date = fields[field] ?? null;
    if (date === readPlanFields(out, settings)[field]) continue;
    out = date === null ? clearTaskDate(out, field, bucketKey(settings)) : setTaskDate(out, field, date, bucketKey(settings));
  }
  return out;
}
