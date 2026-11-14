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

/**
 * Days left in this week after today, with a Monday week start: This Week runs from tomorrow
 * to Sunday, so it is empty on a Sunday and one day long on a Saturday.
 */
function daysLeftInWeek(): number {
  return 6 - ((new Date().getDay() + 6) % 7);
}

/**
 * Runs a drop's last step on the panel's view, the way a drag ends: the harness has no drag.
 * `ordered` names tasks by text, top to bottom, for the drop position.
 */
async function drop(
  method: "handleDropDate" | "handleMove",
  text: string,
  args: unknown[],
  ordered: string[] | null,
): Promise<void> {
  await browser.executeObsidian(async ({ app }, gtd, type, method, text, args, ordered) => {
    interface Task { id: string; text: string }
    const plugin = (app as unknown as {
      plugins: { plugins: Record<string, { taskIndex: { getAllTasks(): Task[] } }> };
    }).plugins.plugins[gtd];
    const tasks = plugin.taskIndex.getAllTasks();
    const byText = (t: string) => {
      const task = tasks.find((task) => task.text === t);
      if (!task) throw new Error(`no task "${t}" in the index`);
      return task;
    };
    const ids = ordered === null ? null : ordered.map((t) => byText(t).id);
    const view = app.workspace.getLeavesOfType(type)[0].view as unknown as Record<string, (...a: unknown[]) => Promise<void>>;
    await view[method](byText(text), ...args, ids);
  }, GTD, PANEL_VIEW, method, text, args, ordered);
}

/** Where on an element a drag event lands: its centre, or 2px above its bottom edge. */
type DragSpot = "center" | "bottom";

/** Fires one drag event at a spot on the element, on whatever is drawn there, the way a real drag does. */
function fireDrag(type: string, selector: string, spot: DragSpot): Promise<void> {
  return browser.execute((type, selector, spot) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`nothing at ${selector}`);
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = spot === "center" ? rect.top + rect.height / 2 : rect.bottom - 2;
    const w = window as unknown as { gtdDragData?: DataTransfer };
    w.gtdDragData ??= new DataTransfer();
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
    const target = type === "pointerdown" || type === "dragstart" || type === "dragend"
      ? el
      : document.elementFromPoint(x, y) ?? el;
    if (type === "pointerdown") {
      target.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
      target.dispatchEvent(new MouseEvent("mousedown", init));
    } else {
      target.dispatchEvent(new DragEvent(type, { ...init, dataTransfer: w.gtdDragData }));
    }
    if (type === "dragend") delete w.gtdDragData;
  }, type, selector, spot);
}

