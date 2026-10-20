import { getDatePicker } from "../src/integrations/Kalendae";
import type { App } from "obsidian";

function appWith(kalendae: unknown): App {
  return { plugins: { plugins: kalendae === undefined ? {} : { kalendae } } } as unknown as App;
}

describe("getDatePicker", () => {
  const anchor = {} as MouseEvent;

  it("is null without Kalendae", () => {
    expect(getDatePicker(appWith(undefined))).toBeNull();
  });

  it("is null when Kalendae has no API", () => {
    expect(getDatePicker(appWith({}))).toBeNull();
    expect(getDatePicker(appWith({ api: { pickDate: "nope" } }))).toBeNull();
  });

  it("passes the value and anchor through and resolves the picked day", async () => {
    const pickDate = jest.fn().mockResolvedValue("2026-10-25");
    const pick = getDatePicker(appWith({ api: { pickDate } }))!;
    await expect(pick("2026-10-18", anchor)).resolves.toBe("2026-10-25");
    expect(pickDate).toHaveBeenCalledWith({ value: "2026-10-18", anchor });
  });

  it("resolves null when the picker is closed", async () => {
    const pick = getDatePicker(appWith({ api: { pickDate: () => Promise.resolve(null) } }))!;
    await expect(pick("2026-10-18", anchor)).resolves.toBeNull();
  });

  it("resolves null when the picker fails", async () => {
    const pick = getDatePicker(appWith({ api: { pickDate: () => Promise.reject(new Error("boom")) } }))!;
    await expect(pick("2026-10-18", anchor)).resolves.toBeNull();
  });

  it("resolves null for a day not written YYYY-MM-DD", async () => {
    const pick = getDatePicker(appWith({ api: { pickDate: () => Promise.resolve("25/10/2026") } }))!;
    await expect(pick("2026-10-18", anchor)).resolves.toBeNull();
  });
});
