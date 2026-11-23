import { t } from "../../i18n/i18n";
import { formatDate } from "../DueStatusText";
import type { Conflict } from "./Plan";
import type { PlanFields } from "./PlanFields";

export interface ConflictWording {
  message: string;
  /** The button that takes the note's value. */
  useNote: string;
  /** The button that keeps the plan's value. */
  keepPlan: string;
}

/** A plan's `YYYY-MM-DD` day, the way the popover shows dates. */
export function showDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return formatDate(new Date(year, month - 1, date));
}

/** The banner row for one conflict, naming the note's value and the plan's. */
export function conflictWording(
  conflict: Conflict,
  note: PlanFields,
  planned: PlanFields,
  bucketName: (id: string) => string
): ConflictWording {
  const text = conflict.text;
  if (conflict.field === "bucket") {
    const noteBucket = note.bucket === null ? null : bucketName(note.bucket);
    const planBucket = planned.bucket === null ? null : bucketName(planned.bucket);
    return {
      message: [
        noteBucket === null
          ? t("plan.conflict.bucketUnpinned", { text })
          : t("plan.conflict.bucketMoved", { text, bucket: noteBucket }),
        planBucket === null ? t("plan.conflict.planUnpins") : t("plan.conflict.planBucket", { bucket: planBucket }),
      ].join(" "),
      useNote: noteBucket === null ? t("plan.conflict.unpin") : t("plan.conflict.use", { value: noteBucket }),
      keepPlan: planBucket === null ? t("plan.conflict.keepUnpinned") : t("plan.conflict.keep", { value: planBucket }),
    };
  }
  const field = t(`plan.conflict.${conflict.field}`);
  const noteDay = note[conflict.field] === null ? null : showDay(note[conflict.field]!);
  const planDay = planned[conflict.field] === null ? null : showDay(planned[conflict.field]!);
  return {
    message: [
      noteDay === null
        ? t("plan.conflict.dateRemoved", { text, field })
        : t("plan.conflict.dateSet", { text, field, date: noteDay }),
      planDay === null ? t("plan.conflict.planRemovesDate") : t("plan.conflict.planDate", { date: planDay }),
    ].join(" "),
    useNote: noteDay === null ? t("plan.conflict.removeDate") : t("plan.conflict.use", { value: noteDay }),
    keepPlan: planDay === null ? t("plan.conflict.keepNoDate") : t("plan.conflict.keep", { value: planDay }),
  };
}
