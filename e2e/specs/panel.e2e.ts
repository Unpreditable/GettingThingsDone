// The panel by itself, with Tasks switched off: what it lists from the fixture's Inbox.md, and
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

/** The panel's view, for the one call a spec makes on it: what a drag ends in. */
interface PanelView {
  handleReorder(bucketId: string, orderedTaskIds: string[]): Promise<void>;
}

/** Today plus `days`, as a Tasks date (YYYY-MM-DD) in local time. */
function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Clicks from inside the page: the row's buttons show only while it is hovered, and the harness has no hover yet. */
async function clickHidden(selector: string): Promise<void> {
  await browser.execute((selector) => {
    const button = document.querySelector<HTMLElement>(selector);
    if (!button) throw new Error(`nothing to click at ${selector}`);
    button.click();
  }, selector);
}

/** The note open in the editor, and the line the cursor is on. */
function activeEditor(): Promise<{ file: string | null; line: number | null }> {
  return browser.executeObsidian(({ app }) => ({
    file: app.workspace.activeEditor?.file?.path ?? null,
    line: app.workspace.activeEditor?.editor?.getCursor().line ?? null,
  }));
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
    // Installed for tasks.e2e.ts; here the panel ticks without it, as it does for a user without Tasks.
    await obsidianPage.disablePlugin("obsidian-tasks-plugin");
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

  it("opens the note at the task's line when a row is clicked", async () => {
    expect((await activeEditor()).file).not.toBe(NOTE);
    const row = await rowOf("Renew passport");
    await $(`${row} .gtd-task-text`).click();
    await browser.waitUntil(async () => (await activeEditor()).file === NOTE, {
      timeoutMsg: `${NOTE} never opened`,
    });
    expect((await activeEditor()).line).toBe(2);
  });

  it("opens the note a wikilink in a task points to", async () => {
    await obsidianPage.write("Reference.md", "# Reference\n");
    await obsidianPage.write("Plans.md", "- [ ] Read [[Reference]] #gtd/today\n");
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Read Reference"), {
      timeoutMsg: "the task with the link never showed",
    });
    const row = await rowOf("Read Reference");
    await $(`${row} .gtd-md-link.is-clickable`).click();
    await browser.waitUntil(async () => (await activeEditor()).file === "Reference.md", {
      timeoutMsg: "the linked note never opened",
    });
  });

  it("dismisses only the completed task whose own button is used", async () => {
    const plumber = await rowOf("Call the plumber");
    const passport = await rowOf("Renew passport");
    await $(`${plumber} ${CHECKBOX}`).click();
    await $(`${plumber}.is-checked`).waitForDisplayed();
    await $(`${passport} ${CHECKBOX}`).click();
    await $(`${passport}.is-checked`).waitForDisplayed();

    await clickHidden(`${plumber} button[title="Dismiss"]`);
    await $(plumber).waitForExist({ reverse: true, timeoutMsg: "the dismissed task stayed in the panel" });
    expect(await $(`${passport}.is-checked`).isDisplayed()).toBe(true);
  });

  it("places dated tasks by their date", async () => {
    // Dates worked out from today, so the buckets are the same whatever day the suite runs.
    await obsidianPage.write(
      "Dated.md",
      `- [ ] Due today 📅 ${dayFromToday(0)}\n` +
        `- [ ] Due in a week 📅 ${dayFromToday(7)}\n` +
        `- [ ] Due next year 📅 ${dayFromToday(400)}\n`,
    );
    await browser.waitUntil(async () => (await tasksIn("someday")).includes("Due next year"), {
      timeoutMsg: "the dated tasks never showed",
    });
    expect(await tasksIn("today")).toContain("Due today");
    expect(await tasksIn("next-week")).toEqual(["Due in a week"]);
    expect(await tasksIn("to-review")).toEqual(["Buy milk"]);
  });

  it("keeps a note's manual order when the note is renamed", async () => {
    await obsidianPage.write("Order.md", "- [ ] Alpha #gtd/someday\n- [ ] Beta #gtd/someday\n");
    await browser.waitUntil(async () => (await tasksIn("someday")).includes("Beta"), {
      timeoutMsg: "the new note's tasks never showed",
    });
    expect(await tasksIn("someday")).toEqual(["Learn the cello", "Alpha", "Beta"]);

    // What a drag ends in, called directly: the harness has no drag yet.
    const reversed = await browser.execute(
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector), (row) => row.dataset.taskId ?? "").reverse(),
      `.gtd-bucket[data-bucket-id="someday"] ${ROW}`,
    );
    await browser.executeObsidian(async ({ app }, type, ids) => {
      const view = app.workspace.getLeavesOfType(type)[0].view as unknown as PanelView;
      await view.handleReorder("someday", ids);
    }, PANEL_VIEW, reversed);
    await browser.waitUntil(async () => (await tasksIn("someday"))[0] === "Beta", {
      timeoutMsg: "the new order never showed",
    });
    expect(await tasksIn("someday")).toEqual(["Beta", "Alpha", "Learn the cello"]);

    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Order.md");
      if (!file) throw new Error("Order.md is not in the vault");
      await app.fileManager.renameFile(file, "Renamed.md");
    });
    await $(`${ROW}[data-file-path="Renamed.md"]`).waitForExist({ timeoutMsg: "the renamed note's tasks never showed" });
    expect(await tasksIn("someday")).toEqual(["Beta", "Alpha", "Learn the cello"]);
  });

  it("writes the bucket tag when a quick-move button is used", async () => {
    const row = await rowOf("Buy milk");
    // To Review's first button moves to Today.
    await clickHidden(`${row} ${MOVE_BUTTON}`);
    await waitForNoteLine("- [ ] Buy milk #gtd/today");
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Buy milk"), {
      timeoutMsg: "the moved task never showed under Today",
    });
    expect(await tasksIn("to-review")).toEqual([]);
  });
});

