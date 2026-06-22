import { describe, expect, test } from "vitest";
import { ActivationCodeService } from "../src/activation.js";
import { sha256 } from "../src/security.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-06-21T08:00:00.000Z");

describe("activation codes", () => {
  test("generates a single-use code without storing plaintext", async () => {
    const store = new MemoryStore();
    const service = new ActivationCodeService({ store, now: () => now });

    const generated = await service.generateCode();

    expect(generated.code).toMatch(/^FQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(generated.entitlementDays).toBe(31);
    expect(generated.redeemBy.toISOString()).toBe("2026-07-21T08:00:00.000Z");
    expect(store.activationCodes).toHaveLength(1);
    expect(store.activationCodes[0]?.codeHash).toBe(sha256(generated.code));
    expect(store.activationCodes[0]?.codeHash).not.toContain(generated.code);
    expect(store.activationCodes[0]?.codePrefix).toBe(generated.code.slice(0, 7));
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
});
