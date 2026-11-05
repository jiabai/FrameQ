import { describe, expect, test } from "vitest";

import { frameqI18n, initializeI18n } from "./i18n";
import { SUPPORTED_LOCALES } from "./locale";
import { processingResources } from "./processingResources";
import { RESOURCE_NAMESPACES, resources } from "./resources";

function resourceEntries(tree: Record<string, unknown>, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return [[path, value]];
    return resourceEntries(value as Record<string, unknown>, path);
  });
}

describe("processing workspace localization", () => {
  test.each(SUPPORTED_LOCALES)("loads every processing label from bundled %s resources", async (locale) => {
    await initializeI18n(locale);

    expect(RESOURCE_NAMESPACES).toContain("processing");
    expect(resources[locale].processing).toBe(processingResources[locale]);
    const entries = resourceEntries(processingResources[locale]);
    expect(entries.map(([key]) => key)).toEqual(resourceEntries(processingResources["en-US"]).map(([key]) => key));
    for (const [key, value] of entries) {
      expect(value.trim(), key).not.toBe("");
      expect(frameqI18n.getResource(locale, "processing", key), key).toBe(value);
    }
  });

  test.each([
    ["zh-CN", "好内容，正在变成笔记。", "第 2 步 / 共 3 步", "来自Bilibili的视频", "已用时 01:46"],
    ["zh-TW", "好內容，正在變成筆記。", "第 2 步 / 共 3 步", "來自Bilibili的影片", "已用時 01:46"],
    ["en-US", "Good content. Your next note.", "Step 2 of 3", "Video from Bilibili", "Elapsed 01:46"],
  ] as const)("renders the approved composition and interpolated labels in %s", async (locale, title, counter, source, elapsed) => {
    await initializeI18n(locale);
    const t = frameqI18n.getFixedT(locale, "processing");

    expect(t("pageTitle")).toBe(title);
    expect(t("stepCounter", { current: 2, total: 3 })).toBe(counter);
    expect(t("source.platformVideo", { platform: "Bilibili" })).toBe(source);
    expect(t("progress.elapsed", { time: "01:46" })).toBe(elapsed);
    expect(t("steps.titlePending")).toContain("1 AI Credit");
    expect(t("detail.titling")).toContain("1 AI Credit");
    expect(t("next.disclosure")).toContain("1 AI Credit");
    expect(t("next.webDisclosure")).toContain("AI Credits");
  });
});
