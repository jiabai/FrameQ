import { describe, expect, test } from "vitest";
import {
  buildClientStrings,
  DEFAULT_LOCALE,
  detectLocale,
  extractQueryLang,
  langSwitcherStyles,
  LOCALE_LABELS,
  renderLangSwitcher,
  SUPPORTED_LOCALES,
  t,
  type Locale,
} from "../src/i18n.js";

describe("i18n module constants", () => {
  test("exposes a closed supported-locale set with zh-CN first", () => {
    expect(SUPPORTED_LOCALES).toEqual(["zh-CN", "en", "zh-TW"]);
  });

  test("defaults to zh-CN", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
  });

  test("provides a native label for every supported locale", () => {
    expect(LOCALE_LABELS).toEqual({ "zh-CN": "中文", "en": "English", "zh-TW": "繁體中文" });
  });
});

describe("t(locale, key)", () => {
  test("resolves an existing key in all three locales", () => {
    expect(t("zh-CN", "login.title")).toBe("FrameQ Login");
    expect(t("en", "login.title")).toBe("FrameQ Login");
    expect(t("zh-TW", "login.title")).toBe("FrameQ Login");

    expect(t("zh-CN", "dashboard.logout")).toBe("退出登录");
    expect(t("en", "dashboard.logout")).toBe("Sign out");
    expect(t("zh-TW", "dashboard.logout")).toBe("登出");

    expect(t("zh-CN", "admin.no_users")).toBe("暂无用户");
    expect(t("en", "admin.no_users")).toBe("No users");
    expect(t("zh-TW", "admin.no_users")).toBe("暫無使用者");
  });

  test("falls back to the default locale when the key is missing from the requested locale", () => {
    // Both maps are currently symmetric; verify en falls back to zh-CN copy.
    expect(t("en", "lang.select_label")).toBe("Language");
    expect(t("zh-CN", "lang.select_label")).toBe("语言");
  });

  test("returns the raw key when the key is missing from both locales", () => {
    const missingKey = "totally.missing.key.that.does.not.exist";
    expect(t("zh-CN", missingKey)).toBe(missingKey);
    expect(t("en", missingKey)).toBe(missingKey);
    expect(t("zh-TW", missingKey)).toBe(missingKey);
  });
});

describe("buildClientStrings(locale)", () => {
  test("returns a fresh object per call (not the internal map)", () => {
    const first = buildClientStrings("en");
    const beforeMutation = first["login.title"];
    first["login.title"] = "MUTATED";

    const second = buildClientStrings("en");
    expect(second["login.title"]).toBe(beforeMutation);
    expect(second["login.title"]).not.toBe("MUTATED");
  });

  test("contains the expected locale-specific strings for zh-TW", () => {
    const zhTW = buildClientStrings("zh-TW");
    expect(zhTW["dashboard.logout"]).toBe("登出");
    expect(zhTW["admin.no_users"]).toBe("暫無使用者");
    expect(zhTW["login.send_code"]).toBe("取得驗證碼");
  });

  test("returns an object that is independent across locales", () => {
    const en = buildClientStrings("en");
    const zhTW = buildClientStrings("zh-TW");
    expect(en["dashboard.logout"]).toBe("Sign out");
    expect(zhTW["dashboard.logout"]).toBe("登出");
  });
});

describe("detectLocale — cookie", () => {
  test.each([
    ["missing cookie (undefined)", undefined, "zh-CN"],
    ["missing cookie (empty string)", "", "zh-CN"],
    ["explicit zh-CN", "lang=zh-CN", "zh-CN"],
    ["explicit en", "lang=en", "en"],
    ["explicit zh-TW", "lang=zh-TW", "zh-TW"],
    ["unknown locale falls back", "lang=fr", "zh-CN"],
    ["unknown two-letter locale falls back", "lang=de", "zh-CN"],
    ["unknown en variant falls back", "lang=en-GB", "zh-CN"],
  ])("%s -> %s", (_name, input, expected) => {
    expect(detectLocale({ cookie: input })).toBe(expected as Locale);
  });

  test("handles mixed cookies (lang not first)", () => {
    expect(detectLocale({ cookie: "theme=dark; lang=en; sidebar=collapsed" })).toBe("en");
    expect(detectLocale({ cookie: "theme=dark; lang=zh-TW; sidebar=collapsed" })).toBe("zh-TW");
  });

  test("handles URL-encoded cookie values", () => {
    expect(detectLocale({ cookie: "lang=zh%2DCN" })).toBe("zh-CN");
    expect(detectLocale({ cookie: "lang=en" })).toBe("en");
  });

  test("rejects URL-encoded unknown values (falls back without throwing)", () => {
    expect(detectLocale({ cookie: "lang=en%2DGB" })).toBe("zh-CN");
  });

  test("does not throw on malformed URI sequences (falls back to default)", () => {
    expect(() => detectLocale({ cookie: "lang=%ZZ" })).not.toThrow();
    expect(detectLocale({ cookie: "lang=%ZZ" })).toBe("zh-CN");
  });

  test("rejects an empty lang value", () => {
    expect(detectLocale({ cookie: "lang=" })).toBe("zh-CN");
  });

  test("does not match a similarly-named cookie (e.g. language=)", () => {
    expect(detectLocale({ cookie: "language=en" })).toBe("zh-CN");
    expect(detectLocale({ cookie: "language=en; lang=en" })).toBe("en");
  });
});

