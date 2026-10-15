// Settings that change what the panel lists or what a move writes, each set the way the settings
// tab sets it: the value saved, and a rescan where the tab runs one.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const PANEL_VIEW = "gtd-tasks-panel";
const NOTE = "Inbox.md";

const ROW = ".gtd-task";
const TASK_TEXT = ".gtd-task-text";
const CHECKBOX = ".gtd-task-checkbox";
const MOVE_BUTTON = ".gtd-task-move-btn";
const DISMISS_ALL = '.gtd-header-icon[title="Dismiss all completed tasks"]';

/** What Obsidian keeps of its commands that the specs reach for. */
interface Commands {
  executeCommandById(id: string): boolean;
}

/** The part of the plugin a spec calls directly: the rescan the settings tab runs after some changes. */
interface GtdPlugin {
  refreshIndex(): Promise<void>;
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

/** Saves settings, then rescans as the settings tab does after a scope or global filter change. */
async function setSettingsAndRescan(patch: Record<string, unknown>): Promise<void> {
  await setPluginSettings(GTD, patch);
  await browser.executeObsidian(async ({ app }, id) => {
    const plugin = (app as unknown as { plugins: { plugins: Record<string, GtdPlugin> } }).plugins.plugins[id];
    await plugin.refreshIndex();
  }, GTD);
}

/** The text of every task row in the panel, top to bottom. */
function allTasks(): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => (el.textContent ?? "").trim()),
    `${ROW} ${TASK_TEXT}`,
  );
}

/** The text of each task under a bucket, top to bottom. Empty when the bucket is not shown. */
function tasksIn(bucketId: string): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => (el.textContent ?? "").trim()),
    `.gtd-bucket[data-bucket-id="${bucketId}"] ${TASK_TEXT}`,
  );
}

/** A selector for the row showing this text. It names the task's line, so it outlives a redraw. */
function rowOf(text: string): Promise<string> {
  return browser.execute(
    (text, rowSelector, textSelector) => {
      for (const row of Array.from(document.querySelectorAll<HTMLElement>(rowSelector))) {
        if (row.querySelector(textSelector)?.textContent?.trim() !== text) continue;
        return `${rowSelector}[data-file-path="${row.dataset.filePath}"][data-line-number="${row.dataset.lineNumber}"]`;
      }
      throw new Error(`no row in the panel shows "${text}"`);
    },
    text,
    ROW,
    TASK_TEXT,
  );
}

async function waitForPanel(expected: string[], timeoutMsg: string): Promise<void> {
  await browser.waitUntil(async () => JSON.stringify(await allTasks()) === JSON.stringify(expected), { timeoutMsg });
}

async function waitForNoteLine(file: string, expected: string): Promise<void> {
  await browser.waitUntil(async () => (await obsidianPage.read(file)).split("\n").includes(expected), {
    timeoutMsg: `${file} never held the line "${expected}"`,
  });
}

describe("Settings", () => {
  beforeEach(async () => {
    await resetState();
    // Installed for tasks.e2e.ts; here the panel ticks without it, as it does for a user without Tasks.
    await obsidianPage.disablePlugin("obsidian-tasks-plugin");
    await openPanel();
  });

  describe("the global task filter", () => {
    beforeEach(async () => {
      await obsidianPage.write("Errands.md", "- [ ] TODO Pay rent\n- [ ] Plain checklist item\n");
      await browser.waitUntil(async () => (await allTasks()).includes("Plain checklist item"), {
        timeoutMsg: "the new note's tasks never showed",
      });
    });

    it("lists only the lines containing the filter", async () => {
      await setSettingsAndRescan({ taskFilters: ["TODO"] });
      await waitForPanel(["TODO Pay rent"], "the panel never narrowed to the line containing TODO");
    });

    it("leaves the filter out of the row when told to hide it", async () => {
      await setSettingsAndRescan({ taskFilters: ["TODO"], taskFilterHideText: true });
      await waitForPanel(["Pay rent"], "the row kept showing the filter text");
    });
  });

  it("writes an inline field instead of a tag in inline-field mode", async () => {
    await setPluginSettings(GTD, { storageMode: "inline-field" });
    const row = await rowOf("Buy milk");
    // Clicked from inside the page: the buttons show only while the row is hovered, and the harness
    // has no hover yet. To Review's first button moves to Today.
    await browser.execute((selector) => {
      const button = document.querySelector<HTMLElement>(selector);
      if (!button) throw new Error(`no quick-move button at ${selector}`);
      button.click();
    }, `${row} ${MOVE_BUTTON}`);
    await waitForNoteLine(NOTE, "- [ ] Buy milk [gtd:: today]");
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Buy milk"), {
      timeoutMsg: "the moved task never showed under Today",
    });
  });

  it("leaves out the tasks of an ignored folder", async () => {
    await obsidianPage.write("Archive/Old.md", "- [ ] Old errand #gtd/today\n");
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Old errand"), {
      timeoutMsg: "the archived task never showed before the folder was ignored",
    });

    await setSettingsAndRescan({ ignoredPaths: [{ type: "folder", path: "Archive" }] });
    await browser.waitUntil(async () => !(await tasksIn("today")).includes("Old errand"), {
      timeoutMsg: "the ignored folder's task stayed in the panel",
    });
    expect(await tasksIn("today")).toEqual(["Call the plumber"]);
  });

  describe("with completed tasks not shown until midnight", () => {
    beforeEach(async () => {
      await setPluginSettings(GTD, { completedVisibilityUntilMidnight: false });
    });

    it("drops a task from the panel as soon as it is ticked", async () => {
      const row = await rowOf("Call the plumber");
      await $(`${row} ${CHECKBOX}`).click();
      await waitForNoteLine(NOTE, "- [x] Call the plumber #gtd/today");
      await $(row).waitForExist({ reverse: true, timeoutMsg: "the ticked task stayed in the panel" });
      expect(await tasksIn("today")).toEqual([]);
    });

    it("has no button to dismiss completed tasks", async () => {
      expect(await $(DISMISS_ALL).isExisting()).toBe(false);
    });
  });
});

// Keeps this file's names its own: a file with no import or export shares one scope with every other.
export {};
