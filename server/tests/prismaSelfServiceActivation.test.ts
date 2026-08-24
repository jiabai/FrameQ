import { type Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, test } from "vitest";
import { ActivationCodeService } from "../src/activation.js";
import { PrismaStore } from "../src/prismaStore.js";
import { sha256 } from "../src/security.js";
import {
  createTemporaryPrismaClient,
  prismaWithInjectedWriteFailure,
  prismaWithOneInjectedTransactionConflict,
} from "./prismaTestHarness.js";

const now = new Date("2026-08-24T08:00:00.000Z");
const sessionExpiresAt = new Date("2026-12-24T08:00:00.000Z");
const redeemBy = new Date("2026-09-23T08:00:00.000Z");
const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

function createBarrier(parties: number): {
  waitAtTransactionStart: () => Promise<void>;
  allArrived: Promise<void>;
  release: () => void;
  arrivals: () => number;
} {
  let arrivals = 0;
  let signalAllArrived = () => {};
  let release = () => {};
  const allArrived = new Promise<void>((resolve) => {
    signalAllArrived = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    waitAtTransactionStart: async () => {
      arrivals += 1;
      if (arrivals === parties) {
        signalAllArrived();
      }
      await released;
    },
    allArrived,
    release,
    arrivals: () => arrivals,
  };
}

async function waitForBarrierArrivals(barrier: ReturnType<typeof createBarrier>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      barrier.allArrived,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`self-service activation gate reached by ${barrier.arrivals()} clients`)),
          5000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function prismaWithTransactionGate(
  prisma: PrismaClient,
  waitAtTransactionStart: () => Promise<void>,
): PrismaClient {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "$transaction" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        await waitAtTransactionStart();
        return Reflect.apply(value, target, args);
      };
    },
  }) as PrismaClient;
}

async function createSessionFixture(email = "self-service@example.com") {
  const fixture = await createTemporaryPrismaClient();
  fixtures.push(fixture);
  const store = new PrismaStore(fixture.prisma);
  const user = await store.upsertUserByEmail(email, now);
  const session = await store.createSession({
    userId: user.id,
    tokenHash: `session-${email}`,
    createdAt: now,
    expiresAt: sessionExpiresAt,
  });
  return { fixture, store, user, session };
}