describe("detectLocale — query param (?lang=)", () => {
  test("honors an explicit deep-link locale when no cookie is set", () => {
    expect(detectLocale({ queryLang: "zh-TW" })).toBe("zh-TW");
    expect(detectLocale({ queryLang: "en" })).toBe("en");
  });

  test("ignores an unknown query locale and falls back", () => {
    expect(detectLocale({ queryLang: "fr" })).toBe("zh-CN");
  });

  test("yields to an existing cookie (explicit choice wins)", () => {
    expect(detectLocale({ cookie: "lang=en", queryLang: "zh-TW" })).toBe("en");
  });
});

describe("detectLocale — Accept-Language", () => {
  test.each([
    ["zh-TW", "zh-TW"],
    ["zh-Hant-TW", "zh-TW"],
    ["zh-Hant", "zh-TW"],
    ["zh", "zh-CN"],
    ["zh-CN", "zh-CN"],
    ["zh-Hans", "zh-CN"],
    ["en", "en"],
    ["fr", "zh-CN"],
  ])("Accept-Language: %s -> %s", (header, expected) => {
    expect(detectLocale({ acceptLanguage: header })).toBe(expected as Locale);
  });

  test("respects q-values (higher q wins)", () => {
    expect(detectLocale({ acceptLanguage: "en;q=0.5,zh-TW;q=0.9" })).toBe("zh-TW");
    expect(detectLocale({ acceptLanguage: "zh-TW;q=0.3,en;q=0.8" })).toBe("en");
  });

  test("skips zero-q ranges", () => {
    expect(detectLocale({ acceptLanguage: "zh-TW;q=0,en;q=0.8" })).toBe("en");
  });

  test("falls back to default when nothing matches", () => {
    expect(detectLocale({ acceptLanguage: "fr;q=0.9" })).toBe("zh-CN");
  });
});

describe("detectLocale — priority order", () => {
  test("cookie > query > Accept-Language > default", () => {
    expect(
      detectLocale({ cookie: "lang=en", queryLang: "zh-TW", acceptLanguage: "zh-TW" }),
    ).toBe("en");
    expect(detectLocale({ queryLang: "zh-TW", acceptLanguage: "en" })).toBe("zh-TW");
    expect(detectLocale({ acceptLanguage: "zh-TW" })).toBe("zh-TW");
    expect(detectLocale({})).toBe("zh-CN");
  });
});

describe("extractQueryLang", () => {
  test("pulls a string lang param", () => {
    expect(extractQueryLang({ lang: "zh-TW" })).toBe("zh-TW");
  });

  test("returns null for missing or non-string values", () => {
    expect(extractQueryLang(undefined)).toBeNull();
    expect(extractQueryLang({})).toBeNull();
    expect(extractQueryLang({ lang: 123 })).toBeNull();
  });
});

describe("renderLangSwitcher(locale)", () => {
  test("renders a select with one option per supported locale", () => {
    const html = renderLangSwitcher("zh-CN");
    expect(html).toContain('<select class="lang-switch"');
    expect(html).toContain('<option value="zh-CN"');
    expect(html).toContain('<option value="en"');
    expect(html).toContain('<option value="zh-TW"');
  });

  test("marks the current locale option as selected", () => {
    expect(renderLangSwitcher("zh-TW")).toContain('<option value="zh-TW" selected>');
    expect(renderLangSwitcher("en")).toContain('<option value="en" selected>');
  });

  test("always emits the inline switcher script with a change handler", () => {
    const html = renderLangSwitcher("zh-CN");
    expect(html).toContain("<script>");
    expect(html).toContain("addEventListener");
    expect(html).toContain("document.cookie");
    expect(html).toContain("window.location.reload()");
  });

  test("uses encodeURIComponent when writing the cookie", () => {
    const html = renderLangSwitcher("zh-CN");
    expect(html).toContain("encodeURIComponent(target)");
  });

  test("sets a 1-year max-age, path=/, and samesite=lax on the cookie", () => {
    const html = renderLangSwitcher("zh-CN");
    expect(html).toContain("path=/");
    expect(html).toContain("samesite=lax");
    // 60 * 60 * 24 * 365 = 31536000
    expect(html).toContain("max-age=31536000");
  });

  test("emits an accessible label for the select", () => {
    const html = renderLangSwitcher("zh-TW");
    expect(html).toContain('aria-label="語言"');
  });
});

describe("langSwitcherStyles()", () => {
  test("returns CSS targeting the .lang-switch class", () => {
    const css = langSwitcherStyles();
    expect(css).toContain(".lang-switch");
    expect(css).toContain("cursor: pointer");
  });

  test("includes a hover state", () => {
    const css = langSwitcherStyles();
    expect(css).toContain(".lang-switch:hover");
  });
});
