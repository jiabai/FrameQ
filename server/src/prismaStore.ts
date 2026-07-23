import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { authRateLimitKey, constantTimeEqual } from "./security.js";
import type {
  ActivationCodeRecord,
  ActivationRedemption,
  AdminEntitlementAdjustmentRecord,
  AuthRateLimitScope,
  ExchangeDesktopTicketResult,
  EntitlementAdjustmentApplication,
  AdminSessionRecord,
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  EntitlementRecord,
  IssueEmailOtpResult,
  LlmConfigRecord,
  LlmQuotaCheckoutResult,
  OtpPurpose,
  OrderRecord,
  PaidOrderSettlement,
  SessionRecord,
  Store,
  UserRecord,
  VerifyAdminOtpResult,
  VerifyDesktopOtpResult,
  WebhookEventRecord,
} from "./store.js";

export class PrismaStore implements Store {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertUserByEmail(email: string, now: Date): Promise<UserRecord> {
    return this.prisma.user.upsert({
      where: { email },
      update: { updatedAt: now },
      create: {
        id: randomUUID(),
        email,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async issueEmailOtp(
    input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
  ): Promise<IssueEmailOtpResult> {
    const otpId = randomUUID();
    const reservations = prismaRateLimitReservations(input);
    const attempted = await withConflictRetry(async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          for (const reservation of reservations) {
            await reserveAuthRateLimit(tx, reservation, input.createdAt);
          }
          await tx.emailOtp.updateMany({
            where: {
              purpose: input.purpose,
              email: input.email,
              state: input.state,
              consumedAt: null,
            },
            data: { consumedAt: input.createdAt },
          });
          await tx.emailOtp.create({
            data: { ...input, id: otpId, attempts: 0, consumedAt: null },
          });
          return { status: "issued", otpId } as const;
        });
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          return { status: "rate_limited", retryAt: error.retryAt } as const;
        }
        throw error;
      }
    });
    return attempted.status === "exhausted"
      ? { status: "temporarily_unavailable" }
      : attempted.value;
  }

  async invalidateIssuedOtpAfterDeliveryFailure(otpId: string, now: Date): Promise<void> {
    const attempted = await withConflictRetry(async () => {
      await this.prisma.emailOtp.updateMany({
        where: { id: otpId, consumedAt: null },
        data: { consumedAt: now },
      });
    });
    if (attempted.status === "exhausted") {
      throw new StoreTemporarilyUnavailableError();
    }
  }

  async verifyDesktopOtpAndCreateTicket(input: {
    email: string;
    state: string;
    codeHash: string;
    ticketHash: string;
    now: Date;
    ticketExpiresAt: Date;
  }): Promise<VerifyDesktopOtpResult> {
    const ticketId = randomUUID();
    const userId = randomUUID();
    const attempted = await withConflictRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const otp = await tx.emailOtp.findFirst({
          where: {
            purpose: "desktop_login",
            email: input.email,
            state: input.state,
            consumedAt: null,
            attempts: { lt: 5 },
            expiresAt: { gt: input.now },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (!otp) {
          return { status: "invalid" } as const;
        }
        const matches = constantTimeEqual(otp.codeHash, input.codeHash);
        const attemptedOtp = await tx.emailOtp.updateMany({
          where: {
            id: otp.id,
            purpose: "desktop_login",
            email: input.email,
            state: input.state,
            codeHash: otp.codeHash,
            consumedAt: null,
            attempts: { lt: 5 },
            expiresAt: { gt: input.now },
          },
          data: matches
            ? { attempts: { increment: 1 }, consumedAt: input.now }
            : { attempts: { increment: 1 } },
        });
        if (attemptedOtp.count !== 1 || !matches) {
          return { status: "invalid" } as const;
        }
        const user = await tx.user.upsert({
          where: { email: input.email },
          update: { updatedAt: input.now },
          create: {
            id: userId,
            email: input.email,
            createdAt: input.now,
            updatedAt: input.now,
          },
        });
        const ticket = await tx.desktopLoginTicket.create({
          data: {
            id: ticketId,
            ticketHash: input.ticketHash,
            state: input.state,
            userId: user.id,
            expiresAt: input.ticketExpiresAt,
            consumedAt: null,
            createdAt: input.now,
          },
        });
        return {
          status: "verified",
          user: user as UserRecord,
          ticket: ticket as DesktopLoginTicketRecord,
        } as const;
      }),
    );
    return attempted.status === "exhausted"
      ? { status: "temporarily_unavailable" }
      : attempted.value;
  }

  async verifyAdminOtpAndCreateSession(input: {
    email: string;
    state: string;
    codeHash: string;
    sessionTokenHash: string;
    csrfTokenHash: string;
    now: Date;
    sessionExpiresAt: Date;
  }): Promise<VerifyAdminOtpResult> {
    const sessionId = randomUUID();
    const attempted = await withConflictRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const otp = await tx.emailOtp.findFirst({
          where: {
            purpose: "admin_login",
            email: input.email,
            state: input.state,
            consumedAt: null,
            attempts: { lt: 5 },
            expiresAt: { gt: input.now },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (!otp) {
          return { status: "invalid" } as const;
        }
        const matches = constantTimeEqual(otp.codeHash, input.codeHash);
        const attemptedOtp = await tx.emailOtp.updateMany({
          where: {
            id: otp.id,
            purpose: "admin_login",
            email: input.email,
            state: input.state,
            codeHash: otp.codeHash,
            consumedAt: null,
            attempts: { lt: 5 },
            expiresAt: { gt: input.now },
          },
          data: matches
            ? { attempts: { increment: 1 }, consumedAt: input.now }
            : { attempts: { increment: 1 } },
        });
        if (attemptedOtp.count !== 1 || !matches) {
          return { status: "invalid" } as const;
        }
        const session = await tx.adminSession.create({
          data: {
            id: sessionId,
            email: input.email,
            tokenHash: input.sessionTokenHash,
            csrfTokenHash: input.csrfTokenHash,
            createdAt: input.now,
            expiresAt: input.sessionExpiresAt,
            revokedAt: null,
          },
        });
        return { status: "verified", session: session as AdminSessionRecord } as const;
      }),
    );
    return attempted.status === "exhausted"
      ? { status: "temporarily_unavailable" }
      : attempted.value;
  }

  async exchangeDesktopTicketAndCreateSession(input: {
    ticketHash: string;
    state: string;
    sessionTokenHash: string;
    now: Date;
    sessionExpiresAt: Date;
  }): Promise<ExchangeDesktopTicketResult> {
    const sessionId = randomUUID();
    const attempted = await withConflictRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const ticket = await tx.desktopLoginTicket.findUnique({
          where: { ticketHash: input.ticketHash },
        });
        if (
          !ticket ||
          ticket.state !== input.state ||
          ticket.consumedAt !== null ||
          ticket.expiresAt <= input.now
        ) {
          return { status: "invalid" } as const;
        }
        const user = await tx.user.findUnique({ where: { id: ticket.userId } });
        if (!user) {
          return { status: "invalid" } as const;
        }
        const consumed = await tx.desktopLoginTicket.updateMany({
          where: {
            id: ticket.id,
            ticketHash: input.ticketHash,
            state: input.state,
            consumedAt: null,
            expiresAt: { gt: input.now },
          },
          data: { consumedAt: input.now },
        });
        if (consumed.count !== 1) {
          return { status: "invalid" } as const;
        }
        const session = await tx.session.create({
          data: {
            id: sessionId,
            userId: user.id,
            tokenHash: input.sessionTokenHash,
            createdAt: input.now,
            expiresAt: input.sessionExpiresAt,
            revokedAt: null,
          },
        });
        return {
          status: "exchanged",
          user: user as UserRecord,
          session: session as SessionRecord,
        } as const;
      }),
    );
    return attempted.status === "exhausted"
      ? { status: "temporarily_unavailable" }
      : attempted.value;
  }

  async createEmailOtp(input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">): Promise<EmailOtpRecord> {
    return this.prisma.emailOtp.create({
      data: { ...input, id: randomUUID(), attempts: 0, consumedAt: null },
    }) as Promise<EmailOtpRecord>;
  }

  async findLatestUsableOtp(email: string, state: string, now: Date): Promise<EmailOtpRecord | null> {
    return this.prisma.emailOtp.findFirst({
      where: {
        email,
        state,
        consumedAt: null,
        attempts: { lt: 5 },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    }) as Promise<EmailOtpRecord | null>;
  }

  async incrementOtpAttempts(otpId: string): Promise<EmailOtpRecord> {
    return this.prisma.emailOtp.update({
      where: { id: otpId },
      data: { attempts: { increment: 1 } },
    }) as Promise<EmailOtpRecord>;
  }

  async consumeOtp(otpId: string, now: Date): Promise<void> {
    await this.prisma.emailOtp.update({
      where: { id: otpId },
      data: { consumedAt: now },
    });
  }

  async createDesktopLoginTicket(
    input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">,
  ): Promise<DesktopLoginTicketRecord> {
    return this.prisma.desktopLoginTicket.create({
      data: { ...input, id: randomUUID(), consumedAt: null },
    });
  }

  async consumeDesktopLoginTicket(
    ticketHash: string,
    state: string,
    now: Date,
  ): Promise<DesktopLoginTicketRecord | null> {
    const ticket = await this.prisma.desktopLoginTicket.findFirst({
      where: {
        ticketHash,
        state,
        consumedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (!ticket) {
      return null;
    }
    return this.prisma.desktopLoginTicket.update({
      where: { id: ticket.id },
      data: { consumedAt: now },
    });
  }

  async createSession(input: Omit<SessionRecord, "id" | "revokedAt">): Promise<SessionRecord> {
    return this.prisma.session.create({
      data: { ...input, id: randomUUID(), revokedAt: null },
    });
  }

  async findSessionByTokenHash(tokenHash: string, now: Date): Promise<SessionRecord | null> {
    return this.prisma.session.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash },
      data: { revokedAt: now },
    });
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

  async listUsers(): Promise<UserRecord[]> {
    return this.prisma.user.findMany({ orderBy: { email: "asc" } });
  }

  async createAdminSession(input: Omit<AdminSessionRecord, "id" | "revokedAt">): Promise<AdminSessionRecord> {
    return this.prisma.adminSession.create({
      data: { ...input, id: randomUUID(), revokedAt: null },
    });
  }

  async findAdminSessionByTokenHash(tokenHash: string, now: Date): Promise<AdminSessionRecord | null> {
    return this.prisma.adminSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
  }

  async revokeAdminSession(tokenHash: string, now: Date): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { tokenHash },
      data: { revokedAt: now },
    });
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

