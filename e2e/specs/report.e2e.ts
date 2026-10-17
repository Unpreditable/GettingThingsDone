// The "Review completed tasks" command: the modal it opens, read from the ✅ and ❌ dates on the
// lines of a note written relative to today, and what clicking one of its rows opens.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const PANEL_VIEW = "gtd-tasks-panel";
const NOTE = "Report.md";

const REPORT = ".gtd-report";
const TAB = ".gtd-report-tab";
const TAB_COUNT = ".gtd-report-tab-count";
const DAY = ".gtd-report-day";
const CHIP = ".gtd-report-chip";
const ROW = ".gtd-report-row";

/** What Obsidian keeps of its commands that the specs reach for. */
interface Commands {
  executeCommandById(id: string): boolean;
}

/** What the spec reads off the plugin: the tasks it has indexed. */
interface IndexedPlugin {
  taskIndex: { getAllTasks(): { filePath: string }[] };
}

/** Today plus `days`, as a Tasks date (YYYY-MM-DD) in local time. */
function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Days since the start of this week, with the plugin's default Monday start: 0 on a Monday. */
const sinceMonday = (new Date().getDay() + 6) % 7;

// Last week's Monday is always last week, and the day before it never in either week; yesterday
// moves from this week to last week when today is a Monday, which the expectations follow.
const LINES = [
  `- [x] Write the weekly summary ✅ ${dayFromToday(0)}`,
  `- [x] Reply to the landlord ✅ ${dayFromToday(0)}`,
  `- [-] Drop the old backlog ❌ ${dayFromToday(0)}`,
  `- [x] Book the dentist ✅ ${dayFromToday(-1)}`,
  `- [x] Plan the sprint ✅ ${dayFromToday(-sinceMonday - 7)}`,
  `- [x] Archive old notes ✅ ${dayFromToday(-sinceMonday - 8)}`,
];
const yesterdayThisWeek = sinceMonday > 0;

/**
 * Writes the note and waits for the plugin to index it, once the plugin has opened its panel by
 * itself as it does on a first install. The modal reads the index once, when it opens.
 */
async function writeNote(): Promise<void> {
  await browser.waitUntil(
    () => browser.executeObsidian(({ app }, type) => app.workspace.getLeavesOfType(type).length > 0, PANEL_VIEW),
    { timeoutMsg: "the plugin never opened its panel after a fresh install" },
  );
  await obsidianPage.write(NOTE, LINES.join("\n") + "\n");
  await browser.waitUntil(
    () =>
      browser.executeObsidian(
        ({ plugins }, file, count) =>
          (plugins.gtdTasks as unknown as IndexedPlugin).taskIndex.getAllTasks().filter((t) => t.filePath === file)
            .length === count,
        NOTE,
        LINES.length,
      ),
    { timeoutMsg: `the plugin never indexed the tasks in ${NOTE}` },
  );
}

async function openReport(): Promise<void> {
  await browser.executeObsidian(({ app }, id) => {
    (app as unknown as { commands: Commands }).commands.executeCommandById(`${id}:review-completed-tasks`);
  }, GTD);
  await $(REPORT).waitForDisplayed({ timeoutMsg: "the completed-tasks modal never opened" });
}

/** The trimmed text of every element matching the selector, top to bottom. */
function texts(selector: string): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => (el.textContent ?? "").trim()),
    selector,
  );
}

/** Clicks the tab at this position: Today, Yesterday, This week, Last week. */
async function selectTab(index: number): Promise<void> {
  await browser.execute(
    (selector, index) => document.querySelectorAll<HTMLElement>(selector)[index].click(),
    TAB,
    index,
  );
}

