import { describe, expect, test } from "vitest";
import { canProcessWithAccount, createGuestAccountStatus } from "./accountState";

describe("account state", () => {
  test("blocks processing for guests and inactive users", () => {
    expect(canProcessWithAccount(createGuestAccountStatus())).toBe(false);
    expect(
      canProcessWithAccount({
        authenticated: true,
        email: "user@example.com",
        entitlementStatus: "inactive",
        entitlementExpiresAt: null,
        llmQuotaLimit: 0,
        llmQuotaUsed: 0,
        llmQuotaRemaining: 0,
        llmQuotaResetsAt: null,
        llmConfigured: false,
        lastVerifiedAt: "2026-06-21T08:00:00.000Z",
        canProcess: false,
        serverError: null,
      }),
    ).toBe(false);
  });

  test("allows processing only when the server says the entitlement can process", () => {
    expect(
      canProcessWithAccount({
        authenticated: true,
        email: "user@example.com",
        entitlementStatus: "active",
        entitlementExpiresAt: "2026-07-22T08:00:00.000Z",
        llmQuotaLimit: 20,
        llmQuotaUsed: 2,
        llmQuotaRemaining: 18,
        llmQuotaResetsAt: "2026-07-22T08:00:00.000Z",
        llmConfigured: true,
        lastVerifiedAt: "2026-06-21T08:00:00.000Z",
        canProcess: true,
        serverError: null,
      }),
    ).toBe(true);
  });
});