type PrismaRateLimitReservation = {
  id: string;
  keyHash: string;
  purpose: OtpPurpose;
  scope: AuthRateLimitScope;
  windowStartedAt: Date;
  nextAllowedAt: Date;
  maxCount: number;
};

class RateLimitExceededError extends Error {
  constructor(readonly retryAt: Date) {
    super("AUTH_RATE_LIMITED");
    this.name = "RateLimitExceededError";
  }
}

class StoreTemporarilyUnavailableError extends Error {
  constructor() {
    super("SERVER_TEMPORARILY_UNAVAILABLE");
    this.name = "StoreTemporarilyUnavailableError";
  }
}

function prismaRateLimitReservations(
  input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
): PrismaRateLimitReservation[] {
  const hourStart = new Date(
    Math.floor(input.createdAt.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000,
  );
  const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
  const reservation = (
    scope: AuthRateLimitScope,
    value: string,
    windowStartedAt: Date,
    nextAllowedAt: Date,
    maxCount: number,
  ): PrismaRateLimitReservation => ({
    id: randomUUID(),
    keyHash: authRateLimitKey(scope, input.purpose, value),
    purpose: input.purpose,
    scope,
    windowStartedAt,
    nextAllowedAt,
    maxCount,
  });
  return [
    reservation(
      "email_minute",
      input.email,
      input.createdAt,
      new Date(input.createdAt.getTime() + 60 * 1000),
      1,
    ),
    reservation("email_hour", input.email, hourStart, hourEnd, 5),
    reservation("ip_hour", input.ip, hourStart, hourEnd, 20),
  ];
}

async function reserveAuthRateLimit(
  tx: Prisma.TransactionClient,
  reservation: PrismaRateLimitReservation,
  now: Date,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ nextAllowedAt: Date }>>(Prisma.sql`
    INSERT INTO "AuthRateLimit" (
      "id", "keyHash", "purpose", "scope", "windowStartedAt", "count", "nextAllowedAt", "updatedAt"
    ) VALUES (
      ${reservation.id}, ${reservation.keyHash}, ${reservation.purpose}, ${reservation.scope},
      ${reservation.windowStartedAt}, 1, ${reservation.nextAllowedAt}, ${now}
    )
    ON CONFLICT("keyHash") DO UPDATE SET
      "windowStartedAt" = excluded."windowStartedAt",
      "count" = CASE
        WHEN excluded."scope" <> 'email_minute'
          AND "AuthRateLimit"."windowStartedAt" = excluded."windowStartedAt"
        THEN "AuthRateLimit"."count" + 1
        ELSE 1
      END,
      "nextAllowedAt" = excluded."nextAllowedAt",
      "updatedAt" = excluded."updatedAt"
    WHERE
      (excluded."scope" = 'email_minute' AND "AuthRateLimit"."nextAllowedAt" <= ${now})
      OR
      (excluded."scope" <> 'email_minute' AND (
        "AuthRateLimit"."windowStartedAt" <> excluded."windowStartedAt"
        OR "AuthRateLimit"."count" < ${reservation.maxCount}
      ))
    RETURNING "nextAllowedAt"
  `);
  if (rows.length > 0) {
    return;
  }
  const existing = await tx.authRateLimit.findUnique({ where: { keyHash: reservation.keyHash } });
  throw new RateLimitExceededError(existing?.nextAllowedAt ?? reservation.nextAllowedAt);
}

