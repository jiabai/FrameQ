import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  ActivationCodeRecord,
  ActivationRedemption,
  AdminEntitlementAdjustmentRecord,
  EntitlementAdjustmentApplication,
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  EntitlementRecord,
  LlmConfigRecord,
  LlmQuotaCheckoutResult,
  OrderRecord,
  PaidOrderSettlement,
  Store,
  WebhookEventRecord,
} from "./store.js";
import * as authOperations from "./prismaStore/auth.js";
import {
  isLlmUsageEventIdempotencyConflict,
  isPrismaKnownError,
  withConflictRetry,
} from "./prismaStore/concurrency.js";

export class PrismaStore implements Store {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertUserByEmail(
    email: string,
    now: Date,
  ): ReturnType<Store["upsertUserByEmail"]> {
    return authOperations.upsertUserByEmail(this.prisma, email, now);
  }

  async getUserById(userId: string): ReturnType<Store["getUserById"]> {
    return authOperations.getUserById(this.prisma, userId);
  }

  async issueEmailOtp(
    input: Parameters<Store["issueEmailOtp"]>[0],
  ): ReturnType<Store["issueEmailOtp"]> {
    return authOperations.issueEmailOtp(this.prisma, input);
  }

  async invalidateIssuedOtpAfterDeliveryFailure(
    otpId: string,
    now: Date,
  ): ReturnType<Store["invalidateIssuedOtpAfterDeliveryFailure"]> {
    return authOperations.invalidateIssuedOtpAfterDeliveryFailure(this.prisma, otpId, now);
  }

  async verifyDesktopOtpAndCreateTicket(
    input: Parameters<Store["verifyDesktopOtpAndCreateTicket"]>[0],
  ): ReturnType<Store["verifyDesktopOtpAndCreateTicket"]> {
    return authOperations.verifyDesktopOtpAndCreateTicket(this.prisma, input);
  }

  async verifyAdminOtpAndCreateSession(
    input: Parameters<Store["verifyAdminOtpAndCreateSession"]>[0],
  ): ReturnType<Store["verifyAdminOtpAndCreateSession"]> {
    return authOperations.verifyAdminOtpAndCreateSession(this.prisma, input);
  }

  async exchangeDesktopTicketAndCreateSession(
    input: Parameters<Store["exchangeDesktopTicketAndCreateSession"]>[0],
  ): ReturnType<Store["exchangeDesktopTicketAndCreateSession"]> {
    return authOperations.exchangeDesktopTicketAndCreateSession(this.prisma, input);
  }

  async createEmailOtp(
    input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
  ): Promise<EmailOtpRecord> {
    return authOperations.createEmailOtp(this.prisma, input);
  }

  async findLatestUsableOtp(
    email: string,
    state: string,
    now: Date,
  ): Promise<EmailOtpRecord | null> {
    return authOperations.findLatestUsableOtp(this.prisma, email, state, now);
  }

  async incrementOtpAttempts(otpId: string): Promise<EmailOtpRecord> {
    return authOperations.incrementOtpAttempts(this.prisma, otpId);
  }

  async consumeOtp(otpId: string, now: Date): Promise<void> {
    return authOperations.consumeOtp(this.prisma, otpId, now);
  }

  async createDesktopLoginTicket(
    input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">,
  ): Promise<DesktopLoginTicketRecord> {
    return authOperations.createDesktopLoginTicket(this.prisma, input);
  }

  async consumeDesktopLoginTicket(
    ticketHash: string,
    state: string,
    now: Date,
  ): Promise<DesktopLoginTicketRecord | null> {
    return authOperations.consumeDesktopLoginTicket(this.prisma, ticketHash, state, now);
  }

  async createSession(
    input: Parameters<Store["createSession"]>[0],
  ): ReturnType<Store["createSession"]> {
    return authOperations.createSession(this.prisma, input);
  }

