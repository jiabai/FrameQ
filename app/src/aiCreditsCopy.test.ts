import { describe, expect, test } from "vitest";

import {
  getAiCreditsCostHint,
  getAiCreditsDisclosureCopy,
} from "./aiCreditsCopy";

describe("AI Credits copy", () => {
  test.each([
    ["zh-CN", "工作间中的每次生成可能消耗多个 Credits。"],
    ["zh-TW", "工作間中的每次產生可能消耗多個 Credits。"],
    ["en-US", "Each generation in Studio may use multiple Credits."],
  ] as const)(
    "describes variable cost in %s without promising action counts",
    (locale, hint) => {
      expect(getAiCreditsCostHint(locale)).toBe(hint);

      const disclosure = getAiCreditsDisclosureCopy(locale);
      expect(disclosure).toContain("1 AI Credit");
      expect(disclosure).toContain("LLM API");
      expect(disclosure).not.toContain("确认后消耗 1 次");
    },
  );
});
