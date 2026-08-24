import { describe, expect, test } from "vitest";
import { sha256 } from "../src/security.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-08-24T08:00:00.000Z");
const sessionExpiresAt = new Date("2026-12-24T08:00:00.000Z");
const redeemBy = new Date("2026-09-23T08:00:00.000Z");

async function createSessionFixture(email = "self-service@example.com") {
  const store = new MemoryStore();
  const user = await store.upsertUserByEmail(email, now);
  const session = await store.createSession({
    userId: user.id,
    tokenHash: `session-${email}`,
    createdAt: now,
    expiresAt: sessionExpiresAt,
  });
  return { store, user, session };
}

describe("MemoryStore self-service activation lifecycle", () => {
  test("prepares a pending self-service code, binds it to the session user, and reserves dispatch limits", async () => {
    const { store, user, session } = await createSessionFixture();

    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-SELF-SVC1-SVC1-SVC1"),
      codePrefix: "FQ-SELF",
      ip: "203.0.113.51",
      now,
      redeemBy,
      entitlementDays: 31,
    });

    expect(prepared).toEqual({
      status: "prepared",
      activationCodeId: expect.any(String),
      email: user.email,
      retryAt: new Date("2026-08-24T08:01:00.000Z"),
      redeemBy,
    });
    expect(store.activationCodes).toHaveLength(1);
    expect(store.activationCodes[0]?.id).toEqual(expect.any(String));
    expect(store.activationCodes[0]).toMatchObject({
      codeHash: sha256("FQ-SELF-SVC1-SVC1-SVC1"),
      codePrefix: "FQ-SELF",
      status: "pending_delivery",
      issuanceSource: "self_service_email",
      entitlementDays: 31,
      issuedToUserId: user.id,
      redeemBy,
      createdAt: now,
      sentAt: null,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    expect(store.authRateLimits).toHaveLength(3);
    expect(store.authRateLimits.every((record) => record.purpose === "self_service_activation")).toBe(true);
  });

  test("blocks prepare when the session user still has an active entitlement", async () => {
    const { store, user, session } = await createSessionFixture("active-entitlement@example.com");
    await store.upsertEntitlement(user.id, new Date("2026-09-01T08:00:00.000Z"), now, {
      llmQuotaLimit: 20,
      llmQuotaUsed: 5,
    });

    await expect(
      store.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-ACTIVE-BLOCK-0001"),
        codePrefix: "FQ-ACTI",
        ip: "203.0.113.52",
        now,
        redeemBy,
        entitlementDays: 31,
      }),
    ).resolves.toEqual({ status: "entitlement_active" });
    expect(store.activationCodes).toHaveLength(0);
    expect(store.authRateLimits).toHaveLength(0);
  });

  test("rate-limited prepare leaves no new activation code or pending record", async () => {
    const { store, session } = await createSessionFixture("rate-limited@example.com");

    await expect(
      store.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-RATE-LIMIT-0001"),
        codePrefix: "FQ-RATE",
        ip: "203.0.113.57",
        now,
        redeemBy,
        entitlementDays: 31,
      }),
    ).resolves.toMatchObject({
      status: "prepared",
      retryAt: new Date("2026-08-24T08:01:00.000Z"),
    });

    await expect(
      store.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-RATE-LIMIT-0002"),
        codePrefix: "FQ-RAT2",
        ip: "203.0.113.57",
        now: new Date("2026-08-24T08:00:30.000Z"),
        redeemBy,
        entitlementDays: 31,
      }),
    ).resolves.toEqual({
      status: "rate_limited",
      retryAt: new Date("2026-08-24T08:01:00.000Z"),
    });
    expect(store.activationCodes).toHaveLength(1);
    expect(
      store.activationCodes.filter((code) => code.status === "pending_delivery"),
    ).toHaveLength(1);
    expect(store.activationCodes.some((code) => code.codePrefix === "FQ-RAT2")).toBe(false);
  });

  test("activates a prepared code, supersedes the older active self-service code, and keeps only one active code", async () => {
    const { store, user, session } = await createSessionFixture("activate@example.com");
    const olderActive = await store.createActivationCode({
      codeHash: sha256("FQ-OLD-ACTV-CODE-0001"),
      codePrefix: "FQ-OLD",
      status: "active",
      issuanceSource: "self_service_email",
      entitlementDays: 31,
      issuedToUserId: user.id,
      redeemBy: new Date("2026-09-10T08:00:00.000Z"),
      createdAt: new Date("2026-08-20T08:00:00.000Z"),
      sentAt: new Date("2026-08-20T08:00:00.000Z"),
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-NEW-ACTV-CODE-0001"),
      codePrefix: "FQ-NEW",
      ip: "203.0.113.53",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    expect(prepared.status).toBe("prepared");
    const preparedId = store.activationCodes.find((code) => code.codePrefix === "FQ-NEW")?.id;

    await expect(
      store.activatePreparedSelfServiceActivationCode({
        activationCodeId: preparedId ?? "",
        now,
      }),
    ).resolves.toEqual({ status: "activated" });

    expect(olderActive).toMatchObject({
      status: "disabled",
      disabledReason: "superseded",
      sentAt: new Date("2026-08-20T08:00:00.000Z"),
    });
    const current = store.activationCodes.find((code) => code.id === preparedId);
    expect(current).toMatchObject({
      status: "active",
      issuanceSource: "self_service_email",
      issuedToUserId: user.id,
      sentAt: now,
      disabledReason: null,
    });
    expect(
      store.activationCodes.filter(
        (code) =>
          code.issuanceSource === "self_service_email" &&
          code.issuedToUserId === user.id &&
          code.status === "active",
      ),
    ).toHaveLength(1);
  });

  test("disables only pending self-service codes on delivery failure and keeps old active codes redeemable", async () => {
    const { store, user, session } = await createSessionFixture("delivery@example.com");
    const active = await store.createActivationCode({
      codeHash: sha256("FQ-KEEP-ACTV-CODE-0001"),
      codePrefix: "FQ-KEEP",
      status: "active",
      issuanceSource: "self_service_email",
      entitlementDays: 31,
      issuedToUserId: user.id,
      redeemBy: new Date("2026-09-10T08:00:00.000Z"),
      createdAt: new Date("2026-08-20T08:00:00.000Z"),
      sentAt: new Date("2026-08-20T08:00:00.000Z"),
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-PEND-FAIL-CODE-0001"),
      codePrefix: "FQ-PEND",
      ip: "203.0.113.54",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    const pending = store.activationCodes.find((code) => code.codePrefix === "FQ-PEND");

    const disabled = await store.disablePreparedSelfServiceActivationCode({
      activationCodeId: pending?.id ?? "",
      now,
      reason: "delivery_failed",
    });

    expect(disabled).toMatchObject({
      id: pending?.id,
      status: "disabled",
      disabledReason: "delivery_failed",
      sentAt: null,
    });
    expect(active).toMatchObject({
      status: "active",
      disabledReason: null,
    });
    await expect(
      store.disablePreparedSelfServiceActivationCode({
        activationCodeId: pending?.id ?? "",
        now,
        reason: "delivery_failed",
      }),
    ).resolves.toBeNull();
  });

  test("disables a pending code when entitlement becomes active before activation", async () => {
    const { store, user, session } = await createSessionFixture("became-active@example.com");
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-BECA-ACTV-0001"),
      codePrefix: "FQ-BECA",
      ip: "203.0.113.58",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    await store.upsertEntitlement(user.id, new Date("2026-09-10T08:00:00.000Z"), now, {
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });

    await expect(
      store.activatePreparedSelfServiceActivationCode({
        activationCodeId:
          store.activationCodes.find((code) => code.codePrefix === "FQ-BECA")?.id ?? "",
        now: new Date("2026-08-24T08:01:00.000Z"),
      }),
    ).resolves.toEqual({ status: "entitlement_active" });

    expect(
      store.activationCodes.find(
        (code) =>
          code.id ===
          (store.activationCodes.find((code) => code.codePrefix === "FQ-BECA")?.id ?? ""),
      ),
    ).toMatchObject({
      status: "disabled",
      disabledReason: "activation_became_active",
      sentAt: null,
      redeemedAt: null,
    });
  });

  test("redeems only the bound self-service code, grants a fresh 31-day window, and resets quota after expiry", async () => {
    const { store, user, session } = await createSessionFixture("redeem@example.com");
    const prepareAt = new Date("2026-09-01T08:00:00.000Z");
    const activateAt = new Date("2026-09-01T08:01:00.000Z");
    const redeemAt = new Date("2026-09-15T09:00:00.000Z");
    await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-REDEEM-SELF-0001"),
      codePrefix: "FQ-REDM",
      ip: "203.0.113.55",
      now: prepareAt,
      redeemBy: new Date("2026-10-01T08:00:00.000Z"),
      entitlementDays: 31,
    });
    await store.activatePreparedSelfServiceActivationCode({
      activationCodeId:
        store.activationCodes.find((code) => code.codePrefix === "FQ-REDM")?.id ?? "",
      now: activateAt,
    });
    const prepared = store.activationCodes.find((code) => code.codePrefix === "FQ-REDM");

    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-REDEEM-SELF-0001"),
        now: redeemAt,
        llmQuotaPerActivation: 99,
      }),
    ).resolves.toMatchObject({
      status: "redeemed",
      entitlement: {
        userId: user.id,
        llmQuotaLimit: 20,
        llmQuotaUsed: 0,
        expiresAt: new Date("2026-10-16T09:00:00.000Z"),
      },
    });
    expect(prepared).toMatchObject({
      status: "redeemed",
      redeemedAt: redeemAt,
      redeemedByUserId: user.id,
    });
  });

  test("permits repeated prepare and redeem cycles after expiry without getting stuck", async () => {
    const { store, user, session } = await createSessionFixture("repeatable@example.com");
    const firstPrepare = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-REPEAT-CYCLE-0001"),
      codePrefix: "FQ-REP1",
      ip: "203.0.113.59",
      now,
      redeemBy: new Date("2026-09-23T08:00:00.000Z"),
      entitlementDays: 31,
    });
    await store.activatePreparedSelfServiceActivationCode({
      activationCodeId: firstPrepare.status === "prepared" ? firstPrepare.activationCodeId : "",
      now: new Date("2026-08-24T08:01:00.000Z"),
    });
    await store.redeemActivationCodeAndGrantEntitlement({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-REPEAT-CYCLE-0001"),
      now: new Date("2026-08-24T08:02:00.000Z"),
      llmQuotaPerActivation: 20,
    });

    const secondPrepareAt = new Date("2026-09-25T08:00:00.000Z");
    const secondPrepare = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-REPEAT-CYCLE-0002"),
      codePrefix: "FQ-REP2",
      ip: "203.0.113.59",
      now: secondPrepareAt,
      redeemBy: new Date("2026-10-25T08:00:00.000Z"),
      entitlementDays: 31,
    });
    await store.activatePreparedSelfServiceActivationCode({
      activationCodeId: secondPrepare.status === "prepared" ? secondPrepare.activationCodeId : "",
      now: new Date("2026-09-25T08:01:00.000Z"),
    });
    await store.redeemActivationCodeAndGrantEntitlement({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-REPEAT-CYCLE-0002"),
      now: new Date("2026-09-25T08:02:00.000Z"),
      llmQuotaPerActivation: 20,
    });

    const thirdPrepareAt = new Date("2026-10-27T08:00:00.000Z");
    const thirdPrepare = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-REPEAT-CYCLE-0003"),
      codePrefix: "FQ-REP3",
      ip: "203.0.113.59",
      now: thirdPrepareAt,
      redeemBy: new Date("2026-11-26T08:00:00.000Z"),
      entitlementDays: 31,
    });
    await store.activatePreparedSelfServiceActivationCode({
      activationCodeId: thirdPrepare.status === "prepared" ? thirdPrepare.activationCodeId : "",
      now: new Date("2026-10-27T08:01:00.000Z"),
    });
    const thirdRedemption = await store.redeemActivationCodeAndGrantEntitlement({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-REPEAT-CYCLE-0003"),
      now: new Date("2026-10-27T08:02:00.000Z"),
      llmQuotaPerActivation: 20,
    });

    expect(thirdRedemption).toMatchObject({
      status: "redeemed",
      entitlement: {
        userId: user.id,
        llmQuotaLimit: 20,
        llmQuotaUsed: 0,
        expiresAt: new Date("2026-11-27T08:02:00.000Z"),
      },
    });
    expect(
      store.activationCodes.filter((code) => code.status === "redeemed"),
    ).toHaveLength(3);
    expect(
      store.activationCodes.map((code) => ({
        codePrefix: code.codePrefix,
        status: code.status,
        redeemedByUserId: code.redeemedByUserId,
      })),
    ).toEqual([
      { codePrefix: "FQ-REP1", status: "redeemed", redeemedByUserId: user.id },
      { codePrefix: "FQ-REP2", status: "redeemed", redeemedByUserId: user.id },
      { codePrefix: "FQ-REP3", status: "redeemed", redeemedByUserId: user.id },
    ]);
  });

  test("rejects pending, mismatched, expired, and active-entitlement self-service redemption without consuming the code", async () => {
    const { store, user, session } = await createSessionFixture("guardrails@example.com");
    const otherUser = await store.upsertUserByEmail("other@example.com", now);
    const otherSession = await store.createSession({
      userId: otherUser.id,
      tokenHash: "other-session",
      createdAt: now,
      expiresAt: sessionExpiresAt,
    });
    await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-GUARD-SELF-0001"),
      codePrefix: "FQ-GUAR",
      ip: "203.0.113.56",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    const pending = store.activationCodes.find((code) => code.codePrefix === "FQ-GUAR");

    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: pending?.codeHash ?? "",
        now,
        llmQuotaPerActivation: 20,
      }),
    ).resolves.toEqual({ status: "code_invalid" });

    await store.activatePreparedSelfServiceActivationCode({
      activationCodeId: pending?.id ?? "",
      now: new Date("2026-08-24T08:01:00.000Z"),
    });
    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: otherSession.tokenHash,
        codeHash: pending?.codeHash ?? "",
        now,
        llmQuotaPerActivation: 20,
      }),
    ).resolves.toEqual({ status: "code_invalid" });

    await store.upsertEntitlement(user.id, new Date("2026-08-30T08:00:00.000Z"), now, {
      llmQuotaLimit: 20,
      llmQuotaUsed: 1,
    });
    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: pending?.codeHash ?? "",
        now,
        llmQuotaPerActivation: 20,
      }),
    ).resolves.toMatchObject({
      status: "entitlement_active",
      entitlement: { userId: user.id },
    });
    expect(pending).toMatchObject({
      status: "active",
      redeemedAt: null,
      redeemedByUserId: null,
    });

    const expiredCode = await store.createActivationCode({
      codeHash: sha256("FQ-EXPR-SELF-0001"),
      codePrefix: "FQ-EXPR",
      status: "active",
      issuanceSource: "self_service_email",
      entitlementDays: 31,
      issuedToUserId: user.id,
      redeemBy: new Date("2026-08-23T08:00:00.000Z"),
      createdAt: now,
      sentAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    const redeemExpiredAt = new Date("2026-08-25T08:00:00.000Z");
    await store.upsertEntitlement(user.id, new Date("2026-08-24T08:00:00.000Z"), redeemExpiredAt, {
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });
    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: expiredCode.codeHash,
        now: redeemExpiredAt,
        llmQuotaPerActivation: 20,
      }),
    ).resolves.toEqual({ status: "code_invalid" });
    expect(expiredCode).toMatchObject({ status: "expired", redeemedAt: null });
  });

  test("continues to use legacy admin redemption semantics", async () => {
    const { store, user, session } = await createSessionFixture("admin-regression@example.com");
    await store.upsertEntitlement(user.id, new Date("2026-09-05T08:00:00.000Z"), now, {
      llmQuotaLimit: 7,
      llmQuotaUsed: 3,
    });
    const adminCode = await store.createActivationCode({
      codeHash: sha256("FQ-ADMIN-REG-0001"),
      codePrefix: "FQ-ADMN",
      status: "active",
      issuanceSource: "admin",
      entitlementDays: 31,
      issuedToUserId: null,
      redeemBy,
      createdAt: now,
      sentAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });

    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: adminCode.codeHash,
        now,
        llmQuotaPerActivation: 20,
      }),
    ).resolves.toMatchObject({
      status: "redeemed",
      entitlement: {
        expiresAt: new Date("2026-10-06T08:00:00.000Z"),
        llmQuotaLimit: 27,
        llmQuotaUsed: 3,
      },
    });
  });
});
