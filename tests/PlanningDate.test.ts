import { planningDate } from "../src/core/PlanningDate";
import type { PlanBy } from "../src/settings";
import type { TaskRecord } from "../src/core/TaskParser";

const AUG_25 = new Date(2026, 7, 25);
const SEP_01 = new Date(2026, 8, 1);
const SEP_05 = new Date(2026, 8, 5);

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "1",
    filePath: "test.md",
    lineNumber: 0,
    rawLine: "- [ ] Test task",
    text: "Test task",
    isCompleted: false,
    completedAt: null,
    dueDate: null,
    priority: null,
    recurrence: null,
    scheduledDate: null,
    startDate: null,
    createdDate: null,
    cancelledDate: null,
    onCompletion: null,
    blockId: null,
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...overrides,
  };
}

const ALL_MODES: PlanBy[] = [
  "manual",
  "due-only",
  "due-first",
  "scheduled-first",
  "scheduled-only",
  "earliest",
];

/** Compact assertion target: the date, or null, plus which field it came from. */
function plan(task: TaskRecord, mode: PlanBy): [Date, "due" | "scheduled"] | null {
  const result = planningDate(task, mode);
  return result === null ? null : [result.date, result.source];
}

describe("planningDate", () => {
  // The four task shapes that distinguish the six modes. Everything else is a
  // repeat of one of these.
  const bothScheduledEarlier = makeTask({ dueDate: SEP_01, scheduledDate: AUG_25 });
  const bothScheduledLater = makeTask({ dueDate: SEP_01, scheduledDate: SEP_05 });
  const dueOnly = makeTask({ dueDate: SEP_01 });
  const scheduledOnly = makeTask({ scheduledDate: AUG_25 });
  const dateless = makeTask({});

  describe("manual", () => {
    it("ignores dates entirely, whatever the task carries", () => {
      for (const task of [bothScheduledEarlier, bothScheduledLater, dueOnly, scheduledOnly]) {
        expect(planningDate(task, "manual")).toBeNull();
      }
    });
  });

  describe("due-only", () => {
    it("uses 📅 and never falls back to ⏳", () => {
      expect(plan(bothScheduledEarlier, "due-only")).toEqual([SEP_01, "due"]);
      expect(plan(bothScheduledLater, "due-only")).toEqual([SEP_01, "due"]);
      expect(plan(dueOnly, "due-only")).toEqual([SEP_01, "due"]);
      expect(plan(scheduledOnly, "due-only")).toBeNull();
    });
  });

  describe("due-first", () => {
    it("prefers 📅 but falls back to ⏳", () => {
      expect(plan(bothScheduledEarlier, "due-first")).toEqual([SEP_01, "due"]);
      expect(plan(dueOnly, "due-first")).toEqual([SEP_01, "due"]);
      expect(plan(scheduledOnly, "due-first")).toEqual([AUG_25, "scheduled"]);
    });
  });

  describe("scheduled-first", () => {
    it("prefers ⏳ but falls back to 📅", () => {
      expect(plan(bothScheduledEarlier, "scheduled-first")).toEqual([AUG_25, "scheduled"]);
      expect(plan(dueOnly, "scheduled-first")).toEqual([SEP_01, "due"]);
      expect(plan(scheduledOnly, "scheduled-first")).toEqual([AUG_25, "scheduled"]);
    });

    it("takes ⏳ even when it falls after 📅 — that is what separates it from earliest", () => {
      expect(plan(bothScheduledLater, "scheduled-first")).toEqual([SEP_05, "scheduled"]);
    });
  });

  describe("scheduled-only", () => {
    it("uses ⏳ and never falls back to 📅", () => {
      expect(plan(bothScheduledEarlier, "scheduled-only")).toEqual([AUG_25, "scheduled"]);
      expect(plan(scheduledOnly, "scheduled-only")).toEqual([AUG_25, "scheduled"]);
      expect(plan(dueOnly, "scheduled-only")).toBeNull();
    });
  });

  describe("earliest", () => {
    it("takes whichever date is sooner", () => {
      expect(plan(bothScheduledEarlier, "earliest")).toEqual([AUG_25, "scheduled"]);
      expect(plan(bothScheduledLater, "earliest")).toEqual([SEP_01, "due"]);
    });

    it("never files a task past its own due date, unlike scheduled-first", () => {
      expect(plan(bothScheduledLater, "earliest")).toEqual([SEP_01, "due"]);
      expect(plan(bothScheduledLater, "scheduled-first")).toEqual([SEP_05, "scheduled"]);
    });

    it("prefers 📅 on a tie, so source is stable", () => {
      const sameDay = makeTask({ dueDate: SEP_01, scheduledDate: new Date(2026, 8, 1) });
      expect(plan(sameDay, "earliest")).toEqual([SEP_01, "due"]);
    });

    it("uses whichever date exists when only one does", () => {
      expect(plan(dueOnly, "earliest")).toEqual([SEP_01, "due"]);
      expect(plan(scheduledOnly, "earliest")).toEqual([AUG_25, "scheduled"]);
    });
  });

  it("returns null for a dateless task in every mode", () => {
    for (const mode of ALL_MODES) {
      expect(planningDate(dateless, mode)).toBeNull();
    }
  });

  it("reports the source field the date actually came from", () => {
    // The popover marks the winning row, so a wrong source puts the ⚡ marker on
    // the date that is NOT driving placement.
    expect(planningDate(bothScheduledEarlier, "scheduled-first")?.source).toBe("scheduled");
    expect(planningDate(bothScheduledEarlier, "due-first")?.source).toBe("due");
  });
});
