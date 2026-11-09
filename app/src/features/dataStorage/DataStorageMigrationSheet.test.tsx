import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { parseMigrationPreview, parseStorageState, type StoragePhase } from "../../dataStorageProtocol";
import { initializeI18n } from "../../i18n/i18n";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { SupportedLocale } from "../../i18n/locale";
import { dataStorageResources } from "../../i18n/dataStorageResources";
import { DataStorageMigrationSheet } from "./DataStorageMigrationSheet";
import { DataStorageProvider } from "./useDataStorageController";

async function markup(locale: SupportedLocale, merge: boolean, phase?: StoragePhase, error: string | null = null) {
  await initializeI18n(locale);
  const preview = phase ? null : parseMigrationPreview({ planToken: "plan", operationId: "operation", merge, generation: 3, sourcePaths: ["C:/LocusData"], targetPath: "D:/LocusData", totalFiles: 3, totalBytes: 4096, requiredBytes: 8192, availableBytes: 65536 });
  const state = parseStorageState({ schemaVersion: 1, generation: 3, dataAccess: "recovery_required", mode: "managed", currentPath: "C:/LocusData", legacyOutputPath: null, lastError: null, cleanupReceipts: [], recoveryCandidates: [], operation: { operationId: "operation", merge, phase: phase ?? "prepared", sourcePaths: ["C:/LocusData"], targetPath: "D:/LocusData", totalFiles: 3, completedFiles: 1, totalBytes: 4096, completedBytes: 1024, canCancel: !phase, canResume: true, lastError: error } });
  return renderToStaticMarkup(<LocaleProvider initialOutcome={{ preference: locale, resolvedLocale: locale, persistedAnchor: locale, notice: null }}>
    <DataStorageProvider>{controller => <DataStorageMigrationSheet controller={{ ...controller, state, preview, open: true }} />}</DataStorageProvider>
  </LocaleProvider>);
}

describe("real data storage merge presentation", () => {
  test.each(["zh-CN", "zh-TW", "en-US"] as const)("shows the agreed destination-first rule in the existing confirmation in %s", async locale => {
    const html = await markup(locale, true);
    expect(html).toContain(dataStorageResources[locale].mergeConfirmBody);
    expect(html).not.toContain(dataStorageResources[locale].confirmBody);
    expect(html).toContain(dataStorageResources[locale].confirm);
    expect(html).not.toContain("mergeConfirmBody");
  });
  test("keeps the empty destination copy explanation", async () => {
    const html = await markup("en-US", false);
    expect(html).toContain(dataStorageResources["en-US"].confirmBody);
    expect(html).not.toContain(dataStorageResources["en-US"].mergeConfirmBody);
  });
  test.each(["zh-CN", "zh-TW", "en-US"] as const)("interrupted merging permits continuation and keeps cancellation unavailable in %s", async locale => {
    const html = await markup(locale, true, "merging", "VerificationFailed");
    expect(html).toContain(dataStorageResources[locale].phases.merging);
    expect(html).toContain(dataStorageResources[locale].mergingBody);
    expect(html).toContain(dataStorageResources[locale].mergeVerificationFailed);
    expect(html).not.toContain(dataStorageResources[locale].errors.VerificationFailed);
    expect(html).toContain(`>${dataStorageResources[locale].continue}</button>`);
    expect(html).not.toContain(`>${dataStorageResources[locale].cancel}</button>`);
    expect(html).not.toContain(`>${dataStorageResources[locale].confirm}</button>`);
  });
});
