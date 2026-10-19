// Tasks that can't be done yet: a 🛫 start date after today, or a ⛔ dependency on a task that is
// still open. What the row shows, what its popover says, and the menu item that jumps to the
// blocking task.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const PANEL_VIEW = "gtd-tasks-panel";
const NOTE = "Waiting.md";

const ROW = ".gtd-task";
const TASK_TEXT = ".gtd-task-text";
const CHECKBOX = ".gtd-task-checkbox";
const BADGE = ".gtd-waiting-badge";
const TOOLTIP = ".gtd-tooltip";

/** What Obsidian keeps of its commands that the specs reach for. */
interface Commands {
  executeCommandById(id: string): boolean;
}

/** Today plus `days`, as a Tasks date (YYYY-MM-DD) in local time. */
function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

/** Writes the note and waits for the panel to show `shown`, one of its tasks. */
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

/** Whether the row is dimmed as waiting. */
function isWaiting(row: string): Promise<boolean> {
  return browser.execute((row) => document.querySelector(row)?.classList.contains("is-waiting") ?? false, row);
}

/** The Lucide name of the icon in front of the row's text, or null when there is none. */
function badgeIcon(row: string): Promise<string | null> {
  return browser.execute((selector) => {
    const svg = document.querySelector(selector);
    const name = svg ? Array.from(svg.classList).find((c) => c.startsWith("lucide-")) : undefined;
    return name ? name.slice("lucide-".length) : null;
  }, `${row} ${BADGE} svg`);
}

/** Hovers the row until its popover shows, and returns the text of each popover row. */
async function popoverRows(row: string): Promise<string[]> {
  await browser.execute((row) => {
    document.querySelector(row)?.dispatchEvent(new MouseEvent("mouseenter"));
  }, row);
  await $(`${row} ${TOOLTIP}`).waitForExist({ timeoutMsg: "the popover never showed" });
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => (el.textContent ?? "").trim()),
    `${row} ${TOOLTIP} .gtd-tooltip-field-text`,
  );
}

async function leave(row: string): Promise<void> {
  await browser.execute((row) => {
    document.querySelector(row)?.dispatchEvent(new MouseEvent("mouseleave"));
  }, row);
  await $(`${row} ${TOOLTIP}`).waitForExist({ reverse: true });
}

/** Opens the row's context menu and returns the title of each item. */
async function menuItems(row: string): Promise<string[]> {
  await browser.execute((row) => {
    document.querySelector(row)?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }),
    );
  }, row);
  await $(".menu").waitForDisplayed({ timeoutMsg: "the row's menu never opened" });
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".menu .menu-item-title"), (el) => (el.textContent ?? "").trim()),
  );
}

async function clickMenuItem(title: string): Promise<void> {
  await browser.execute((title) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>(".menu-item"))
      .find((el) => el.querySelector(".menu-item-title")?.textContent === title);
    if (!item) throw new Error(`the menu has no "${title}" item`);
    item.click();
  }, title);
}

/** The note open in the editor, and the line the cursor is on. */
function activeEditor(): Promise<{ file: string | null; line: number | null }> {
  return browser.executeObsidian(({ app }) => ({
    file: app.workspace.activeEditor?.file?.path ?? null,
    line: app.workspace.activeEditor?.editor?.getCursor().line ?? null,
  }));
}

