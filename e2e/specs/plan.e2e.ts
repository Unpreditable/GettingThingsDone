// Plan mode: planned moves and dates, Apply, Discard, peek, and a note edited while planning.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const PANEL_VIEW = "gtd-tasks-panel";
const NOTE = "Plan.md";

const ROW = ".gtd-task";
const TASK_TEXT = ".gtd-task-text";
const TOOLBAR = ".gtd-plan-toolbar";
const APPLY = `${TOOLBAR} button.mod-cta`;

interface Commands {
  executeCommandById(id: string): boolean;
}

/** The parts of the panel view a test drives directly: what a drag or a menu pick ends in. */
interface PanelView {
  handleMove(task: unknown, targetBucketId: string | null, orderedTaskIds?: string[] | null): Promise<void>;
  handleReorder(bucketId: string, orderedTaskIds: string[]): Promise<void>;
  handleSetDate(task: unknown, field: "due" | "scheduled", date: string, unpin: boolean): Promise<void>;
}

interface IndexedTask {
  id: string;
  filePath: string;
  lineNumber: number;
  text: string;
}

function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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

async function writeNote(content: string, shown: string): Promise<void> {
  await obsidianPage.write(NOTE, content);
  await browser.waitUntil(
    () => browser.execute(
      (selector, shown) => Array.from(document.querySelectorAll(selector)).some((el) => el.textContent?.trim() === shown),
      `${ROW} ${TASK_TEXT}`,
      shown,
    ),
    { timeoutMsg: `the panel never showed "${shown}"` },
  );
}

async function enterPlanMode(): Promise<void> {
  await setPluginSettings(GTD, { planIntroSeen: true });
  await browser.executeObsidian(({ app }, id) => {
    (app as unknown as { commands: Commands }).commands.executeCommandById(`${id}:enter-plan-mode`);
  }, GTD);
  await $(TOOLBAR).waitForDisplayed({ timeoutMsg: "plan mode never showed its strip" });
}

function tasksIn(bucketId: string): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => (el.textContent ?? "").trim()),
    `.gtd-bucket[data-bucket-id="${bucketId}"] ${TASK_TEXT}`,
  );
}

/** The line number of each row under a bucket in this note, top to bottom. */
function linesIn(bucketId: string, file: string): Promise<number[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector), (el) => Number(el.dataset.lineNumber)),
    `.gtd-bucket[data-bucket-id="${bucketId}"] ${ROW}[data-file-path="${file}"]`,
  );
}

/** The ids of the rows a bucket shows, top to bottom. */
function idsIn(bucketId: string): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector), (el) => el.dataset.taskId ?? ""),
    `.gtd-bucket[data-bucket-id="${bucketId}"] ${ROW}`,
  );
}

/** Moves the task on this line of the note into a bucket, as a drag or the menu does. */
async function move(file: string, lineNumber: number, bucketId: string | null): Promise<void> {
  await browser.executeObsidian(async ({ app, plugins }, type, file, lineNumber, bucketId) => {
    const plugin = plugins.gtdTasks as unknown as { taskIndex: { getAllTasks(): IndexedTask[] } };
    const task = plugin.taskIndex.getAllTasks().find((t) => t.filePath === file && t.lineNumber === lineNumber);
    if (!task) throw new Error(`no task on line ${lineNumber} of ${file}`);
    const view = app.workspace.getLeavesOfType(type)[0].view as unknown as PanelView;
    await view.handleMove(task, bucketId, null);
  }, PANEL_VIEW, file, lineNumber, bucketId);
}

async function reorder(bucketId: string, ids: string[]): Promise<void> {
  await browser.executeObsidian(async ({ app }, type, bucketId, ids) => {
    const view = app.workspace.getLeavesOfType(type)[0].view as unknown as PanelView;
    await view.handleReorder(bucketId, ids);
  }, PANEL_VIEW, bucketId, ids);
}

