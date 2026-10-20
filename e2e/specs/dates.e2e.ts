// Changing a task's due or scheduled date from the row's menu, and the "Move to" submenu beside it.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const PANEL_VIEW = "gtd-tasks-panel";
const NOTE = "Dates.md";
const INBOX = "Inbox.md";

const ROW = ".gtd-task";
const TASK_TEXT = ".gtd-task-text";

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

/** The text of each task under a bucket, top to bottom. Empty when the bucket is not shown. */
function tasksIn(bucketId: string): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => (el.textContent ?? "").trim()),
    `.gtd-bucket[data-bucket-id="${bucketId}"] ${TASK_TEXT}`,
  );
}

/** Opens the row's context menu and returns the title of each top-level item. */
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

interface SubmenuItem {
  title: string;
  label: boolean;
}

/** Opens the submenu under the open menu's item with this title, and returns its items. */
async function submenuItems(parent: string): Promise<SubmenuItem[]> {
  await browser.execute((parent) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>(".menu-item"))
      .find((el) => el.querySelector(".menu-item-title")?.textContent === parent);
    if (!item) throw new Error(`the menu has no "${parent}" item`);
    item.click();
  }, parent);
  await browser.waitUntil(() => browser.execute(() => document.querySelectorAll(".menu").length > 1), {
    timeoutMsg: `"${parent}" never opened a submenu`,
  });
  return browser.execute(() => {
    const menus = document.querySelectorAll(".menu");
    return Array.from(menus[menus.length - 1].querySelectorAll<HTMLElement>(".menu-item"), (el) => ({
      title: (el.querySelector(".menu-item-title")?.textContent ?? "").trim(),
      label: el.classList.contains("is-label"),
    }));
  });
}

/** Clicks the open submenu's first item whose title starts with `prefix`. */
async function clickSubmenuItem(prefix: string): Promise<void> {
  await browser.execute((prefix) => {
    const menus = document.querySelectorAll(".menu");
    const item = Array.from(menus[menus.length - 1].querySelectorAll<HTMLElement>(".menu-item"))
      .find((el) => (el.querySelector(".menu-item-title")?.textContent ?? "").startsWith(prefix));
    if (!item) throw new Error(`the submenu has no item starting "${prefix}"`);
    item.click();
  }, prefix);
}

/** Opens the row's menu, then the named submenu, and clicks the item starting with `prefix`. */
async function pick(task: string, entry: string, prefix: string): Promise<void> {
  await menuItems(await rowOf(task));
  await submenuItems(entry);
  await clickSubmenuItem(prefix);
}

async function closeMenus(): Promise<void> {
  while (await $(".menu").isExisting()) await press("Escape");
}

async function waitForNoteLine(file: string, expected: string): Promise<void> {
  await browser.waitUntil(async () => (await obsidianPage.read(file)).split("\n").includes(expected), {
    timeoutMsg: `${file} never held the line "${expected}"`,
  });
}

