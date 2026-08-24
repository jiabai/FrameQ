import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_ENTITLEMENT_DAYS,
  DEFAULT_REDEEM_WINDOW_DAYS,
  SELF_SERVICE_LLM_QUOTA,
} from "../src/activationPolicy.js";
import {
  SelfServiceActivationError,
  SelfServiceActivationService,
} from "../src/selfServiceActivation.js";
import type {
  ActivatePreparedSelfServiceActivationCodeResult,
  PrepareSelfServiceActivationCodeResult,
  Store,
} from "../src/store.js";

type SelfServiceActivationStore = Pick<
  Store,
  | "prepareSelfServiceActivationCode"
  | "disablePreparedSelfServiceActivationCode"
  | "activatePreparedSelfServiceActivationCode"
>;

const now = new Date("2026-08-24T08:00:00.000Z");
const retryAt = new Date("2026-08-24T08:01:00.000Z");
const redeemBy = new Date("2026-09-23T08:00:00.000Z");
const activationCodeId = "activation-code-1";
const plaintextCode = "FQ-ABCD-EFGH-JKLM-NPQR";

function createStore(
  prepared: PrepareSelfServiceActivationCodeResult,
  activated: ActivatePreparedSelfServiceActivationCodeResult = { status: "activated" },
): SelfServiceActivationStore {
  return {
    prepareSelfServiceActivationCode: vi.fn(async () => prepared),
    disablePreparedSelfServiceActivationCode: vi.fn(async () => null),
    activatePreparedSelfServiceActivationCode: vi.fn(async () => activated),
  };
}

