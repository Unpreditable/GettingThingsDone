// The "what's new" note: a one-time banner in the panel for installs that predate it, waiting its
// turn behind the other banners, and the changelog it opens, which the command and the settings
// page open too.

// Written without imports: describe, it, expect, browser, $ and the helpers are globals the harness
// provides.

const GTD = "gtd-tasks";
const PANEL_VIEW = "gtd-tasks-panel";
const NEWEST_NOTE = "1";

const ROW = ".gtd-task";
const BANNER = ".gtd-language-banner";
const NOTE_BANNER = ".gtd-notice-banner";
const BANNER_BUTTON = ".gtd-language-banner-btn";
const CHANGELOG = ".modal .gtd-whats-new";
const READ_IN_ENGLISH = ".gtd-whats-new-english";

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
  settings: { lastNoticeSeen: string };
}

/** Waits for the panel the plugin opens by itself on a first install. */
async function waitForFirstPanel(): Promise<void> {
  await browser.waitUntil(
    () => browser.executeObsidian(({ app }, type) => app.workspace.getLeavesOfType(type).length > 0, PANEL_VIEW),
    { timeoutMsg: "the plugin never opened its panel after a fresh install" },
  );
}

/** Opens the panel through the plugin's own command, and waits for its rows. */
async function showPanel(): Promise<void> {
  await browser.executeObsidian(({ app }, id) => {
    (app as unknown as { commands: Commands }).commands.executeCommandById(`${id}:open-gtd-panel`);
  }, GTD);
  await $(ROW).waitForDisplayed();
}

/**
 * Opens the panel once the plugin has opened it by itself, as it does on a first install. Running
 * the command before that would race it into a second panel.
 */
async function openPanel(): Promise<void> {
  await waitForFirstPanel();
  await showPanel();
}

/** Turns the plugin off and on, so it loads its settings from data.json again, and reopens the panel. */
async function reloadPlugin(): Promise<void> {
  await togglePlugin(GTD);
  await showPanel();
}

/** The settled note id the running plugin holds. */
function lastNoticeSeen(): Promise<string> {
  return browser.executeObsidian(
    ({ app }, id) =>
      (app as unknown as { plugins: { plugins: Record<string, GtdPlugin> } }).plugins.plugins[id].settings
        .lastNoticeSeen,
    GTD,
  );
}

/** The trimmed text of every element matching the selector, top to bottom. */
function texts(selector: string): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => (el.textContent ?? "").trim()),
    selector,
  );
}

/** Clicks the button in the showing banner that reads `label`. */
async function clickBannerButton(label: string): Promise<void> {
  const clicked = await browser.execute(
    (selector, label) => {
      const button = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
        (el) => (el.textContent ?? "").trim() === label,
      );
      button?.click();
      return button !== undefined;
    },
    BANNER_BUTTON,
    label,
  );
  expect(clicked).toBe(true);
}

/** Every other banner settled, so only the note can show. */
const OTHER_BANNERS_SEEN = { weekStartNoticeSeen: true, catchAllNoticeSeen: true };

