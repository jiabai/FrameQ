import { describe, expect, test } from "vitest";
import { ActivationCodeService } from "../src/activation.js";
import { sha256 } from "../src/security.js";
import { buildServer } from "../src/server.js";
import { type AdminEntitlementAdjustmentRecord, MemoryStore } from "../src/store.js";

const now = new Date("2026-07-10T08:00:00.000Z");


class FailOnceEntitlementWriteStore extends MemoryStore {
  private fail = true;

  override async upsertEntitlement(
    userId: string,
    expiresAt: Date,
    updatedAt: Date,
    quota: { llmQuotaLimit?: number; llmQuotaUsed?: number } = {},
  ) {
    if (this.fail) {
      this.fail = false;
      throw new Error("injected entitlement write failure");
    }
    return super.upsertEntitlement(userId, expiresAt, updatedAt, quota);
  }
}

class FailAuditWriteStore extends MemoryStore {
  override async createAdminEntitlementAdjustment(
    _input: AdminEntitlementAdjustmentRecord,
  ): Promise<AdminEntitlementAdjustmentRecord> {
    throw new Error("injected audit write failure");
  }
}

class FailOnceSelfServiceCodeCreateStore extends MemoryStore {
  fail = true;

  override async createActivationCode(input: Parameters<MemoryStore["createActivationCode"]>[0]) {
    if (this.fail) {
      this.fail = false;
      throw new Error("injected self-service code create failure");
    }
    return super.createActivationCode(input);
  }
}

class FailOnceSelfServiceActivationStore extends MemoryStore {
  fail = true;

  override async getEntitlement(userId: string) {
    const entitlement = await super.getEntitlement(userId);
    const hasPendingPreparedCode = this.activationCodes.some(
      (code) =>
        code.issuanceSource === "self_service_email" &&
        code.status === "pending_delivery" &&
        code.issuedToUserId === userId,
    );
    if (this.fail && entitlement === null && hasPendingPreparedCode) {
      this.fail = false;
      throw new Error("injected self-service activation failure");
    }
    return entitlement;
  }
}



async function createSelfServiceSession(store: MemoryStore, email = "self-service@example.com") {
  const user = await store.upsertUserByEmail(email, now);
  const session = await store.createSession({
    userId: user.id,
    tokenHash: `self-service-session-${email}`,
    createdAt: now,
    expiresAt: new Date("2026-08-10T08:00:00.000Z"),
  });
  return { user, session };
}

