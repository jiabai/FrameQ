import { describe, expect, test } from "vitest";
import { PrismaStore } from "../src/prismaStore.js";
import { MemoryStore as DefiningMemoryStore } from "../src/store/memory.js";
import {
  MemoryStore as PublicMemoryStore,
  type ActivationCodeDisabledReason,
  type ActivationCodeIssuanceSource,
  type ActivationCodeRecord,
  type ActivationRedemption,
  type EmailDispatchPurpose,
  type EntitlementRecord,
  type OtpPurpose,
  type PrepareSelfServiceActivationCodeResult,
  type Store,
} from "../src/store.js";

const storeMethods = [
  "upsertUserByEmail",
  "getUserById",
  "issueEmailOtp",
  "invalidateIssuedOtpAfterDeliveryFailure",
  "verifyDesktopOtpAndCreateTicket",
  "verifyDesktopOtpAndCreateTicketAndWebSession",
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
  "prepareSelfServiceActivationCode",
  "disablePreparedSelfServiceActivationCode",
  "activatePreparedSelfServiceActivationCode",
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
  "verifyUserOtpAndCreateWebSession",
  "createUserSession",
  "findUserSessionByTokenHash",
  "revokeUserSession",
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
  "userSessions",
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
type EmailDispatchPurposeShape = Assert<
  Equal<EmailDispatchPurpose, "desktop_login" | "admin_login" | "self_service_activation">
>;
type OtpPurposeShape = Assert<Equal<OtpPurpose, "desktop_login" | "admin_login">>;
type ActivationCodeIssuanceSourceShape = Assert<
  Equal<ActivationCodeIssuanceSource, "admin" | "self_service_email">
>;
type ActivationCodeDisabledReasonShape = Assert<
  Equal<
    ActivationCodeDisabledReason,
    "delivery_failed" | "superseded" | "activation_became_active"
  >
>;
type ActivationCodeRecordShape = Assert<
  Equal<
    ActivationCodeRecord,
    {
      id: string;
      codeHash: string;
      codePrefix: string;
      status: "pending_delivery" | "active" | "redeemed" | "expired" | "disabled";
      issuanceSource: ActivationCodeIssuanceSource;
      entitlementDays: number;
      issuedToUserId: string | null;
      redeemBy: Date;
      createdAt: Date;
      sentAt: Date | null;
      redeemedAt: Date | null;
      redeemedByUserId: string | null;
      disabledReason: ActivationCodeDisabledReason | null;
    }
  >
>;
type PrepareSelfServiceActivationCodeResultShape = Assert<
  Equal<
    PrepareSelfServiceActivationCodeResult,
    | { status: "prepared"; code: string; email: string; retryAt: Date }
    | { status: "session_invalid" }
    | { status: "entitlement_active" }
    | { status: "rate_limited"; retryAt: Date }
    | { status: "temporarily_unavailable" }
  >
>;
type ActivationRedemptionShape = Assert<
  Equal<
    ActivationRedemption,
    | { status: "redeemed"; entitlement: EntitlementRecord }
    | { status: "entitlement_active"; entitlement: EntitlementRecord }
    | { status: "session_invalid" }
    | { status: "code_invalid" }
  >
>;

const storeMethodSetIsExact: StoreMethodSetIsExact = true;
const emailDispatchPurposeShape: EmailDispatchPurposeShape = true;
const otpPurposeShape: OtpPurposeShape = true;
const activationCodeIssuanceSourceShape: ActivationCodeIssuanceSourceShape = true;
const activationCodeDisabledReasonShape: ActivationCodeDisabledReasonShape = true;
const activationCodeRecordShape: ActivationCodeRecordShape = true;
const prepareSelfServiceActivationCodeResultShape: PrepareSelfServiceActivationCodeResultShape = true;
const activationRedemptionShape: ActivationRedemptionShape = true;
const now = new Date("2026-07-23T08:00:00.000Z");

describe("Store adapter compatibility surface", () => {
  test("keeps the exact official method set and both class compatibility surfaces", () => {
    expect(storeMethodSetIsExact).toBe(true);
    expect(emailDispatchPurposeShape).toBe(true);
    expect(otpPurposeShape).toBe(true);
    expect(activationCodeIssuanceSourceShape).toBe(true);
    expect(activationCodeDisabledReasonShape).toBe(true);
    expect(activationCodeRecordShape).toBe(true);
    expect(prepareSelfServiceActivationCodeResultShape).toBe(true);
    expect(activationRedemptionShape).toBe(true);
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
      issuanceSource: "admin",
      entitlementDays: 31,
      issuedToUserId: null,
      redeemBy: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      createdAt: now,
      sentAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    const newerCode = await store.createActivationCode({
      codeHash: "newer-code-hash",
      codePrefix: "FQ-NEW",
      status: "pending_delivery",
      issuanceSource: "self_service_email",
      entitlementDays: 31,
      issuedToUserId: alpha.id,
      redeemBy: new Date(later.getTime() + 30 * 24 * 60 * 60 * 1000),
      createdAt: later,
      sentAt: null,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    expect(await store.listActivationCodes()).toEqual([newerCode, olderCode]);
  });
});
