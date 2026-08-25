import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const accountCopyFiles = [
  ["App.tsx", new URL("./App.tsx", import.meta.url)],
  ["AccountSheet.tsx", new URL("./features/account/AccountSheet.tsx", import.meta.url)],
] as const;

const accountCreditCopyFiles = [
  ["accountResources.ts", new URL("./i18n/accountResources.ts", import.meta.url)],
  ["synthesisResources.ts", new URL("./i18n/synthesisResources.ts", import.meta.url)],
] as const;

describe("account copy", () => {
  test("uses activation and authorization wording instead of monthly-pass wording", () => {
    for (const [label, url] of accountCopyFiles) {
      const content = readFileSync(url, "utf8");

      expect(content, label).not.toContain("月卡");
    }
  });

  test("describes the AI balance as Credits rather than generation times", () => {
    for (const [label, url] of accountCreditCopyFiles) {
      const content = readFileSync(url, "utf8");

      expect(content, label).toContain("AI Credits");
      expect(content, label).not.toContain("次可用");
      expect(content, label).not.toContain("LLM API 调用次数");
    }
  });

  test("includes activation request copy for every locale", async () => {
    const { accountResources } = await import("./i18n/accountResources");

    expect(accountResources["zh-CN"].actions.requestActivationCode).toBeTruthy();
    expect(accountResources["zh-CN"].actions.activationCodeSending).toBeTruthy();
    expect(accountResources["zh-CN"].notice.activationCodeSent).toBeTruthy();
    expect(accountResources["zh-CN"].notice.activationCodeAuthRequired).toBeTruthy();
    expect(accountResources["zh-CN"].notice.activationCodeFeatureUnavailable).toBeTruthy();
    expect(accountResources["zh-CN"].notice.activationCodeAlreadyActive).toBeTruthy();
    expect(accountResources["zh-CN"].notice.activationCodeRateLimited).toBeTruthy();
    expect(accountResources["zh-CN"].notice.activationCodeEmailUnavailable).toBeTruthy();
    expect(accountResources["zh-CN"].notice.activationCodeServerUnavailable).toBeTruthy();

    expect(accountResources["zh-TW"].actions.requestActivationCode).toBeTruthy();
    expect(accountResources["en-US"].actions.requestActivationCode).toBeTruthy();
  });
});