const GRIP = ".gtd-drag-handle";

/** Makes the plugin treat this window as a phone or not. The panel reads it on its next redraw. */
async function setMobile(on: boolean): Promise<void> {
  await browser.executeObsidian(({ obsidian }, on) => {
    (obsidian.Platform as { isMobile: boolean }).isMobile = on;
  }, on);
}

/**
 * Presses the pointer down at a spot across `selector` (0 = left edge, 1 = right edge), on
 * whatever is drawn there, and says whether Sortable picked the row up. Lets go afterwards.
 */
async function pressPicksUp(selector: string, across: number): Promise<boolean> {
  const chosen = await browser.execute((selector, across) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`nothing at ${selector}`);
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width * across;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y) ?? el;
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
    target.dispatchEvent(new MouseEvent("mousedown", init));
    const picked = document.querySelector(".sortable-chosen") !== null;
    document.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
    document.dispatchEvent(new MouseEvent("mouseup", init));
    return picked;
  }, selector, across);
  await browser.pause(100);
  return chosen;
}

/** Where a row's grip sits across the row, as pressPicksUp takes it. */
function gripAcross(row: string): Promise<number> {
  return browser.execute((row, grip) => {
    const rowEl = document.querySelector<HTMLElement>(row);
    const gripEl = rowEl?.querySelector<HTMLElement>(grip);
    if (!rowEl || !gripEl) throw new Error(`no grip in ${row}`);
    const r = rowEl.getBoundingClientRect();
    const g = gripEl.getBoundingClientRect();
    return (g.left + g.width / 2 - r.left) / r.width;
  }, row, GRIP);
}

