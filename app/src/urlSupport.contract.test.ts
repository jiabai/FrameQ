import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { canSubmitUrl, normalizeSubmitUrl } from "./urlSupport";

type Platform = "douyin" | "xiaohongshu" | "bilibili" | "youtube";

type UrlSupportContract = {
  schemaVersion: number;
  intent: string;
  networkPolicy: string;
  knownAsymmetries: Record<string, string>;
  cases: Array<{
    id: string;
    platform: Platform;
    input: string;
    frontend: {
      canSubmit: boolean;
      normalized: string | null;
    };
    worker: {
      dispatch: boolean;
      failureMessage: string | null;
      parser: {
        outcome: "accepted" | "rejected";
      } | null;
    };
    knownAsymmetry: string | null;
  }>;
};

function loadContract(): UrlSupportContract {
  return JSON.parse(
    readFileSync(
      new URL("../../contracts/platform-url-support-contract.json", import.meta.url),
      "utf-8",
    ),
  ) as UrlSupportContract;
}

describe("platform URL support contract", () => {
  test("is a drift-only fixture with every known asymmetry referenced", () => {
    const contract = loadContract();
    const referencedAsymmetries = contract.cases
      .map((contractCase) => contractCase.knownAsymmetry)
      .filter((value): value is string => value !== null);

    expect(contract.schemaVersion).toBe(2);
    expect(contract.intent).toBe("drift-detection-only");
    expect(contract.networkPolicy).toBe("fake-clients-only");
    expect([...new Set(referencedAsymmetries)].sort()).toEqual(
      Object.keys(contract.knownAsymmetries).sort(),
    );
    for (const contractCase of contract.cases) {
      const layerSupport = [
        contractCase.frontend.canSubmit,
        contractCase.worker.dispatch,
      ];
      if (contractCase.worker.parser !== null) {
        layerSupport.push(contractCase.worker.parser.outcome === "accepted");
      }
      const hasLayerDisagreement = new Set(layerSupport).size > 1;
      expect(
        contractCase.knownAsymmetry !== null,
        `${contractCase.id}: knownAsymmetry`,
      ).toBe(hasLayerDisagreement);
    }
  });

  test("freezes frontend admission and normalization behavior", () => {
    const contract = loadContract();

    for (const contractCase of contract.cases) {
      expect(
        canSubmitUrl(contractCase.input),
        `${contractCase.id}: canSubmitUrl`,
      ).toBe(contractCase.frontend.canSubmit);
      expect(
        normalizeSubmitUrl(contractCase.input),
        `${contractCase.id}: normalizeSubmitUrl`,
      ).toBe(contractCase.frontend.normalized);
    }
  });
});
