import { describe, expect, test } from "vitest";
import { parseRuntimeConfig, RuntimeConfigurationError } from "../src/runtimeConfig.js";

const completeProductionEnv = {
  NODE_ENV: "production",
  APP_SERVER_HOST: "127.0.0.1",
  APP_SERVER_PORT: "8787",
  APP_SELF_SERVICE_ACTIVATION_ENABLED: "false",
  DATABASE_URL: "file:../data/app.sqlite",
  APP_ADMIN_EMAIL: "admin@example.com",
  APP_LLM_CONFIG_ENCRYPTION_KEY: "production-encryption-secret-at-least-32",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "465",
  SMTP_USER: "mailer@example.com",
  SMTP_PASS: "smtp-secret",
  SMTP_FROM: "Locus <mailer@example.com>",
} satisfies NodeJS.ProcessEnv;

describe("runtime configuration", () => {
  test("accepts and freezes a complete production configuration", () => {
    const config = parseRuntimeConfig(completeProductionEnv);

    expect(config).toMatchObject({
      environment: "production",
      host: "127.0.0.1",
      port: 8787,
      selfServiceActivationEnabled: false,
      databaseUrl: "file:../data/app.sqlite",
      adminEmail: "admin@example.com",
      llmConfigEncryptionKey: "production-encryption-secret-at-least-32",
      allowConsoleOtp: false,
      smtp: {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        user: "mailer@example.com",
        pass: "smtp-secret",
        from: "Locus <mailer@example.com>",
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.smtp)).toBe(true);
  });

  test.each([
    "DATABASE_URL",
    "APP_ADMIN_EMAIL",
    "APP_LLM_CONFIG_ENCRYPTION_KEY",
    "APP_SELF_SERVICE_ACTIVATION_ENABLED",
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
        APP_ALLOW_CONSOLE_OTP: "1",
      }),
    ).toThrow("APP_ALLOW_CONSOLE_OTP");
  });

  test("non-production console OTP requires explicit opt-in", () => {
    expect(() =>
      parseRuntimeConfig({
        NODE_ENV: "development",
      }),
    ).toThrow("APP_ALLOW_CONSOLE_OTP");

    const config = parseRuntimeConfig({
      NODE_ENV: "development",
      APP_ALLOW_CONSOLE_OTP: "1",
    });
    expect(config.allowConsoleOtp).toBe(true);
    expect(config.smtp).toBeNull();
  });

  test("development defaults self-service activation to disabled", () => {
    const config = parseRuntimeConfig({
      NODE_ENV: "development",
      APP_ALLOW_CONSOLE_OTP: "1",
    });

    expect(config.selfServiceActivationEnabled).toBe(false);
  });

  test("production accepts explicit true/false self-service activation values", () => {
    expect(
      parseRuntimeConfig({
        ...completeProductionEnv,
        APP_SELF_SERVICE_ACTIVATION_ENABLED: "true",
      }).selfServiceActivationEnabled,
    ).toBe(true);
    expect(
      parseRuntimeConfig({
        ...completeProductionEnv,
        APP_SELF_SERVICE_ACTIVATION_ENABLED: "false",
      }).selfServiceActivationEnabled,
    ).toBe(false);
  });

  test("production requires an explicit self-service activation flag value", () => {
    const env: Partial<typeof completeProductionEnv> = { ...completeProductionEnv };
    delete env.APP_SELF_SERVICE_ACTIVATION_ENABLED;

    expect(() => parseRuntimeConfig(env)).toThrow("APP_SELF_SERVICE_ACTIVATION_ENABLED");
  });

  test("partial SMTP is rejected even when development console delivery is enabled", () => {
    expect(() =>
      parseRuntimeConfig({
        NODE_ENV: "development",
        APP_ALLOW_CONSOLE_OTP: "1",
        SMTP_HOST: "smtp.example.com",
      }),
    ).toThrow("SMTP_USER");
  });





  test.each([
    ["APP_SERVER_PORT", "0"],
    ["APP_SERVER_PORT", "65536"],
    ["APP_SERVER_PORT", "not-a-port"],
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
