import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { parseStoragePreflightProgress, type StoragePreflightProgress } from "../../dataStorageProtocol";
import { dataStorageResources } from "../../i18n/dataStorageResources";
import type { SupportedLocale } from "../../i18n/locale";
import { StoragePreflightProgressView } from "./StoragePreflightProgress";

function progress(overrides: Partial<StoragePreflightProgress> = {}) {
  return parseStoragePreflightProgress({ requestId: "6ec49382-bd73-47f0-9209-249a2de176c0", generation: 3, sequence: 1, kind: "migration", stage: "inventory_scanning", completedFiles: 12, totalFiles: null, completedBytes: 8192, totalBytes: null, currentFileBytes: 0, currentFileTotalBytes: 0, ...overrides });
}
async function markup(value: StoragePreflightProgress | null, locale: SupportedLocale = "en-US") {
  const i18n = createInstance();
  await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: { dataStorage: dataStorageResources[locale] } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><StoragePreflightProgressView progress={value} /></I18nextProvider>);
}

describe("real storage preflight presentation", () => {
  test("unknown totals show discovered files and indeterminate progress", async () => {
    const html = await markup(progress());
    expect(html).toContain("12");
    expect(html).toContain("<progress");
    expect(html).not.toContain("value=");
    expect(html).not.toContain("0 / 0");
  });
  test("waiting does not invent a numeric file total", async () => {
    const html = await markup(null);
    expect(html).toContain("Waiting for existing operations");
    expect(html).not.toContain("<progress");
  });
  test.each(["zh-CN", "zh-TW", "en-US"] as const)("cleanup checks report actual counts and current large-file reads in %s", async locale => {
    const html = await markup(progress({ kind: "cleanup", stage: "cleanup_checking", completedFiles: 5, totalFiles: 100, completedBytes: 4096, totalBytes: 65536, currentFileBytes: 1024, currentFileTotalBytes: 32768 }), locale);
    expect(html).toContain('max="65536" value="4096"');
    expect(html).toContain('max="32768" value="1024"');
    expect(html).toContain("100");
    expect(html).not.toContain("preflight.");
    expect(html).not.toContain("0 / 0");
  });
});
