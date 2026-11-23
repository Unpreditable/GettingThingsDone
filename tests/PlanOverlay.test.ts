import { groupPlanned, overlayTasks, plannedLine } from "../src/core/plan/PlanOverlay";
import { parseFile } from "../src/core/TaskParser";
import { computeOrderKeys, entryId } from "../src/core/TaskOrder";
import { dayKey } from "../src/core/DueStatus";
import { DEFAULT_SETTINGS, activeOrderKeyScheme } from "../src/settings";
import type { BucketGroup } from "../src/core/BucketManager";

function bucketOf(groups: BucketGroup[], taskId: string): string | undefined {
  return groups.find((g) => g.tasks.some((t) => t.id === taskId))?.bucketId;
}

function idOf(tasks: ReturnType<typeof parseFile>, i: number): string {
  return entryId(computeOrderKeys(tasks, activeOrderKeyScheme(DEFAULT_SETTINGS)).get(tasks[i].id)!);
}

it("a planned bucket change moves the task in the planned grouping only", () => {
  const real = parseFile("a.md", "- [ ] one #gtd/today");
  const { planned, realGroups } = groupPlanned(real, { changes: { [idOf(real, 0)]: { bucket: "this-week" } }, taskOrder: {} }, DEFAULT_SETTINGS);
  expect(bucketOf(planned, real[0].id)).toBe("this-week");
  expect(bucketOf(realGroups, real[0].id)).toBe("today");
});

it("a planned due date auto-places the task by that date", () => {
  const real = parseFile("a.md", "- [ ] one");
  const { planned } = groupPlanned(real, { changes: { [idOf(real, 0)]: { due: dayKey(new Date()) } }, taskOrder: {} }, DEFAULT_SETTINGS);
  expect(bucketOf(planned, real[0].id)).toBe("today");
});

it("the planned task keeps its id and line but carries the planned line", () => {
  const real = parseFile("a.md", "- [ ] one #gtd/today");
  const keys = computeOrderKeys(real, activeOrderKeyScheme(DEFAULT_SETTINGS));
  const [task] = overlayTasks(real, { [idOf(real, 0)]: { bucket: "someday" } }, keys, DEFAULT_SETTINGS);
  expect(task.id).toBe(real[0].id);
  expect(task.lineNumber).toBe(0);
  expect(task.rawLine).toBe("- [ ] one #gtd/someday");
  expect(task.tags).toEqual(["gtd/someday"]);
});

it("unchanged tasks are passed through as the same objects", () => {
  const real = parseFile("a.md", "- [ ] one");
  expect(overlayTasks(real, {}, computeOrderKeys(real, "due-first"), DEFAULT_SETTINGS)[0]).toBe(real[0]);
});

it("plannedLine without a change is the real line", () => {
  const [task] = parseFile("a.md", "- [ ] one 📅 2026-11-12");
  expect(plannedLine(task, undefined, DEFAULT_SETTINGS)).toBe(task.rawLine);
  expect(plannedLine(task, { due: "2026-11-20" }, DEFAULT_SETTINGS)).toBe("- [ ] one 📅 2026-11-20");
});

it("the planned grouping uses the plan's order copy", () => {
  const real = parseFile("a.md", "- [ ] one #gtd/today\n- [ ] two #gtd/today");
  const keys = computeOrderKeys(real, activeOrderKeyScheme(DEFAULT_SETTINGS));
  const order = { today: [keys.get(real[1].id)!, keys.get(real[0].id)!] };
  const { planned, realGroups } = groupPlanned(real, { changes: {}, taskOrder: order }, DEFAULT_SETTINGS);
  expect(planned.find((g) => g.bucketId === "today")!.tasks.map((t) => t.text)).toEqual(["two", "one"]);
  expect(realGroups.find((g) => g.bucketId === "today")!.tasks.map((t) => t.text)).toEqual(["one", "two"]);
});
