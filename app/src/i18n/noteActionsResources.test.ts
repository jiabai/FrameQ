import { describe, expect, test } from "vitest";
import { noteActionsResources } from "./noteActionsResources";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, nested]) => typeof nested === "object" && nested !== null ? keys(nested, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();
}

describe("noteActionsResources", () => {
  test.each(["zh-CN", "zh-TW", "en-US"] as const)("keeps all action sheet and lifecycle messages available in %s", (locale) => {
    expect(keys(noteActionsResources[locale])).toEqual(keys(noteActionsResources["en-US"]));
    expect(noteActionsResources[locale].notice.metadataLoadFailed).toBeTruthy();
    expect(noteActionsResources[locale].notice.cleanupPending).toBeTruthy();
    expect(noteActionsResources[locale].notice.cleanupFailed).toBeTruthy();
    expect(noteActionsResources[locale].actions.retryCleanup).toBeTruthy();
    expect(noteActionsResources[locale].rename.hint).toContain("60");
  });
});
