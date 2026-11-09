import { afterEach, describe, expect, test } from "vitest";
import { ActivationCodeService } from "../src/activation.js";
import { PrismaStore } from "../src/prismaStore.js";
import { sha256 } from "../src/security.js";
import { buildServer } from "../src/server.js";
import { createTemporaryPrismaClient, prismaWithInjectedWriteFailure } from "./prismaTestHarness.js";

const now = new Date("2026-07-10T08:00:00.000Z");

const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});



describe("PrismaStore transactional entitlement boundaries", () => {




  test("rolls back activation redemption when the transactional entitlement write fails", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const verifiedStore = new PrismaStore(fixture.prisma);
    const user = await verifiedStore.upsertUserByEmail("prisma-activation@example.com", now);
    const session = await verifiedStore.createSession({
      userId: user.id,
      tokenHash: "prisma-activation-session",
      createdAt: now,
      expiresAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    const normalActivation = new ActivationCodeService({ store: verifiedStore, now: () => now });
    const code = await normalActivation.generateCode();
    const failingStore = new PrismaStore(
      prismaWithInjectedWriteFailure(fixture.prisma, {
        model: "entitlement",
        methods: ["upsert"],
        message: "injected Prisma entitlement write failure",
      }),
    );

    await expect(
      new ActivationCodeService({ store: failingStore, now: () => now }).redeemCode({
        sessionTokenHash: session.tokenHash,
        code: code.code,
      }),
    ).rejects.toThrow("injected Prisma entitlement write failure");

    await expect(verifiedStore.findActivationCodeByHash(sha256(code.code))).resolves.toMatchObject({
      status: "active",
      redeemedAt: null,
      redeemedByUserId: null,
    });
    expect(await verifiedStore.getEntitlement(user.id)).toBeNull();
  });

  test("rolls back administrator compensation when the required Prisma audit write fails", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const verifiedStore = new PrismaStore(fixture.prisma);
    const user = await verifiedStore.upsertUserByEmail("prisma-compensation@example.com", now);
    const adminToken = "prisma-admin-token";
    const csrfToken = "prisma-admin-csrf";
    await verifiedStore.createAdminSession({
      email: "lantianye@163.com",
      tokenHash: sha256(adminToken),
      csrfTokenHash: sha256(csrfToken),
      createdAt: now,
      expiresAt: new Date("2026-07-10T20:00:00.000Z"),
    });
    const failingStore = new PrismaStore(
      prismaWithInjectedWriteFailure(fixture.prisma, {
        model: "adminEntitlementAdjustment",
        methods: ["create"],
        message: "injected Prisma audit write failure",
      }),
    );
    const app = buildServer({
      store: failingStore,
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
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(await verifiedStore.getEntitlement(user.id)).toBeNull();
    expect(await fixture.prisma.adminEntitlementAdjustment.count()).toBe(0);
  });



  test("permits only one concurrent real SQLite activation redemption", async () => {
    const fixture = await createTemporaryPrismaClient();
    fixtures.push(fixture);
    const store = new PrismaStore(fixture.prisma);
    const user = await store.upsertUserByEmail("prisma-concurrent-activation@example.com", now);
    const session = await store.createSession({
      userId: user.id,
      tokenHash: "prisma-concurrent-activation-session",
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
    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });
  });
});