type ConflictRetryResult<T> =
  | { status: "completed"; value: T }
  | { status: "exhausted" };

async function withConflictRetry<T>(
  operation: () => Promise<T>,
  isAdditionalRetryable: (error: unknown) => boolean = () => false,
): Promise<ConflictRetryResult<T>> {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return { status: "completed", value: await operation() };
    } catch (error) {
      if (!isRetryablePrismaConflict(error) && !isAdditionalRetryable(error)) {
        throw error;
      }
      if (attempt === maximumAttempts) {
        return { status: "exhausted" };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 5));
    }
  }
  return { status: "exhausted" };
}

function isRetryablePrismaConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034" || error.code === "P1008") {
      return true;
    }
    if (error.code === "P2010") {
      const meta = error.meta as { code?: unknown; message?: unknown } | undefined;
      return meta?.code === "5" || hasSqliteBusyMarker(meta?.message);
    }
    return error.code === "P2028" && hasSqliteBusyMarker(error.message);
  }
  return error instanceof Prisma.PrismaClientUnknownRequestError && hasSqliteBusyMarker(error.message);
}

function hasSqliteBusyMarker(value: unknown): boolean {
  return typeof value === "string" && /SQLITE_BUSY|database (?:table )?is locked/i.test(value);
}

function isLlmUsageEventIdempotencyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.includes("userId") && target.includes("requestId");
  }
  return typeof target === "string" && target.includes("userId") && target.includes("requestId");
}

function isPrismaKnownError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function storedWebhookTransactionId(payload: string): string | null {
  try {
    const value = JSON.parse(payload) as { transactionId?: unknown };
    return typeof value.transactionId === "string" ? value.transactionId : null;
  } catch {
    return null;
  }
}