async function setDue(file: string, lineNumber: number, date: string): Promise<void> {
  await browser.executeObsidian(async ({ app, plugins }, type, file, lineNumber, date) => {
    const plugin = plugins.gtdTasks as unknown as { taskIndex: { getAllTasks(): IndexedTask[] } };
    const task = plugin.taskIndex.getAllTasks().find((t) => t.filePath === file && t.lineNumber === lineNumber);
    if (!task) throw new Error(`no task on line ${lineNumber} of ${file}`);
    const view = app.workspace.getLeavesOfType(type)[0].view as unknown as PanelView;
    await view.handleSetDate(task, "due", date, false);
  }, PANEL_VIEW, file, lineNumber, date);
}

async function waitForApplyText(expected: string): Promise<void> {
  await browser.waitUntil(async () => (await $(APPLY).getText()).trim() === expected, {
    timeoutMsg: `the Apply button never read "${expected}"`,
  });
}

async function clickButton(selector: string, text: string): Promise<void> {
  await browser.execute((selector, text) => {
    const button = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((el) => el.textContent?.trim() === text);
    if (!button) throw new Error(`no "${text}" button`);
    button.click();
  }, selector, text);
}

async function waitForPlanEnd(): Promise<void> {
  await $(TOOLBAR).waitForExist({ reverse: true, timeout: 5000, timeoutMsg: "plan mode never ended" });
}

const THREE = "- [ ] One #gtd/today\n- [ ] Two #gtd/today\n- [ ] Three #gtd/today\n";

