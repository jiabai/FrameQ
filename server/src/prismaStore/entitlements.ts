import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  ActivationCodeRecord,
  AdminEntitlementAdjustmentRecord,
  EntitlementRecord,
  Store,
} from "../store/contracts.js";
import {
  isLlmUsageEventIdempotencyConflict,
  withConflictRetry,
} from "./concurrency.js";

export async function getEntitlement(
  prisma: PrismaClient,
  userId: string,
): ReturnType<Store["getEntitlement"]> {
  const entitlement = await prisma.entitlement.findUnique({ where: { userId } });
  return entitlement as EntitlementRecord | null;
}

export async function upsertEntitlement(
  prisma: PrismaClient,
  userId: string,
  expiresAt: Date,
  now: Date,
  quota: { llmQuotaLimit?: number; llmQuotaUsed?: number } = {},
): ReturnType<Store["upsertEntitlement"]> {
  const quotaUpdate = {
    ...(quota.llmQuotaLimit !== undefined ? { llmQuotaLimit: quota.llmQuotaLimit } : {}),
    ...(quota.llmQuotaUsed !== undefined ? { llmQuotaUsed: quota.llmQuotaUsed } : {}),
  };
  const entitlement = await prisma.entitlement.upsert({
    where: { userId },
    update: {
      status: expiresAt > now ? "active" : "inactive",
      expiresAt,
      ...quotaUpdate,
      updatedAt: now,
    },
    create: {
      id: randomUUID(),
      userId,
      status: expiresAt > now ? "active" : "inactive",
      expiresAt,
      llmQuotaLimit: quota.llmQuotaLimit ?? 0,
      llmQuotaUsed: quota.llmQuotaUsed ?? 0,
      updatedAt: now,
    },
  });
  return entitlement as EntitlementRecord;
}

