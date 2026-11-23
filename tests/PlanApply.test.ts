import { applyLineEdits, buildFileEdits, translateOrderState, remainingPlan } from "../src/core/plan/PlanApply";
import { startPlan, planStep } from "../src/core/plan/Plan";
import type { PlannedChange } from "../src/core/plan/Plan";
import { readPlanFields } from "../src/core/plan/PlanFields";
import { parseFile } from "../src/core/TaskParser";
import type { TaskRecord } from "../src/core/TaskParser";
import { computeOrderKeys, entryId } from "../src/core/TaskOrder";
import { DEFAULT_SETTINGS, activeOrderKeyScheme } from "../src/settings";

const settings = DEFAULT_SETTINGS;
const scheme = activeOrderKeyScheme(settings);
const keysOf = (tasks: TaskRecord[]) => computeOrderKeys(tasks, scheme);
const idOf = (tasks: TaskRecord[], i: number) => entryId(keysOf(tasks).get(tasks[i].id)!);

it("applyLineEdits rewrites the planned lines", () => {
  expect(applyLineEdits("- [ ] a #gtd/today\n- [ ] b", [{ lineNumber: 0, expected: "- [ ] a #gtd/today", planned: "- [ ] a #gtd/this-week" }]))
    .toBe("- [ ] a #gtd/this-week\n- [ ] b");
});

it("applyLineEdits refuses a file whose expected line moved", () => {
  expect(applyLineEdits("- [ ] new\n- [ ] a #gtd/today", [{ lineNumber: 0, expected: "- [ ] a #gtd/today", planned: "x" }])).toBeNull();
});

it("applyLineEdits keeps CRLF", () => {
  expect(applyLineEdits("- [ ] a\r\n- [ ] b", [{ lineNumber: 1, expected: "- [ ] b", planned: "- [ ] b!" }])).toBe("- [ ] a\r\n- [ ] b!");
});

it("buildFileEdits groups by file and skips no-op changes", () => {
  const a = parseFile("a.md", "- [ ] one #gtd/today\n- [ ] two #gtd/today");
  const b = parseFile("b.md", "- [ ] three #gtd/today");
  const real = [...a, ...b];
  const changes: Record<string, PlannedChange> = {
    [idOf(a, 1)]: { bucket: "someday" },
    [idOf(b, 0)]: { bucket: "today" },
  };
  const edits = buildFileEdits(real, changes, keysOf(real), settings);
  expect([...edits.keys()]).toEqual(["a.md"]);
  expect(edits.get("a.md")).toEqual([{ lineNumber: 1, expected: "- [ ] two #gtd/today", planned: "- [ ] two #gtd/someday" }]);
});

it("translateOrderState keeps duplicate tasks in their planned slots", () => {
  const before = parseFile("a.md", "- [ ] Call mom 📅 2026-11-12\n- [ ] Call mom 📅 2026-11-12");
  const after = parseFile("a.md", "- [ ] Call mom 📅 2026-11-20\n- [ ] Call mom 📅 2026-11-12");
  const [first, second] = [keysOf(before).get(before[0].id)!, keysOf(before).get(before[1].id)!];
  const state = { taskOrder: { "this-week": [second, first] }, completionSeen: {} };
  const translated = translateOrderState(state, [{ file: "a.md", before, after }], scheme);
  expect(translated.taskOrder["this-week"]).toEqual([keysOf(after).get(after[1].id)!, keysOf(after).get(after[0].id)!]);
});

it("translateOrderState carries completionSeen to the new key", () => {
  const before = parseFile("a.md", "- [x] done 📅 2026-11-12");
  const after = parseFile("a.md", "- [x] done 📅 2026-11-20");
  const state = { taskOrder: {}, completionSeen: { [idOf(before, 0)]: 42 } };
  const translated = translateOrderState(state, [{ file: "a.md", before, after }], scheme);
  expect(translated.completionSeen).toEqual({ [idOf(after, 0)]: 42 });
});

it("translateOrderState leaves files it did not write alone", () => {
  const b = parseFile("b.md", "- [ ] x");
  const entry = keysOf(b).get(b[0].id)!;
  const state = { taskOrder: { today: [entry] }, completionSeen: {} };
  expect(translateOrderState(state, [], scheme)).toEqual(state);
});

it("remainingPlan keeps only the failed file's changes", () => {
  const a = parseFile("a.md", "- [ ] one #gtd/today");
  const b = parseFile("b.md", "- [ ] two #gtd/today");
  const real = readPlanFields(a[0].rawLine, settings);
  let plan = startPlan({}, [idOf(a, 0), idOf(b, 0)]);
  plan = planStep(plan, {
    changes: { [idOf(a, 0)]: { change: { bucket: "someday" }, real }, [idOf(b, 0)]: { change: { bucket: "someday" }, real } },
  });
  const aAfter = parseFile("a.md", "- [ ] one #gtd/someday");
  const translated = { taskOrder: { someday: [] }, completionSeen: {} };
  const next = remainingPlan(plan, new Set(["a.md"]), translated, keysOf([...aAfter, ...b]));
  expect(next.current.changes).toEqual({ [idOf(b, 0)]: { bucket: "someday" } });
  expect(next.current.taskOrder).toEqual({ someday: [] });
  expect(next.past).toEqual([]);
  expect(next.future).toEqual([]);
});
