// Everything an end-to-end spec can use without importing it.
//
// This file belongs to ObsidianE2EHarness (types/harness.d.ts). A plugin keeps a copy as
// e2e/harness.d.ts, so that its specs are fully typed wherever the plugin's repo is checked out by
// itself. Do not edit the copy: `obsidian-e2e --update-types` refreshes it, and a run refuses to
// start while the two differ.
//
// It depends on nothing but the `obsidian` package, which every plugin already has.

// --- Mocha -------------------------------------------------------------------------------------

type E2eBody = () => void | Promise<void>;

interface E2eSuiteFunction {
  (title: string, body: () => void): void;
  only(title: string, body: () => void): void;
  skip(title: string, body: () => void): void;
}

interface E2eTestFunction {
  (title: string, body: E2eBody): void;
  only(title: string, body: E2eBody): void;
  skip(title: string, body: E2eBody): void;
}

/** A group of tests. The vault and every plugin's settings go back to the fixture before it. */
declare const describe: E2eSuiteFunction;
/** One test. It fails on any error in Obsidian's console, unless it called `allowConsoleErrors()`. */
declare const it: E2eTestFunction;
declare function before(body: E2eBody): void;
declare function after(body: E2eBody): void;
declare function beforeEach(body: E2eBody): void;
declare function afterEach(body: E2eBody): void;

// --- expect ------------------------------------------------------------------------------------

interface E2eMatchers<Result> {
  toBe(expected: unknown): Result;
  toEqual(expected: unknown): Result;
  toStrictEqual(expected: unknown): Result;
  toMatchObject(expected: object): Result;
  toBeNull(): Result;
  toBeUndefined(): Result;
  toBeDefined(): Result;
  toBeTruthy(): Result;
  toBeFalsy(): Result;
  toContain(item: unknown): Result;
  toHaveLength(length: number): Result;
  toMatch(pattern: RegExp | string): Result;
  toBeGreaterThan(value: number): Result;
  toBeGreaterThanOrEqual(value: number): Result;
  toBeLessThan(value: number): Result;
  toBeLessThanOrEqual(value: number): Result;
  toThrow(expected?: RegExp | string | Error): Result;
  not: E2eMatchers<Result>;
}

interface E2eExpectation extends E2eMatchers<void> {
  /** For a promise that should resolve: `await expect(promise).resolves.toBe(…)`. */
  resolves: E2eMatchers<Promise<void>>;
  /** For a promise that should reject: `await expect(promise).rejects.toThrow(…)`. */
  rejects: E2eMatchers<Promise<void>>;
}

interface E2eExpect {
  (actual: unknown): E2eExpectation;
  arrayContaining(items: readonly unknown[]): unknown;
  objectContaining(shape: object): unknown;
  stringContaining(text: string): unknown;
  stringMatching(pattern: RegExp | string): unknown;
  anything(): unknown;
}

declare const expect: E2eExpect;

// --- The Obsidian window -----------------------------------------------------------------------

/** What code run inside Obsidian is handed. */
interface E2eObsidian {
  app: import("obsidian").App;
  /** The `obsidian` module, for `instanceof` checks and the like. */
  obsidian: typeof import("obsidian");
  /** The enabled plugins, by id in camelCase. */
  plugins: Record<string, import("obsidian").Plugin>;
  require: (id: string) => unknown;
}

interface E2eBrowser {
  /**
   * Runs a function inside Obsidian and returns what it returns. The function is sent as text, so
   * it cannot use a variable from outside itself: pass values in as extra arguments.
   */
  executeObsidian<Return, Params extends unknown[]>(
    run: (obsidian: E2eObsidian, ...params: Params) => Return | Promise<Return>,
    ...params: Params
  ): Promise<Return>;
  /** Runs a function in the window without the Obsidian API. */
  execute<Return, Params extends unknown[]>(
    run: string | ((...params: Params) => Return | Promise<Return>),
    ...params: Params
  ): Promise<Return>;
  /** Waits until the condition holds, and fails with `timeoutMsg` if it never does. */
  waitUntil(
    condition: () => boolean | Promise<boolean>,
    options?: { timeout?: number; interval?: number; timeoutMsg?: string },
  ): Promise<void>;
  pause(milliseconds: number): Promise<void>;
  /** Sends keys as they are. Prefer `type()` and `press()`. */
  keys(value: string | string[]): Promise<void>;
  getObsidianVersion(): string;
  getObsidianInstallerVersion(): string;
}

declare const browser: E2eBrowser;

interface E2eElement {
  click(): Promise<void>;
  waitForExist(options?: { timeout?: number; reverse?: boolean; timeoutMsg?: string }): Promise<void>;
  waitForDisplayed(options?: { timeout?: number; reverse?: boolean; timeoutMsg?: string }): Promise<void>;
  isExisting(): Promise<boolean>;
  isDisplayed(): Promise<boolean>;
  getText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  setValue(value: string): Promise<void>;
  $(selector: string): E2eElement;
  $$(selector: string): E2eElementList;
}

interface E2eElementList {
  readonly [index: number]: E2eElement;
  readonly length: Promise<number>;
}

/** The first element matching a CSS selector. */
declare function $(selector: string): E2eElement;
/** Every element matching a CSS selector. */
declare function $$(selector: string): E2eElementList;

/** The service's own page object. */
interface E2eObsidianPage {
  /** Writes a file in the vault, creating its folders. */
  write(file: string, content: string): Promise<void>;
  read(file: string): Promise<string>;
  delete(file: string): Promise<void>;
  mkdir(folder: string): Promise<void>;
  /** Opens a file in a new tab. */
  openFile(path: string): Promise<void>;
  enablePlugin(id: string): Promise<void>;
  disablePlugin(id: string): Promise<void>;
  /** The test vault's folder on disk: a copy of the fixture. */
  getVaultPath(): string;
}

declare const obsidianPage: E2eObsidianPage;

// --- The helpers -------------------------------------------------------------------------------

/** An open suggester menu. */
interface E2eMenu {
  /** The id of the plugin whose menu it is, or "obsidian". */
  owner: string;
  /** The title of each row, top to bottom. */
  rows: string[];
}

type E2eKey =
  | "Enter"
  | "Escape"
  | "Backspace"
  | "Delete"
  | "Tab"
  | "Space"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown";

/** Closes every open note, then opens a new empty one in live preview with the caret in it. */
declare function openEmptyNote(): Promise<void>;
/** Types text with real key events, one character at a time. */
declare function type(text: string): Promise<void>;
/** Presses one named key. */
declare function press(key: E2eKey): Promise<void>;
/** The text of the line the caret is on, in the active note. */
declare function line(): Promise<string>;
/** The whole text of the active note. */
declare function noteText(): Promise<string>;
/** The menu showing once it has stopped changing, or null when none shows. */
declare function menu(): Promise<E2eMenu | null>;
/** The owner of every registered suggester, in the order Obsidian asks them. */
declare function suggesters(): Promise<string[]>;
/** Changes some of a plugin's settings and has it save them, with no restart. */
declare function setPluginSettings(id: string, patch: Record<string, unknown>): Promise<void>;
/** Turns a plugin off and on again. */
declare function togglePlugin(id: string): Promise<void>;
/** Quits and starts Obsidian on the same vault as it stands. */
declare function restartObsidian(): Promise<void>;
/** Puts the vault's files and every plugin's settings back to the fixture. Each `describe` gets one. */
declare function resetState(): Promise<void>;
/** The errors logged in Obsidian's console since the last test ended. */
declare function consoleErrors(): Promise<string[]>;
/** Lets the current test end with errors in the console. */
declare function allowConsoleErrors(): void;
