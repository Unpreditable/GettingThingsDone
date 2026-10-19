import { countShown, searchBuckets, shownTasks, visibleCompleted } from "../src/core/PanelVisibility";
import type { BucketGroup } from "../src/core/BucketManager";
import type { TaskRecord } from "../src/core/TaskParser";

function makeTask(id: string, text: string, isCompleted = false): TaskRecord {
  return {
    id,
    filePath: "test.md",
    lineNumber: 0,
    rawLine: `- [${isCompleted ? "x" : " "}] ${text}`,
    text,
    isCompleted,
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
  };
}

function makeGroup(bucketId: string, tasks: TaskRecord[], agedCompletedTaskIds: string[] = []): BucketGroup {
  return {
    bucketId,
    name: bucketId,
    emoji: "",
    tasks,
    dueStatuses: {},
    misfiledIn: {},
    autoPlacedFrom: {},
    waiting: {},
    agedCompletedTaskIds,
    isSystem: false,
  };
}

const open = makeTask("open", "Call the plumber");
const tickedNow = makeTask("now", "Pay rent", true);
const tickedBefore = makeTask("before", "Already done", true);
const today = makeGroup("today", [open, tickedNow, tickedBefore], ["before"]);

describe("visibleCompleted", () => {
  it("is the completed tasks that have not aged out", () => {
    expect(visibleCompleted(today, true)).toEqual([tickedNow]);
  });

  it("is empty when completed tasks are not shown at all", () => {
    expect(visibleCompleted(today, false)).toEqual([]);
  });
});

describe("shownTasks", () => {
  it("is the open tasks and the visible completed ones, in bucket order", () => {
    expect(shownTasks(today, true)).toEqual([open, tickedNow]);
  });

  it("is only the open tasks when completed tasks are not shown", () => {
    expect(shownTasks(today, false)).toEqual([open]);
  });
});

describe("countShown", () => {
  it("adds up what every bucket lists", () => {
    const someday = makeGroup("someday", [makeTask("cello", "Learn the cello")]);
    expect(countShown([today, someday], true)).toBe(3);
    expect(countShown([today, someday], false)).toBe(2);
  });
});

describe("searchBuckets", () => {
  const someday = makeGroup("someday", [makeTask("cello", "Learn the cello")]);

  it("returns the buckets untouched for an empty search", () => {
    const groups = [today, someday];
    expect(searchBuckets(groups, "", [], true)).toBe(groups);
  });

  it("keeps the matching tasks of each bucket, ignoring case", () => {
    const result = searchBuckets([today, someday], "CELLO", [], true);
    expect(result.map((g) => g.bucketId)).toEqual(["someday"]);
    expect(result[0].tasks.map((t) => t.id)).toEqual(["cello"]);
  });

  it("drops a bucket whose only matches are completed tasks the panel hides", () => {
    expect(searchBuckets([today, someday], "done", [], true)).toEqual([]);
  });

  it("drops a bucket whose only matches are completed, when completed tasks are not shown", () => {
    expect(searchBuckets([today, someday], "rent", [], false)).toEqual([]);
  });

  it("keeps a bucket for a completed match still on screen", () => {
    const result = searchBuckets([today, someday], "rent", [], true);
    expect(result.map((g) => g.bucketId)).toEqual(["today"]);
  });

  it("does not match the text the global filter hides", () => {
    const tagged = makeGroup("today", [makeTask("t", "Buy milk TODO")]);
    expect(searchBuckets([tagged], "todo", ["TODO"], true)).toEqual([]);
  });
});
