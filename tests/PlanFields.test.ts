import { readPlanFields, writePlanFields } from "../src/core/plan/PlanFields";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { PluginSettings } from "../src/settings";

const tag = { ...DEFAULT_SETTINGS, storageMode: "inline-tag", tagPrefix: "gtd" } as PluginSettings;
const field = { ...tag, storageMode: "inline-field" } as PluginSettings;

it("reads bucket and both dates", () => {
  expect(readPlanFields("- [ ] a #gtd/today 📅 2026-11-12 ⏳ 2026-11-10", tag))
    .toEqual({ bucket: "today", due: "2026-11-12", scheduled: "2026-11-10" });
});

it("reads absent fields as null", () => {
  expect(readPlanFields("- [ ] a", tag)).toEqual({ bucket: null, due: null, scheduled: null });
});

it("writes only the fields given", () => {
  expect(writePlanFields("- [ ] a #gtd/today 📅 2026-11-12", { bucket: null }, tag)).toBe("- [ ] a 📅 2026-11-12");
  expect(writePlanFields("- [ ] a 📅 2026-11-12", { due: "2026-11-20" }, tag)).toBe("- [ ] a 📅 2026-11-20");
  expect(writePlanFields("- [ ] a 📅 2026-11-12", { due: null }, tag)).toBe("- [ ] a");
});

it("round-trips: writing what was read changes nothing", () => {
  const line = "- [ ] a [gtd:: week] 📅 2026-11-12 ^id";
  expect(writePlanFields(line, readPlanFields(line, field), field)).toBe(line);
});
