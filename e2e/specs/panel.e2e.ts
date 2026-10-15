// The panel by itself, with no other plugin installed: what it lists from the fixture's Inbox.md, and
// what ticking a task or moving it writes back to the note.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const PANEL_VIEW = "gtd-tasks-panel";
const NOTE = "Inbox.md";

const ROW = ".gtd-task";
const CHECKBOX = ".gtd-task-checkbox";
const MOVE_BUTTON = ".gtd-task-move-btn";
const DISMISS_ALL = '.gtd-header-icon[title="Dismiss all completed tasks"]';
const TO_REVIEW = '.gtd-bucket[data-bucket-id="to-review"]';
const SEARCH = ".gtd-search-input";
const SEARCH_PILL = ".gtd-search-pill";

/** What Obsidian keeps of its commands that the specs reach for. */
interface Commands {
  executeCommandById(id: string): boolean;
}

/**
 * Opens the panel through the plugin's own command, once the plugin has opened it by itself as it
 * does on a first install. Running the command before that would race it into a second panel.
 */
async function openPanel(): Promise<void> {
  await browser.waitUntil(
    () => browser.executeObsidian(({ app }, type) => app.workspace.getLeavesOfType(type).length > 0, PANEL_VIEW),
    { timeoutMsg: "the plugin never opened its panel after a fresh install" },
  );
  await browser.executeObsidian(({ app }, id) => {
    (app as unknown as { commands: Commands }).commands.executeCommandById(`${id}:open-gtd-panel`);
  }, GTD);
  await $(ROW).waitForDisplayed();
}

/** The text of each task under a bucket, top to bottom. Empty when the bucket is not shown. */
function tasksIn(bucketId: string): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => (el.textContent ?? "").trim()),
    `.gtd-bucket[data-bucket-id="${bucketId}"] .gtd-task-text`,
  );
}

/** A selector for the row showing this text. It names the task's line, so it outlives a redraw. */
function rowOf(text: string): Promise<string> {
  return browser.execute(
    (text, rowSelector) => {
      for (const row of Array.from(document.querySelectorAll<HTMLElement>(rowSelector))) {
        if (row.querySelector(".gtd-task-text")?.textContent?.trim() !== text) continue;
        return `${rowSelector}[data-file-path="${row.dataset.filePath}"][data-line-number="${row.dataset.lineNumber}"]`;
      }
      throw new Error(`no row in the panel shows "${text}"`);
    },
    text,
    ROW,
  );
}

async function waitForNoteLine(expected: string): Promise<void> {
  await browser.waitUntil(async () => (await obsidianPage.read(NOTE)).split("\n").includes(expected), {
    timeoutMsg: `${NOTE} never held the line "${expected}"`,
  });
}

describe("The panel", () => {
  beforeEach(async () => {
    await resetState();
    await openPanel();
  });

  it("lists the fixture's tasks under the right buckets", async () => {
    expect(await tasksIn("to-review")).toEqual(["Buy milk"]);
    expect(await tasksIn("today")).toEqual(["Call the plumber"]);
    expect(await tasksIn("this-week")).toEqual(["Renew passport"]);
    expect(await tasksIn("someday")).toEqual(["Learn the cello"]);
    // Completed before the session began, so it is in the note and not in the panel.
    expect(await $$(ROW).length).toBe(4);
  });

  it("changes the note when a task is ticked", async () => {
    const row = await rowOf("Call the plumber");
    await $(`${row} ${CHECKBOX}`).click();
    await waitForNoteLine("- [x] Call the plumber #gtd/today");
    // A task ticked in this session stays in view, checked.
    await $(`${row}.is-checked`).waitForDisplayed();
  });

  it("keeps a task ticked in To Review in view, checked", async () => {
    // The fixture's only To Review task, so ticking it leaves the bucket with no open task.
    const row = await rowOf("Buy milk");
    await $(`${row} ${CHECKBOX}`).click();
    await waitForNoteLine("- [x] Buy milk");
    await $(`${row}.is-checked`).waitForDisplayed();
  });

  it("keeps dismissed tasks gone when another task lands in To Review", async () => {
    const row = await rowOf("Buy milk");
    await $(`${row} ${CHECKBOX}`).click();
    await $(`${row}.is-checked`).waitForDisplayed();
    await $(DISMISS_ALL).click();
    await $(TO_REVIEW).waitForExist({ reverse: true, timeoutMsg: "To Review stayed after its tasks were dismissed" });

    await obsidianPage.write(NOTE, `${await obsidianPage.read(NOTE)}
- [ ] Water the plants`);
    await browser.waitUntil(async () => (await tasksIn("to-review")).includes("Water the plants"), {
      timeoutMsg: "the new task never showed under To Review",
    });
    expect(await tasksIn("to-review")).toEqual(["Water the plants"]);
  });

  it("leaves out of a search the completed tasks the panel hides", async () => {
    // Only "Already done" matches, and it was completed before the session, so the panel hides it.
    await $(SEARCH).setValue("done");
    await $(SEARCH_PILL).waitForDisplayed();
    expect(await $$(".gtd-bucket").length).toBe(0);
    expect(await $(SEARCH_PILL).getText()).toBe("🔍 Showing 0 of 4 tasks ×");
  });

  it("reads and writes a note with Windows line endings", async () => {
    await obsidianPage.write("Windows.md", "- [ ] Pay rent #gtd/today\r\n- [ ] Book flights\r\n");
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Pay rent"), {
      timeoutMsg: "the task from the CRLF note never showed under Today",
    });
    expect(await tasksIn("to-review")).toEqual(["Buy milk", "Book flights"]);

    const row = await rowOf("Pay rent");
    await $(`${row} ${CHECKBOX}`).click();
    await browser.waitUntil(async () => (await obsidianPage.read("Windows.md")).startsWith("- [x]"), {
      timeoutMsg: "Windows.md was never written",
    });
    expect(await obsidianPage.read("Windows.md")).toBe("- [x] Pay rent #gtd/today\r\n- [ ] Book flights\r\n");
  });

  it("writes the bucket tag when a quick-move button is used", async () => {
    const row = await rowOf("Buy milk");
    // Clicked from inside the page, not with the pointer: the buttons show only while the row is
    // hovered, and the harness has no hover yet. To Review's first button moves to Today.
    await browser.execute((selector) => {
      const button = document.querySelector<HTMLElement>(selector);
      if (!button) throw new Error(`no quick-move button at ${selector}`);
      button.click();
    }, `${row} ${MOVE_BUTTON}`);
    await waitForNoteLine("- [ ] Buy milk #gtd/today");
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Buy milk"), {
      timeoutMsg: "the moved task never showed under Today",
    });
    expect(await tasksIn("to-review")).toEqual([]);
  });
});

// Keeps this file's names its own: a file with no import or export shares one scope with every other.
export {};
