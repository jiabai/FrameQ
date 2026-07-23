import { randomUUID } from "node:crypto";
import type {
  ActivationCodeRecord,
  AdminEntitlementAdjustmentRecord,
  EntitlementRecord,
  Store,
} from "../contracts.js";
import type { MemoryAtomicCoordinator, MemoryState } from "./atomic.js";

export type MemoryEntitlementContext = {
  state: MemoryState;
  atomic: MemoryAtomicCoordinator;
  findSessionByTokenHash: Store["findSessionByTokenHash"];
  getUserById: Store["getUserById"];
  findActivationCodeByHash: Store["findActivationCodeByHash"];
  markActivationCodeRedeemed: Store["markActivationCodeRedeemed"];
  getEntitlement: Store["getEntitlement"];
  upsertEntitlement: Store["upsertEntitlement"];
  createAdminEntitlementAdjustment: Store["createAdminEntitlementAdjustment"];
};

export async function getEntitlement(
  context: MemoryEntitlementContext,
  userId: string,
): ReturnType<Store["getEntitlement"]> {
  return context.state.entitlements.find((entitlement) => entitlement.userId === userId) ?? null;
}

export async function upsertEntitlement(
  context: MemoryEntitlementContext,
  userId: string,
  expiresAt: Date,
  now: Date,
  quota: { llmQuotaLimit?: number; llmQuotaUsed?: number } = {},
): ReturnType<Store["upsertEntitlement"]> {
  const existing = await context.getEntitlement(userId);
  if (existing) {
    existing.status = expiresAt > now ? "active" : "inactive";
    existing.expiresAt = expiresAt;
    if (quota.llmQuotaLimit !== undefined) {
      existing.llmQuotaLimit = quota.llmQuotaLimit;
    }
    if (quota.llmQuotaUsed !== undefined) {
      existing.llmQuotaUsed = quota.llmQuotaUsed;
    }
    existing.updatedAt = now;
    return existing;
  }
  const entitlement: EntitlementRecord = {
    id: randomUUID(),
    userId,
    status: expiresAt > now ? "active" : "inactive",
    expiresAt,
    llmQuotaLimit: quota.llmQuotaLimit ?? 0,
    llmQuotaUsed: quota.llmQuotaUsed ?? 0,
    updatedAt: now,
  };
  context.state.entitlements.push(entitlement);
  return entitlement;
}

export async function consumeLlmQuota(
  context: MemoryEntitlementContext,
  userId: string,
  requestId: string,
  now: Date,
): ReturnType<Store["consumeLlmQuota"]> {
  return context.atomic.run(async () => {
    const existingEvent = context.state.llmUsageEvents.find(
      (event) => event.userId === userId && event.requestId === requestId,
    );
    const entitlement = await context.getEntitlement(userId);
    if (!entitlement || entitlement.expiresAt <= now) {
      return { status: "unavailable" };
    }
    if (existingEvent) {
      return { status: "reused", entitlement };
    }
    if (entitlement.llmQuotaUsed >= entitlement.llmQuotaLimit) {
      return { status: "unavailable" };
    }
    entitlement.llmQuotaUsed += 1;
    entitlement.updatedAt = now;
    context.state.llmUsageEvents.push({
      id: randomUUID(),
      userId,
      entitlementId: entitlement.id,
      requestId,
      createdAt: now,
    });
    return { status: "consumed", entitlement };
  });
}

export async function createActivationCode(
  context: MemoryEntitlementContext,
  input: Omit<ActivationCodeRecord, "id">,
): ReturnType<Store["createActivationCode"]> {
  const code: ActivationCodeRecord = { ...input, id: randomUUID() };
  context.state.activationCodes.push(code);
  return code;
}

export async function findActivationCodeByHash(
  context: MemoryEntitlementContext,
  codeHash: string,
): ReturnType<Store["findActivationCodeByHash"]> {
  return context.state.activationCodes.find((code) => code.codeHash === codeHash) ?? null;
}

export async function markActivationCodeRedeemed(
  context: MemoryEntitlementContext,
  codeHash: string,
  userId: string,
  redeemedAt: Date,
): ReturnType<Store["markActivationCodeRedeemed"]> {
  const code = await context.findActivationCodeByHash(codeHash);
  if (!code || code.status !== "active" || code.redeemedAt !== null) {
    return null;
  }
  code.status = "redeemed";
  code.redeemedByUserId = userId;
  code.redeemedAt = redeemedAt;
  return code;
}

