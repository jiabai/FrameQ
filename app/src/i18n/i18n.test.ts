import { describe, expect, test } from "vitest";
import { frameqI18n, initializeI18n } from "./i18n";

describe("offline i18n instance", () => {
  test("initializes from bundled namespaced resources and switches locales", async () => {
    await initializeI18n("zh-TW");
    expect(frameqI18n.isInitialized).toBe(true);
    expect(frameqI18n.t("language.title", { ns: "settings" })).toBe(
      "介面與 AI 結果語言",
    );

    await initializeI18n("en-US");
    expect(frameqI18n.t("language.options.system", { ns: "settings" })).toBe(
      "Use system language",
    );
    expect(Object.keys(frameqI18n.store.data).sort()).toEqual([
      "en-US",
      "zh-CN",
      "zh-TW",
    ]);
  });
});
