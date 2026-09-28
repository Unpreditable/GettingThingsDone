import { groupTasksIntoBuckets, TO_REVIEW_ID } from "../../src/core/BucketManager";
import { DEFAULT_SETTINGS, DEFAULT_BUCKETS } from "../../src/settings";
import type { TaskRecord } from "../../src/core/TaskParser";
import { computeOrderKeys } from "../../src/core/TaskOrder";
import type { OrderEntry } from "../../src/core/TaskOrder";

// Wall-clock tests. Run on their own via `npm run test:perf` (serially, with
// no other suites competing for the CPU); the default `npm test` skips them.

jest.mock("../../src/integrations/TasksPluginParser", () => ({
  today: () => new Date("2026-02-23T00:00:00"),
}));

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

/**
 * A single daily-note-style file accumulating tasks over months — the
 * scenario where a per-refresh cost that scales with total task count (not
 * file count) would actually be felt. A fifth of the tasks carry a saved
 * manual order, as a long-lived file does.
 */
function bigFile(taskCount: number) {
  const tasks: TaskRecord[] = [];
  for (let i = 0; i < taskCount; i++) {
    const isParent = i % 20 === 0;
    const isChild = i % 20 === 1;
    tasks.push(
      makeTask({
        id: `t${i}`,
        filePath: "big-daily-note.md",
        lineNumber: i,
        text: `Task ${i}`,
        isCompleted: i % 3 === 0,
        parentId: isChild ? `t${i - 1}` : null,
        childIds: isParent ? [`t${i + 1}`] : [],
      })
    );
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    buckets: DEFAULT_BUCKETS,
    taskOrder: {} as Record<string, OrderEntry[]>,
  };
  const orderKeys = computeOrderKeys(tasks, "due-only");
  settings.taskOrder[TO_REVIEW_ID] = tasks
    .slice(0, taskCount / 5)
    .map((t) => orderKeys.get(t.id)!)
    .reverse();

  return { tasks, settings };
}

/** Median of several timed runs, after one untimed run to warm up the JIT. */
function medianMs(taskCount: number, runs = 5): number {
  const { tasks, settings } = bigFile(taskCount);
  groupTasksIntoBuckets(tasks, settings);

  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    const result = groupTasksIntoBuckets(tasks, settings);
    times.push(performance.now() - start);
    expect(result.find((g) => g.bucketId === TO_REVIEW_ID)?.tasks.length).toBe(taskCount);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe("groupTasksIntoBuckets performance", () => {
  it("stays fast with thousands of tasks in one large, long-lived file", () => {
    // Generous threshold — a backstop against a pathological slowdown, not a
    // tight budget tuned to one specific machine.
    expect(medianMs(5000)).toBeLessThan(500);
  });

  it("grows linearly, not quadratically, with task count", () => {
    // 8x the tasks should cost roughly 8x the time; an O(n^2) lookup creeping
    // into regroupByHierarchy or applyManualOrder would cost 64x. A ratio
    // doesn't depend on how fast the machine is, which the absolute threshold
    // above does. Calibrated 2026-09-27: clean code measured 9.4-10.4, and a
    // deliberately injected tasks.indexOf per task — about the cheapest
    // quadratic there is — measured 14.3-22.5. Smaller steps (2x, 4x) could
    // not reliably tell that injection apart from noise.
    const small = medianMs(5000);
    const large = medianMs(40000);
    expect(large / small).toBeLessThan(12);
  });
});
