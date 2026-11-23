import { t } from "../../i18n/i18n";
import { showDay } from "./ConflictWording";
import type { PlanFields } from "./PlanFields";
import type { Indicator } from "./PlanIndicators";

/** The mark a row shows for its indicator. */
export function indicatorMark(indicator: Indicator): string {
  switch (indicator.kind) {
    case "up":
      return `↑${indicator.by}`;
    case "down":
      return `↓${indicator.by}`;
    case "bucket-up":
      return "⇑";
    case "bucket-down":
      return "⇓";
  }
}

/** The popover's lines about a task's planned changes, each naming what it was before. */
export function planNotes(
  indicator: Indicator | null,
  real: PlanFields,
  planned: PlanFields,
  bucketName: (id: string) => string
): string[] {
  const notes: string[] = [];
  if (indicator) {
    const mark = indicatorMark(indicator);
    if ("fromBucketId" in indicator) {
      notes.push(`${mark} ${t("plan.indicator.from", { bucket: bucketName(indicator.fromBucketId) })}`);
    } else {
      const key = indicator.kind === "up" ? "plan.notes.movedUp" : "plan.notes.movedDown";
      notes.push(`${mark} ${t(key, { count: indicator.by })}`);
    }
  }
  const jumped = indicator?.kind === "bucket-up" || indicator?.kind === "bucket-down";
  if (!jumped && real.bucket !== planned.bucket) {
    notes.push(real.bucket === null ? t("plan.notes.wasUnpinned") : t("plan.notes.wasPinned", { bucket: bucketName(real.bucket) }));
  }
  for (const field of ["due", "scheduled"] as const) {
    if (real[field] === planned[field]) continue;
    const was = real[field];
    notes.push(was === null ? t(`plan.notes.no_${field}`) : t(`plan.notes.was_${field}`, { date: showDay(was) }));
  }
  return notes;
}