describe("The what's new note", () => {
  beforeEach(async () => {
    await resetState();
    await openPanel();
  });

  afterEach(async () => {
    while (await $(".modal-container").isExisting()) await press("Escape");
  });

  it("doesn't show on a fresh install", async () => {
    expect(await lastNoticeSeen()).toBe(NEWEST_NOTE);
    expect(await $(NOTE_BANNER).isExisting()).toBe(false);
  });

  it("shows once to an install that hasn't settled it, and Dismiss settles it for good", async () => {
    await setPluginSettings(GTD, { ...OTHER_BANNERS_SEEN, lastNoticeSeen: "" });
    await $(NOTE_BANNER).waitForDisplayed({ timeoutMsg: "the note never showed" });
    expect(await $$(BANNER).length).toBe(1);
    const [message] = await texts(`${NOTE_BANNER} .gtd-language-banner-message`);
    expect(message).not.toContain("whatsNew.");

    await clickBannerButton("Dismiss");
    await $(NOTE_BANNER).waitForExist({ reverse: true, timeoutMsg: "Dismiss left the note up" });
    expect(await lastNoticeSeen()).toBe(NEWEST_NOTE);

    await reloadPlugin();
    expect(await $(NOTE_BANNER).isExisting()).toBe(false);
  });

  it("waits behind the week-start banner instead of stacking", async () => {
    await setPluginSettings(GTD, { catchAllNoticeSeen: true, weekStartNoticeSeen: false, lastNoticeSeen: "" });
    await $(BANNER).waitForDisplayed();
    expect(await $$(BANNER).length).toBe(1);
    expect(await $(NOTE_BANNER).isExisting()).toBe(false);

    await clickBannerButton("Dismiss");
    await $(NOTE_BANNER).waitForDisplayed({ timeoutMsg: "the note never showed after the week-start banner" });
    expect(await $$(BANNER).length).toBe(1);
  });

  it("opens the changelog from its Read more button, and that settles it too", async () => {
    await setPluginSettings(GTD, { ...OTHER_BANNERS_SEEN, lastNoticeSeen: "" });
    await $(NOTE_BANNER).waitForDisplayed();
    await clickBannerButton("Read more");
    await $(CHANGELOG).waitForDisplayed({ timeoutMsg: "the banner's Read more button opened nothing" });
    await $(NOTE_BANNER).waitForExist({ reverse: true, timeoutMsg: "the note stayed up after Read more" });
    expect(await lastNoticeSeen()).toBe(NEWEST_NOTE);
  });

  it("doesn't bring back an older note when the settled one was deleted", async () => {
    await setPluginSettings(GTD, { ...OTHER_BANNERS_SEEN, lastNoticeSeen: "deleted-note" });
    await reloadPlugin();
    expect(await lastNoticeSeen()).toBe(NEWEST_NOTE);
    expect(await $(NOTE_BANNER).isExisting()).toBe(false);
  });
});

describe("The changelog", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterEach(async () => {
    while (await $(".modal-container").isExisting()) await press("Escape");
    await browser.executeObsidian(({ app }) => (app as unknown as { setting: SettingsWindow }).setting.close());
  });

  it("opens from the command, in English with no Read in English link", async () => {
    await browser.executeObsidian(({ app }, id) => {
      (app as unknown as { commands: Commands }).commands.executeCommandById(`${id}:show-whats-new`);
    }, GTD);
    await $(CHANGELOG).waitForDisplayed({ timeoutMsg: "the command opened no changelog" });
    expect(await texts(".modal .modal-title")).toEqual(["What's new"]);
    expect((await texts(`${CHANGELOG} h2`)).length).toBeGreaterThan(0);
    expect(await $(READ_IN_ENGLISH).isExisting()).toBe(false);
  });

  it("opens from the What's new button on the settings page", async () => {
    await browser.executeObsidian(({ app }, id) => {
      const setting = (app as unknown as { setting: SettingsWindow }).setting;
      setting.open();
      setting.openTabById(id);
    }, GTD);
    const button = ".gtd-settings-banner-buttons button:not(.mod-cta)";
    // The settings page lives in its own window, out of reach of $().
    const label = await browser.executeObsidian(({ app }, button) => {
      const el = (app as unknown as { setting: SettingsWindow }).setting.activeTab.containerEl.querySelector<HTMLElement>(button);
      el?.click();
      return el?.textContent ?? null;
    }, button);
    expect(label).toBe("What's new");
    await browser.waitUntil(
      () =>
        browser.executeObsidian(({ app }, changelog) => {
          const settingsDoc = (app as unknown as { setting: SettingsWindow }).setting.activeTab.containerEl.ownerDocument;
          return [document, settingsDoc].some((doc) => doc.querySelector(changelog) !== null);
        }, CHANGELOG),
      { timeoutMsg: "the settings button opened no changelog" },
    );
  });
});

export {};
