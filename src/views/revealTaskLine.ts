import { App, MarkdownView, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { taskTextColumn } from "../core/TaskParser";
import type { TaskRecord } from "../core/TaskParser";
import { flashLine } from "./lineFlash";

/** Opens the task's note, or switches to it, with the caret on the task's line. */
export async function revealTaskLine(app: App, task: TaskRecord): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return;

  const { workspace } = app;
  const line = task.lineNumber;
  const existingLeaf = workspace.getLeavesOfType("markdown")
    .find((leaf) => (leaf.view as MarkdownView).file?.path === task.filePath);
  const leaf = existingLeaf ?? workspace.getLeaf(false);
  if (existingLeaf) await workspace.revealLeaf(leaf);
  else await leaf.openFile(file, { eState: { line } });
  if (!(leaf.view instanceof MarkdownView)) return;

  // setCursor alone scrolls the least it can, which leaves an off-screen line
  // pinned to the viewport's bottom edge.
  const { editor } = leaf.view;
  const pos = { line, ch: taskTextColumn(editor.getLine(line)) };
  editor.setCursor(pos);
  editor.scrollIntoView({ from: pos, to: pos }, true);
  // Clicking the panel leaves focus there, which hides the caret.
  editor.focus();
  const cm = (editor as unknown as { cm?: EditorView }).cm;
  if (cm) flashLine(cm, line);
}
