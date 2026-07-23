import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, test } from "vitest";
import { AdminAuthService } from "../src/adminAuth.js";
import { AuthService } from "../src/auth.js";
import { PrismaStore } from "../src/prismaStore.js";
import type { EmailOtpRecord } from "../src/store.js";
import {
  createTemporaryPrismaClient,
  prismaWithInjectedWriteFailure,
  prismaWithOneInjectedTransactionConflict,
} from "./prismaTestHarness.js";

const now = new Date("2026-07-22T08:00:00.000Z");
const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

function createBarrier(parties: number): () => Promise<void> {
  let arrivals = 0;
  let release = () => {};
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === parties) {
      release();
    }
    await reached;
  };
}

function prismaWithTransactionFailures(
  prisma: PrismaClient,
  createError: () => Error,
): { prisma: PrismaClient; attempts: () => number } {
  let attempts = 0;
  return {
    prisma: new Proxy(prisma, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "$transaction" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async () => {
          attempts += 1;
          throw createError();
        };
      },
    }),
    attempts: () => attempts,
  };
}

class OtpReadBarrierPrismaStore extends PrismaStore {
  constructor(prisma: PrismaClient, private readonly waitAtRead: () => Promise<void>) {
    super(prisma);
  }

  override async findLatestUsableOtp(email: string, state: string, at: Date): Promise<EmailOtpRecord | null> {
    const otp = await super.findLatestUsableOtp(email, state, at);
    await this.waitAtRead();
    return otp;
  }
}