/** The day heading's date as the modal writes it, in the language Obsidian runs in. */
function headingDate(days: number): Promise<string> {
  return browser.executeObsidian(({ obsidian }, days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return new Intl.DateTimeFormat(obsidian.getLanguage() ?? "en", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
  }, days);
}

describe("The completed-tasks modal", () => {
  beforeEach(async () => {
    await resetState();
    await writeNote();
    await openReport();
  });

  // resetState puts back files and settings but leaves a modal open, and the next test's would
  // stack on top of it.
  afterEach(async () => {
    while (await $(".modal-container").isExisting()) await press("Escape");
  });

  it("counts each tab's completed tasks, leaving out the cancelled one", async () => {
    expect(await texts(TAB_COUNT)).toEqual([
      "2",
      "1",
      String(yesterdayThisWeek ? 3 : 2),
      String(yesterdayThisWeek ? 1 : 2),
    ]);
  });

  it("opens on this week, with a heading per day, newest first", async () => {
    const headings = await texts(DAY);
    expect(headings).toHaveLength(yesterdayThisWeek ? 2 : 1);
    expect(headings[0]).toContain(await headingDate(0));
    expect(await texts(`${DAY} ${CHIP}`)).toEqual(yesterdayThisWeek ? ["2", "1"] : ["2"]);
    expect(await texts(`${ROW}.is-cancelled .gtd-report-text`)).toEqual(["Drop the old backlog"]);
  });

  it("shows last week's days under their own headings", async () => {
    await selectTab(3);
    await browser.waitUntil(async () => (await texts(`${ROW} .gtd-report-text`)).includes("Plan the sprint"), {
      timeoutMsg: "the Last week tab never listed last week's task",
    });

    const headings = await texts(DAY);
    expect(headings).toHaveLength(yesterdayThisWeek ? 1 : 2);
    expect(headings[headings.length - 1]).toContain(await headingDate(-sinceMonday - 7));
    expect(await texts(`${ROW} .gtd-report-text`)).not.toContain("Archive old notes");
  });

  it("lists today's tasks without a heading on the Today tab", async () => {
    await selectTab(0);
    await browser.waitUntil(async () => (await texts(DAY)).length === 0, {
      timeoutMsg: "the Today tab kept its day headings",
    });
    expect(await texts(`${ROW} .gtd-report-text`)).toEqual([
      "Write the weekly summary",
      "Reply to the landlord",
      "Drop the old backlog",
    ]);
  });

  it("centres the trophy on its title's text", async () => {
    const [trophy, text] = await browser.execute((report) => {
      const title = document.querySelector(report)?.closest(".modal")?.querySelector(".gtd-report-title");
      const textNode = Array.from(title?.childNodes ?? []).find((n) => n.nodeType === 3 && n.textContent?.trim());
      const svg = title?.querySelector(".gtd-report-title-icon svg");
      if (!textNode || !svg) return [null, null];
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const middle = (box: DOMRect) => box.top + box.height / 2;
      return [middle(svg.getBoundingClientRect()), middle(range.getBoundingClientRect())];
    }, REPORT);

    expect(trophy).not.toBeNull();
    expect(Math.abs((trophy as number) - (text as number))).toBeLessThanOrEqual(1);
  });

  it("closes from its own button, level with its other header buttons", async () => {
    const layout = await browser.execute((report) => {
      const modal = document.querySelector(report)?.closest(".modal");
      const middle = (el: Element | null | undefined) => {
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return box.top + box.height / 2;
      };
      const obsidianClose = modal?.querySelector(".modal-header-button");
      return {
        obsidianCloseShown: !!obsidianClose && getComputedStyle(obsidianClose).display !== "none",
        info: middle(modal?.querySelector(".gtd-report-header .clickable-icon")),
        close: middle(modal?.querySelector(".gtd-report-close")),
      };
    }, REPORT);

    expect(layout.obsidianCloseShown).toBe(false);
    expect(layout.close).not.toBeNull();
    expect(Math.abs((layout.close as number) - (layout.info as number))).toBeLessThanOrEqual(1);

    await $(".gtd-report-close").click();
    await $(REPORT).waitForExist({ reverse: true, timeoutMsg: "the modal stayed open after its close button" });
  });

  it("closes and puts the caret on the task's line when a row is clicked", async () => {
    await browser.execute(
      (selector, text) => {
        for (const row of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          if (row.querySelector(".gtd-report-text")?.textContent?.trim() === text) return row.click();
        }
        throw new Error(`no row in the modal shows "${text}"`);
      },
      ROW,
      "Reply to the landlord",
    );

    await $(REPORT).waitForExist({ reverse: true, timeoutMsg: "the modal stayed open after a row was clicked" });
    await browser.waitUntil(
      () =>
        browser.executeObsidian(
          ({ app }, file) =>
            app.workspace.activeEditor?.file?.path === file && app.workspace.activeEditor?.editor?.getCursor().line === 1,
          NOTE,
        ),
      { timeoutMsg: `the caret never landed on line 2 of ${NOTE}` },
    );
  });
});