describe("Dragging on mobile", () => {
  beforeEach(async () => {
    await resetState();
    await obsidianPage.disablePlugin("obsidian-tasks-plugin");
    await setMobile(true);
    await openPanel();
  });

  afterEach(async () => {
    await setMobile(false);
  });

  it("with Right grip, picks a task up by its grip and never by its text", async () => {
    await setPluginSettings(GTD, { mobileDragBy: "right-grip" });
    const row = await rowOf("Buy milk");
    await $(`${row} ${GRIP}.is-right`).waitForExist({ timeoutMsg: "no grip at the right end of the row" });
    expect(await pressPicksUp(row, 0.3)).toBe(false);
    expect(await pressPicksUp(row, await gripAcross(row))).toBe(true);
  });

  it("with Left bar, draws the bar before the checkbox and drags by it", async () => {
    await setPluginSettings(GTD, { mobileDragBy: "left-bar" });
    const row = await rowOf("Buy milk");
    await $(`${row} ${GRIP}.is-left.is-bar`).waitForExist({ timeoutMsg: "no bar at the left end of the row" });
    const order = await browser.execute((row) => {
      const kids = Array.from(document.querySelector(row)!.children);
      return [kids.findIndex((k) => k.matches(".gtd-drag-handle")), kids.findIndex((k) => k.matches(".gtd-task-checkbox"))];
    }, row);
    expect(order[0]).toBeLessThan(order[1]);
    expect(await pressPicksUp(row, 0.5)).toBe(false);
    expect(await pressPicksUp(row, await gripAcross(row))).toBe(true);
  });

  it("with Left half, picks a task up on the left half only", async () => {
    await setPluginSettings(GTD, { mobileDragBy: "left-half" });
    const row = await rowOf("Buy milk");
    expect(await $(`${row} ${GRIP}`).isExisting()).toBe(false);
    expect(await pressPicksUp(row, 0.75)).toBe(false);
    expect(await pressPicksUp(row, 0.25)).toBe(true);
  });

  it("with Whole row, picks a task up anywhere", async () => {
    await setPluginSettings(GTD, { mobileDragBy: "whole-row" });
    const row = await rowOf("Buy milk");
    expect(await $(`${row} ${GRIP}`).isExisting()).toBe(false);
    expect(await pressPicksUp(row, 0.3)).toBe(true);
  });

  it("moves a task dragged by its grip onto another bucket", async () => {
    await setPluginSettings(GTD, { mobileDragBy: "right-grip" });
    const row = await rowOf("Buy milk");
    const header = `.gtd-bucket[data-bucket-id="someday"] .gtd-bucket-header`;
    // Only a collapsed bucket's header takes a drop.
    await $(header).click();
    await $(`${header}.collapsed`).waitForExist({ timeoutMsg: "Someday never collapsed" });
    const across = await gripAcross(row);
    await browser.execute((row, header, across) => {
      const rowEl = document.querySelector<HTMLElement>(row)!;
      const r = rowEl.getBoundingClientRect();
      const x = r.left + r.width * across;
      const y = r.top + r.height / 2;
      const grip = document.elementFromPoint(x, y) ?? rowEl;
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
      grip.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
      grip.dispatchEvent(new MouseEvent("mousedown", init));
      const data = new DataTransfer();
      rowEl.dispatchEvent(new DragEvent("dragstart", { ...init, dataTransfer: data }));
      (window as unknown as { gtdDrag: { data: DataTransfer; header: string } }).gtdDrag = { data, header };
    }, row, header, across);
    await browser.pause(100);
    for (const type of ["dragover", "drop"]) {
      await browser.execute((type) => {
        const { data, header } = (window as unknown as { gtdDrag: { data: DataTransfer; header: string } }).gtdDrag;
        const h = document.querySelector<HTMLElement>(header)!.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, clientX: h.left + h.width / 2, clientY: h.top + h.height / 2 };
        const target = document.elementFromPoint(init.clientX, init.clientY)!;
        target.dispatchEvent(new DragEvent(type, { ...init, dataTransfer: data }));
      }, type);
      await browser.pause(100);
    }
    await browser.execute((row) => {
      const { data } = (window as unknown as { gtdDrag: { data: DataTransfer } }).gtdDrag;
      document.querySelector<HTMLElement>(row)?.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: data }));
    }, row);
    await waitForNoteLine("- [ ] Buy milk #gtd/someday");
  });

  it("draws no grip on desktop, whatever the setting", async () => {
    await setMobile(false);
    await setPluginSettings(GTD, { mobileDragBy: "right-grip" });
    const row = await rowOf("Buy milk");
    expect(await $(`${row} ${GRIP}`).isExisting()).toBe(false);
    expect(await pressPicksUp(row, 0.3)).toBe(true);
  });
});

// Keeps this file's names its own: a file with no import or export shares one scope with every other.
export {};