describe("self-service activation service", () => {
  test("sends a prepared code, returns no plaintext, and passes exact email payload", async () => {
    const store = createStore({
      status: "prepared",
      activationCodeId,
      email: "user@example.com",
      retryAt,
      redeemBy,
    });
    const sender = {
      sendActivationCode: vi.fn(async () => {}),
    };
    const service = new SelfServiceActivationService({
      store,
      now: () => now,
      generateCode: () => plaintextCode,
      sendActivationCode: sender,
    });

    const result = await service.requestCode({
      sessionTokenHash: "session-token-hash",
      ip: "203.0.113.8",
      locale: "zh-CN",
    });

    expect(result).toEqual({
      status: "sent",
      retryAt,
      redeemBy,
    });
    expect(store.prepareSelfServiceActivationCode).toHaveBeenCalledWith({
      sessionTokenHash: "session-token-hash",
      codeHash: expect.any(String),
      codePrefix: "FQ-ABCD",
      ip: "203.0.113.8",
      now,
      redeemBy,
      entitlementDays: DEFAULT_ENTITLEMENT_DAYS,
    });
    expect(sender.sendActivationCode).toHaveBeenCalledWith({
      email: "user@example.com",
      code: plaintextCode,
      locale: "zh-CN",
      redeemBy,
      entitlementDays: DEFAULT_ENTITLEMENT_DAYS,
      llmCredits: SELF_SERVICE_LLM_QUOTA,
    });
    expect(store.activatePreparedSelfServiceActivationCode).toHaveBeenCalledWith({
      activationCodeId,
      now,
    });
    expect(JSON.stringify(result)).not.toContain(plaintextCode);
    expect(JSON.stringify(result)).not.toContain("user@example.com");
  });

  test("rejects locales outside the strict whitelist before touching the store", async () => {
    const store = createStore({
      status: "prepared",
      activationCodeId,
      email: "user@example.com",
      retryAt,
      redeemBy,
    });
    const service = new SelfServiceActivationService({
      store,
      now: () => now,
      generateCode: () => plaintextCode,
      sendActivationCode: { sendActivationCode: vi.fn(async () => {}) },
    });

    await expect(
      service.requestCode({
        sessionTokenHash: "session-token-hash",
        ip: "203.0.113.8",
        locale: "fr-FR" as "zh-CN",
      }),
    ).rejects.toMatchObject({
      code: "SERVER_TEMPORARILY_UNAVAILABLE",
      retryAt: undefined,
    });
    expect(store.prepareSelfServiceActivationCode).not.toHaveBeenCalled();
  });

  test("maps prepare outcomes to sanitized domain errors", async () => {
    const scenarios: Array<{
      prepared: PrepareSelfServiceActivationCodeResult;
      expectedCode: SelfServiceActivationError["code"];
      expectedRetryAt?: Date;
    }> = [
      {
        prepared: { status: "session_invalid" },
        expectedCode: "AUTH_REQUIRED",
      },
      {
        prepared: { status: "entitlement_active" },
        expectedCode: "ENTITLEMENT_ACTIVE",
      },
      {
        prepared: { status: "rate_limited", retryAt },
        expectedCode: "ACTIVATION_REQUEST_RATE_LIMITED",
        expectedRetryAt: retryAt,
      },
      {
        prepared: { status: "temporarily_unavailable" },
        expectedCode: "SERVER_TEMPORARILY_UNAVAILABLE",
      },
    ];

    for (const scenario of scenarios) {
      const service = new SelfServiceActivationService({
        store: createStore(scenario.prepared),
        now: () => now,
        generateCode: () => plaintextCode,
        sendActivationCode: { sendActivationCode: vi.fn(async () => {}) },
      });

      await expect(
        service.requestCode({
          sessionTokenHash: "session-token-hash",
          ip: "203.0.113.8",
          locale: "en-US",
        }),
      ).rejects.toMatchObject({
        code: scenario.expectedCode,
        retryAt: scenario.expectedRetryAt,
      });
    }
  });

  test("disables the prepared code and reports email unavailable when sending fails", async () => {
    const store = createStore({
      status: "prepared",
      activationCodeId,
      email: "user@example.com",
      retryAt,
      redeemBy,
    });
    const service = new SelfServiceActivationService({
      store,
      now: () => now,
      generateCode: () => plaintextCode,
      sendActivationCode: {
        sendActivationCode: vi.fn(async () => {
          throw new Error("smtp exploded with code body");
        }),
      },
    });

    await expect(
      service.requestCode({
        sessionTokenHash: "session-token-hash",
        ip: "203.0.113.8",
        locale: "zh-TW",
      }),
    ).rejects.toMatchObject({
      code: "ACTIVATION_EMAIL_UNAVAILABLE",
      retryAt,
    });
    expect(store.disablePreparedSelfServiceActivationCode).toHaveBeenCalledWith({
      activationCodeId,
      now,
      reason: "delivery_failed",
    });
    expect(store.activatePreparedSelfServiceActivationCode).not.toHaveBeenCalled();
  });

  test("maps activation outcomes without leaking plaintext or store details", async () => {
    const scenarios: Array<{
      activated: ActivatePreparedSelfServiceActivationCodeResult;
      expectedCode: SelfServiceActivationError["code"];
      expectedRetryAt?: Date;
    }> = [
      {
        activated: { status: "entitlement_active" },
        expectedCode: "ENTITLEMENT_ACTIVE",
      },
      {
        activated: { status: "invalid" },
        expectedCode: "ACTIVATION_EMAIL_UNAVAILABLE",
        expectedRetryAt: retryAt,
      },
      {
        activated: { status: "temporarily_unavailable" },
        expectedCode: "SERVER_TEMPORARILY_UNAVAILABLE",
      },
    ];

    for (const scenario of scenarios) {
      const store = createStore(
        {
          status: "prepared",
          activationCodeId,
          email: "user@example.com",
          retryAt,
          redeemBy,
        },
        scenario.activated,
      );
      const service = new SelfServiceActivationService({
        store,
        now: () => now,
        generateCode: () => plaintextCode,
        sendActivationCode: { sendActivationCode: vi.fn(async () => {}) },
      });

      await expect(
        service.requestCode({
          sessionTokenHash: "session-token-hash",
          ip: "203.0.113.8",
          locale: "en-US",
        }),
      ).rejects.toMatchObject({
        code: scenario.expectedCode,
        retryAt: scenario.expectedRetryAt,
      });
    }
  });

  test("sanitizes unknown store failures as server temporarily unavailable", async () => {
    const store: SelfServiceActivationStore = {
      prepareSelfServiceActivationCode: vi.fn(async () => {
        throw new Error(`db failed while staging ${plaintextCode} for user@example.com`);
      }),
      disablePreparedSelfServiceActivationCode: vi.fn(async () => null),
      activatePreparedSelfServiceActivationCode: vi.fn(
        async () => ({ status: "activated" }) as const,
      ),
    };
    const service = new SelfServiceActivationService({
      store,
      now: () => now,
      generateCode: () => plaintextCode,
      sendActivationCode: { sendActivationCode: vi.fn(async () => {}) },
    });

    await expect(
      service.requestCode({
        sessionTokenHash: "session-token-hash",
        ip: "203.0.113.8",
        locale: "zh-CN",
      }),
    ).rejects.toMatchObject({
      code: "SERVER_TEMPORARILY_UNAVAILABLE",
      retryAt: undefined,
      message: "SERVER_TEMPORARILY_UNAVAILABLE",
    });
  });

  test("uses the shared default redeem window when no custom redeemBy comes back from prepare", async () => {
    const store = createStore({
      status: "prepared",
      activationCodeId,
      email: "user@example.com",
      retryAt,
      redeemBy: new Date(now.getTime() + DEFAULT_REDEEM_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    });
    const service = new SelfServiceActivationService({
      store,
      now: () => now,
      generateCode: () => plaintextCode,
      sendActivationCode: { sendActivationCode: vi.fn(async () => {}) },
    });

    await service.requestCode({
      sessionTokenHash: "session-token-hash",
      ip: "203.0.113.8",
      locale: "en-US",
    });

    expect(store.prepareSelfServiceActivationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        redeemBy: new Date("2026-09-23T08:00:00.000Z"),
      }),
    );
  });
});
