import { changelogFor } from "../src/changelog";

describe("changelogFor", () => {
  it("returns the English changelog for English", () => {
    const { text, isEnglish } = changelogFor("en");
    expect(isEnglish).toBe(true);
    expect(text).toMatch(/^## Unreleased$/m);
  });

  it("falls back to English for a language with no changelog", () => {
    expect(changelogFor("xx")).toEqual(changelogFor("en"));
  });
});