/** Lets SortableJS run the timers it starts between drag events. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

describe("a dated drop", () => {
  beforeEach(async () => {
    await resetState();
    await obsidianPage.disablePlugin("obsidian-tasks-plugin");
    await setPluginSettings(GTD, { planBy: "scheduled-first", weekStartsOn: "monday", dropIntoBucket: "ask" });
    await openPanel();
  });

  // This Week is empty on a Sunday, and then no menu shows at all.
  (daysLeftInWeek() >= 1 ? it : it.skip)("opens one menu for a drop on a collapsed bucket's header", async () => {
    const header = `.gtd-bucket[data-bucket-id="this-week"] .gtd-bucket-header`;
    await $(header).click();
    await $(`${header}.collapsed`).waitForExist({ timeoutMsg: "This Week never collapsed" });

    const row = await rowOf("Buy milk");
    const next = `.gtd-bucket[data-bucket-id="next-week"] .gtd-bucket-header`;
    const todayRow = await rowOf("Call the plumber");
    const variants: [string, [string, string, DragSpot][]][] = [
      ["centre only", [["dragover", header, "center"], ["drop", header, "center"]]],
      ["bottom then centre", [["dragover", header, "bottom"], ["dragover", header, "center"], ["drop", header, "center"]]],
      ["drop at bottom", [["dragover", header, "bottom"], ["drop", header, "bottom"]]],
      ["enter then leave", [["dragenter", header, "center"], ["dragover", header, "center"], ["dragover", header, "bottom"], ["dragleave", header, "center"], ["dragenter", header, "center"], ["dragover", header, "center"], ["drop", header, "center"]]],
      ["via next week", [["dragover", next, "center"], ["dragover", header, "bottom"], ["dragover", header, "center"], ["drop", header, "center"]]],
      // Today sits open between To Review and This Week, so the drag crosses its rows first.
      ["across an open Today", [["dragover", todayRow, "center"], ["dragover", header, "center"], ["drop", header, "center"]]],
    ];
    const counts: string[] = [];
    for (const [name, steps] of variants) {
      await fireDrag("pointerdown", row, "center");
      await fireDrag("dragstart", row, "center");
      await settle();
      for (const [type, sel, spot] of steps) {
        await fireDrag(type, sel, spot);
        await settle();
      }
      await fireDrag("dragend", row, "center");
      await settle();
      await settle();
      counts.push(`${name}: ${await browser.execute(() => {
        const menus = document.querySelectorAll(".menu");
        const first = menus[0]?.querySelector(".menu-item-title")?.textContent ?? "";
        return `${menus.length} ${first.endsWith(" This Week") ? "This Week" : first}`;
      })}`);
      await closeMenus();
      await settle();
    }
    expect(counts).toEqual(variants.map(([name]) => `${name}: 1 This Week`));
  });

  // This Week is empty on a Sunday.
  (daysLeftInWeek() >= 1 ? it : it.skip)("writes the date to the field Plan by reads, and the task shows in the bucket", async () => {
    const day = dayFromToday(1);
    await writeNote("- [ ] Undated\n", "Undated");
    await drop("handleDropDate", "Undated", ["scheduled", day, "this-week"], null);
    await waitForNoteLine(NOTE, `- [ ] Undated ⏳ ${day}`);
    await browser.waitUntil(async () => (await tasksIn("this-week")).includes("Undated"), {
      timeoutMsg: "the task never showed in This Week",
    });
  });

  // A must be dated after B, so its natural place is below B: This Week needs two days.
  (daysLeftInWeek() >= 2 ? it : it.skip)("removes the pin and keeps the drop position", async () => {
    await writeNote(`- [ ] A #gtd/today\n- [ ] B ⏳ ${dayFromToday(1)}\n`, "A");
    await drop("handleDropDate", "A", ["scheduled", dayFromToday(2), "this-week"], ["A", "B"]);
    await waitForNoteLine(NOTE, `- [ ] A ⏳ ${dayFromToday(2)}`);
    await browser.waitUntil(async () => (await tasksIn("this-week")).includes("A"), {
      timeoutMsg: "A never showed in This Week",
    });
    // The fixture vault has tasks of its own in This Week.
    expect((await tasksIn("this-week")).filter((t) => t === "A" || t === "B")).toEqual(["A", "B"]);
  });

  describe("from a real drag", () => {
    // Day-independent ranges: Soon is three days long, so every day is offered; Later is long enough to leave some out.
    const buckets = [
      { id: "today", name: "Today", emoji: "⚡", dateRangeRule: { type: "today" }, quickMoveTargets: [], showInStatusBar: false },
      { id: "soon", name: "Soon", emoji: "🔜", dateRangeRule: { type: "within-days-range", from: 1, to: 3 }, quickMoveTargets: [], showInStatusBar: false },
      { id: "later", name: "Later", emoji: "🔭", dateRangeRule: { type: "within-days-range", from: 4, to: 30 }, quickMoveTargets: [], showInStatusBar: false },
      { id: "someday", name: "Someday", emoji: "💭", dateRangeRule: { type: "catch-all" }, quickMoveTargets: [], showInStatusBar: false },
    ];

    beforeEach(async () => {
      await setPluginSettings(GTD, { buckets });
      await writeNote(`- [ ] Soon anchor ⏳ ${dayFromToday(2)}\n- [ ] Later anchor ⏳ ${dayFromToday(10)}\n`, "Later anchor");
    });

    /** Drags the row showing `from` onto the row showing `onto`, and waits for the menu the drop opens. */
    async function dragOnto(from: string, onto: string): Promise<void> {
      const row = await rowOf(from);
      const target = await rowOf(onto);
      await fireDrag("pointerdown", row, "center");
      await fireDrag("dragstart", row, "center");
      await settle();
      await fireDrag("dragover", target, "center");
      await settle();
      await fireDrag("drop", target, "center");
      await fireDrag("dragend", row, "center");
      await $(".menu").waitForDisplayed({ timeoutMsg: "the drop never opened a menu" });
    }

    /** The text of each task the bucket shows, leaving out hidden rows. */
    function shownIn(bucketId: string): Promise<string[]> {
      return browser.execute(
        (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector))
          .filter((el) => el.offsetParent !== null)
          .map((el) => (el.textContent ?? "").trim()),
        `.gtd-bucket[data-bucket-id="${bucketId}"] ${TASK_TEXT}`,
      );
    }

    function menuTitles(): Promise<string[]> {
      return browser.execute(() =>
        Array.from(document.querySelectorAll(".menu .menu-item-title"), (el) => (el.textContent ?? "").trim()),
      );
    }

    function noticeTexts(): Promise<string[]> {
      return browser.execute(() => Array.from(document.querySelectorAll(".notice"), (el) => (el.textContent ?? "").trim()));
    }

    /** A stand-in for Kalendae's API that picks `picked`. */
    async function stubKalendae(picked: string): Promise<void> {
      await browser.executeObsidian(({ app }, picked) => {
        const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins;
        plugins["kalendae"] = {
          manifest: { id: "kalendae", name: "Kalendae", version: "0.0.0" },
          api: { pickDate: () => Promise.resolve(picked) },
        };
      }, picked);
    }

    async function unstubKalendae(): Promise<void> {
      await browser.executeObsidian(({ app }) => {
        delete (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins["kalendae"];
      });
    }

    it("shows the row where it was dropped while the menu is open, and Escape puts it back", async () => {
      await dragOnto("Buy milk", "Soon anchor");
      expect(await shownIn("soon")).toContain("Buy milk");
      expect(await shownIn("to-review")).not.toContain("Buy milk");

      await press("Escape");
      await browser.waitUntil(async () => !(await $(".menu").isExisting()), { timeoutMsg: "the menu never closed" });
      await settle();
      expect(await shownIn("soon")).not.toContain("Buy milk");
      expect(await shownIn("to-review")).toContain("Buy milk");
      expect((await obsidianPage.read(INBOX)).split("\n")).toContain("- [ ] Buy milk");
    });

    it("hides the row and marks a collapsed bucket's header while the menu is open, and Escape undoes both", async () => {
      const header = `.gtd-bucket[data-bucket-id="soon"] .gtd-bucket-header`;
      await $(header).click();
      await $(`${header}.collapsed`).waitForExist({ timeoutMsg: "Soon never collapsed" });
      const marked = () => browser.execute((header) => document.querySelector(header)?.classList.contains("gtd-drop-target") ?? false, header);

      const row = await rowOf("Buy milk");
      await fireDrag("pointerdown", row, "center");
      await fireDrag("dragstart", row, "center");
      await settle();
      await fireDrag("dragover", header, "center");
      await settle();
      await fireDrag("drop", header, "center");
      await fireDrag("dragend", row, "center");
      await $(".menu").waitForDisplayed({ timeoutMsg: "the drop never opened a menu" });

      expect(await shownIn("to-review")).not.toContain("Buy milk");
      expect(await marked()).toBe(true);

      await press("Escape");
      await browser.waitUntil(async () => !(await $(".menu").isExisting()), { timeoutMsg: "the menu never closed" });
      await settle();
      expect(await shownIn("to-review")).toContain("Buy milk");
      expect(await marked()).toBe(false);
    });

    it("keeps the row at its drop position while the move-children dialog is open", async () => {
      await obsidianPage.write(INBOX, "- [ ] Parent\n\t- [ ] Child #gtd/someday\n");
      await browser.waitUntil(async () => (await tasksIn("someday")).includes("Child"), {
        timeoutMsg: "the child never showed in Someday",
      });
      await dragOnto("Parent", "Soon anchor");
      await browser.execute(() => {
        const item = Array.from(document.querySelectorAll<HTMLElement>(".menu .menu-item"))
          .find((el) => (el.querySelector(".menu-item-title")?.textContent ?? "").startsWith("Tomorrow"));
        if (!item) throw new Error("the menu has no Tomorrow item");
        item.click();
      });
      await $(".gtd-confirm-overlay").waitForDisplayed({ timeoutMsg: "the move-children dialog never showed" });
      await settle();
      expect(await shownIn("soon")).toContain("Parent");
      expect(await shownIn("to-review")).not.toContain("Parent");

      await browser.execute(() => {
        const cancel = Array.from(document.querySelectorAll<HTMLElement>(".gtd-confirm-buttons button"))
          .find((el) => el.textContent?.trim() === "Cancel");
        if (!cancel) throw new Error("the dialog has no Cancel button");
        cancel.click();
      });
      await settle();
      expect(await shownIn("soon")).not.toContain("Parent");
      expect(await shownIn("to-review")).toContain("Parent");
    });

    it("keeps the source bucket's order when a drop on a collapsed header is cancelled", async () => {
      await obsidianPage.write(INBOX, "- [ ] First today #gtd/today\n- [ ] Second today #gtd/today\n");
      await browser.waitUntil(async () => (await tasksIn("today")).includes("Second today"), {
        timeoutMsg: "the Today tasks never showed",
      });
      const before = await tasksIn("today");
      const header = `.gtd-bucket[data-bucket-id="soon"] .gtd-bucket-header`;
      await $(header).click();
      await $(`${header}.collapsed`).waitForExist({ timeoutMsg: "Soon never collapsed" });

      // On its way down to Soon's header, the row passes the one below it in its own list.
      const row = await rowOf("First today");
      await fireDrag("pointerdown", row, "center");
      await fireDrag("dragstart", row, "center");
      await settle();
      await fireDrag("dragover", await rowOf("Second today"), "center");
      await settle();
      await fireDrag("dragenter", header, "center");
      await fireDrag("dragover", header, "center");
      await settle();
      await fireDrag("drop", header, "center");
      await fireDrag("dragend", row, "center");
      await $(".menu").waitForDisplayed({ timeoutMsg: "the drop never opened a menu" });

      await press("Escape");
      await browser.waitUntil(async () => !(await $(".menu").isExisting()), { timeoutMsg: "the menu never closed" });
      await settle();
      await settle();
      expect(await tasksIn("today")).toEqual(before);
    });

    it("hides the drag placeholder while a collapsed bucket's header is the drop target", async () => {
      const header = `.gtd-bucket[data-bucket-id="soon"] .gtd-bucket-header`;
      await $(header).click();
      await $(`${header}.collapsed`).waitForExist({ timeoutMsg: "Soon never collapsed" });
      const placeholderShown = () => browser.execute(() => {
        const ghost = document.querySelector<HTMLElement>(".sortable-ghost");
        return ghost !== null && ghost.offsetParent !== null;
      });

      // Crossing Today leaves SortableJS's placeholder in Today's list.
      const row = await rowOf("Buy milk");
      const todayRow = await rowOf("Call the plumber");
      await fireDrag("pointerdown", row, "center");
      await fireDrag("dragstart", row, "center");
      await settle();
      await fireDrag("dragover", todayRow, "center");
      await settle();
      expect(await placeholderShown()).toBe(true);

      await fireDrag("dragenter", header, "center");
      await fireDrag("dragover", header, "center");
      await settle();
      expect(await placeholderShown()).toBe(false);

      await fireDrag("dragleave", header, "center");
      await fireDrag("dragover", todayRow, "center");
      await settle();
      expect(await placeholderShown()).toBe(true);

      // Ended on the header and cancelled, so no drop or menu is left for the next test.
      await fireDrag("dragenter", header, "center");
      await fireDrag("dragover", header, "center");
      await settle();
      await fireDrag("drop", header, "center");
      await fireDrag("dragend", row, "center");
      await $(".menu").waitForDisplayed({ timeoutMsg: "the drop never opened a menu" });
      await press("Escape");
      await browser.waitUntil(async () => !(await $(".menu").isExisting()), { timeoutMsg: "the menu never closed" });
      await settle();
    });

    it("pins the task when the menu is closed by a click elsewhere, and says so", async () => {
      await dragOnto("Buy milk", "Soon anchor");
      await $(".gtd-panel-header h3").click();
      await waitForNoteLine(INBOX, "- [ ] Buy milk #gtd/soon");
      expect(await noticeTexts()).toContain("GTD Tasks: Pinned to 🔜 Soon. To cancel a drop, press Esc while its menu is open.");
    });

    it("offers Custom… only when the menu leaves out some day of the range", async () => {
      await stubKalendae(dayFromToday(12));
      await dragOnto("Buy milk", "Soon anchor");
      expect(await menuTitles()).not.toContain("Custom…");
      await press("Escape");
      await settle();

      await dragOnto("Buy milk", "Later anchor");
      expect(await menuTitles()).toContain("Custom…");
      await closeMenus();
      await unstubKalendae();
    });

    it("writes nothing for a Custom… day outside the bucket, and says so", async () => {
      await stubKalendae(dayFromToday(60));
      await dragOnto("Buy milk", "Later anchor");
      await browser.execute(() => {
        const item = Array.from(document.querySelectorAll<HTMLElement>(".menu .menu-item"))
          .find((el) => el.querySelector(".menu-item-title")?.textContent === "Custom…");
        if (!item) throw new Error("the menu has no Custom… item");
        item.click();
      });
      await browser.waitUntil(async () => (await noticeTexts()).some((text) => text.includes(" is outside 🔭 Later.")), {
        timeoutMsg: "no notice said the day was outside the bucket",
      });
      await settle();
      expect((await obsidianPage.read(INBOX)).split("\n")).toContain("- [ ] Buy milk");
      await unstubKalendae();
    });
  });

  it("still pins when the setting is Pin", async () => {
    await setPluginSettings(GTD, { dropIntoBucket: "pin" });
    await writeNote("- [ ] Undated\n", "Undated");
    await drop("handleMove", "Undated", ["this-week"], null);
    await waitForNoteLine(NOTE, "- [ ] Undated #gtd/this-week");
  });
});

export {};
