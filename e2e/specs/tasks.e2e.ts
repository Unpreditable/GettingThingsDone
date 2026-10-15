// The panel with the Tasks plugin installed: ticking goes through Tasks, so a tick from the panel
// writes what the same tick in the editor would.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const TASKS = "obsidian-tasks-plugin";
const PANEL_VIEW = "gtd-tasks-panel";
const NOTE = "Inbox.md";

const ROW = ".gtd-task";
const TASK_TEXT = ".gtd-task-text";
const CHECKBOX = ".gtd-task-checkbox";

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

/** Today plus `days`, as a Tasks date (YYYY-MM-DD) in local time. */
function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Changes some of Tasks' settings and restarts it to load them. Tasks keeps no `settings` object
 * for setPluginSettings to reach; resetState puts its data.json back before the next test.
 */
async function setTasksSettings(patch: Record<string, unknown>): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, id, patch) => {
      const file = `${app.vault.configDir}/plugins/${id}/data.json`;
      const current = (await app.vault.adapter.exists(file))
        ? (JSON.parse(await app.vault.adapter.read(file)) as Record<string, unknown>)
        : {};
      await app.vault.adapter.write(file, JSON.stringify({ ...current, ...patch }));
    },
    TASKS,
    patch,
  );
  await togglePlugin(TASKS);
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

/** Waits for a note to read exactly `expected`, and fails showing what it read instead. */
async function waitForNote(file: string, expected: string): Promise<void> {
  try {
    await browser.waitUntil(async () => (await obsidianPage.read(file)) === expected);
  } catch {
    expect(await obsidianPage.read(file)).toBe(expected);
  }
}

async function tick(text: string): Promise<void> {
  const row = await rowOf(text);
  await $(`${row} ${CHECKBOX}`).click();
}

describe("With Tasks", () => {
  beforeEach(async () => {
    await resetState();
    await openPanel();
  });

  it("writes Tasks' done date when a task is ticked in the panel", async () => {
    const row = await rowOf("Call the plumber");
    await $(`${row} ${CHECKBOX}`).click();
    await browser.waitUntil(
      async () => (await obsidianPage.read(NOTE)).split("\n").includes(`- [x] Call the plumber #gtd/today ✅ ${dayFromToday(0)}`),
      { timeoutMsg: `${NOTE} never held the ticked line with today's done date` },
    );
    await $(`${row}.is-checked`).waitForDisplayed();
  });

  it("adds the next occurrence of a recurring task, and shows only that one", async () => {
    // Laid out as Tasks writes a line: tags in the description, its own fields after.
    await obsidianPage.write("Habits.md", `- [ ] Water the plants #gtd/someday 🔁 every day 📅 ${dayFromToday(0)}\n`);
    await browser.waitUntil(async () => (await tasksIn("someday")).includes("Water the plants"), {
      timeoutMsg: "the recurring task never showed",
    });

    await tick("Water the plants");
    await waitForNote(
      "Habits.md",
      `- [ ] Water the plants #gtd/someday 🔁 every day 📅 ${dayFromToday(1)}\n` +
        `- [x] Water the plants #gtd/someday 🔁 every day 📅 ${dayFromToday(0)} ✅ ${dayFromToday(0)}\n`,
    );
    // The completed occurrence is hidden at once: its next one already stands in for it.
    await browser.waitUntil(async () => (await $$(`.gtd-bucket[data-bucket-id="someday"] ${ROW}.is-checked`).length) === 0, {
      timeoutMsg: "the completed occurrence stayed in the panel",
    });
    // Once, and ahead of the undated task: a bucket lists dated tasks first.
    expect(await tasksIn("someday")).toEqual(["Water the plants", "Learn the cello"]);
  });

  it("ticks a line outside Tasks' global filter the way Tasks does in the editor", async () => {
    await setTasksSettings({ globalFilter: "#task" });
    await obsidianPage.write("Mixed.md", "- [ ] Pay rent #task #gtd/today\n- [ ] Pack the bag #gtd/today\n");
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Pack the bag"), {
      timeoutMsg: "the new note's tasks never showed",
    });

    await tick("Pay rent");
    await waitForNote("Mixed.md", `- [x] Pay rent #task #gtd/today ✅ ${dayFromToday(0)}\n- [ ] Pack the bag #gtd/today\n`);
    // Not a task to Tasks, so it is ticked with no done date.
    await tick("Pack the bag");
    await waitForNote(
      "Mixed.md",
      `- [x] Pay rent #task #gtd/today ✅ ${dayFromToday(0)}\n- [x] Pack the bag #gtd/today\n`,
    );
  });
});

// Keeps this file's names its own: a file with no import or export shares one scope with every other.
export {};
