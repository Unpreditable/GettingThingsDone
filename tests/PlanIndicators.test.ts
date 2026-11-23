import { computeIndicators } from "../src/core/plan/PlanIndicators";
import { groupPlanned } from "../src/core/plan/PlanOverlay";
import type { PlannedChange, PlanSnapshot } from "../src/core/plan/Plan";
import { parseFile } from "../src/core/TaskParser";
import type { TaskRecord } from "../src/core/TaskParser";
import { computeOrderKeys, entryId } from "../src/core/TaskOrder";
import { dayKey } from "../src/core/DueStatus";
import { DEFAULT_SETTINGS, activeOrderKeyScheme } from "../src/settings";

const settings = DEFAULT_SETTINGS;

function keysOf(tasks: TaskRecord[]) {
  return computeOrderKeys(tasks, activeOrderKeyScheme(settings));
}
function byText(tasks: TaskRecord[], text: string): TaskRecord {
  return tasks.find((t) => t.text === text)!;
}
/** Order for `bucketId` as task texts, in planned order. */
function order(tasks: TaskRecord[], bucketId: string, texts: string[]): PlanSnapshot["taskOrder"] {
  const keys = keysOf(tasks);
  return { [bucketId]: texts.map((text) => keys.get(byText(tasks, text).id)!) };
}
function change(tasks: TaskRecord[], text: string, c: PlannedChange): Record<string, PlannedChange> {
  return { [entryId(keysOf(tasks).get(byText(tasks, text).id)!)]: c };
}
function summarize(tasks: TaskRecord[], snapshot: PlanSnapshot, changed: string[] = []) {
  const { planned, realGroups } = groupPlanned(tasks, snapshot, settings);
  return computeIndicators(realGroups, planned, new Set(changed.map((text) => byText(tasks, text).id)));
}

const four = "- [ ] a #gtd/today\n- [ ] b #gtd/today\n- [ ] c #gtd/today\n- [ ] d #gtd/today";

it("moving one task up three marks only that task", () => {
  const tasks = parseFile("f.md", four);
  const summary = summarize(tasks, { changes: {}, taskOrder: order(tasks, "today", ["d", "a", "b", "c"]) });
  expect(summary.indicators).toEqual({ [byText(tasks, "d").id]: { kind: "up", by: 3 } });
  expect(summary.count).toBe(1);
});

it("moving one task down marks it as down", () => {
  const tasks = parseFile("f.md", four);
  const summary = summarize(tasks, { changes: {}, taskOrder: order(tasks, "today", ["b", "c", "a", "d"]) });
  expect(summary.indicators).toEqual({ [byText(tasks, "a").id]: { kind: "down", by: 2 } });
});

it("a cross-bucket move is a bucket jump with its source", () => {
  const tasks = parseFile("f.md", "- [ ] x #gtd/today\n- [ ] y #gtd/today");
  const summary = summarize(tasks, { changes: change(tasks, "x", { bucket: "this-week" }), taskOrder: {} }, ["x"]);
  expect(summary.indicators[byText(tasks, "x").id]).toEqual({ kind: "bucket-down", fromBucketId: "today" });
  expect(summary.indicators[byText(tasks, "y").id]).toBeUndefined();
  expect(summary.count).toBe(1);
});

it("a move to an earlier bucket is a bucket jump up", () => {
  const tasks = parseFile("f.md", "- [ ] x #gtd/someday");
  const summary = summarize(tasks, { changes: change(tasks, "x", { bucket: "today" }), taskOrder: {} }, ["x"]);
  expect(summary.indicators[byText(tasks, "x").id]).toEqual({ kind: "bucket-up", fromBucketId: "someday" });
});

const family = "- [ ] p #gtd/today\n    - [ ] c1 #gtd/today\n    - [ ] c2 #gtd/today\n- [ ] q #gtd/today\n- [ ] r #gtd/today";

it("a subtask moving with its parent gets no indicator", () => {
  const tasks = parseFile("f.md", family);
  const summary = summarize(tasks, { changes: {}, taskOrder: order(tasks, "today", ["q", "r", "p", "c1", "c2"]) });
  expect(summary.indicators).toEqual({ [byText(tasks, "p").id]: { kind: "down", by: 2 } });
});