  async findSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): ReturnType<Store["findSessionByTokenHash"]> {
    return authOperations.findSessionByTokenHash(this.prisma, tokenHash, now);
  }

  async revokeSession(
    tokenHash: string,
    now: Date,
  ): ReturnType<Store["revokeSession"]> {
    return authOperations.revokeSession(this.prisma, tokenHash, now);
  }


  async createOrder(input: Omit<OrderRecord, "id" | "paidAt" | "transactionId">): Promise<OrderRecord> {
    const order = await this.prisma.order.create({
      data: { ...input, id: randomUUID(), paidAt: null, transactionId: null },
    });
    return order as OrderRecord;
  }

  async findOrderByOutTradeNo(outTradeNo: string): Promise<OrderRecord | null> {
    const order = await this.prisma.order.findUnique({ where: { outTradeNo } });
    return order as OrderRecord | null;
  }

  async markOrderPaid(outTradeNo: string, transactionId: string, paidAt: Date): Promise<OrderRecord> {
    const order = await this.prisma.order.update({
      where: { outTradeNo },
      data: { status: "paid", transactionId, paidAt },
    });
    return order as OrderRecord;
  }

  async settlePaidOrder(input: {
    provider: string;
    eventId: string;
    outTradeNo: string;
    transactionId: string;
    paidAt: Date;
    now: Date;
    passDays: number;
  }): Promise<PaidOrderSettlement> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { outTradeNo: input.outTradeNo } });
      if (!order) {
        return { status: "order_not_found" };
      }
      const existingEvent = await tx.webhookEvent.findUnique({
        where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
      });
      if (existingEvent && existingEvent.outTradeNo !== input.outTradeNo) {
        return { status: "webhook_order_mismatch" };
      }
      const existingEventTransactionId = existingEvent
        ? storedWebhookTransactionId(existingEvent.payload)
        : null;
      if (existingEvent && existingEventTransactionId !== input.transactionId) {
        return { status: "transaction_mismatch" };
      }
      if (order.status === "paid") {
        const entitlement = await tx.entitlement.findUnique({ where: { userId: order.userId } });
        if (!existingEvent && !entitlement) {
          return { status: "order_state_conflict" };
        }
        const webhook = await this.ensureWebhookEvent(tx, input);
        if (webhook.status !== "recorded") {
          return webhook;
        }
        return this.settleExistingPaidOrder(tx, order, input);
      }
      if (order.status !== "pending" || order.transactionId !== null || order.paidAt !== null) {
        return { status: "order_state_conflict" };
      }
      const webhook = await this.ensureWebhookEvent(tx, input);
      if (webhook.status !== "recorded") {
        return webhook;
      }
      const marked = await tx.order.updateMany({
        where: {
          outTradeNo: input.outTradeNo,
          status: "pending",
          transactionId: null,
          paidAt: null,
        },
        data: {
          status: "paid",
          transactionId: input.transactionId,
          paidAt: input.paidAt,
        },
      });
      if (marked.count === 0) {
        const latest = await tx.order.findUnique({ where: { outTradeNo: input.outTradeNo } });
        if (!latest) {
          return { status: "order_state_conflict" };
        }
        return this.settleExistingPaidOrder(tx, latest, input);
      }
      return {
        status: "settled",
        entitlement: await this.extendMonthlyPass(
          tx,
          order.userId,
          input.paidAt,
          input.now,
          input.passDays,
        ),
      };
    });
  }

  async getEntitlement(userId: string): Promise<EntitlementRecord | null> {
    const entitlement = await this.prisma.entitlement.findUnique({ where: { userId } });
    return entitlement as EntitlementRecord | null;
  }

  async upsertEntitlement(
    userId: string,
    expiresAt: Date,
    now: Date,
    quota: { llmQuotaLimit?: number; llmQuotaUsed?: number } = {},
  ): Promise<EntitlementRecord> {
    const quotaUpdate = {
      ...(quota.llmQuotaLimit !== undefined ? { llmQuotaLimit: quota.llmQuotaLimit } : {}),
      ...(quota.llmQuotaUsed !== undefined ? { llmQuotaUsed: quota.llmQuotaUsed } : {}),
    };
    const entitlement = await this.prisma.entitlement.upsert({
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

  async consumeLlmQuota(
    userId: string,
    requestId: string,
    now: Date,
  ): Promise<LlmQuotaCheckoutResult> {
    const usageEventId = randomUUID();
    const attempted = await withConflictRetry(
      () =>
        this.prisma.$transaction(async (tx) => {
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

  async getLlmConfig(): Promise<LlmConfigRecord | null> {
    const config = await this.prisma.llmConfig.findUnique({ where: { id: "default" } });
    return config as LlmConfigRecord | null;
  }

  async upsertLlmConfig(
    input: Omit<LlmConfigRecord, "id" | "createdAt" | "updatedAt">,
    now: Date,
  ): Promise<LlmConfigRecord> {
    const config = await this.prisma.llmConfig.upsert({
      where: { id: "default" },
      update: { ...input, updatedAt: now },
      create: {
        ...input,
        id: "default",
        createdAt: now,
        updatedAt: now,
      },
    });
    return config as LlmConfigRecord;
  }

  async createActivationCode(input: Omit<ActivationCodeRecord, "id">): Promise<ActivationCodeRecord> {
    const code = await this.prisma.activationCode.create({
      data: { ...input, id: randomUUID() },
    });
    return code as ActivationCodeRecord;
  }

  async findActivationCodeByHash(codeHash: string): Promise<ActivationCodeRecord | null> {
    const code = await this.prisma.activationCode.findUnique({ where: { codeHash } });
    return code as ActivationCodeRecord | null;
  }

  async markActivationCodeRedeemed(
    codeHash: string,
    userId: string,
    redeemedAt: Date,
  ): Promise<ActivationCodeRecord | null> {
    const update = await this.prisma.activationCode.updateMany({
      where: {
        codeHash,
        status: "active",
        redeemedAt: null,
      },
      data: {
        status: "redeemed",
        redeemedByUserId: userId,
        redeemedAt,
      },
    });
    if (update.count !== 1) {
      return null;
    }
    return this.findActivationCodeByHash(codeHash);
  }

  async redeemActivationCodeAndGrantEntitlement(input: {
    sessionTokenHash: string;
    codeHash: string;
    now: Date;
    llmQuotaPerActivation: number;
  }): Promise<ActivationRedemption> {
    return this.prisma.$transaction(async (tx) => {
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
      if (!code || code.status !== "active" || code.redeemedAt !== null || code.redeemBy <= input.now) {
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
          llmQuotaLimit: active && existing
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

  async listActivationCodes(): Promise<ActivationCodeRecord[]> {
    const codes = await this.prisma.activationCode.findMany({
      orderBy: { createdAt: "desc" },
    });
    return codes as ActivationCodeRecord[];
  }

  async listUsers(): ReturnType<Store["listUsers"]> {
    return authOperations.listUsers(this.prisma);
  }

  async createAdminSession(
    input: Parameters<Store["createAdminSession"]>[0],
  ): ReturnType<Store["createAdminSession"]> {
    return authOperations.createAdminSession(this.prisma, input);
  }

  async findAdminSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): ReturnType<Store["findAdminSessionByTokenHash"]> {
    return authOperations.findAdminSessionByTokenHash(this.prisma, tokenHash, now);
  }

  async revokeAdminSession(
    tokenHash: string,
    now: Date,
  ): ReturnType<Store["revokeAdminSession"]> {
    return authOperations.revokeAdminSession(this.prisma, tokenHash, now);
  }


  async createAdminEntitlementAdjustment(
    input: AdminEntitlementAdjustmentRecord,
  ): Promise<AdminEntitlementAdjustmentRecord> {
    const adjustment = await this.prisma.adminEntitlementAdjustment.create({ data: input });
    return adjustment as AdminEntitlementAdjustmentRecord;
  }

  async listAdminEntitlementAdjustments(limit = 50) {
    const adjustments = await (this.prisma as any).adminEntitlementAdjustment.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return adjustments as AdminEntitlementAdjustmentRecord[];
  }

  async applyEntitlementAdjustmentWithAudit(input: {
    adminEmail: string;
    userId: string;
    reason: string;
    note: string | null;
    extendDays?: number;
    expiresAt?: Date;
    quotaAdd?: number;
    now: Date;
  }): Promise<EntitlementAdjustmentApplication> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user) {
        return { status: "user_not_found" };
      }
      const before = await tx.entitlement.findUnique({ where: { userId: input.userId } });
      const beforeExpiresAt = before?.expiresAt ? new Date(before.expiresAt) : null;
      const beforeLlmQuotaLimit = before?.llmQuotaLimit ?? 0;
      const beforeLlmQuotaUsed = before?.llmQuotaUsed ?? 0;
      const extensionBase = beforeExpiresAt && beforeExpiresAt > input.now ? beforeExpiresAt : input.now;
      const extendedExpiry = input.extendDays !== undefined
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

  async createWebhookEvent(
    input: Omit<WebhookEventRecord, "id" | "createdAt"> & { createdAt: Date },
  ): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: { ...input, id: randomUUID() },
      });
      return true;
    } catch (error) {
      if (isPrismaKnownError(error, "P2002")) {
        return false;
      }
      throw error;
    }
  }

  private async ensureWebhookEvent(
    tx: Prisma.TransactionClient,
    input: {
      provider: string;
      eventId: string;
      outTradeNo: string;
      transactionId: string;
      paidAt: Date;
      now: Date;
    },
  ): Promise<
    { status: "recorded" }
    | { status: "webhook_order_mismatch" }
    | { status: "transaction_mismatch" }
  > {
    const existing = await tx.webhookEvent.findUnique({
      where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
    });
    if (existing) {
      return this.webhookEventMatch(existing, input);
    }
    try {
      await tx.webhookEvent.create({
        data: {
          id: randomUUID(),
          provider: input.provider,
          eventId: input.eventId,
          outTradeNo: input.outTradeNo,
          payload: JSON.stringify({
            outTradeNo: input.outTradeNo,
            transactionId: input.transactionId,
            paidAt: input.paidAt.toISOString(),
          }),
          createdAt: input.now,
        },
      });
      return { status: "recorded" };
    } catch (error) {
      if (!isPrismaKnownError(error, "P2002")) {
        throw error;
      }
      const duplicate = await tx.webhookEvent.findUnique({
        where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
      });
      return duplicate
        ? this.webhookEventMatch(duplicate, input)
        : { status: "webhook_order_mismatch" };
    }
  }

  private webhookEventMatch(
    event: { outTradeNo: string; payload: string },
    input: { outTradeNo: string; transactionId: string },
  ): { status: "recorded" } | { status: "webhook_order_mismatch" } | { status: "transaction_mismatch" } {
    if (event.outTradeNo !== input.outTradeNo) {
      return { status: "webhook_order_mismatch" };
    }
    const transactionId = storedWebhookTransactionId(event.payload);
    return transactionId === input.transactionId ? { status: "recorded" } : { status: "transaction_mismatch" };
  }

  private async settleExistingPaidOrder(
    tx: Prisma.TransactionClient,
    order: { status: string; transactionId: string | null; userId: string; paidAt: Date | null },
    input: { transactionId: string; paidAt: Date; now: Date; passDays: number },
  ): Promise<PaidOrderSettlement> {
    if (order.status !== "paid") {
      return { status: "order_state_conflict" };
    }
    if (!order.transactionId || order.transactionId !== input.transactionId) {
      return { status: "transaction_mismatch" };
    }
    const entitlement = await tx.entitlement.findUnique({ where: { userId: order.userId } });
    if (entitlement) {
      return { status: "settled", entitlement: entitlement as EntitlementRecord };
    }
    return {
      status: "settled",
      entitlement: await this.extendMonthlyPass(
        tx,
        order.userId,
        order.paidAt ?? input.paidAt,
        input.now,
        input.passDays,
      ),
    };
  }

  private async extendMonthlyPass(
    tx: Prisma.TransactionClient,
    userId: string,
    paidAt: Date,
    now: Date,
    passDays: number,
  ): Promise<EntitlementRecord> {
    const existing = await tx.entitlement.findUnique({ where: { userId } });
    const base = existing && existing.expiresAt > paidAt ? existing.expiresAt : paidAt;
    const entitlement = await tx.entitlement.upsert({
      where: { userId },
      update: {
        status: "active",
        expiresAt: new Date(base.getTime() + passDays * 24 * 60 * 60 * 1000),
        updatedAt: now,
      },
      create: {
        id: randomUUID(),
        userId,
        status: "active",
        expiresAt: new Date(base.getTime() + passDays * 24 * 60 * 60 * 1000),
        llmQuotaLimit: 0,
        llmQuotaUsed: 0,
        updatedAt: now,
      },
    });
    return entitlement as EntitlementRecord;
  }
}


function storedWebhookTransactionId(payload: string): string | null {
  try {
    const value = JSON.parse(payload) as { transactionId?: unknown };
    return typeof value.transactionId === "string" ? value.transactionId : null;
  } catch {
    return null;
  }
}
