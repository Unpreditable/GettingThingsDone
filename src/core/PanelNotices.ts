import notices from "../notices.json";

export type NoticeAction = "dismiss" | "settings";

/** One "what's new" banner. Its text is `whatsNew.notes.<id>.message` in en.json. */
export interface PanelNotice {
  id: string;
  action: NoticeAction;
}

/** Oldest first, numbered upwards; only the last entry is ever shown. */
export const PANEL_NOTICES = notices as PanelNotice[];

/** The newest note, unless this install has already settled it. */
export function noticeToShow(notices: PanelNotice[], lastSeen: string): PanelNotice | null {
  const newest = notices[notices.length - 1];
  if (!newest || newest.id === lastSeen) return null;
  return newest;
}

/**
 * The starting value of `lastNoticeSeen` for an install that has none. A fresh
 * install settles every note already in the list, since they describe features
 * it has never seen any other way; an existing install settles none.
 */
export function seedLastNoticeSeen(freshInstall: boolean, notices: PanelNotice[]): string {
  return freshInstall ? (notices[notices.length - 1]?.id ?? "") : "";
}

/**
 * A settled id that is no longer in the list names a deleted note. Left alone,
 * it would make the next-newest note show again, so it moves onto the newest.
 */
export function settleUnknownNotice(lastSeen: string, notices: PanelNotice[]): string {
  if (lastSeen === "" || notices.some((n) => n.id === lastSeen)) return lastSeen;
  return notices[notices.length - 1]?.id ?? "";
}
