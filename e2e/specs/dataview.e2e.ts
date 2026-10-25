// Tasks' Dataview format: fields written `[due:: 2026-10-20]` or `(due:: 2026-10-20)` instead of
// emoji. What the panel reads from them, the tag / field name that may not reuse their keys, and
// how they pass through Tasks when a task is ticked or edited from the panel.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const TASKS = "obsidian-tasks-plugin";
const PANEL_VIEW = "gtd-tasks-panel";

const ROW = ".gtd-task";
const TASK_TEXT = ".gtd-task-text";
const CHECKBOX = ".gtd-task-checkbox";
const PRIORITY_BADGE = ".gtd-priority-badge";
const RECURRING_BADGE = ".gtd-recurring-badge";
const PREFIX_INPUT = 'input[placeholder="gtd"]';
const PREFIX_ERROR = ".gtd-field-error.gtd-field-error-visible";
const TASKS_MODAL = ".modal:has(.tasks-modal-description)";

/** What Obsidian keeps of its commands and settings window that the specs reach for. */
interface Commands {
  executeCommandById(id: string): boolean;
}
interface SettingsWindow {
  open(): void;
  openTabById(id: string): void;
  close(): void;
  /** The open tab. Its element is the one in the settings window; the window's own is not. */
  activeTab: { containerEl: HTMLElement };
}
interface GtdPlugin {
  settings: { tagPrefix: string };
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

/** Writes a note and waits for the panel to show `shown`, one of its tasks. */
async function writeNote(file: string, content: string, shown: string): Promise<void> {
  await obsidianPage.write(file, content);
  await browser.waitUntil(
    () => browser.execute(
      (selector, shown) => Array.from(document.querySelectorAll(selector)).some((el) => el.textContent?.trim() === shown),
      `${ROW} ${TASK_TEXT}`,
      shown,
    ),
    { timeoutMsg: `the panel never showed "${shown}" from ${file}` },
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

/** Opens Tasks' edit modal on a row, through the row's context menu. */
async function openEditModal(text: string): Promise<void> {
  const row = await rowOf(text);
  await browser.execute((selector) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no row at ${selector}`);
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
  }, row);
  await browser.execute(() => {
    const item = Array.from(document.querySelectorAll<HTMLElement>(".menu-item"))
      .find((el) => el.querySelector(".menu-item-title")?.textContent === "Edit task");
    if (!item) throw new Error("the row's menu has no Edit task item");
    item.click();
  });
  await $(TASKS_MODAL).waitForDisplayed({ timeoutMsg: "Tasks' edit modal never opened" });
}

/** The value of one of the edit modal's inputs, by its id: "description", "due", "scheduled"… */
function modalValue(id: string): Promise<string> {
  return browser.execute(
    (modal, id) => document.querySelector<HTMLInputElement>(`${modal} #${id}`)?.value ?? "(no such input)",
    TASKS_MODAL,
    id,
  );
}

async function clickModalButton(label: string): Promise<void> {
  await browser.execute((modal, label) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(`${modal} button`))
      .find((el) => el.textContent?.trim() === label);
    if (!button) throw new Error(`the edit modal has no ${label} button`);
    button.click();
  }, TASKS_MODAL, label);
  await $(TASKS_MODAL).waitForExist({ reverse: true, timeoutMsg: "Tasks' edit modal stayed open" });
}

/**
 * The tag / field name input and the error message under it. Settings open in a window of their
 * own, out of reach of `$`, so this goes through the open tab's element. The key is not `error`:
 * WebDriver reads a returned object with one as a failure.
 */
function prefixField(): Promise<{ value: string | null; message: string | null }> {
  return browser.executeObsidian(({ app }, inputSelector, errorSelector) => {
    const root = (app as unknown as { setting: SettingsWindow }).setting.activeTab.containerEl;
    return {
      value: root.querySelector<HTMLInputElement>(inputSelector)?.value ?? null,
      message: root.querySelector(errorSelector)?.textContent ?? null,
    };
  }, PREFIX_INPUT, PREFIX_ERROR);
}

/** Fires an event on the tag / field name input, built in the settings window's own realm. */
function fire(type: string, value?: string): Promise<void> {
  return browser.executeObsidian(({ app }, inputSelector, type, value) => {
    const input = (app as unknown as { setting: SettingsWindow }).setting.activeTab.containerEl.querySelector<HTMLInputElement>(inputSelector);
    if (!input) throw new Error(`no input at ${inputSelector}`);
    // An undefined argument arrives as null.
    if (value != null) input.value = value;
    const win = input.ownerDocument.defaultView as unknown as typeof window;
    input.dispatchEvent(new win.Event(type, { bubbles: true }));
  }, PREFIX_INPUT, type, value);
}

/** Puts a whole value in the input at once, as a paste would. */
function enter(value: string): Promise<void> {
  return fire("input", value);
}

function savedPrefix(): Promise<string> {
  return browser.executeObsidian(({ plugins }) => (plugins.gtdTasks as unknown as GtdPlugin).settings.tagPrefix);
}

describe("Dataview-format fields, without Tasks", () => {
  beforeEach(async () => {
    await resetState();
    // Installed for tasks.e2e.ts; here the panel reads the fields with no Tasks to lean on.
    await obsidianPage.disablePlugin(TASKS);
    await openPanel();
  });

  it("places tasks by a Dataview due date, square or round, and shows the text bare", async () => {
    await writeNote(
      "Dataview.md",
      `- [ ] Square today [due:: ${dayFromToday(0)}]\n` +
        `- [ ] Round in a week (due:: ${dayFromToday(7)})\n` +
        `- [ ] Round next year (due:: ${dayFromToday(400)})\n`,
      "Round next year",
    );
    expect(await tasksIn("today")).toContain("Square today");
    expect(await tasksIn("next-week")).toEqual(["Round in a week"]);
    expect(await tasksIn("someday")).toContain("Round next year");
  });

  it("shows the priority and recurrence badges for Dataview fields", async () => {
    await writeNote("Dataview.md", "- [ ] Water the plants [priority:: high] [repeat:: every day]\n", "Water the plants");
    const row = await rowOf("Water the plants");
    expect(await $(`${row} ${PRIORITY_BADGE}`).getText()).toBe("⏫");
    expect(await $(`${row} ${RECURRING_BADGE}`).isExisting()).toBe(true);
  });

  it("places a task by its emoji due date over a Dataview one on the same line", async () => {
    await writeNote("Mixed.md", `- [ ] Mixed dates [due:: ${dayFromToday(400)}] 📅 ${dayFromToday(0)}\n`, "Mixed dates");
    expect(await tasksIn("today")).toContain("Mixed dates");
  });

  it("takes the Dataview due date when the emoji one does not parse", async () => {
    await writeNote("Mixed.md", `- [ ] Fallback 📅 soon (due:: ${dayFromToday(0)})\n`, "Fallback 📅 soon");
    expect(await tasksIn("today")).toContain("Fallback 📅 soon");
  });

  it("places tasks by the due and scheduled emoji Tasks reads but does not write", async () => {
    // U+FE0F, the variation selector emoji pickers add after a marker.
    const vs16 = String.fromCodePoint(0xfe0f);
    await writeNote(
      "Spellings.md",
      `- [ ] Tear-off calendar 📆 ${dayFromToday(0)}\n` +
        `- [ ] Spiral calendar 🗓${vs16} ${dayFromToday(0)}\n` +
        `- [ ] Hourglass ⌛ ${dayFromToday(0)}\n` +
        `- [ ] Selector 📅${vs16} ${dayFromToday(0)}\n`,
      "Selector",
    );
    expect(await tasksIn("today")).toEqual(expect.arrayContaining(["Tear-off calendar", "Spiral calendar", "Hourglass", "Selector"]));
  });

  it("keeps a round-bracket field it cannot read in the row's text", async () => {
    await writeNote("Dataview.md", "- [ ] Pay rent (due:: soon)\n", "Pay rent (due:: soon)");
    expect(await tasksIn("to-review")).toContain("Pay rent (due:: soon)");
  });

  it("does not read the bucket field as a Tasks field, when an old setting gave it a Tasks key", async () => {
    // The settings tab refuses "repeat" now; saved straight into the settings, as before the rule.
    await setPluginSettings(GTD, { storageMode: "inline-field", tagPrefix: "repeat" });
    await writeNote("Fields.md", "- [ ] Field task [repeat:: today]\n", "Field task");
    expect(await tasksIn("today")).toContain("Field task");
    expect(await $(`${await rowOf("Field task")} ${RECURRING_BADGE}`).isExisting()).toBe(false);
  });
});

describe("The tag / field name setting", () => {
  beforeEach(async () => {
    await resetState();
    await obsidianPage.disablePlugin(TASKS);
    await browser.executeObsidian(({ app }, id) => {
      const setting = (app as unknown as { setting: SettingsWindow }).setting;
      setting.open();
      setting.openTabById(id);
    }, GTD);
    await browser.waitUntil(async () => (await prefixField()).value !== null, {
      timeoutMsg: "the settings tab never showed the tag / field name",
    });
  });

  afterEach(async () => {
    await browser.executeObsidian(({ app }) => (app as unknown as { setting: SettingsWindow }).setting.close());
  });

  it("refuses a Tasks key in any case, and says why", async () => {
    for (const name of ["due", "Due", "onCompletion"]) {
      await enter(name);
      expect(await prefixField()).toEqual({ value: name, message: `"${name}" is a Tasks field name. Pick another tag / field name.` });
      expect(await savedPrefix()).toBe("gtd");
    }
  });

  it("puts the saved name back when the field is left holding a refused one", async () => {
    await enter("due");
    await fire("blur");
    expect(await prefixField()).toEqual({ value: "gtd", message: null });
  });

  it("saves a name that only starts like a Tasks key, once the field is left", async () => {
    await enter("dueDate");
    expect((await prefixField()).message).toBeNull();
    expect(await savedPrefix()).toBe("gtd");
    await fire("blur");
    await browser.waitUntil(async () => (await savedPrefix()) === "dueDate", { timeoutMsg: "dueDate was never saved" });
  });

  it("saves the name when settings close with the field still focused", async () => {
    await enter("horizon");
    await browser.executeObsidian(({ app }) => (app as unknown as { setting: SettingsWindow }).setting.close());
    await browser.waitUntil(async () => (await savedPrefix()) === "horizon", { timeoutMsg: "closing settings lost the name" });
  });
});

describe("Dataview-format fields, with Tasks", () => {
  beforeEach(async () => {
    await resetState();
    await openPanel();
  });

  it("hides a ticked recurrence written in Dataview format, as it does an emoji one", async () => {
    await setTasksSettings({ taskFormat: "dataview" });
    await writeNote(
      "Habits.md",
      `- [ ] Water the plants #gtd/someday  [repeat:: every day]  [due:: ${dayFromToday(0)}]\n`,
      "Water the plants",
    );
    await $(`${await rowOf("Water the plants")} ${CHECKBOX}`).click();
    await browser.waitUntil(async () => (await obsidianPage.read("Habits.md")).includes(`[completion:: ${dayFromToday(0)}]`), {
      timeoutMsg: "Tasks never wrote a Dataview done date",
    });
    await browser.waitUntil(async () => (await $$(`.gtd-bucket[data-bucket-id="someday"] ${ROW}.is-checked`).length) === 0, {
      timeoutMsg: "the completed occurrence stayed in the panel",
    });
    expect((await tasksIn("someday")).filter((text) => text === "Water the plants")).toHaveLength(1);
  });

  it("keeps a ticked Dataview recurrence in view when Tasks, set to emoji, writes no next occurrence", async () => {
    // Tasks reads `[repeat:: …]` as text in emoji format, so the tick is a plain one.
    const line = `- [ ] Water the plants #gtd/someday [repeat:: every day] [due:: ${dayFromToday(0)}]`;
    await writeNote("Habits.md", `${line}\n`, "Water the plants");
    await $(`${await rowOf("Water the plants")} ${CHECKBOX}`).click();
    await waitForNote("Habits.md", `${line.replace("- [ ]", "- [x]")} ✅ ${dayFromToday(0)}\n`);
    await $(`${await rowOf("Water the plants")}.is-checked`).waitForDisplayed({
      timeoutMsg: "the ticked task left the panel, as if a next occurrence had replaced it",
    });
  });

  it("opens Tasks' edit modal with the Dataview dates filled in, when Tasks uses that format", async () => {
    await setTasksSettings({ taskFormat: "dataview" });
    const line = `- [ ] Pay rent #gtd/today  [due:: ${dayFromToday(3)}]`;
    await writeNote("Rent.md", `${line}\n`, "Pay rent");
    await openEditModal("Pay rent");
    expect(await modalValue("due")).toBe(dayFromToday(3));
    await clickModalButton("Apply");
    // Tasks writes the line back in its own layout; it already was, so nothing changes.
    await waitForNote("Rent.md", `${line}\n`);
    expect(await tasksIn("today")).toContain("Pay rent");
  });

  it("opens Tasks' edit modal without a Dataview date when Tasks uses emoji", async () => {
    // The panel reads both formats; Tasks reads only the one it is set to.
    await writeNote("Rent.md", `- [ ] Pay rent [due:: ${dayFromToday(3)}]\n`, "Pay rent");
    await openEditModal("Pay rent");
    expect(await modalValue("due")).toBe("");
    expect(await modalValue("description")).toBe(`Pay rent [due:: ${dayFromToday(3)}]`);
    await clickModalButton("Cancel");
  });

  it("keeps a Dataview date an edit leaves in the text, under the emoji date the edit adds", async () => {
    await writeNote("Rent.md", `- [ ] Pay rent [due:: ${dayFromToday(400)}]\n`, "Pay rent");
    await openEditModal("Pay rent");
    await browser.execute((modal, date) => {
      const input = document.querySelector<HTMLInputElement>(`${modal} #due`);
      if (!input) throw new Error("the edit modal has no due input");
      input.value = date;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, TASKS_MODAL, dayFromToday(0));
    await clickModalButton("Apply");
    await waitForNote("Rent.md", `- [ ] Pay rent [due:: ${dayFromToday(400)}] 📅 ${dayFromToday(0)}\n`);
    // Emoji outrank Dataview, so the panel follows the date Tasks itself reads.
    await browser.waitUntil(async () => (await tasksIn("today")).includes("Pay rent"), {
      timeoutMsg: "the task never moved to Today by its new emoji date",
    });
  });
});

// Keeps this file's names its own: a file with no import or export shares one scope with every other.
export {};
