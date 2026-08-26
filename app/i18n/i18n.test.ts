import { describe, expect, it } from "vitest";
import { createTranslator, DEFAULT_LOCALE, resolveLocale, translate } from "./i18n";

describe("resolveLocale", () => {
  it("falls back to the default locale when none is given", () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
  });

  it("resolves a supported locale", () => {
    expect(resolveLocale("en")).toBe("en");
  });

  it("normalizes a region-qualified locale to its base language", () => {
    expect(resolveLocale("en-GB")).toBe("en");
  });

  it("falls back to the default locale for an unsupported one", () => {
    expect(resolveLocale("fr-FR")).toBe(DEFAULT_LOCALE);
  });

  it("takes the first, most-preferred tag from a full Accept-Language header", () => {
    expect(resolveLocale("en-GB,en;q=0.9,fr;q=0.8")).toBe("en");
  });
});

describe("translate", () => {
  it("returns the string for a known key", () => {
    expect(translate("en", "nav.home")).toBe("Home");
  });

  it("falls back to the default locale for an unsupported locale", () => {
    expect(translate("fr", "nav.home")).toBe("Home");
  });

  it("returns the key itself when no translation exists anywhere", () => {
    expect(translate("en", "does.not.exist")).toBe("does.not.exist");
  });
});

describe("createTranslator", () => {
  it("returns a bound function that translates for the given locale", () => {
    const t = createTranslator("en");
    expect(t("nav.orders")).toBe("Orders");
  });
});