describe("Plan mode", () => {
  beforeEach(async () => {
    await resetState();
    await obsidianPage.disablePlugin("obsidian-tasks-plugin");
    await openPanel();
    await writeNote(THREE, "Three");
  });

  it("writes the planned tags on Apply, in the order the plan showed", async () => {
    await enterPlanMode();
    await move(NOTE, 0, "this-week");
    await browser.waitUntil(async () => (await tasksIn("this-week")).includes("One"), {
      timeoutMsg: "the planned move never showed",
    });
    const today = await idsIn("today");
    const texts = await tasksIn("today");
    const two = today[texts.indexOf("Two")];
    const three = today[texts.indexOf("Three")];
    await reorder("today", today.filter((id) => id !== two && id !== three).concat([three, two]));
    await waitForApplyText("Apply 2 changes");

    expect(await obsidianPage.read(NOTE)).toBe(THREE);
    const planned = await tasksIn("today");

    await $(APPLY).click();
    await waitForPlanEnd();
    expect(await obsidianPage.read(NOTE)).toBe("- [ ] One #gtd/this-week\n- [ ] Two #gtd/today\n- [ ] Three #gtd/today\n");
    expect(await tasksIn("today")).toEqual(planned);
  });

  it("writes nothing on Discard", async () => {
    const inbox = await obsidianPage.read("Inbox.md");
    await enterPlanMode();
    await move(NOTE, 0, "someday");
    await move(NOTE, 1, "this-week");
    await waitForApplyText("Apply 2 changes");
    await clickButton(`${TOOLBAR} button`, "Discard");
    await $(".modal button.mod-warning").waitForDisplayed({ timeoutMsg: "Discard never asked" });
    await $(".modal button.mod-warning").click();
    await waitForPlanEnd();
    expect(await obsidianPage.read(NOTE)).toBe(THREE);
    expect(await obsidianPage.read("Inbox.md")).toBe(inbox);
    expect(await tasksIn("today")).toContain("One");
  });

  it("starts from the header button, which hides while planning", async () => {
    await setPluginSettings(GTD, { planIntroSeen: true });
    await browser.execute((selector) => document.querySelector<HTMLElement>(selector)?.click(), ".gtd-plan-button");
    await $(TOOLBAR).waitForDisplayed({ timeoutMsg: "the header button never started plan mode" });
    expect(await $(".gtd-plan-button").isExisting()).toBe(false);
  });

  it("says in the popover what a planned task was before", async () => {
    await enterPlanMode();
    await move(NOTE, 0, "this-week");
    await browser.waitUntil(async () => (await tasksIn("this-week")).includes("One"), {
      timeoutMsg: "the planned move never showed",
    });
    const row = await browser.execute((selector) => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(selector))
        .find((r) => r.querySelector(".gtd-task-text")?.textContent?.trim() === "One");
      return el ? `.gtd-task[data-task-id="${el.dataset.taskId}"]` : "";
    }, ROW);
    await browser.execute((row) => {
      document.querySelector(row)?.dispatchEvent(new MouseEvent("mouseenter"));
    }, row);
    await $(`${row} .gtd-tooltip-plan`).waitForExist({ timeoutMsg: "the popover never showed the planned change" });
    const lines = await browser.execute(
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector), (el) => ({
        text: (el.querySelector(".gtd-tooltip-field-text")?.textContent ?? "").trim(),
        icon: el.querySelector("svg")?.getAttribute("class") ?? "",
      })),
      `${row} .gtd-tooltip-plan .gtd-tooltip-field`,
    );
    expect(lines.map((l) => l.text)).toEqual(["⇓ Was in ⚡ Today"]);
    expect(lines[0].icon).toContain("lucide-pencil-ruler");
    expect(await $(`${row} .gtd-plan-indicator`).getAttribute("title")).toBeNull();
    expect(await $(`${row} .gtd-plan-indicator`).getAttribute("aria-label")).toBeNull();
  });

  it("discards a plan with no changes without asking", async () => {
    await enterPlanMode();
    await waitForApplyText("No changes");
    await clickButton(`${TOOLBAR} button`, "Discard");
    await waitForPlanEnd();
    expect(await $(".modal").isExisting()).toBe(false);
  });

  it("keeps the rows as tall on peek as in the plan", async () => {
    // Compact rows have no minimum height, so their buttons set it.
    await setPluginSettings(GTD, { compactView: true });
    await enterPlanMode();
    const heights = () => browser.execute(
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector), (el) => el.getBoundingClientRect().height),
      `.gtd-bucket[data-bucket-id="today"] ${ROW}`,
    );
    const planned = await heights();
    await browser.execute((selector) => document.querySelector<HTMLElement>(selector)?.click(), `${TOOLBAR} .gtd-plan-peek`);
    await $(`${TOOLBAR}.is-peeking`).waitForExist({ timeoutMsg: "peek never started" });
    expect(await heights()).toEqual(planned);
  });

  it("saves a ticked task at once", async () => {
    await enterPlanMode();
    await browser.execute((selector) => {
      const row = Array.from(document.querySelectorAll<HTMLElement>(selector))
        .find((el) => el.querySelector(".gtd-task-text")?.textContent?.trim() === "Two");
      row?.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
    }, ROW);
    await browser.waitUntil(async () => (await obsidianPage.read(NOTE)).split("\n")[1].startsWith("- [x] Two"), {
      timeoutMsg: "the tick never reached the note",
    });
    expect(await $(TOOLBAR).isDisplayed()).toBe(true);
  });

  it("asks about a tag changed in the note, and keeps the note's version when told to", async () => {
    await enterPlanMode();
    await move(NOTE, 0, "this-week");
    await move(NOTE, 1, "someday");
    await waitForApplyText("Apply 2 changes");
    await obsidianPage.write(NOTE, "- [ ] One #gtd/next-week\n- [ ] Two #gtd/today\n- [ ] Three #gtd/today\n");
    await $(".gtd-plan-conflicts").waitForDisplayed({ timeoutMsg: "the conflict banner never showed" });
    expect((await $(".gtd-plan-conflicts .gtd-language-banner-message").getText()).trim())
      .toBe('"One" moved to Next Week in its note. Your plan has it in This Week.');
    await clickButton(".gtd-plan-conflicts .gtd-language-banner-btn", "Use Next Week");
    await $(".gtd-plan-conflicts").waitForExist({ reverse: true, timeoutMsg: "the banner stayed" });
    await waitForApplyText("Apply 1 change");

    await $(APPLY).click();
    await waitForPlanEnd();
    expect(await obsidianPage.read(NOTE)).toBe("- [ ] One #gtd/next-week\n- [ ] Two #gtd/someday\n- [ ] Three #gtd/today\n");
  });

  it("leaves a note alone when it changed under Apply, and keeps its change planned", async () => {
    await enterPlanMode();
    await move(NOTE, 0, "this-week");
    await waitForApplyText("Apply 1 change");
    await browser.executeObsidian(async ({ app, plugins }, file) => {
      const note = app.vault.getFileByPath(file);
      if (!note) throw new Error(`${file} is not in the vault`);
      // In the same tick as Apply: the index has not seen this edit yet.
      await app.vault.modify(note, `New first line\n${await app.vault.read(note)}`);
      await (plugins.gtdTasks as unknown as { planSession: { apply(): Promise<void> } }).planSession.apply();
    }, NOTE);

    await browser.waitUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll(".notice")).some((el) => el.textContent?.includes("weren't applied") || el.textContent?.includes("wasn't applied"))),
      { timeoutMsg: "no notice named the unapplied change" },
    );
    expect(await obsidianPage.read(NOTE)).toBe(`New first line\n${THREE}`);
    expect(await $(TOOLBAR).isDisplayed()).toBe(true);
    await waitForApplyText("Apply 1 change");
  });

  it("shows the real tasks on peek, and they cannot be moved", async () => {
    await enterPlanMode();
    await move(NOTE, 0, "this-week");
    await browser.waitUntil(async () => (await tasksIn("this-week")).includes("One"), {
      timeoutMsg: "the planned move never showed",
    });
    await $(".gtd-plan-peek").click();
    await browser.waitUntil(async () => (await tasksIn("today")).includes("One"), {
      timeoutMsg: "peek never showed the real tasks",
    });
    expect(await $(`${TOOLBAR}.is-peeking`).isExisting()).toBe(true);
    expect(await browser.execute((selector) => document.querySelector(selector)?.hasAttribute("disabled"), APPLY)).toBe(true);
    expect(await browser.execute(
      (selector) => document.querySelector<HTMLInputElement>(selector)?.disabled,
      `.gtd-bucket[data-bucket-id="today"] ${ROW} input[type=checkbox]`,
    )).toBe(true);

    await $(".gtd-plan-peek").click();
    await browser.waitUntil(async () => (await tasksIn("this-week")).includes("One"), {
      timeoutMsg: "Back to plan never showed the plan again",
    });
    await waitForApplyText("Apply 1 change");
  });

  it("undoes a parent moved with its pinned subtasks in one step", async () => {
    await writeNote("- [ ] Parent #gtd/today\n    - [ ] Kid one #gtd/this-week\n    - [ ] Kid two #gtd/this-week\n", "Kid two");
    await enterPlanMode();
    await browser.execute((selector) => {
      const row = Array.from(document.querySelectorAll<HTMLElement>(selector))
        .find((el) => el.querySelector(".gtd-task-text")?.textContent?.trim() === "Parent");
      const button = Array.from(row?.querySelectorAll<HTMLElement>(".gtd-task-move-btn") ?? [])
        .find((el) => el.getAttribute("aria-label") === "Move to Someday / Maybe");
      if (!button) throw new Error("no Move to Someday button on Parent");
      button.click();
    }, ROW);
    await $(".gtd-confirm-dialog").waitForDisplayed({ timeoutMsg: "the subtasks question never showed" });
    await clickButton(".gtd-confirm-dialog button", "Move all");
    await waitForApplyText("Apply 3 changes");

    await browser.execute((selector) => document.querySelector<HTMLElement>(selector)?.click(), `${TOOLBAR} [aria-label="Undo"]`);
    await waitForApplyText("No changes");
    expect(await tasksIn("someday")).not.toContain("Parent");
  });

  it("keeps the plan when the panel opens again right after closing", async () => {
    await enterPlanMode();
    await move(NOTE, 0, "someday");
    await waitForApplyText("Apply 1 change");
    await browser.executeObsidian(({ app }, type, id) => {
      app.workspace.detachLeavesOfType(type);
      (app as unknown as { commands: Commands }).commands.executeCommandById(`${id}:open-gtd-panel`);
    }, PANEL_VIEW, GTD);
    await $(TOOLBAR).waitForDisplayed({ timeoutMsg: "the reopened panel never showed the plan" });
    await browser.pause(2500);
    await waitForApplyText("Apply 1 change");
  });

  it("says so when closing the panel discards the plan", async () => {
    await enterPlanMode();
    await move(NOTE, 0, "someday");
    await waitForApplyText("Apply 1 change");
    await browser.executeObsidian(({ app }, type) => app.workspace.detachLeavesOfType(type), PANEL_VIEW);
    await browser.waitUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll(".notice"), (el) => el.textContent ?? "")
        .some((text) => text.includes("Plan discarded"))),
      { timeout: 5000, timeoutMsg: "no notice said the plan was discarded" },
    );
    expect(await obsidianPage.read(NOTE)).toBe(THREE);
  });

  it("keeps two identical tasks in their planned slots after Apply", async () => {
    const first = dayFromToday(400);
    const later = dayFromToday(401);
    await writeNote(`- [ ] Call mom 📅 ${first}\n- [ ] Call mom 📅 ${first}\n`, "Call mom");
    await setPluginSettings(GTD, { planBy: "due-first" });
    await enterPlanMode();
    const bucket = await browser.execute(
      (selector) => document.querySelector<HTMLElement>(selector)?.closest<HTMLElement>(".gtd-bucket")?.dataset.bucketId ?? "",
      `${ROW}[data-file-path="${NOTE}"]`,
    );

    await setDue(NOTE, 0, later);
    await browser.waitUntil(async () => (await $(APPLY).getText()).trim() === "Apply 1 change", {
      timeoutMsg: "the planned date never counted",
    });
    const ids = await idsIn(bucket);
    const lines = await browser.execute(
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector), (el) => [el.dataset.taskId ?? "", el.dataset.filePath ?? "", Number(el.dataset.lineNumber)] as [string, string, number]),
      `.gtd-bucket[data-bucket-id="${bucket}"] ${ROW}`,
    );
    const idOfLine = (n: number) => lines.find(([, file, line]) => file === NOTE && line === n)![0];
    const others = ids.filter((id) => id !== idOfLine(0) && id !== idOfLine(1));
    await reorder(bucket, [...others, idOfLine(1), idOfLine(0)]);
    await browser.waitUntil(async () => JSON.stringify(await linesIn(bucket, NOTE)) === "[1,0]", {
      timeoutMsg: "the planned order never showed",
    });

    await $(APPLY).click();
    await waitForPlanEnd();
    expect(await obsidianPage.read(NOTE)).toBe(`- [ ] Call mom 📅 ${later}\n- [ ] Call mom 📅 ${first}\n`);

    // A reload closes the panel, and nothing reopens it but the command.
    await togglePlugin(GTD);
    await browser.executeObsidian(({ app }, id) => {
      (app as unknown as { commands: Commands }).commands.executeCommandById(`${id}:open-gtd-panel`);
    }, GTD);
    await $(ROW).waitForDisplayed({ timeoutMsg: "the panel never came back after the reload" });
    await browser.waitUntil(async () => (await linesIn(bucket, NOTE)).length === 2, {
      timeoutMsg: "the note's tasks never showed after the reload",
    });
    expect(await linesIn(bucket, NOTE)).toEqual([1, 0]);
  });
});
