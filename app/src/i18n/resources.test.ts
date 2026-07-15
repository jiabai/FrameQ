import { describe, expect, test } from "vitest";
import { RESOURCE_NAMESPACES, resources } from "./resources";
import { SUPPORTED_LOCALES } from "./locale";

function flatten(
  value: Record<string, unknown>,
  prefix = "",
): Array<[key: string, value: string]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      return [[path, child]];
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      return flatten(child as Record<string, unknown>, path);
    }
    throw new Error(`Invalid resource value at ${path}`);
  });
}

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+).*?}}/g)]
    .map((match) => match[1])
    .sort();
}

describe("bundled localization resources", () => {
  test("contains the foundational and semantic progress namespaces", () => {
    expect(RESOURCE_NAMESPACES).toEqual([
      "common",
      "settings",
      "bootstrap",
      "progress",
      "preferences",
      "account",
      "history",
      "transcript",
      "asrModel",
      "workflow",
      "synthesis",
      "updates",
      "errors",
    ]);
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  test("keeps key, interpolation, and plural parity across all locales", () => {
    const baselineLocale = SUPPORTED_LOCALES[0];

    for (const namespace of RESOURCE_NAMESPACES) {
      const baseline = new Map(flatten(resources[baselineLocale][namespace]));
      const baselineKeys = [...baseline.keys()].sort();

      for (const locale of SUPPORTED_LOCALES.slice(1)) {
        const candidate = new Map(flatten(resources[locale][namespace]));
        expect([...candidate.keys()].sort(), `${locale}.${namespace} key parity`).toEqual(
          baselineKeys,
        );

        for (const key of baselineKeys) {
          expect(
            interpolationTokens(candidate.get(key) ?? ""),
            `${locale}.${namespace}.${key} interpolation parity`,
          ).toEqual(interpolationTokens(baseline.get(key) ?? ""));
        }
      }

      const pluralBases = baselineKeys
        .filter((key) => key.endsWith("_one") || key.endsWith("_other"))
        .map((key) => key.replace(/_(one|other)$/, ""));
      for (const base of new Set(pluralBases)) {
        expect(baselineKeys).toContain(`${base}_one`);
        expect(baselineKeys).toContain(`${base}_other`);
      }
    }
  });

  test("contains no empty strings or inline HTML", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const namespace of RESOURCE_NAMESPACES) {
        for (const [key, value] of flatten(resources[locale][namespace])) {
          expect(value.trim(), `${locale}.${namespace}.${key}`).not.toBe("");
          expect(value, `${locale}.${namespace}.${key}`).not.toMatch(/<\/?[a-z][^>]*>/i);
        }
      }
    }
  });
});
