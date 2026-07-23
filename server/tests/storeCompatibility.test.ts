import { describe, expect, test } from "vitest";
import { PrismaStore } from "../src/prismaStore.js";
import { MemoryStore as DefiningMemoryStore } from "../src/store/memory.js";
import { MemoryStore as PublicMemoryStore, type Store } from "../src/store.js";

const storeMethods = [
  "upsertUserByEmail",
  "getUserById",
  "issueEmailOtp",
  "invalidateIssuedOtpAfterDeliveryFailure",
  "verifyDesktopOtpAndCreateTicket",
  "verifyAdminOtpAndCreateSession",
  "exchangeDesktopTicketAndCreateSession",
  "createSession",
  "findSessionByTokenHash",
  "revokeSession",
  "createOrder",
  "findOrderByOutTradeNo",
  "markOrderPaid",
  "settlePaidOrder",
  "getEntitlement",
  "upsertEntitlement",
  "consumeLlmQuota",
  "getLlmConfig",
  "upsertLlmConfig",
  "createActivationCode",
  "findActivationCodeByHash",
  "markActivationCodeRedeemed",
  "redeemActivationCodeAndGrantEntitlement",
  "listActivationCodes",
  "listUsers",
  "createAdminSession",
  "findAdminSessionByTokenHash",
  "revokeAdminSession",
  "createAdminEntitlementAdjustment",
  "applyEntitlementAdjustmentWithAudit",
  "listAdminEntitlementAdjustments",
  "createWebhookEvent",
] as const satisfies readonly (keyof Store)[];

const compatibilityMethods = [
  "createEmailOtp",
  "findLatestUsableOtp",
  "incrementOtpAttempts",
  "consumeOtp",
  "createDesktopLoginTicket",
  "consumeDesktopLoginTicket",
] as const;

const arrayFixtureFields = [
  "users",
  "emailOtps",
  "desktopLoginTickets",
  "sessions",
  "orders",
  "entitlements",
  "llmUsageEvents",
  "activationCodes",
  "adminSessions",
  "adminEntitlementAdjustments",
  "webhookEvents",
  "authRateLimits",
] as const;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Value extends true> = Value;
type StoreMethodSetIsExact = Assert<
  Equal<keyof Store, (typeof storeMethods)[number]>
>;

const storeMethodSetIsExact: StoreMethodSetIsExact = true;
const now = new Date("2026-07-23T08:00:00.000Z");

describe("Store adapter compatibility surface", () => {
  test("keeps the exact official method set and both class compatibility surfaces", () => {
    expect(storeMethodSetIsExact).toBe(true);
    const expectedMethods = [...storeMethods, ...compatibilityMethods];

    expect(PublicMemoryStore).toBe(DefiningMemoryStore);

    for (const storeClass of [PublicMemoryStore, PrismaStore]) {
      const prototypeMethods = Object.getOwnPropertyNames(storeClass.prototype);
      for (const method of expectedMethods) {
        expect(prototypeMethods, `${storeClass.name}.${method}`).toContain(method);
      }
    }
  });

  test("keeps the public MemoryStore fixture fields", () => {
    const store = new PublicMemoryStore();

    for (const field of arrayFixtureFields) {
      expect(Array.isArray(store[field]), field).toBe(true);
    }
    expect(store.llmConfig).toBeNull();
  });

  test("keeps mutable record identity and established list ordering", async () => {
    const store = new PublicMemoryStore();
    const later = new Date(now.getTime() + 1000);

    const zulu = await store.upsertUserByEmail("zulu@example.com", now);
    const alpha = await store.upsertUserByEmail("alpha@example.com", later);
    expect(await store.getUserById(zulu.id)).toBe(zulu);
    expect(await store.listUsers()).toEqual([alpha, zulu]);

    const order = await store.createOrder({
      userId: alpha.id,
      outTradeNo: "compatibility-order",
      amountFen: 990,
      status: "pending",
      codeUrl: "weixin://compatibility-order",
      expiresAt: new Date(later.getTime() + 30 * 60 * 1000),
      createdAt: later,
      providerPayload: "{}",
    });
    expect(await store.findOrderByOutTradeNo(order.outTradeNo)).toBe(order);

    const entitlement = await store.upsertEntitlement(
      alpha.id,
      new Date(later.getTime() + 31 * 24 * 60 * 60 * 1000),
      later,
    );
    expect(await store.getEntitlement(alpha.id)).toBe(entitlement);

    const olderCode = await store.createActivationCode({
      codeHash: "older-code-hash",
      codePrefix: "FQ-OLD",
      status: "active",
      entitlementDays: 31,
      redeemBy: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      createdAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
    });
    const newerCode = await store.createActivationCode({
      codeHash: "newer-code-hash",
      codePrefix: "FQ-NEW",
      status: "active",
      entitlementDays: 31,
      redeemBy: new Date(later.getTime() + 30 * 24 * 60 * 60 * 1000),
      createdAt: later,
      redeemedAt: null,
      redeemedByUserId: null,
    });
    expect(await store.listActivationCodes()).toEqual([newerCode, olderCode]);
  });
});