describe("transactional entitlement boundaries in MemoryStore", () => {







  test("rolls back activation redemption when entitlement quota grant fails", async () => {
    const store = new FailOnceEntitlementWriteStore();
    const user = await store.upsertUserByEmail("activation@example.com", now);
    const session = await store.createSession({
      userId: user.id,
      tokenHash: "activation-session",
      createdAt: now,
      expiresAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    const activation = new ActivationCodeService({ store, now: () => now });
    const code = await activation.generateCode();

    await expect(
      activation.redeemCode({ sessionTokenHash: session.tokenHash, code: code.code }),
    ).rejects.toThrow("injected entitlement write failure");

    expect(store.activationCodes[0]).toMatchObject({
      status: "active",
      redeemedAt: null,
      redeemedByUserId: null,
    });
    expect(await store.getEntitlement(user.id)).toBeNull();

    await expect(
      activation.redeemCode({ sessionTokenHash: session.tokenHash, code: code.code }),
    ).resolves.toMatchObject({ entitlementExpiresAt: new Date("2026-08-10T08:00:00.000Z") });
  });

  test("does not persist administrator compensation when its required audit write fails", async () => {
    const store = new FailAuditWriteStore();
    const user = await store.upsertUserByEmail("compensation@example.com", now);
    const adminToken = "admin-transaction-token";
    const csrfToken = "admin-transaction-csrf";
    await store.createAdminSession({
      email: "lantianye@163.com",
      tokenHash: sha256(adminToken),
      csrfTokenHash: sha256(csrfToken),
      createdAt: now,
      expiresAt: new Date("2026-07-10T20:00:00.000Z"),
    });
    const app = buildServer({
      store,
      now: () => now,
      adminEmail: "lantianye@163.com",
      sendOtp: async () => {},
    });

    const response = await app.inject({
      method: "POST",
      url: `/admin/api/users/${user.id}/entitlement-adjustments`,
      headers: {
        cookie: `app_admin_session=${adminToken}; app_admin_csrf=${csrfToken}`,
        "x-app-csrf": csrfToken,
      },
      payload: { extend_days: 7, quota_add: 5, reason: "manual_repair" },
    });

    expect(response.statusCode).toBe(500);
    expect(await store.getEntitlement(user.id)).toBeNull();
    expect(store.adminEntitlementAdjustments).toHaveLength(0);
  });


  test("permits only one concurrent redemption of the same activation code", async () => {
    const store = new MemoryStore();
    const user = await store.upsertUserByEmail("concurrent-activation@example.com", now);
    const session = await store.createSession({
      userId: user.id,
      tokenHash: "concurrent-activation-session",
      createdAt: now,
      expiresAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    const activation = new ActivationCodeService({ store, now: () => now });
    const code = await activation.generateCode();

    const results = await Promise.allSettled([
      activation.redeemCode({ sessionTokenHash: session.tokenHash, code: code.code }),
      activation.redeemCode({ sessionTokenHash: session.tokenHash, code: code.code }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await store.getEntitlement(user.id)).toMatchObject({ llmQuotaLimit: 20, llmQuotaUsed: 0 });
  });

  test("rolls back self-service prepare when code creation fails after reserving rate limits", async () => {
    const store = new FailOnceSelfServiceCodeCreateStore();
    const { session } = await createSelfServiceSession(store, "prepare-rollback@example.com");

    await expect(
      store.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-PREP-ROLL-BACK-0001"),
        codePrefix: "FQ-PREP",
        ip: "203.0.113.61",
        now,
        redeemBy: new Date("2026-09-23T08:00:00.000Z"),
        entitlementDays: 31,
      }),
    ).rejects.toThrow("injected self-service code create failure");

    expect(store.activationCodes).toHaveLength(0);
    expect(store.authRateLimits).toHaveLength(0);

    await expect(
      store.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-PREP-ROLL-BACK-0002"),
        codePrefix: "FQ-PREP",
        ip: "203.0.113.61",
        now,
        redeemBy: new Date("2026-09-23T08:00:00.000Z"),
        entitlementDays: 31,
      }),
    ).resolves.toMatchObject({
      status: "prepared",
      retryAt: new Date("2026-07-10T08:01:00.000Z"),
    });
  });

  test("leaves no redeemable code when activation fails after SMTP acceptance", async () => {
    const store = new FailOnceSelfServiceActivationStore();
    const { user, session } = await createSelfServiceSession(store, "activate-rollback@example.com");
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-ACTV-ROLL-BACK-0001"),
      codePrefix: "FQ-ACTV",
      ip: "203.0.113.62",
      now,
      redeemBy: new Date("2026-09-23T08:00:00.000Z"),
      entitlementDays: 31,
    });
    expect(prepared.status).toBe("prepared");
    const pending = store.activationCodes[0];

    await expect(
      store.activatePreparedSelfServiceActivationCode({
        activationCodeId: pending?.id ?? "",
        now,
      }),
    ).rejects.toThrow("injected self-service activation failure");

    expect(pending).toMatchObject({
      status: "pending_delivery",
      sentAt: null,
      redeemedAt: null,
      disabledReason: null,
    });
    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: pending?.codeHash ?? "",
        now,
        llmQuotaPerActivation: 20,
      }),
    ).resolves.toEqual({ status: "code_invalid" });
    expect(await store.getEntitlement(user.id)).toBeNull();
  });

  test("permits only one concurrent activation of the same prepared self-service code", async () => {
    const store = new MemoryStore();
    const { user, session } = await createSelfServiceSession(store, "concurrent-self-service@example.com");
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-CNCR-ACTV-0001"),
      codePrefix: "FQ-CNCR",
      ip: "203.0.113.63",
      now,
      redeemBy: new Date("2026-09-23T08:00:00.000Z"),
      entitlementDays: 31,
    });
    expect(prepared.status).toBe("prepared");
    const activationCodeId = store.activationCodes[0]?.id ?? "";

    const results = await Promise.allSettled([
      store.activatePreparedSelfServiceActivationCode({ activationCodeId, now }),
      store.activatePreparedSelfServiceActivationCode({ activationCodeId, now }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.map((result) => (result.status === "fulfilled" ? result.value.status : "rejected"))).toEqual(
      expect.arrayContaining(["activated", "invalid"]),
    );
    expect(
      store.activationCodes.filter(
        (code) =>
          code.issuanceSource === "self_service_email" &&
          code.issuedToUserId === user.id &&
          code.status === "active",
      ),
    ).toHaveLength(1);
  });
});
