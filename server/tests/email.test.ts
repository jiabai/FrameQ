import { describe, expect, test } from "vitest";
import { createActivationCodeSender, createOtpSender } from "../src/email.js";

describe("OTP email sender", () => {
  test("does not implicitly fall back to printing OTPs when SMTP is absent", () => {
    expect(() =>
      createOtpSender({ environment: "development", smtp: null, allowConsoleOtp: false }),
    ).toThrow("FRAMEQ_ALLOW_CONSOLE_OTP");
  });

  test("allows console OTP only through explicit non-production opt-in", async () => {
    const warnings: string[] = [];
    const writes: Array<{ email: string; code: string }> = [];
    const sender = createOtpSender(
      { environment: "development", smtp: null, allowConsoleOtp: true },
      () => {
        throw new Error("should not create transport");
      },
      {
        warn: (message) => warnings.push(message),
        write: (email, code) => writes.push({ email, code }),
      },
    );

    await sender("developer@example.com", "test-code");

    expect(warnings).toEqual([expect.stringContaining("DEVELOPMENT ONLY")]);
    expect(writes).toEqual([{ email: "developer@example.com", code: "test-code" }]);
  });

  test("sends a formatted login code email through the configured SMTP transport", async () => {
    const sentMessages: unknown[] = [];
    const transportOptions: unknown[] = [];
    const sender = createOtpSender(
      {
        environment: "production",
        allowConsoleOtp: false,
        smtp: {
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "mailer@example.com",
          pass: "app-password",
          from: "FrameQ <mailer@example.com>",
        },
      },
      (options) => {
        transportOptions.push(options);
        return {
          sendMail: async (message: unknown) => {
            sentMessages.push(message);
          },
        };
      },
    );

    await sender("USER@Example.COM", "123456");

    expect(transportOptions[0]).toMatchObject({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "mailer@example.com", pass: "app-password" },
    });
    expect(sentMessages[0]).toMatchObject({
      from: "FrameQ <mailer@example.com>",
      to: "USER@Example.COM",
      subject: "FrameQ login code",
    });
    expect(JSON.stringify(sentMessages[0])).toContain("123456");
    expect(JSON.stringify(sentMessages[0])).toContain("10 minutes");
  });
});

describe("activation email sender", () => {
  test("fails closed when SMTP is absent even in development", () => {
    expect(() =>
      createActivationCodeSender({
        environment: "development",
        smtp: null,
        allowConsoleOtp: true,
      }),
    ).toThrow("Activation email delivery is unavailable.");
  });

  test.each([
    {
      locale: "zh-CN" as const,
      subject: "FrameQ 激活码",
      snippets: [
        "完整激活码",
        "绑定邮箱",
        "兑换截止时间",
        "31 天权益",
        "20 AI Credits",
        "仅限当前账号使用，请勿转发",
      ],
    },
    {
      locale: "zh-TW" as const,
      subject: "FrameQ 啟用碼",
      snippets: [
        "完整啟用碼",
        "綁定信箱",
        "兌換截止時間",
        "31 天權益",
        "20 AI Credits",
        "僅限目前帳號使用，請勿轉寄",
      ],
    },
    {
      locale: "en-US" as const,
      subject: "Your FrameQ activation code",
      snippets: [
        "Full activation code",
        "Bound email",
        "Redeem by",
        "31-day entitlement",
        "20 AI Credits",
        "This email is only for the current account. Do not forward it.",
      ],
    },
  ])("localizes subject/text/html for $locale", async ({ locale, subject, snippets }) => {
    const sentMessages: Array<Record<string, string>> = [];
    const sender = createActivationCodeSender(
      {
        environment: "production",
        allowConsoleOtp: false,
        smtp: {
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "mailer@example.com",
          pass: "app-password",
          from: "FrameQ <mailer@example.com>",
        },
      },
      () => ({
        sendMail: async (message: Record<string, string>) => {
          sentMessages.push(message);
        },
      }),
    );

    await sender.sendActivationCode({
      email: "user@example.com",
      code: "FQ-ABCD-EFGH-JKLM-NPQR",
      locale,
      redeemBy: new Date("2026-09-23T08:00:00.000Z"),
      entitlementDays: 31,
      llmCredits: 20,
    });

    expect(sentMessages).toHaveLength(1);
    const message = sentMessages[0]!;
    expect(message).toMatchObject({
      from: "FrameQ <mailer@example.com>",
      to: "user@example.com",
      subject,
    });
    expect(message.text).toContain("FQ-ABCD-EFGH-JKLM-NPQR");
    expect(message.html).toContain("FQ-ABCD-EFGH-JKLM-NPQR");
    expect(message.text).toContain("2026-09-23T08:00:00.000Z");
    expect(message.html).toContain("2026-09-23T08:00:00.000Z");
    for (const snippet of snippets) {
      expect(message.text).toContain(snippet);
      expect(message.html).toContain(snippet);
    }
  });

  test("escapes user-controlled fields in activation email HTML while keeping text readable", async () => {
    const sentMessages: Array<Record<string, string>> = [];
    const sender = createActivationCodeSender(
      {
        environment: "production",
        allowConsoleOtp: false,
        smtp: {
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "mailer@example.com",
          pass: "app-password",
          from: "FrameQ <mailer@example.com>",
        },
      },
      () => ({
        sendMail: async (message: Record<string, string>) => {
          sentMessages.push(message);
        },
      }),
    );

    await sender.sendActivationCode({
      email: "user+<tag>@example.com",
      code: "FQ-<&>\"'",
      locale: "en-US",
      redeemBy: new Date("2026-09-23T08:00:00.000Z"),
      entitlementDays: 31,
      llmCredits: 20,
    });

    const message = sentMessages[0]!;
    expect(message.text).toContain("user+<tag>@example.com");
    expect(message.text).toContain("FQ-<&>\"'");
    expect(message.text).toContain("2026-09-23T08:00:00.000Z");
    expect(message.html).toContain("user+&lt;tag&gt;@example.com");
    expect(message.html).toContain("FQ-&lt;&amp;&gt;&quot;&#39;");
    expect(message.html).not.toContain("<script>");
  });

  test("sanitizes SMTP send failures without leaking activation payloads", async () => {
    const sender = createActivationCodeSender(
      {
        environment: "production",
        allowConsoleOtp: false,
        smtp: {
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "mailer@example.com",
          pass: "app-password",
          from: "FrameQ <mailer@example.com>",
        },
      },
      () => ({
        sendMail: async () => {
          throw new Error("smtp exploded for user@example.com / FQ-ABCD-EFGH-JKLM-NPQR");
        },
      }),
    );

    await expect(
      sender.sendActivationCode({
        email: "user@example.com",
        code: "FQ-ABCD-EFGH-JKLM-NPQR",
        locale: "zh-CN",
        redeemBy: new Date("2026-09-23T08:00:00.000Z"),
        entitlementDays: 31,
        llmCredits: 20,
      }),
    ).rejects.toMatchObject({
      message: "Activation email delivery failed.",
      cause: expect.any(Error),
    });
  });
});
