import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** Matches the fade in styles.css; the decoration is removed once it has run. */
const FLASH_MS = 2000;

/** The start offset of the line to flash, or null to clear it. */
export const setFlash = StateEffect.define<number | null>();

const flashDeco = Decoration.line({ class: "gtd-line-flash" });

export const lineFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlash)) {
        deco = e.value === null ? Decoration.none : Decoration.set(flashDeco.range(e.value));
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const pendingClear = new WeakMap<EditorView, number>();

/**
 * Briefly highlights a 0-based line. The cursor alone is invisible in themes
 * that don't colour the active line, so a jump from the panel would otherwise
 * leave the user hunting for the task.
 */
export function flashLine(view: EditorView, line: number): void {
  if (line >= view.state.doc.lines) return;
  window.clearTimeout(pendingClear.get(view));
  view.dispatch({ effects: setFlash.of(view.state.doc.line(line + 1).from) });
  pendingClear.set(view, window.setTimeout(() => {
    pendingClear.delete(view);
    if (view.dom.isConnected) view.dispatch({ effects: setFlash.of(null) });
  }, FLASH_MS));
}
