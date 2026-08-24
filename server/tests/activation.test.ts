import { describe, expect, test } from "vitest";
import { ActivationCodeService } from "../src/activation.js";
import {
  DEFAULT_ENTITLEMENT_DAYS,
  activationCodeHash,
  normalizeActivationCode,
} from "../src/activationPolicy.js";
import { sha256 } from "../src/security.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-06-21T08:00:00.000Z");

describe("activation codes", () => {
  test("generates a single-use code without storing plaintext", async () => {
    const store = new MemoryStore();
    const service = new ActivationCodeService({ store, now: () => now });

    const generated = await service.generateCode();

    expect(generated.code).toMatch(/^FQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(generated.entitlementDays).toBe(DEFAULT_ENTITLEMENT_DAYS);
    expect(generated.redeemBy.toISOString()).toBe("2026-07-21T08:00:00.000Z");
    expect(store.activationCodes).toHaveLength(1);
    expect(store.activationCodes[0]?.codeHash).toBe(activationCodeHash(generated.code));
    expect(store.activationCodes[0]?.codeHash).not.toContain(generated.code);
    expect(store.activationCodes[0]?.codePrefix).toBe(generated.code.slice(0, 7));
    expect(store.activationCodes[0]).toMatchObject({
      issuanceSource: "admin",
      issuedToUserId: null,
      sentAt: null,
      disabledReason: null,
      status: "active",
    });
  });

  test("redeems a valid code and extends entitlement by 31 days from current expiry", async () => {
    const store = new MemoryStore();
    const user = await store.upsertUserByEmail("user@example.com", now);
    const session = await store.createSession({
      userId: user.id,
      tokenHash: "session-hash",
      createdAt: now,
      expiresAt: new Date("2026-07-21T08:00:00.000Z"),
    });
    await store.upsertEntitlement(user.id, new Date("2026-07-01T08:00:00.000Z"), now);
    const service = new ActivationCodeService({ store, now: () => now });
    const generated = await service.generateCode();

    const result = await service.redeemCode({
      sessionTokenHash: session.tokenHash,
      code: generated.code,
    });

    expect(result.entitlementExpiresAt.toISOString()).toBe("2026-08-01T08:00:00.000Z");
    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });
    expect(store.activationCodes[0]).toMatchObject({
      status: "redeemed",
      redeemedByUserId: user.id,
      redeemedAt: now,
    });
    await expect(
      service.redeemCode({ sessionTokenHash: session.tokenHash, code: generated.code }),
    ).rejects.toThrow("Activation code is invalid or expired.");
  });

  test("adds quota on active renewal and resets quota after expiry", async () => {
    const store = new MemoryStore();
    const user = await store.upsertUserByEmail("user@example.com", now);
    const session = await store.createSession({
      userId: user.id,
      tokenHash: "session-hash",
      createdAt: now,
      expiresAt: new Date("2026-12-21T08:00:00.000Z"),
    });
    const service = new ActivationCodeService({ store, now: () => now });

    const first = await service.generateCode();
    await service.redeemCode({ sessionTokenHash: session.tokenHash, code: first.code });
    const renewed = await service.generateCode();
    await service.redeemCode({ sessionTokenHash: session.tokenHash, code: renewed.code });
    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      llmQuotaLimit: 40,
      llmQuotaUsed: 0,
    });

    const afterExpiry = new Date("2026-09-01T08:00:00.000Z");
    const postExpiryService = new ActivationCodeService({ store, now: () => afterExpiry });
    const reactivation = await postExpiryService.generateCode();
    await postExpiryService.redeemCode({
      sessionTokenHash: session.tokenHash,
      code: reactivation.code,
    });

    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });
  });

  test("rejects expired and unknown codes without creating entitlement", async () => {
    const store = new MemoryStore();
    const user = await store.upsertUserByEmail("user@example.com", now);
    const session = await store.createSession({
      userId: user.id,
      tokenHash: "session-hash",
      createdAt: now,
      expiresAt: new Date("2026-07-21T08:00:00.000Z"),
    });
    const service = new ActivationCodeService({ store, now: () => now });
    const expired = await service.generateCode({
      redeemBy: new Date("2026-06-20T08:00:00.000Z"),
    });

    await expect(
      service.redeemCode({ sessionTokenHash: session.tokenHash, code: expired.code }),
    ).rejects.toThrow("Activation code is invalid or expired.");
    await expect(
      service.redeemCode({ sessionTokenHash: session.tokenHash, code: "FQ-WRNG-WRNG-WRNG-WRNG" }),
    ).rejects.toThrow("Activation code is invalid or expired.");
    expect(await store.getEntitlement(user.id)).toBeNull();
  });

  test("rejects a self-service code when the same account already has an active entitlement", async () => {
    const store = new MemoryStore();
    const user = await store.upsertUserByEmail("self-service-active@example.com", now);
    const session = await store.createSession({
      userId: user.id,
      tokenHash: "self-service-active-session",
      createdAt: now,
      expiresAt: new Date("2026-07-21T08:00:00.000Z"),
    });
    await store.upsertEntitlement(user.id, new Date("2026-07-01T08:00:00.000Z"), now, {
      llmQuotaLimit: 20,
      llmQuotaUsed: 4,
    });
    const service = new ActivationCodeService({ store, now: () => now });
    const selfServiceCode = await store.createActivationCode({
      codeHash: sha256("FQ-SELF-ACTV-LOCK-0001"),
      codePrefix: "FQ-SELF",
      status: "active",
      issuanceSource: "self_service_email",
      entitlementDays: 31,
      issuedToUserId: user.id,
      redeemBy: new Date("2026-07-21T08:00:00.000Z"),
      createdAt: now,
      sentAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });

    await expect(
      service.redeemCode({ sessionTokenHash: session.tokenHash, code: "FQ-SELF-ACTV-LOCK-0001" }),
    ).rejects.toThrow("Activation code is not redeemable while your entitlement is active.");
    expect(selfServiceCode).toMatchObject({
      status: "active",
      redeemedAt: null,
      redeemedByUserId: null,
    });
    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      expiresAt: new Date("2026-07-01T08:00:00.000Z"),
      llmQuotaLimit: 20,
      llmQuotaUsed: 4,
    });
  });

  test("normalizes admin redemption input before hashing", async () => {
    const store = new MemoryStore();
    const user = await store.upsertUserByEmail("normalize@example.com", now);
    const session = await store.createSession({
      userId: user.id,
      tokenHash: "normalize-session",
      createdAt: now,
      expiresAt: new Date("2026-07-21T08:00:00.000Z"),
    });
    const canonicalCode = "FQ-ABCD-EFGH-JKLM-NPQR";
    await store.createActivationCode({
      codeHash: sha256(normalizeActivationCode(canonicalCode)),
      codePrefix: "FQ-ABCD",
      status: "active",
      issuanceSource: "admin",
      entitlementDays: 31,
      issuedToUserId: null,
      redeemBy: new Date("2026-07-21T08:00:00.000Z"),
      createdAt: now,
      sentAt: null,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    const service = new ActivationCodeService({ store, now: () => now });

    const result = await service.redeemCode({
      sessionTokenHash: session.tokenHash,
      code: " fq-abcd-efgh-jklm-npqr ",
    });

    expect(result.entitlementExpiresAt.toISOString()).toBe("2026-07-22T08:00:00.000Z");
  });
});
