import {
  PANEL_NOTICES,
  noticeToShow,
  seedLastNoticeSeen,
  settleUnknownNotice,
  type PanelNotice,
} from "../src/core/PanelNotices";
import en from "../src/i18n/locales/en.json";

const a: PanelNotice = { id: "a", action: "dismiss" };
const b: PanelNotice = { id: "b", action: "settings" };
const c: PanelNotice = { id: "c", action: "dismiss" };
const list = [a, b, c];

describe("noticeToShow", () => {
  it("shows nothing when there are no notes", () => {
    expect(noticeToShow([], "")).toBeNull();
  });

  it("shows the newest note to an install that has settled none", () => {
    expect(noticeToShow(list, "")).toBe(c);
  });

  it("shows nothing once the newest note is settled", () => {
    expect(noticeToShow(list, "c")).toBeNull();
  });

  it("skips straight to the newest note past an older settled one", () => {
    expect(noticeToShow(list, "a")).toBe(c);
  });
});

describe("seedLastNoticeSeen", () => {
  it("settles every existing note on a fresh install", () => {
    expect(seedLastNoticeSeen(true, list)).toBe("c");
  });

  it("leaves an existing install with nothing settled", () => {
    expect(seedLastNoticeSeen(false, list)).toBe("");
  });

  it("settles nothing on a fresh install when there are no notes", () => {
    expect(seedLastNoticeSeen(true, [])).toBe("");
  });
});

describe("settleUnknownNotice", () => {
  it("moves a deleted note's id onto the newest note", () => {
    expect(settleUnknownNotice("gone", list)).toBe("c");
    expect(noticeToShow(list, settleUnknownNotice("gone", list))).toBeNull();
  });

  it("keeps an id that is still in the list", () => {
    expect(settleUnknownNotice("a", list)).toBe("a");
  });

  it("keeps an empty id, so an upgrading install still sees the newest note", () => {
    expect(settleUnknownNotice("", list)).toBe("");
  });

  it("clears an unknown id when the list is empty", () => {
    expect(settleUnknownNotice("gone", [])).toBe("");
  });
});

describe("PANEL_NOTICES", () => {
  it("numbers the notes upwards in list order, so the newest has the highest number", () => {
    const ids = PANEL_NOTICES.map((n) => n.id);
    for (const id of ids) expect(id).toMatch(/^[1-9][0-9]*$/);
    // Gaps are fine (a deleted note's number stays retired); going down or repeating is not.
    for (let i = 1; i < ids.length; i++) expect(Number(ids[i])).toBeGreaterThan(Number(ids[i - 1]));
  });

  it("uses only known actions", () => {
    for (const n of PANEL_NOTICES) expect(["dismiss", "settings"]).toContain(n.action);
  });

  it("has English text for every note", () => {
    const notes = (en as { whatsNew?: { notes?: Record<string, { message?: string }> } }).whatsNew?.notes ?? {};
    for (const n of PANEL_NOTICES) expect(notes[n.id]?.message?.trim()).toBeTruthy();
  });
});
