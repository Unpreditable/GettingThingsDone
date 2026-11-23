import { applyTaskDiff, diffByLine } from "../OrderMigration";
import type { OrderState } from "../OrderMigration";
import { lineEnding, splitLines } from "../TaskParser";
import type { TaskRecord } from "../TaskParser";
import { entryId } from "../TaskOrder";
import type { OrderEntry, OrderKeyScheme } from "../TaskOrder";
import type { PluginSettings } from "../../settings";
import { plannedLine } from "./PlanOverlay";
import type { Plan, PlannedChange } from "./Plan";

export interface LineEdit {
  lineNumber: number;
  expected: string;
  planned: string;
}

/** File path → the lines Apply rewrites there. A change whose planned line equals the real one is skipped. */
export function buildFileEdits(
  real: TaskRecord[],
  changes: Record<string, PlannedChange>,
  orderKeys: Map<string, OrderEntry>,
  settings: PluginSettings
): Map<string, LineEdit[]> {
  const edits = new Map<string, LineEdit[]>();
  for (const task of real) {
    const entry = orderKeys.get(task.id);
    const change = entry ? changes[entryId(entry)] : undefined;
    if (!change) continue;
    const planned = plannedLine(task, change, settings);
    if (planned === task.rawLine) continue;
    if (!edits.has(task.filePath)) edits.set(task.filePath, []);
    edits.get(task.filePath)!.push({ lineNumber: task.lineNumber, expected: task.rawLine, planned });
  }
  return edits;
}

/** The rewritten content, or null when any expected line is not at its line number: the file is then left alone. */
export function applyLineEdits(content: string, edits: LineEdit[]): string | null {
  const lines = splitLines(content);
  for (const edit of edits) {
    if (lines[edit.lineNumber] !== edit.expected) return null;
  }
  for (const edit of edits) lines[edit.lineNumber] = edit.planned;
  return lines.join(lineEnding(content));
}

export interface WrittenFile {
  file: string;
  before: TaskRecord[];
  after: TaskRecord[];
}

/**
 * The plan's order copy with every written file's keys translated old → new
 * by line number. Apply never adds or removes a line, so this pairing is
 * exact, even for identical siblings whose occurrence numbers shifted.
 */
export function translateOrderState(state: OrderState, written: WrittenFile[], scheme: OrderKeyScheme): OrderState {
  let result = state;
  for (const { file, before, after } of written) {
    result = applyTaskDiff(result, file, diffByLine(before, after, scheme), 0).state;
  }
  return result;
}

function fileOf(id: string): string {
  return id.slice(0, id.lastIndexOf("::"));
}

/**
 * The plan after a partial Apply: only unwritten files' changes remain, the
 * order is the translated copy, and history is cleared, since undoing across
 * an Apply would mean undoing writes. What is indexed now is the new starting
 * point Revert links back to.
 */
export function remainingPlan(
  plan: Plan,
  writtenFiles: Set<string>,
  translated: OrderState,
  orderKeysAfter: Map<string, OrderEntry>
): Plan {
  const unwritten = (id: string) => !writtenFiles.has(fileOf(id));
  const changes = Object.fromEntries(Object.entries(plan.current.changes).filter(([id]) => unwritten(id)));
  return {
    current: { changes, taskOrder: translated.taskOrder },
    past: [],
    future: [],
    originals: [...orderKeysAfter.values()].map(entryId),
    dropped: plan.dropped.filter((d) => unwritten(d.entryId)),
    lost: [],
    conflicts: plan.conflicts.filter((c) => !writtenFiles.has(c.file)),
  };
}