export async function consumeLlmQuota(
  prisma: PrismaClient,
  userId: string,
  requestId: string,
  now: Date,
): ReturnType<Store["consumeLlmQuota"]> {
  const usageEventId = randomUUID();
  const attempted = await withConflictRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const existingEvent = await tx.llmUsageEvent.findUnique({
          where: { userId_requestId: { userId, requestId } },
        });
        const current = await tx.entitlement.findUnique({ where: { userId } });
        if (!current || current.expiresAt <= now) {
          return { status: "unavailable" } as const;
        }
        if (existingEvent) {
          return {
            status: "reused",
            entitlement: current as EntitlementRecord,
          } as const;
        }

        const updatedRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE "Entitlement"
             SET "llmQuotaUsed" = "llmQuotaUsed" + 1,
                 "updatedAt" = ${now}
           WHERE "userId" = ${userId}
             AND "expiresAt" > ${now}
             AND "llmQuotaUsed" < "llmQuotaLimit"
           RETURNING "id"
        `);
        const updatedId = updatedRows[0]?.id;
        if (!updatedId) {
          return { status: "unavailable" } as const;
        }
        const updated = await tx.entitlement.findUnique({ where: { id: updatedId } });
        if (!updated) {
          throw new Error("LLM_QUOTA_UPDATE_INCONSISTENT");
        }
        await tx.llmUsageEvent.create({
          data: {
            id: usageEventId,
            userId,
            entitlementId: updated.id,
            requestId,
            createdAt: now,
          },
        });
        return {
          status: "consumed",
          entitlement: updated as EntitlementRecord,
        } as const;
      }),
    isLlmUsageEventIdempotencyConflict,
  );
  return attempted.status === "exhausted"
    ? { status: "temporarily_unavailable" }
    : attempted.value;
}

export async function createActivationCode(
  prisma: PrismaClient,
  input: Omit<ActivationCodeRecord, "id">,
): ReturnType<Store["createActivationCode"]> {
  const code = await prisma.activationCode.create({
    data: { ...input, id: randomUUID() },
  });
  return code as ActivationCodeRecord;
}

export async function findActivationCodeByHash(
  prisma: PrismaClient,
  codeHash: string,
): ReturnType<Store["findActivationCodeByHash"]> {
  const code = await prisma.activationCode.findUnique({ where: { codeHash } });
  return code as ActivationCodeRecord | null;
}

export async function markActivationCodeRedeemed(
  prisma: PrismaClient,
  codeHash: string,
  userId: string,
  redeemedAt: Date,
): ReturnType<Store["markActivationCodeRedeemed"]> {
  const update = await prisma.activationCode.updateMany({
    where: { codeHash, status: "active", redeemedAt: null },
    data: { status: "redeemed", redeemedByUserId: userId, redeemedAt },
  });
  if (update.count !== 1) {
    return null;
  }
  return findActivationCodeByHash(prisma, codeHash);
}

export async function redeemActivationCodeAndGrantEntitlement(
  prisma: PrismaClient,
  input: Parameters<Store["redeemActivationCodeAndGrantEntitlement"]>[0],
): ReturnType<Store["redeemActivationCodeAndGrantEntitlement"]> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findFirst({
      where: {
        tokenHash: input.sessionTokenHash,
        revokedAt: null,
        expiresAt: { gt: input.now },
      },
    });
    if (!session) {
      return { status: "session_invalid" };
    }
    const code = await tx.activationCode.findUnique({ where: { codeHash: input.codeHash } });
    if (
      !code ||
      code.status !== "active" ||
      code.redeemedAt !== null ||
      code.redeemBy <= input.now
    ) {
      return { status: "code_invalid" };
    }
    const redeemed = await tx.activationCode.updateMany({
      where: {
        codeHash: input.codeHash,
        status: "active",
        redeemedAt: null,
        redeemBy: { gt: input.now },
      },
      data: {
        status: "redeemed",
        redeemedByUserId: session.userId,
        redeemedAt: input.now,
      },
    });
    if (redeemed.count !== 1) {
      return { status: "code_invalid" };
    }
    const existing = await tx.entitlement.findUnique({ where: { userId: session.userId } });
    const active = Boolean(existing && existing.expiresAt > input.now);
    const base = active && existing ? existing.expiresAt : input.now;
    const entitlement = await tx.entitlement.upsert({
      where: { userId: session.userId },
      update: {
        status: "active",
        expiresAt: new Date(base.getTime() + code.entitlementDays * 24 * 60 * 60 * 1000),
        llmQuotaLimit:
          active && existing
            ? existing.llmQuotaLimit + input.llmQuotaPerActivation
            : input.llmQuotaPerActivation,
        llmQuotaUsed: active && existing ? existing.llmQuotaUsed : 0,
        updatedAt: input.now,
      },
      create: {
        id: randomUUID(),
        userId: session.userId,
        status: "active",
        expiresAt: new Date(base.getTime() + code.entitlementDays * 24 * 60 * 60 * 1000),
        llmQuotaLimit: input.llmQuotaPerActivation,
        llmQuotaUsed: 0,
        updatedAt: input.now,
      },
    });
    return { status: "redeemed", entitlement: entitlement as EntitlementRecord };
  });
}

export async function listActivationCodes(
  prisma: PrismaClient,
): ReturnType<Store["listActivationCodes"]> {
  const codes = await prisma.activationCode.findMany({ orderBy: { createdAt: "desc" } });
  return codes as ActivationCodeRecord[];
}

export async function createAdminEntitlementAdjustment(
  prisma: PrismaClient,
  input: AdminEntitlementAdjustmentRecord,
): ReturnType<Store["createAdminEntitlementAdjustment"]> {
  const adjustment = await prisma.adminEntitlementAdjustment.create({ data: input });
  return adjustment as AdminEntitlementAdjustmentRecord;
}

export async function listAdminEntitlementAdjustments(
  prisma: PrismaClient,
  limit = 50,
): ReturnType<Store["listAdminEntitlementAdjustments"]> {
  const adjustments = await (prisma as any).adminEntitlementAdjustment.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return adjustments as AdminEntitlementAdjustmentRecord[];
}

export async function applyEntitlementAdjustmentWithAudit(
  prisma: PrismaClient,
  input: Parameters<Store["applyEntitlementAdjustmentWithAudit"]>[0],
): ReturnType<Store["applyEntitlementAdjustmentWithAudit"]> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      return { status: "user_not_found" };
    }
    const before = await tx.entitlement.findUnique({ where: { userId: input.userId } });
    const beforeExpiresAt = before?.expiresAt ? new Date(before.expiresAt) : null;
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
    const entitlement = await tx.entitlement.upsert({
      where: { userId: input.userId },
      update: {
        status: afterExpiresAt > input.now ? "active" : "inactive",
        expiresAt: afterExpiresAt,
        llmQuotaLimit: beforeLlmQuotaLimit + (input.quotaAdd ?? 0),
        llmQuotaUsed: beforeLlmQuotaUsed,
        updatedAt: input.now,
      },
      create: {
        id: randomUUID(),
        userId: input.userId,
        status: afterExpiresAt > input.now ? "active" : "inactive",
        expiresAt: afterExpiresAt,
        llmQuotaLimit: beforeLlmQuotaLimit + (input.quotaAdd ?? 0),
        llmQuotaUsed: beforeLlmQuotaUsed,
        updatedAt: input.now,
      },
    });
    const adjustment = await tx.adminEntitlementAdjustment.create({
      data: {
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
      },
    });
    return {
      status: "applied",
      entitlement: entitlement as EntitlementRecord,
      adjustment: adjustment as AdminEntitlementAdjustmentRecord,
    };
  });
}