describe("PrismaStore authentication and quota concurrency boundaries", () => {
  test("isolates OTP purpose and replacement scope in Prisma", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const store = new PrismaStore(fixture.prisma);
    const shared = {
      email: "prisma-purpose@example.com",
      state: "prisma-purpose-state",
      ip: "203.0.113.60",
      expiresAt: new Date(now.getTime() + 20 * 60 * 1000),
      createdAt: now,
    };
    await expect(store.issueEmailOtp({
      ...shared,
      purpose: "desktop_login",
      codeHash: "desktop-code-hash",
    })).resolves.toMatchObject({ status: "issued" });
    await expect(store.issueEmailOtp({
      ...shared,
      purpose: "admin_login",
      codeHash: "admin-code-hash",
    })).resolves.toMatchObject({ status: "issued" });
    const replacementAt = new Date(now.getTime() + 61 * 1000);
    await expect(store.issueEmailOtp({
      ...shared,
      purpose: "desktop_login",
      codeHash: "desktop-replacement-hash",
      createdAt: replacementAt,
      expiresAt: new Date(replacementAt.getTime() + 20 * 60 * 1000),
    })).resolves.toMatchObject({ status: "issued" });

    const desktopRows = await fixture.prisma.emailOtp.findMany({
      where: { purpose: "desktop_login", email: shared.email, state: shared.state },
      orderBy: { createdAt: "asc" },
    });
    expect(desktopRows).toHaveLength(2);
    expect(desktopRows[0]?.consumedAt).toEqual(replacementAt);
    expect(desktopRows[1]?.consumedAt).toBeNull();
    await expect(fixture.prisma.emailOtp.findFirst({
      where: { purpose: "admin_login", email: shared.email, state: shared.state },
    })).resolves.toMatchObject({ consumedAt: null, codeHash: "admin-code-hash" });
  });

  test("atomically reserves overlapping Prisma dispatch limits", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const secondClient = await fixture.createClient();
    const firstStore = new PrismaStore(fixture.prisma);
    const secondStore = new PrismaStore(secondClient);
    const input = {
      purpose: "desktop_login" as const,
      email: "prisma-rate@example.com",
      state: "prisma-rate-state",
      codeHash: "prisma-rate-code-hash",
      ip: "203.0.113.61",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      createdAt: now,
    };

    const results = await Promise.all([
      firstStore.issueEmailOtp(input),
      secondStore.issueEmailOtp({ ...input, codeHash: "prisma-rate-second-hash" }),
    ]);

    expect(results.filter((result) => result.status === "issued")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rate_limited")).toHaveLength(1);
    expect(await fixture.prisma.emailOtp.count({ where: { email: input.email } })).toBe(1);
    const counters = await fixture.prisma.authRateLimit.findMany({ orderBy: { scope: "asc" } });
    expect(counters).toHaveLength(3);
    expect(counters.every((counter) => counter.count === 1)).toBe(true);
  });

  test("bounds a Prisma correct/wrong fifth-attempt race and creates at most one artifact", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const secondClient = await fixture.createClient();
    const firstStore = new PrismaStore(fixture.prisma);
    const secondStore = new PrismaStore(secondClient);
    await firstStore.issueEmailOtp({
      purpose: "desktop_login",
      email: "prisma-attempt@example.com",
      state: "prisma-attempt-state",
      codeHash: "correct-code-hash",
      ip: "203.0.113.62",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      createdAt: now,
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await firstStore.verifyDesktopOtpAndCreateTicket({
        email: "prisma-attempt@example.com",
        state: "prisma-attempt-state",
        codeHash: "wrong-code-hash",
        ticketHash: `early-ticket-${attempt}`,
        now,
        ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      });
    }

    const results = await Promise.all([
      firstStore.verifyDesktopOtpAndCreateTicket({
        email: "prisma-attempt@example.com",
        state: "prisma-attempt-state",
        codeHash: "wrong-code-hash",
        ticketHash: "final-wrong-ticket",
        now,
        ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      }),
      secondStore.verifyDesktopOtpAndCreateTicket({
        email: "prisma-attempt@example.com",
        state: "prisma-attempt-state",
        codeHash: "correct-code-hash",
        ticketHash: "final-correct-ticket",
        now,
        ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      }),
    ]);

    expect(results.every((result) => result.status !== "temporarily_unavailable")).toBe(true);
    await expect(fixture.prisma.emailOtp.findFirst()).resolves.toMatchObject({ attempts: 5 });
    expect(await fixture.prisma.desktopLoginTicket.count()).toBeLessThanOrEqual(1);
  });

  test("rolls back Prisma OTP consumption when ticket insertion fails", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const setupStore = new PrismaStore(fixture.prisma);
    await setupStore.issueEmailOtp({
      purpose: "desktop_login",
      email: "prisma-otp-rollback@example.com",
      state: "prisma-otp-rollback-state",
      codeHash: "prisma-otp-rollback-code",
      ip: "203.0.113.63",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      createdAt: now,
    });
    const failingStore = new PrismaStore(
      prismaWithInjectedWriteFailure(fixture.prisma, {
        model: "desktopLoginTicket",
        methods: ["create"],
        message: "injected Prisma ticket write failure",
      }),
    );

    await expect(failingStore.verifyDesktopOtpAndCreateTicket({
      email: "prisma-otp-rollback@example.com",
      state: "prisma-otp-rollback-state",
      codeHash: "prisma-otp-rollback-code",
      ticketHash: "prisma-failed-ticket",
      now,
      ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    })).rejects.toThrow("injected Prisma ticket write failure");
    await expect(setupStore.verifyDesktopOtpAndCreateTicket({
      email: "prisma-otp-rollback@example.com",
      state: "prisma-otp-rollback-state",
      codeHash: "prisma-otp-rollback-code",
      ticketHash: "prisma-retry-ticket",
      now,
      ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    })).resolves.toMatchObject({ status: "verified" });
    await expect(fixture.prisma.emailOtp.findFirst()).resolves.toMatchObject({ attempts: 1 });
    expect(await fixture.prisma.desktopLoginTicket.count()).toBe(1);
  });

  test("one desktop OTP creates at most one ticket across independent clients", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const secondClient = await fixture.createClient();
    const setupStore = new PrismaStore(fixture.prisma);
    let code = "";
    const setupAuth = new AuthService({
      store: setupStore,
      now: () => now,
      sendOtp: async (_email, value) => {
        code = value;
      },
    });
    await setupAuth.startEmailLogin({
      email: "prisma-desktop@example.com",
      state: "prisma-desktop-state",
      ip: "203.0.113.20",
    });
    const barrier = createBarrier(2);
    const firstAuth = new AuthService({
      store: new OtpReadBarrierPrismaStore(fixture.prisma, barrier),
      now: () => now,
      sendOtp: async () => {},
    });
    const secondAuth = new AuthService({
      store: new OtpReadBarrierPrismaStore(secondClient, barrier),
      now: () => now,
      sendOtp: async () => {},
    });

    const results = await Promise.allSettled([
      firstAuth.verifyEmailCode({
        email: "prisma-desktop@example.com",
        state: "prisma-desktop-state",
        code,
      }),
      secondAuth.verifyEmailCode({
        email: "prisma-desktop@example.com",
        state: "prisma-desktop-state",
        code,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await fixture.prisma.desktopLoginTicket.count()).toBe(1);
    await expect(fixture.prisma.emailOtp.findFirst()).resolves.toMatchObject({ attempts: 1 });
  });

  test("one admin OTP creates at most one session across independent clients", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const secondClient = await fixture.createClient();
    const setupStore = new PrismaStore(fixture.prisma);
    let code = "";
    const setupAuth = new AdminAuthService({
      store: setupStore,
      adminEmail: "prisma-admin@example.com",
      now: () => now,
      sendOtp: async (_email, value) => {
        code = value;
      },
    });
    await setupAuth.startEmailLogin({
      email: "prisma-admin@example.com",
      state: "prisma-admin-state",
      ip: "203.0.113.21",
    });
    const barrier = createBarrier(2);
    const firstAuth = new AdminAuthService({
      store: new OtpReadBarrierPrismaStore(fixture.prisma, barrier),
      adminEmail: "prisma-admin@example.com",
      now: () => now,
      sendOtp: async () => {},
    });
    const secondAuth = new AdminAuthService({
      store: new OtpReadBarrierPrismaStore(secondClient, barrier),
      adminEmail: "prisma-admin@example.com",
      now: () => now,
      sendOtp: async () => {},
    });

    const results = await Promise.allSettled([
      firstAuth.verifyEmailCode({ email: "prisma-admin@example.com", state: "prisma-admin-state", code }),
      secondAuth.verifyEmailCode({ email: "prisma-admin@example.com", state: "prisma-admin-state", code }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await fixture.prisma.adminSession.count()).toBe(1);
    await expect(fixture.prisma.emailOtp.findFirst()).resolves.toMatchObject({ attempts: 1 });
  });

  test("a Prisma session write failure leaves the desktop ticket usable for retry", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const setupStore = new PrismaStore(fixture.prisma);
    let code = "";
    const setupAuth = new AuthService({
      store: setupStore,
      now: () => now,
      sendOtp: async (_email, value) => {
        code = value;
      },
    });
    await setupAuth.startEmailLogin({
      email: "prisma-ticket@example.com",
      state: "prisma-ticket-state",
      ip: "203.0.113.22",
    });
    const verified = await setupAuth.verifyEmailCode({
      email: "prisma-ticket@example.com",
      state: "prisma-ticket-state",
      code,
    });
    const failingStore = new PrismaStore(
      prismaWithInjectedWriteFailure(fixture.prisma, {
        model: "session",
        methods: ["create"],
        message: "injected Prisma session write failure",
      }),
    );
    const failingAuth = new AuthService({ store: failingStore, now: () => now, sendOtp: async () => {} });

    await expect(
      failingAuth.exchangeDesktopTicket({ ticket: verified.ticket, state: "prisma-ticket-state" }),
    ).rejects.toThrow("injected Prisma session write failure");
    await expect(
      setupAuth.exchangeDesktopTicket({ ticket: verified.ticket, state: "prisma-ticket-state" }),
    ).resolves.toMatchObject({ email: "prisma-ticket@example.com" });
    expect(await fixture.prisma.session.count()).toBe(1);
  });

  test("distinct request IDs settle without overspending the final Credit", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const secondClient = await fixture.createClient();
    const firstStore = new PrismaStore(fixture.prisma);
    const secondStore = new PrismaStore(secondClient);
    const user = await firstStore.upsertUserByEmail("quota-race@example.com", now);
    await firstStore.upsertEntitlement(
      user.id,
      new Date("2026-08-22T08:00:00.000Z"),
      now,
      { llmQuotaLimit: 1, llmQuotaUsed: 0 },
    );

    const results = await Promise.allSettled([
      firstStore.consumeLlmQuota(user.id, "quota-race-a", now),
      secondStore.consumeLlmQuota(user.id, "quota-race-b", now),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.status === "consumed",
      ),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.status === "unavailable",
      ),
    ).toHaveLength(1);
    await expect(firstStore.getEntitlement(user.id)).resolves.toMatchObject({
      llmQuotaLimit: 1,
      llmQuotaUsed: 1,
    });
    expect(await fixture.prisma.llmUsageEvent.count({ where: { userId: user.id } })).toBe(1);
  });

  test("identical concurrent request IDs consume one Credit and settle as reused", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const secondClient = await fixture.createClient();
    const firstStore = new PrismaStore(fixture.prisma);
    const secondStore = new PrismaStore(secondClient);
    const user = await firstStore.upsertUserByEmail("quota-idempotent@example.com", now);
    await firstStore.upsertEntitlement(
      user.id,
      new Date("2026-08-22T08:00:00.000Z"),
      now,
      { llmQuotaLimit: 2, llmQuotaUsed: 0 },
    );

    const results = await Promise.all([
      firstStore.consumeLlmQuota(user.id, "quota-idempotent", now),
      secondStore.consumeLlmQuota(user.id, "quota-idempotent", now),
    ]);

    expect(results.filter((result) => result.status === "consumed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "reused")).toHaveLength(1);
    await expect(firstStore.getEntitlement(user.id)).resolves.toMatchObject({ llmQuotaUsed: 1 });
    expect(await fixture.prisma.llmUsageEvent.count({ where: { userId: user.id } })).toBe(1);
  });

  test("rolls back the conditional quota increment when usage-event insertion fails", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const setupStore = new PrismaStore(fixture.prisma);
    const user = await setupStore.upsertUserByEmail("quota-event-rollback@example.com", now);
    await setupStore.upsertEntitlement(
      user.id,
      new Date("2026-08-22T08:00:00.000Z"),
      now,
      { llmQuotaLimit: 1, llmQuotaUsed: 0 },
    );
    const failingStore = new PrismaStore(
      prismaWithInjectedWriteFailure(fixture.prisma, {
        model: "llmUsageEvent",
        methods: ["create"],
        message: "injected Prisma usage-event write failure",
      }),
    );

    await expect(
      failingStore.consumeLlmQuota(user.id, "quota-event-rollback", now),
    ).rejects.toThrow("injected Prisma usage-event write failure");
    await expect(setupStore.getEntitlement(user.id)).resolves.toMatchObject({ llmQuotaUsed: 0 });
    expect(await fixture.prisma.llmUsageEvent.count({ where: { userId: user.id } })).toBe(0);
    await expect(
      setupStore.consumeLlmQuota(user.id, "quota-event-rollback", now),
    ).resolves.toMatchObject({ status: "consumed", entitlement: { llmQuotaUsed: 1 } });
  });

  test("retries one recognized transaction conflict without double spending", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const setupStore = new PrismaStore(fixture.prisma);
    const user = await setupStore.upsertUserByEmail("quota-retry@example.com", now);
    await setupStore.upsertEntitlement(
      user.id,
      new Date("2026-08-22T08:00:00.000Z"),
      now,
      { llmQuotaLimit: 1, llmQuotaUsed: 0 },
    );
    const retryingStore = new PrismaStore(prismaWithOneInjectedTransactionConflict(fixture.prisma));

    await expect(retryingStore.consumeLlmQuota(user.id, "quota-retry", now)).resolves.toMatchObject({
      status: "consumed",
      entitlement: { llmQuotaUsed: 1 },
    });
    await expect(setupStore.getEntitlement(user.id)).resolves.toMatchObject({ llmQuotaUsed: 1 });
    expect(await fixture.prisma.llmUsageEvent.count({ where: { userId: user.id } })).toBe(1);
  });

  test("bounds recognized conflict retries and returns temporary unavailability", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const setupStore = new PrismaStore(fixture.prisma);
    const user = await setupStore.upsertUserByEmail("quota-retry-exhausted@example.com", now);
    await setupStore.upsertEntitlement(
      user.id,
      new Date("2026-08-22T08:00:00.000Z"),
      now,
      { llmQuotaLimit: 1, llmQuotaUsed: 0 },
    );
    const injected = prismaWithTransactionFailures(
      fixture.prisma,
      () =>
        new Prisma.PrismaClientKnownRequestError("injected transaction conflict", {
          code: "P2034",
          clientVersion: "6.19.3",
        }),
    );

    await expect(
      new PrismaStore(injected.prisma).consumeLlmQuota(user.id, "quota-retry-exhausted", now),
    ).resolves.toEqual({ status: "temporarily_unavailable" });
    expect(injected.attempts()).toBe(3);
    await expect(setupStore.getEntitlement(user.id)).resolves.toMatchObject({ llmQuotaUsed: 0 });
    expect(await fixture.prisma.llmUsageEvent.count({ where: { userId: user.id } })).toBe(0);
  });

  test("does not retry an unknown transaction failure", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const injected = prismaWithTransactionFailures(
      fixture.prisma,
      () => new Error("seeded unknown transaction failure"),
    );

    await expect(
      new PrismaStore(injected.prisma).consumeLlmQuota("missing-user", "quota-unknown-error", now),
    ).rejects.toThrow("seeded unknown transaction failure");
    expect(injected.attempts()).toBe(1);
  });
});