describe("PrismaStore self-service activation lifecycle", () => {
  test("prepares a pending self-service code without persisting plaintext", async () => {
    const { fixture, store, user, session } = await createSessionFixture();

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
    const stored = await fixture.prisma.activationCode.findUnique({
      where: { id: prepared.status === "prepared" ? prepared.activationCodeId : "" },
    });
    expect(stored).toMatchObject({
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
    expect(Object.keys(stored ?? {})).not.toContain("code");
    await expect(
      fixture.prisma.authRateLimit.findMany({ orderBy: { scope: "asc" } }),
    ).resolves.toMatchObject([
      { purpose: "self_service_activation", count: 1, scope: "email_hour" },
      { purpose: "self_service_activation", count: 1, scope: "email_minute" },
      { purpose: "self_service_activation", count: 1, scope: "ip_hour" },
    ]);
  });

  test("rate-limited prepare leaves no extra code behind", async () => {
    const { fixture, store, session } = await createSessionFixture("rate-limited@example.com");

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
    expect(await fixture.prisma.activationCode.count()).toBe(1);
    expect(
      await fixture.prisma.activationCode.count({ where: { codePrefix: "FQ-RAT2" } }),
    ).toBe(0);
  });

  test("rejects prepare when the session already has an active entitlement", async () => {
    const { fixture, store, user, session } = await createSessionFixture("active-entitlement@example.com");
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
    expect(await fixture.prisma.activationCode.count()).toBe(0);
    expect(await fixture.prisma.authRateLimit.count()).toBe(0);
  });

  test("disables only pending codes and stays idempotent", async () => {
    const { fixture, store, user, session } = await createSessionFixture("delivery@example.com");
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
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-PEND-FAIL-CODE-0001"),
      codePrefix: "FQ-PEND",
      ip: "203.0.113.54",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    const disabled = await store.disablePreparedSelfServiceActivationCode({
      activationCodeId: prepared.status === "prepared" ? prepared.activationCodeId : "",
      now,
      reason: "delivery_failed",
    });

    expect(disabled).toMatchObject({
      id: prepared.status === "prepared" ? prepared.activationCodeId : "",
      status: "disabled",
      disabledReason: "delivery_failed",
      sentAt: null,
    });
    expect(await fixture.prisma.activationCode.findUnique({ where: { id: active.id } })).toMatchObject({
      status: "active",
      disabledReason: null,
    });
    await expect(
      store.disablePreparedSelfServiceActivationCode({
        activationCodeId: prepared.status === "prepared" ? prepared.activationCodeId : "",
        now,
        reason: "delivery_failed",
      }),
    ).resolves.toBeNull();
  });

  test("activates a prepared code and supersedes the older active self-service code", async () => {
    const { fixture, store, user, session } = await createSessionFixture("activate@example.com");
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

    await expect(
      store.activatePreparedSelfServiceActivationCode({
        activationCodeId: prepared.status === "prepared" ? prepared.activationCodeId : "",
        now,
      }),
    ).resolves.toEqual({ status: "activated" });

    await expect(fixture.prisma.activationCode.findUnique({ where: { id: olderActive.id } })).resolves.toMatchObject({
      status: "disabled",
      disabledReason: "superseded",
    });
    await expect(
      fixture.prisma.activationCode.findUnique({
        where: { id: prepared.status === "prepared" ? prepared.activationCodeId : "" },
      }),
    ).resolves.toMatchObject({
      status: "active",
      sentAt: now,
      issuedToUserId: user.id,
      disabledReason: null,
    });
    expect(
      await fixture.prisma.activationCode.count({
        where: {
          issuanceSource: "self_service_email",
          issuedToUserId: user.id,
          status: "active",
        },
      }),
    ).toBe(1);
  });

  test("disables a prepared code when entitlement becomes active before SMTP completion", async () => {
    const { fixture, store, user, session } = await createSessionFixture("became-active@example.com");
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
        activationCodeId: prepared.status === "prepared" ? prepared.activationCodeId : "",
        now: new Date("2026-08-24T08:01:00.000Z"),
      }),
    ).resolves.toEqual({ status: "entitlement_active" });
    await expect(
      fixture.prisma.activationCode.findUnique({
        where: { id: prepared.status === "prepared" ? prepared.activationCodeId : "" },
      }),
    ).resolves.toMatchObject({
      status: "disabled",
      disabledReason: "activation_became_active",
      sentAt: null,
    });
  });

  test("permits only one concurrent activation of the same prepared self-service code", async () => {
    const { fixture, store, session, user } = await createSessionFixture("concurrent-self-service@example.com");
    const secondStore = new PrismaStore(await fixture.createClient());
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-CNCR-ACTV-0001"),
      codePrefix: "FQ-CNCR",
      ip: "203.0.113.63",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    const activationCodeId = prepared.status === "prepared" ? prepared.activationCodeId : "";

    const results = await Promise.all([
      store.activatePreparedSelfServiceActivationCode({ activationCodeId, now }),
      secondStore.activatePreparedSelfServiceActivationCode({ activationCodeId, now }),
    ]);

    expect(results).toEqual(expect.arrayContaining([{ status: "activated" }, { status: "invalid" }]));
    expect(
      await fixture.prisma.activationCode.count({
        where: {
          issuanceSource: "self_service_email",
          issuedToUserId: user.id,
          status: "active",
        },
      }),
    ).toBe(1);
  });

  test("prevents two concurrent pending codes for one user from both becoming active", async () => {
    const { fixture, store, user } = await createSessionFixture("concurrent-two-pending@example.com");
    const secondClient = await fixture.createClient();
    const barrier = createBarrier(2);
    const firstStore = new PrismaStore(
      prismaWithTransactionGate(fixture.prisma, barrier.waitAtTransactionStart),
    );
    const secondStore = new PrismaStore(
      prismaWithTransactionGate(secondClient, barrier.waitAtTransactionStart),
    );

    const firstPending = await store.createActivationCode({
      codeHash: sha256("FQ-TWO-PENDING-0001"),
      codePrefix: "FQ-TP01",
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
    const secondPending = await store.createActivationCode({
      codeHash: sha256("FQ-TWO-PENDING-0002"),
      codePrefix: "FQ-TP02",
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

    const pendingResults = Promise.allSettled([
      firstStore.activatePreparedSelfServiceActivationCode({ activationCodeId: firstPending.id, now }),
      secondStore.activatePreparedSelfServiceActivationCode({ activationCodeId: secondPending.id, now }),
    ]);

    await waitForBarrierArrivals(barrier);
    barrier.release();
    const results = await pendingResults;

    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.status === "activated",
      ),
    ).toHaveLength(1);
    expect(
      results.every(
        (result) =>
          result.status === "fulfilled" &&
          (result.value.status === "activated" ||
            result.value.status === "invalid" ||
            result.value.status === "temporarily_unavailable"),
      ),
    ).toBe(true);
    expect(
      await fixture.prisma.activationCode.count({
        where: {
          issuanceSource: "self_service_email",
          issuedToUserId: user.id,
          status: "active",
        },
      }),
    ).toBeLessThanOrEqual(1);
  });

  test("rejects pending, mismatched, expired, and already-entitled self-service redemption", async () => {
    const { fixture, store, user, session } = await createSessionFixture("guardrails@example.com");
    const otherUser = await store.upsertUserByEmail("other@example.com", now);
    const otherSession = await store.createSession({
      userId: otherUser.id,
      tokenHash: "other-session",
      createdAt: now,
      expiresAt: sessionExpiresAt,
    });
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-GUARD-SELF-0001"),
      codePrefix: "FQ-GUAR",
      ip: "203.0.113.56",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    const activationCodeId = prepared.status === "prepared" ? prepared.activationCodeId : "";
    const pending = await fixture.prisma.activationCode.findUnique({ where: { id: activationCodeId } });

    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: pending?.codeHash ?? "",
        now,
        llmQuotaPerActivation: 20,
      }),
    ).resolves.toEqual({ status: "code_invalid" });

    await store.activatePreparedSelfServiceActivationCode({ activationCodeId, now: new Date("2026-08-24T08:01:00.000Z") });
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
    await expect(fixture.prisma.activationCode.findUnique({ where: { id: activationCodeId } })).resolves.toMatchObject({
      status: "active",
      redeemedAt: null,
      redeemedByUserId: null,
    });

    const expiredUser = await store.upsertUserByEmail("expired@example.com", now);
    const expiredSession = await store.createSession({
      userId: expiredUser.id,
      tokenHash: "expired-session",
      createdAt: now,
      expiresAt: sessionExpiresAt,
    });
    const expiredCode = await store.createActivationCode({
      codeHash: sha256("FQ-EXPR-SELF-0001"),
      codePrefix: "FQ-EXPR",
      status: "active",
      issuanceSource: "self_service_email",
      entitlementDays: 31,
      issuedToUserId: expiredUser.id,
      redeemBy: new Date("2026-08-23T08:00:00.000Z"),
      createdAt: now,
      sentAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    const redeemExpiredAt = new Date("2026-08-31T08:00:00.000Z");
    await store.upsertEntitlement(expiredUser.id, new Date("2026-08-24T08:00:00.000Z"), redeemExpiredAt, {
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });
    await expect(
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: expiredSession.tokenHash,
        codeHash: expiredCode.codeHash,
        now: redeemExpiredAt,
        llmQuotaPerActivation: 20,
      }),
    ).resolves.toEqual({ status: "code_invalid" });
    await expect(fixture.prisma.activationCode.findUnique({ where: { id: expiredCode.id } })).resolves.toMatchObject({
      status: "expired",
      redeemedAt: null,
    });
  });

  test("redeems repeated self-service cycles with fixed quota resets after expiry", async () => {
    const { store, user, session } = await createSessionFixture("repeatable@example.com");
    const runCycle = async (index: number, prepareAt: Date) => {
      const prepared = await store.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256(`FQ-REPEAT-CYCLE-000${index}`),
        codePrefix: `FQ-REP${index}`,
        ip: "203.0.113.59",
        now: prepareAt,
        redeemBy: new Date(prepareAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        entitlementDays: 31,
      });
      await store.activatePreparedSelfServiceActivationCode({
        activationCodeId: prepared.status === "prepared" ? prepared.activationCodeId : "",
        now: new Date(prepareAt.getTime() + 60 * 1000),
      });
      return store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256(`FQ-REPEAT-CYCLE-000${index}`),
        now: new Date(prepareAt.getTime() + 120 * 1000),
        llmQuotaPerActivation: 999,
      });
    };

    await expect(runCycle(1, now)).resolves.toMatchObject({
      status: "redeemed",
      entitlement: { userId: user.id, llmQuotaLimit: 20, llmQuotaUsed: 0 },
    });
    await expect(runCycle(2, new Date("2026-09-25T08:00:00.000Z"))).resolves.toMatchObject({
      status: "redeemed",
      entitlement: { llmQuotaLimit: 20, llmQuotaUsed: 0 },
    });
    await expect(runCycle(3, new Date("2026-10-27T08:00:00.000Z"))).resolves.toMatchObject({
      status: "redeemed",
      entitlement: {
        userId: user.id,
        llmQuotaLimit: 20,
        llmQuotaUsed: 0,
        expiresAt: new Date("2026-11-27T08:02:00.000Z"),
      },
    });
  });

  test("permits only one concurrent redemption of the same self-service code", async () => {
    const { fixture, store, session, user } = await createSessionFixture("concurrent-redeem@example.com");
    const secondStore = new PrismaStore(await fixture.createClient());
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-CONCURRENT-REDEEM-01"),
      codePrefix: "FQ-CONR",
      ip: "203.0.113.77",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    const codeHash = sha256("FQ-CONCURRENT-REDEEM-01");
    await store.activatePreparedSelfServiceActivationCode({
      activationCodeId: prepared.status === "prepared" ? prepared.activationCodeId : "",
      now,
    });

    const results = await Promise.allSettled([
      store.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash,
        now,
        llmQuotaPerActivation: 20,
      }),
      secondStore.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash,
        now,
        llmQuotaPerActivation: 20,
      }),
    ]);

    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.status === "redeemed",
      ),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.status === "code_invalid",
      ),
    ).toHaveLength(1);
    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });
  });

  test("keeps admin activation redemption semantics unchanged", async () => {
    const { store, user, session } = await createSessionFixture("admin-regression@example.com");
    await store.upsertEntitlement(user.id, new Date("2026-09-05T08:00:00.000Z"), now, {
      llmQuotaLimit: 7,
      llmQuotaUsed: 3,
    });
    const activation = new ActivationCodeService({ store, now: () => now });
    const code = await activation.generateCode();

    await expect(
      activation.redeemCode({ sessionTokenHash: session.tokenHash, code: code.code }),
    ).resolves.toEqual({ entitlementExpiresAt: new Date("2026-10-06T08:00:00.000Z") });
    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      expiresAt: new Date("2026-10-06T08:00:00.000Z"),
      llmQuotaLimit: 27,
      llmQuotaUsed: 3,
    });
  });

  test("rolls back reservations when code creation fails inside prepare", async () => {
    const { fixture, session } = await createSessionFixture("prepare-rollback@example.com");
    const failingStore = new PrismaStore(
      prismaWithInjectedWriteFailure(fixture.prisma, {
        model: "activationCode",
        methods: ["create"],
        message: "injected Prisma self-service code create failure",
      }),
    );
    const verifiedStore = new PrismaStore(fixture.prisma);

    await expect(
      failingStore.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-PREP-ROLL-BACK-0001"),
        codePrefix: "FQ-PREP",
        ip: "203.0.113.61",
        now,
        redeemBy,
        entitlementDays: 31,
      }),
    ).rejects.toThrow("injected Prisma self-service code create failure");

    expect(await fixture.prisma.activationCode.count()).toBe(0);
    expect(await fixture.prisma.authRateLimit.count()).toBe(0);
    await expect(
      verifiedStore.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-PREP-ROLL-BACK-0002"),
        codePrefix: "FQ-PREP",
        ip: "203.0.113.61",
        now,
        redeemBy,
        entitlementDays: 31,
      }),
    ).resolves.toMatchObject({
      status: "prepared",
      retryAt: new Date("2026-08-24T08:01:00.000Z"),
    });
  });

  test("rolls back redemption when entitlement grant fails", async () => {
    const { fixture, store, user, session } = await createSessionFixture("redeem-rollback@example.com");
    const prepared = await store.prepareSelfServiceActivationCode({
      sessionTokenHash: session.tokenHash,
      codeHash: sha256("FQ-REDM-ROLL-BACK-0001"),
      codePrefix: "FQ-ROLL",
      ip: "203.0.113.62",
      now,
      redeemBy,
      entitlementDays: 31,
    });
    await store.activatePreparedSelfServiceActivationCode({
      activationCodeId: prepared.status === "prepared" ? prepared.activationCodeId : "",
      now,
    });
    const failingStore = new PrismaStore(
      prismaWithInjectedWriteFailure(fixture.prisma, {
        model: "entitlement",
        methods: ["upsert"],
        message: "injected Prisma self-service entitlement failure",
      }),
    );

    await expect(
      failingStore.redeemActivationCodeAndGrantEntitlement({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-REDM-ROLL-BACK-0001"),
        now,
        llmQuotaPerActivation: 20,
      }),
    ).rejects.toThrow("injected Prisma self-service entitlement failure");

    await expect(
      fixture.prisma.activationCode.findUnique({
        where: { id: prepared.status === "prepared" ? prepared.activationCodeId : "" },
      }),
    ).resolves.toMatchObject({
      status: "active",
      redeemedAt: null,
      redeemedByUserId: null,
    });
    expect(await store.getEntitlement(user.id)).toBeNull();
  });

  test("retries one recognized transaction conflict during prepare", async () => {
    const { fixture, session } = await createSessionFixture("prepare-retry@example.com");
    const retryingStore = new PrismaStore(prismaWithOneInjectedTransactionConflict(fixture.prisma));

    await expect(
      retryingStore.prepareSelfServiceActivationCode({
        sessionTokenHash: session.tokenHash,
        codeHash: sha256("FQ-PREP-RETRY-0001"),
        codePrefix: "FQ-PRTY",
        ip: "203.0.113.89",
        now,
        redeemBy,
        entitlementDays: 31,
      }),
    ).resolves.toMatchObject({
      status: "prepared",
      retryAt: new Date("2026-08-24T08:01:00.000Z"),
    });
    expect(await fixture.prisma.activationCode.count()).toBe(1);
  });
});
