import { describe, expect, test } from "vitest";

import {
  formatAiCreditsAllocation,
  formatAiCreditsBalance,
  getAiCreditsCostHint,
  getAiCreditsDisclosureCopy,
} from "./aiCreditsCopy";

describe("AI Credits copy", () => {
  test.each([
    ["zh-CN", "AI Credits 余额：8", "AI Credits：8 / 20", "一次智能提炼可能消耗多个 Credits。"],
    ["zh-TW", "AI Credits 餘額：8", "AI Credits：8 / 20", "一次 AI 提煉可能消耗多個 Credits。"],
    ["en-US", "AI Credits balance: 8", "AI Credits: 8 / 20", "One AI Synthesis run may use multiple Credits."],
  ] as const)(
    "describes balance and variable cost in %s without promising action counts",
    (locale, balance, allocation, hint) => {
      expect(formatAiCreditsBalance(8, locale)).toBe(balance);
      expect(formatAiCreditsAllocation(8, 20, locale)).toBe(allocation);
      expect(getAiCreditsCostHint(locale)).toBe(hint);

      const disclosure = getAiCreditsDisclosureCopy(locale);
      expect(disclosure).toContain("1 AI Credit");
      expect(disclosure).toContain("LLM API");
      expect(disclosure).not.toContain("确认后消耗 1 次");
    },
  );
});
