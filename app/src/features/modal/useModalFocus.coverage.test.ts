import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const MODAL_SOURCES = [
  ["../history/HistorySheet.tsx", 1],
  ["./AnimatedSheet.tsx", 1],
] as const;

const ANIMATED_SHEET_SOURCES = [
  "../../App.tsx",
  "../account/AccountSheet.tsx",
  "../asrModel/ModelGuideSheet.tsx",
  "../history/HistorySheet.tsx",
  "../insightPreferences/InsightPreferenceFlow.tsx",
  "../results/AiResultDetailSheet.tsx",
  "../settings/SettingsSheet.tsx",
  "../dissection/TranscriptDissectionConfirmationSheet.tsx",
] as const;

describe("modal focus integration", () => {
  test.each(MODAL_SOURCES)(
    "connects every aria-modal scope in %s to the shared focus manager",
    (relativePath, expectedCount) => {
      const source = readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8",
      );

      expect(source.match(/aria-modal="true"/g) ?? []).toHaveLength(expectedCount);
      expect(source.match(/useModalFocus<HTMLElement>/g) ?? []).toHaveLength(
        expectedCount,
      );
      expect(source.match(/ref=\{\w*ModalRef\}/g) ?? []).toHaveLength(
        expectedCount,
      );
    },
  );

  test.each(ANIMATED_SHEET_SOURCES)(
    "routes %s through the shared AnimatedSheet shell",
    (relativePath) => {
      const source = readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8",
      );

      expect(source).toContain("AnimatedSheet");
    },
  );
});