export async function redeemActivationCodeAndGrantEntitlement(
  context: MemoryEntitlementContext,
  input: Parameters<Store["redeemActivationCodeAndGrantEntitlement"]>[0],
): ReturnType<Store["redeemActivationCodeAndGrantEntitlement"]> {
  return context.atomic.run(async () => {
    const session = await context.findSessionByTokenHash(input.sessionTokenHash, input.now);
    if (!session) {
      return { status: "session_invalid" };
    }
    const code = await context.findActivationCodeByHash(input.codeHash);
    if (
      !code ||
      code.status !== "active" ||
      code.redeemedAt !== null ||
      code.redeemBy <= input.now
    ) {
      return { status: "code_invalid" };
    }
    const redeemed = await context.markActivationCodeRedeemed(
      input.codeHash,
      session.userId,
      input.now,
    );
    if (!redeemed) {
      return { status: "code_invalid" };
    }
    const existing = await context.getEntitlement(session.userId);
    const active = Boolean(existing && existing.expiresAt > input.now);
    const base = active && existing ? existing.expiresAt : input.now;
    const quota =
      active && existing
        ? {
            llmQuotaLimit: existing.llmQuotaLimit + input.llmQuotaPerActivation,
            llmQuotaUsed: existing.llmQuotaUsed,
          }
        : { llmQuotaLimit: input.llmQuotaPerActivation, llmQuotaUsed: 0 };
    const entitlement = await context.upsertEntitlement(
      session.userId,
      new Date(base.getTime() + redeemed.entitlementDays * 24 * 60 * 60 * 1000),
      input.now,
      quota,
    );
    return { status: "redeemed", entitlement };
  });
}

export async function listActivationCodes(
  context: MemoryEntitlementContext,
): ReturnType<Store["listActivationCodes"]> {
  return [...context.state.activationCodes].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
}

export async function createAdminEntitlementAdjustment(
  context: MemoryEntitlementContext,
  input: AdminEntitlementAdjustmentRecord,
): ReturnType<Store["createAdminEntitlementAdjustment"]> {
  context.state.adminEntitlementAdjustments.push(input);
  return input;
}

export async function applyEntitlementAdjustmentWithAudit(
  context: MemoryEntitlementContext,
  input: Parameters<Store["applyEntitlementAdjustmentWithAudit"]>[0],
): ReturnType<Store["applyEntitlementAdjustmentWithAudit"]> {
  return context.atomic.run(async () => {
    const user = await context.getUserById(input.userId);
    if (!user) {
      return { status: "user_not_found" };
    }
    const before = await context.getEntitlement(input.userId);
    const beforeExpiresAt = before ? new Date(before.expiresAt) : null;
    const beforeLlmQuotaLimit = before?.llmQuotaLimit ?? 0;
    const beforeLlmQuotaUsed = before?.llmQuotaUsed ?? 0;
    const extensionBase =
      beforeExpiresAt && beforeExpiresAt > input.now ? beforeExpiresAt : input.now;
    const extendedExpiry =
      input.extendDays !== undefined
        ? new Date(extensionBase.getTime() + input.extendDays * 24 * 60 * 60 * 1000)
        : null;
    const afterExpiresAt = input.expiresAt ?? extendedExpiry ?? beforeExpiresAt;
    if (!afterExpiresAt) {
      return { status: "expiry_required" };
    }
    const entitlement = await context.upsertEntitlement(
      input.userId,
      afterExpiresAt,
      input.now,
      {
        llmQuotaLimit: beforeLlmQuotaLimit + (input.quotaAdd ?? 0),
        llmQuotaUsed: beforeLlmQuotaUsed,
      },
    );
    const adjustment = await context.createAdminEntitlementAdjustment({
      id: `adj_${randomUUID()}`,
      adminEmail: input.adminEmail,
      userId: input.userId,
      reason: input.reason,
      note: input.note,
      beforeExpiresAt,
      afterExpiresAt: entitlement.expiresAt,
      beforeLlmQuotaLimit,
      afterLlmQuotaLimit: entitlement.llmQuotaLimit,
      beforeLlmQuotaUsed,
      afterLlmQuotaUsed: entitlement.llmQuotaUsed,
      createdAt: input.now,
    });
    return { status: "applied", entitlement, adjustment };
  });
}

export async function listAdminEntitlementAdjustments(
  context: MemoryEntitlementContext,
  limit = 50,
): ReturnType<Store["listAdminEntitlementAdjustments"]> {
  return [...context.state.adminEntitlementAdjustments]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, limit);
}
