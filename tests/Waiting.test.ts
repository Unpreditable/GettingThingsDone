import { computeWaiting, isDimmed } from "../src/core/Waiting";
import type { TaskRecord } from "../src/core/TaskParser";

const NOW = new Date(2026, 9, 18);

function day(offset: number): Date {
  return new Date(2026, 9, 18 + offset);
}

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
    tasksId: null,
    dependsOn: [],
    blockId: null,
    tags: [],
    inlineField: null,
    indentLevel: 0,
    parentId: null,
    childIds: [],
    ...overrides,
  };
}

describe("computeWaiting — start date", () => {
  it("marks a task whose start date is after today", () => {
    const task = makeTask({ startDate: day(1) });
    const w = computeWaiting([task], NOW).get(task.id)!;
    expect(w.startsOn).toEqual(day(1));
    expect(isDimmed(w)).toBe(true);
  });

  it("leaves a task that starts today or earlier alone", () => {
    const today = makeTask({ id: "a", startDate: day(0) });
    const past = makeTask({ id: "b", startDate: day(-3) });
    expect(computeWaiting([today, past], NOW).size).toBe(0);
  });

  it("releases the task once its start day arrives", () => {
    const task = makeTask({ startDate: day(1) });
    expect(computeWaiting([task], day(1)).has(task.id)).toBe(false);
  });
});

describe("computeWaiting — dependencies", () => {
  it("blocks a task on an open task carrying the id", () => {
    const blocker = makeTask({ id: "b", tasksId: "a" });
    const task = makeTask({ id: "t", dependsOn: ["a"] });
    const w = computeWaiting([blocker, task], NOW).get("t")!;
    expect(w.blockedBy).toEqual([blocker]);
    expect(isDimmed(w)).toBe(true);
  });

  it("releases a task whose blocker is done or cancelled", () => {
    const blocker = makeTask({ id: "b", tasksId: "a", isCompleted: true });
    const task = makeTask({ id: "t", dependsOn: ["a"] });
    expect(computeWaiting([blocker, task], NOW).has("t")).toBe(false);
  });

  it("flags an id no task carries without dimming", () => {
    const task = makeTask({ id: "t", dependsOn: ["a"] });
    const w = computeWaiting([task], NOW).get("t")!;
    expect(w.missingDependency).toBe(true);
    expect(w.blockedBy).toEqual([]);
    expect(isDimmed(w)).toBe(false);
  });

  it("reports an open blocker and a missing one together", () => {
    const blocker = makeTask({ id: "b", tasksId: "a" });
    const task = makeTask({ id: "t", dependsOn: ["a", "nosuch"] });
    const w = computeWaiting([blocker, task], NOW).get("t")!;
    expect(w.blockedBy).toEqual([blocker]);
    expect(w.missingDependency).toBe(true);
  });

  it("never blocks a task on itself", () => {
    const task = makeTask({ id: "t", tasksId: "a", dependsOn: ["a"] });
    expect(computeWaiting([task], NOW).has("t")).toBe(false);
  });

  it("blocks on the open one of two tasks sharing an id", () => {
    const done = makeTask({ id: "d", tasksId: "a", isCompleted: true });
    const open = makeTask({ id: "o", tasksId: "a" });
    const task = makeTask({ id: "t", dependsOn: ["a"] });
    expect(computeWaiting([done, open, task], NOW).get("t")!.blockedBy).toEqual([open]);
  });
});

describe("computeWaiting — what never waits", () => {
  it("ignores a completed task, whatever it carries", () => {
    const blocker = makeTask({ id: "b", tasksId: "a" });
    const task = makeTask({ id: "t", isCompleted: true, startDate: day(5), dependsOn: ["a"] });
    expect(computeWaiting([blocker, task], NOW).has("t")).toBe(false);
  });

  it("doesn't pass a parent's state to its children", () => {
    const blocker = makeTask({ id: "b", tasksId: "a" });
    const parent = makeTask({ id: "p", dependsOn: ["a"], childIds: ["c"] });
    const child = makeTask({ id: "c", parentId: "p", indentLevel: 1 });
    const waiting = computeWaiting([blocker, parent, child], NOW);
    expect(waiting.has("p")).toBe(true);
    expect(waiting.has("c")).toBe(false);
  });
});
