import { EditorState } from "@codemirror/state";
import { lineFlashField, setFlash } from "../src/views/lineFlash";

function flashedLines(state: EditorState): number[] {
  const lines: number[] = [];
  state.field(lineFlashField).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number);
  });
  return lines;
}

function create(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [lineFlashField] });
}

describe("lineFlashField", () => {
  it("starts with nothing flashed", () => {
    expect(flashedLines(create("a\nb\nc"))).toEqual([]);
  });

  it("flashes one line, and a new flash replaces the old", () => {
    let state = create("a\nb\nc");
    state = state.update({ effects: setFlash.of(state.doc.line(2).from) }).state;
    expect(flashedLines(state)).toEqual([2]);
    state = state.update({ effects: setFlash.of(state.doc.line(3).from) }).state;
    expect(flashedLines(state)).toEqual([3]);
  });

  it("clears on a null flash", () => {
    let state = create("a\nb\nc");
    state = state.update({ effects: setFlash.of(state.doc.line(2).from) }).state;
    state = state.update({ effects: setFlash.of(null) }).state;
    expect(flashedLines(state)).toEqual([]);
  });

  it("follows its line when text is inserted above it", () => {
    let state = create("a\nb\nc");
    state = state.update({ effects: setFlash.of(state.doc.line(3).from) }).state;
    state = state.update({ changes: { from: 0, insert: "new\n" } }).state;
    expect(flashedLines(state)).toEqual([4]);
  });
});
