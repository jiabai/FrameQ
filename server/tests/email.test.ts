import { describe, expect, test } from "vitest";
import { createOtpSender } from "../src/email.js";

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
