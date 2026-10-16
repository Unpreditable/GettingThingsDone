// The two status commands, run in the editor: "Toggle task in progress" and "Toggle task
// cancelled". A task leaving [x] or [-] goes through Tasks, which owns the ✅ and ❌ dates.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const TASKS = "obsidian-tasks-plugin";
const PANEL_VIEW = "gtd-tasks-panel";
const NOTE = "Status.md";

/** What Obsidian keeps of its commands that the specs reach for. */
interface Commands {
  executeCommandById(id: string): boolean;
  /** The commands the palette offers right now; executeCommandById runs one without asking. */
  listCommands(): { id: string }[];
}

/** A cursor or selection: where it starts and where the caret is, as [line, ch]. */
type Selection = { anchor: [number, number]; head: [number, number] };

/**
 * Writes the note and opens it, once the plugin has opened its panel by itself as it does on a
 * first install. Opening the note before that would let the panel take the focus back.
 */
async function openNote(content: string): Promise<void> {
  await browser.waitUntil(
    () => browser.executeObsidian(({ app }, type) => app.workspace.getLeavesOfType(type).length > 0, PANEL_VIEW),
    { timeoutMsg: "the plugin never opened its panel after a fresh install" },
  );
  await obsidianPage.write(NOTE, content);
  await obsidianPage.openFile(NOTE);
  await browser.waitUntil(
    () => browser.executeObsidian(({ app }, file) => app.workspace.activeEditor?.file?.path === file, NOTE),
    { timeoutMsg: `${NOTE} never became the active note` },
  );
}

async function select(...selections: Selection[]): Promise<void> {
  await browser.executeObsidian(({ app }, selections) => {
    const editor = app.workspace.activeEditor?.editor;
    if (!editor) throw new Error("no active editor");
    editor.focus();
    editor.setSelections(
      selections.map(({ anchor, head }) => ({
        anchor: { line: anchor[0], ch: anchor[1] },
        head: { line: head[0], ch: head[1] },
      })),
    );
  }, selections);
}

const caretAt = (line: number, ch: number): Selection => ({ anchor: [line, ch], head: [line, ch] });

/** Runs one of the plugin's commands, as the palette does: only where it is offered. */
async function run(command: string): Promise<void> {
  expect(await offered(command)).toBe(true);
  await browser.executeObsidian(
    ({ app }, id) => (app as unknown as { commands: Commands }).commands.executeCommandById(id),
    `${GTD}:${command}`,
  );
}

/** Whether the command palette offers one of the plugin's commands where the caret is now. */
function offered(command: string): Promise<boolean> {
  return browser.executeObsidian(
    ({ app }, id) => (app as unknown as { commands: Commands }).commands.listCommands().some((c) => c.id === id),
    `${GTD}:${command}`,
  );
}

function caret(): Promise<[number, number]> {
  return browser.executeObsidian(({ app }) => {
    const cursor = app.workspace.activeEditor?.editor?.getCursor();
    if (!cursor) throw new Error("no active editor");
    return [cursor.line, cursor.ch] as [number, number];
  });
}

/** Waits for the open note to read exactly `expected`, and fails showing what it read instead. */
async function waitForText(expected: string): Promise<void> {
  try {
    await browser.waitUntil(async () => (await noteText()) === expected);
  } catch {
    expect(await noteText()).toBe(expected);
  }
}

describe("Status commands, with Tasks", () => {
  beforeEach(async () => {
    await resetState();
  });

  it("sets an open task in progress, and back to open when run again", async () => {
    await openNote("- [ ] Draft the report\n");
    await select(caretAt(0, 8));

    await run("toggle-in-progress");
    await waitForText("- [/] Draft the report\n");
    await run("toggle-in-progress");
    await waitForText("- [ ] Draft the report\n");
  });

  it("cancels a task without a ❌ date, though Tasks would write one", async () => {
    await openNote("- [/] Draft the report\n");
    await select(caretAt(0, 8));

    await run("toggle-cancelled");
    await waitForText("- [-] Draft the report\n");
  });

  it("reopens a cancelled task through Tasks, which clears its ❌ date", async () => {
    await openNote("- [-] Draft the report ❌ 2026-10-01\n");
    await select(caretAt(0, 8));

    await run("toggle-cancelled");
    await waitForText("- [ ] Draft the report\n");
  });

  it("sets a cancelled task in progress, Tasks clearing its ❌ date first", async () => {
    await openNote("- [-] Draft the report ❌ 2026-10-01\n");
    await select(caretAt(0, 8));

    await run("toggle-in-progress");
    await waitForText("- [/] Draft the report\n");
  });

  it("cancels a done task, Tasks clearing its ✅ date first", async () => {
    await openNote("- [x] Draft the report ✅ 2026-10-01\n");
    await select(caretAt(0, 8));

    await run("toggle-cancelled");
    await waitForText("- [-] Draft the report\n");
  });

  it("changes every task in a selection and leaves the other lines alone", async () => {
    await openNote("- [ ] Draft the report\n- Just a note\n- [/] Book the venue\n- [>] Ask Sam\n");
    await select({ anchor: [0, 0], head: [3, 4] });

    await run("toggle-cancelled");
    await waitForText("- [-] Draft the report\n- Just a note\n- [-] Book the venue\n- [>] Ask Sam\n");
  });

  it("changes the task under each of several cursors", async () => {
    await openNote("- [ ] Draft the report\n- [ ] Call the plumber\n- [ ] Book the venue\n");
    await select(caretAt(0, 8), caretAt(2, 8));

    await run("toggle-in-progress");
    await waitForText("- [/] Draft the report\n- [ ] Call the plumber\n- [/] Book the venue\n");
  });

  it("leaves the caret where it was on the line", async () => {
    await openNote("- [-] Draft the report ❌ 2026-10-01\n");
    await select(caretAt(0, 12));

    await run("toggle-in-progress");
    await waitForText("- [/] Draft the report\n");
    expect(await caret()).toEqual([0, 12]);
  });

  it("is not offered on a line that is not a task it changes", async () => {
    await openNote("- Just a note\n- [>] Ask Sam\n");

    await select(caretAt(0, 4));
    expect(await offered("toggle-in-progress")).toBe(false);
    await select(caretAt(1, 8));
    expect(await offered("toggle-cancelled")).toBe(false);
    expect(await noteText()).toBe("- Just a note\n- [>] Ask Sam\n");
  });
});

describe("Status commands, without Tasks", () => {
  beforeEach(async () => {
    await resetState();
    await obsidianPage.disablePlugin(TASKS);
  });

  it("changes only the symbol and leaves the dates on the line", async () => {
    await openNote("- [-] Draft the report ❌ 2026-10-01\n- [x] Book the venue ✅ 2026-10-01\n");
    await select(caretAt(0, 8), caretAt(1, 8));

    await run("toggle-in-progress");
    await waitForText("- [/] Draft the report ❌ 2026-10-01\n- [/] Book the venue ✅ 2026-10-01\n");
  });
});

// Keeps this file's names its own: a file with no import or export shares one scope with every other.
export {};