it("a subtask moving across buckets with its parent gets no indicator", () => {
  const tasks = parseFile("f.md", family);
  const changes = { ...change(tasks, "p", { bucket: "someday" }), ...change(tasks, "c1", { bucket: "someday" }), ...change(tasks, "c2", { bucket: "someday" }) };
  const summary = summarize(tasks, { changes, taskOrder: {} }, ["p", "c1", "c2"]);
  expect(Object.keys(summary.indicators)).toEqual([byText(tasks, "p").id]);
  expect(summary.count).toBe(3);
});

it("a subtask moving on its own does", () => {
  const tasks = parseFile("f.md", family);
  const summary = summarize(tasks, { changes: {}, taskOrder: order(tasks, "today", ["p", "c2", "c1", "q", "r"]) });
  expect(Object.keys(summary.indicators)).toHaveLength(1);
  expect([byText(tasks, "c1").id, byText(tasks, "c2").id]).toContain(Object.keys(summary.indicators)[0]);
});

it("header deltas count open tasks and skip equal buckets", () => {
  const today = Array.from({ length: 5 }, (_, i) => `- [ ] t${i} #gtd/today`);
  const week = Array.from({ length: 3 }, (_, i) => `- [ ] w${i} #gtd/this-week`);
  const tasks = parseFile("f.md", [...today, ...week, "- [ ] s #gtd/someday"].join("\n"));
  const changes = Object.assign({}, ...["w0", "w1", "w2"].map((t) => change(tasks, t, { bucket: "today" })));
  const summary = summarize(tasks, { changes, taskOrder: {} });
  expect(summary.deltas).toEqual({ today: { from: 5, to: 8 }, "this-week": { from: 3, to: 0 } });
});

it("computeIndicators counts nothing for an order equal to the real one", () => {
  const tasks = parseFile("f.md", four);
  const summary = summarize(tasks, { changes: {}, taskOrder: order(tasks, "today", ["a", "b", "c", "d"]) });
  expect(summary).toEqual({ indicators: {}, deltas: {}, count: 0 });
});

it("computeIndicators compares against the real grouping of the same day", () => {
  jest.useFakeTimers();
  try {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
    const tasks = parseFile("f.md", `- [ ] dated 📅 ${dayKey(tomorrow)}\n- [ ] other #gtd/today`);
    jest.setSystemTime(tomorrow);
    const summary = summarize(tasks, { changes: change(tasks, "other", { bucket: "someday" }), taskOrder: {} }, ["other"]);
    expect(summary.indicators[byText(tasks, "dated").id]).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

it("a date change that keeps the bucket counts as a change without an indicator", () => {
  const tasks = parseFile("f.md", "- [ ] a #gtd/someday 📅 2030-01-01");
  const summary = summarize(tasks, { changes: change(tasks, "a", { due: "2030-01-02" }), taskOrder: {} }, ["a"]);
  expect(summary.count).toBe(1);
  expect(summary.indicators).toEqual({});
});

it("a date change that re-sorts its bucket marks the re-dated task, not the one it passed", () => {
  const tasks = parseFile("f.md", "- [ ] first 📅 2030-01-01\n- [ ] second 📅 2030-01-01");
  const summary = summarize(tasks, { changes: change(tasks, "first", { due: "2030-01-02" }), taskOrder: {} }, ["first"]);
  expect(Object.keys(summary.indicators)).toEqual([byText(tasks, "first").id]);
  expect(summary.count).toBe(1);
});

it("a tie between moved tasks marks the untouched one only when nothing else will do", () => {
  const tasks = parseFile("f.md", "- [ ] a #gtd/today\n- [ ] b #gtd/today");
  const keys = keysOf(tasks);
  const summary = summarize(tasks, { changes: {}, taskOrder: { today: [keys.get(byText(tasks, "b").id)!, keys.get(byText(tasks, "a").id)!] } });
  expect(Object.keys(summary.indicators)).toHaveLength(1);
});