describe("Changing dates from the menu", () => {
  beforeEach(async () => {
    await resetState();
    // Installed for tasks.e2e.ts; date changes don't go through Tasks.
    await obsidianPage.disablePlugin("obsidian-tasks-plugin");
    await setPluginSettings(GTD, { planBy: "due-first" });
    await openPanel();
  });

  it("lists the buckets by name under Move to, and moves through it", async () => {
    const items = await menuItems(await rowOf("Buy milk"));
    expect(items).toContain("Move to");
    expect(items.some((title) => title.startsWith("Move to:"))).toBe(false);

    const buckets = await submenuItems("Move to");
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.some((item) => item.title.startsWith("Move to"))).toBe(false);
    const today = buckets.find((item) => item.title.endsWith(" Today"));
    expect(today).toBeDefined();

    await clickSubmenuItem(today!.title);
    await waitForNoteLine(INBOX, "- [ ] Buy milk #gtd/today");
  });

  it("leaves out Move to when there is no other bucket", async () => {
    await setPluginSettings(GTD, {
      buckets: [
        { id: "today", name: "Today", emoji: "⚡", dateRangeRule: { type: "today" }, quickMoveTargets: [], showInStatusBar: true },
      ],
    });
    const items = await menuItems(await rowOf("Call the plumber"));
    expect(items).not.toContain("Move to");
  });

  it("changes a due date to today, and the task follows it", async () => {
    await writeNote(`- [ ] Far off 📅 ${dayFromToday(20)}\n`, "Far off");
    await pick("Far off", "Change due date", "Today");
    await waitForNoteLine(NOTE, `- [ ] Far off 📅 ${dayFromToday(0)}`);
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Far off"), {
      timeoutMsg: "the task never moved to Today",
    });
  });

  it("unpins only through the date that decides placement", async () => {
    await writeNote(`- [ ] Pinned #gtd/someday 📅 ${dayFromToday(20)} ⏳ ${dayFromToday(21)}\n`, "Pinned");

    await menuItems(await rowOf("Pinned"));
    const scheduled = await submenuItems("Change scheduled date");
    expect(scheduled.some((item) => item.label)).toBe(false);
    await clickSubmenuItem("Today");
    await waitForNoteLine(NOTE, `- [ ] Pinned #gtd/someday 📅 ${dayFromToday(20)} ⏳ ${dayFromToday(0)}`);

    await menuItems(await rowOf("Pinned"));
    const due = await submenuItems("Change due date");
    expect(due[0].label).toBe(true);
    expect(due[0].title.startsWith("Update unpins from ")).toBe(true);
    expect(due[0].title.endsWith(" Someday / Maybe")).toBe(true);
    await clickSubmenuItem("Tomorrow");
    await waitForNoteLine(NOTE, `- [ ] Pinned 📅 ${dayFromToday(1)} ⏳ ${dayFromToday(0)}`);
  });

  it("offers the date Plan by uses on a dateless task", async () => {
    expect(await menuItems(await rowOf("Buy milk"))).toContain("Set due date");
    await closeMenus();

    await setPluginSettings(GTD, { planBy: "scheduled-first" });
    const items = await menuItems(await rowOf("Buy milk"));
    expect(items).toContain("Set scheduled date");
    expect(items).not.toContain("Set due date");
  });

  it("sets a due date on a dateless task", async () => {
    await pick("Buy milk", "Set due date", "Today");
    await waitForNoteLine(INBOX, `- [ ] Buy milk 📅 ${dayFromToday(0)}`);
  });

  it("offers no date items when Plan by is manual", async () => {
    await writeNote(`- [ ] Far off 📅 ${dayFromToday(20)}\n`, "Far off");
    await setPluginSettings(GTD, { planBy: "manual" });
    const items = await menuItems(await rowOf("Far off"));
    expect(items.filter((title) => title.includes(" date"))).toEqual([]);
  });

  it("opens Kalendae's calendar by the row from Custom…, and writes the day it picks", async () => {
    await writeNote(`- [ ] Far off 📅 ${dayFromToday(20)}\n`, "Far off");
    await menuItems(await rowOf("Far off"));
    expect((await submenuItems("Change due date")).map((item) => item.title)).not.toContain("Custom…");
    await closeMenus();

    // A stand-in for Kalendae's API, which records what it was asked and picks a fixed day.
    const picked = dayFromToday(40);
    await browser.executeObsidian(({ app }, picked) => {
      const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins;
      const calls: { value: string; anchorIsRow: boolean }[] = [];
      (window as unknown as { kalendaeCalls: typeof calls }).kalendaeCalls = calls;
      plugins["kalendae"] = {
        manifest: { id: "kalendae", name: "Kalendae", version: "0.0.0" },
        api: {
          pickDate: ({ value, anchor }: { value: string; anchor: unknown }) => {
            calls.push({ value, anchorIsRow: anchor instanceof HTMLElement && anchor.classList.contains("gtd-task") });
            return Promise.resolve(picked);
          },
        },
      };
    }, picked);

    await pick("Far off", "Change due date", "Custom…");
    await waitForNoteLine(NOTE, `- [ ] Far off 📅 ${picked}`);
    const calls = await browser.execute(
      () => (window as unknown as { kalendaeCalls: { value: string; anchorIsRow: boolean }[] }).kalendaeCalls,
    );
    expect(calls).toEqual([{ value: dayFromToday(20), anchorIsRow: true }]);

    await browser.executeObsidian(({ app }) => {
      delete (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins["kalendae"];
    });
  });

  it("keeps a Dataview field's brackets", async () => {
    await writeNote(`- [ ] Bracketed [due:: ${dayFromToday(20)}]\n`, "Bracketed");
    await pick("Bracketed", "Change due date", "Today");
    await waitForNoteLine(NOTE, `- [ ] Bracketed [due:: ${dayFromToday(0)}]`);
  });
});

export {};
