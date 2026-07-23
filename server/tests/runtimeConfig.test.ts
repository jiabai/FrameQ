import { describe, expect, test } from "vitest";
import { parseRuntimeConfig, RuntimeConfigurationError } from "../src/runtimeConfig.js";

const completeProductionEnv = {
  NODE_ENV: "production",
  FRAMEQ_SERVER_HOST: "127.0.0.1",
  FRAMEQ_SERVER_PORT: "8787",
  DATABASE_URL: "file:../data/frameq.sqlite",
  FRAMEQ_ADMIN_EMAIL: "admin@example.com",
  FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY: "production-encryption-secret-at-least-32",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "465",
  SMTP_USER: "mailer@example.com",
  SMTP_PASS: "smtp-secret",
  SMTP_FROM: "FrameQ <mailer@example.com>",
  WECHAT_PAY_ENABLED: "0",
} satisfies NodeJS.ProcessEnv;

describe("runtime configuration", () => {
  test("accepts and freezes a complete production configuration", () => {
    const config = parseRuntimeConfig(completeProductionEnv);

    expect(config).toMatchObject({
      environment: "production",
      host: "127.0.0.1",
      port: 8787,
      databaseUrl: "file:../data/frameq.sqlite",
      adminEmail: "admin@example.com",
      llmConfigEncryptionKey: "production-encryption-secret-at-least-32",
      allowConsoleOtp: false,
      smtp: {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        user: "mailer@example.com",
        pass: "smtp-secret",
        from: "FrameQ <mailer@example.com>",
      },
      wechatPayEnabled: false,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.smtp)).toBe(true);
  });

  test.each([
    "DATABASE_URL",
    "FRAMEQ_ADMIN_EMAIL",
    "FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
  ])("production rejects a missing required variable: %s", (name) => {
    const env = { ...completeProductionEnv, [name]: "" };

    expect(() => parseRuntimeConfig(env)).toThrow(name);
  });

  test("reports variable names without echoing secret values", () => {
    const secretMarker = "do-not-echo-this-secret";
    const env = {
      ...completeProductionEnv,
      SMTP_PORT: secretMarker,
      SMTP_PASS: secretMarker,
    };

    expect(() => parseRuntimeConfig(env)).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("SMTP_PORT"),
      }),
    );
    try {
      parseRuntimeConfig(env);
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigurationError);
      expect((error as RuntimeConfigurationError).variables).toContain("SMTP_PORT");
      expect(String(error)).not.toContain(secretMarker);
    }
  });

  test("production rejects console OTP even when explicitly requested", () => {
    expect(() =>
      parseRuntimeConfig({
        ...completeProductionEnv,
        FRAMEQ_ALLOW_CONSOLE_OTP: "1",
      }),
    ).toThrow("FRAMEQ_ALLOW_CONSOLE_OTP");
  });

  test("non-production console OTP requires explicit opt-in", () => {
    expect(() =>
      parseRuntimeConfig({
        NODE_ENV: "development",
      }),
    ).toThrow("FRAMEQ_ALLOW_CONSOLE_OTP");

    const config = parseRuntimeConfig({
      NODE_ENV: "development",
      FRAMEQ_ALLOW_CONSOLE_OTP: "1",
    });
    expect(config.allowConsoleOtp).toBe(true);
    expect(config.smtp).toBeNull();
  });

  test("partial SMTP is rejected even when development console delivery is enabled", () => {
    expect(() =>
      parseRuntimeConfig({
        NODE_ENV: "development",
        FRAMEQ_ALLOW_CONSOLE_OTP: "1",
        SMTP_HOST: "smtp.example.com",
      }),
    ).toThrow("SMTP_USER");
  });

  test("enabled WeChat Pay rejects incomplete provider configuration", () => {
    expect(() =>
      parseRuntimeConfig({
        ...completeProductionEnv,
        WECHAT_PAY_ENABLED: "1",
      }),
    ).toThrow("WECHAT_APP_ID");
  });

  test("normalizes a complete enabled WeChat configuration into the closed config", () => {
    const config = parseRuntimeConfig({
      ...completeProductionEnv,
      WECHAT_PAY_ENABLED: "1",
      WECHAT_APP_ID: "wx-app-id",
      WECHAT_MCH_ID: "merchant-id",
      WECHAT_MCH_SERIAL_NO: "serial-no",
      WECHAT_MCH_PRIVATE_KEY: "private-key-line-1\\nprivate-key-line-2",
      WECHAT_NOTIFY_URL: "https://frameq.example/api/wechat/notify",
      WECHAT_API_V3_KEY: "12345678901234567890123456789012",
      WECHAT_PLATFORM_CERT_PEM: "certificate-line-1\\ncertificate-line-2",
    });

    expect(config.wechatPayEnabled).toBe(true);
    expect(config.wechat).toEqual({
      appId: "wx-app-id",
      mchId: "merchant-id",
      serialNo: "serial-no",
      privateKey: "private-key-line-1\nprivate-key-line-2",
      notifyUrl: "https://frameq.example/api/wechat/notify",
      apiV3Key: "12345678901234567890123456789012",
      platformCertPem: "certificate-line-1\ncertificate-line-2",
      allowInsecureNotify: false,
    });
    expect(Object.isFrozen(config.wechat)).toBe(true);
  });

  test("production rejects insecure WeChat notification parsing", () => {
    expect(() =>
      parseRuntimeConfig({
        ...completeProductionEnv,
        WECHAT_DEV_INSECURE_NOTIFY: "1",
      }),
    ).toThrow("WECHAT_DEV_INSECURE_NOTIFY");
  });

  test("enabled WeChat Pay rejects an invalid APIv3 key length", () => {
    expect(() =>
      parseRuntimeConfig({
        ...completeProductionEnv,
        WECHAT_PAY_ENABLED: "1",
        WECHAT_APP_ID: "wx-app-id",
        WECHAT_MCH_ID: "merchant-id",
        WECHAT_MCH_SERIAL_NO: "serial-no",
        WECHAT_MCH_PRIVATE_KEY: "private-key",
        WECHAT_NOTIFY_URL: "https://frameq.example/api/wechat/notify",
        WECHAT_API_V3_KEY: "too-short",
        WECHAT_PLATFORM_CERT_PEM: "certificate",
      }),
    ).toThrow("WECHAT_API_V3_KEY");
  });

  test.each([
    ["FRAMEQ_SERVER_PORT", "0"],
    ["FRAMEQ_SERVER_PORT", "65536"],
    ["FRAMEQ_SERVER_PORT", "not-a-port"],
    ["SMTP_PORT", "not-a-port"],
  ])("rejects an invalid %s without echoing its value", (name, value) => {
    expect(() =>
      parseRuntimeConfig({
        ...completeProductionEnv,
        [name]: value,
      }),
    ).toThrow(name);
  });
});