describe("Tasks that can't be done yet", () => {
  beforeEach(async () => {
    await resetState();
    // Installed for tasks.e2e.ts; here the panel reads the dependencies on its own.
    await obsidianPage.disablePlugin("obsidian-tasks-plugin");
    await openPanel();
  });

  it("dims a task whose start date is after today, with a snail", async () => {
    await writeNote(
      `- [ ] Starts later 🛫 ${dayFromToday(3)}\n- [ ] Started already 🛫 ${dayFromToday(-1)}\n`,
      "Started already",
    );
    const later = await rowOf("Starts later");
    const started = await rowOf("Started already");
    expect(await isWaiting(later)).toBe(true);
    expect(await badgeIcon(later)).toBe("snail");
    expect(await isWaiting(started)).toBe(false);
    expect(await badgeIcon(started)).toBeNull();
  });

  it("explains a start date in the popover, which is not dimmed itself", async () => {
    await writeNote(`- [ ] Starts later 🛫 ${dayFromToday(3)}\n`, "Starts later");
    const row = await rowOf("Starts later");
    const rows = await popoverRows(row);
    const start = rows.findIndex((text) => text.startsWith("Starts "));
    expect(start).toBeGreaterThan(0);
    expect(rows[start - 1]).toBe("Can't start yet");

    // The popover sits inside the row, so dimming the row would fade it too. Opacity multiplies
    // down the tree, which a single element's computed value doesn't show.
    const opacity = await browser.execute((selector) => {
      let product = 1;
      for (let el = document.querySelector(selector); el; el = el.parentElement) {
        product *= Number(getComputedStyle(el).opacity);
      }
      return product;
    }, `${row} ${TOOLTIP}`);
    expect(opacity).toBe(1);
    await leave(row);
  });

  it("dims a blocked task until its blocker is ticked", async () => {
    await writeNote("- [ ] Write the changelog 🆔 e2e1\n- [ ] Ship the release ⛔ e2e1\n", "Ship the release");
    const ship = await rowOf("Ship the release");
    expect(await isWaiting(ship)).toBe(true);
    expect(await badgeIcon(ship)).toBe("construction");
    expect(await popoverRows(ship)).toContain("Blocked by: (e2e1) Write the changelog");
    await leave(ship);

    const blocker = await rowOf("Write the changelog");
    await $(`${blocker} ${CHECKBOX}`).click();
    await browser.waitUntil(async () => !(await isWaiting(ship)), {
      timeoutMsg: "the task stayed dimmed after its blocker was ticked",
    });
    expect(await badgeIcon(ship)).toBeNull();
  });

  it("jumps to the blocking task from the menu", async () => {
    await writeNote("- [ ] Ship the release ⛔ e2e1\n- [ ] Write the changelog 🆔 e2e1\n", "Write the changelog");
    const items = await menuItems(await rowOf("Ship the release"));
    const title = "Go to blocking task: (e2e1) Write the changelog";
    expect(items).toContain(title);
    expect(items.indexOf(title)).toBe(items.indexOf("Show in file") - 1);

    await clickMenuItem(title);
    await browser.waitUntil(async () => (await activeEditor()).file === NOTE, { timeoutMsg: `${NOTE} never opened` });
    expect((await activeEditor()).line).toBe(1);
  });

  it("keeps a long blocker name to one line in the popover and the menu", async () => {
    const long = "Write the changelog " + "and then some more words ".repeat(20);
    await writeNote(`- [ ] Ship the release ⛔ e2e1\n- [ ] ${long.trim()} 🆔 e2e1\n`, "Ship the release");
    const ship = await rowOf("Ship the release");
    await popoverRows(ship);
    const popoverRow = await browser.execute((selector) => {
      const el = document.querySelector<HTMLElement>(selector)!;
      return { height: el.offsetHeight, fontSize: parseFloat(getComputedStyle(el).fontSize), cut: el.scrollWidth > el.clientWidth };
    }, `${ship} ${TOOLTIP} .gtd-tooltip-field-text.is-truncated`);
    expect(popoverRow.cut).toBe(true);
    // One line is about 1.5× the font size; two would be 3×.
    expect(popoverRow.height).toBeLessThan(popoverRow.fontSize * 2);
    await leave(ship);

    await menuItems(ship);
    const menuTitle = await browser.execute(() => {
      const el = document.querySelector<HTMLElement>(".menu .gtd-menu-title-capped")!;
      return { width: el.offsetWidth, cap: 20 * parseFloat(getComputedStyle(el).fontSize), cut: el.scrollWidth > el.clientWidth };
    });
    expect(menuTitle.cut).toBe(true);
    expect(menuTitle.width).toBeLessThanOrEqual(menuTitle.cap);
    await press("Escape");
  });

  it("leaves a task whose blocker isn't found as it is, and says so on hover", async () => {
    await writeNote("- [ ] Waits on nothing ⛔ e2e-nosuch\n", "Waits on nothing");
    const row = await rowOf("Waits on nothing");
    expect(await isWaiting(row)).toBe(false);
    expect(await badgeIcon(row)).toBeNull();
    expect(await popoverRows(row)).toContain("Depends on task not found in scope");
    await leave(row);

    const items = await menuItems(row);
    expect(items.some((title) => title.startsWith("Go to blocking task"))).toBe(false);
    await press("Escape");
  });
});

// Keeps this file's names its own: a file with no import or export shares one scope with every other.
export {};
