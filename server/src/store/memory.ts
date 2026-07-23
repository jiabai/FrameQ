import { randomUUID } from "node:crypto";
import { authRateLimitKey, constantTimeEqual } from "../security.js";
import type {
  ActivationCodeRecord,
  ActivationRedemption,
  AdminEntitlementAdjustmentRecord,
  AdminSessionRecord,
  AuthRateLimitRecord,
  AuthRateLimitScope,
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  EntitlementAdjustmentApplication,
  EntitlementRecord,
  ExchangeDesktopTicketResult,
  IssueEmailOtpResult,
  LlmConfigRecord,
  LlmQuotaCheckoutResult,
  LlmUsageEventRecord,
  OrderRecord,
  OtpPurpose,
  PaidOrderSettlement,
  SessionRecord,
  Store,
  UserRecord,
  VerifyAdminOtpResult,
  VerifyDesktopOtpResult,
  WebhookEventRecord,
} from "./contracts.js";
import { MemoryAtomicCoordinator } from "./memory/atomic.js";

export class MemoryStore implements Store {
  users: UserRecord[] = [];
  emailOtps: EmailOtpRecord[] = [];
  desktopLoginTickets: DesktopLoginTicketRecord[] = [];
  sessions: SessionRecord[] = [];
  orders: OrderRecord[] = [];
  entitlements: EntitlementRecord[] = [];
  llmConfig: LlmConfigRecord | null = null;
  llmUsageEvents: LlmUsageEventRecord[] = [];
  activationCodes: ActivationCodeRecord[] = [];
  adminSessions: AdminSessionRecord[] = [];
  adminEntitlementAdjustments: AdminEntitlementAdjustmentRecord[] = [];
  webhookEvents: WebhookEventRecord[] = [];
  authRateLimits: AuthRateLimitRecord[] = [];
  private readonly atomic = new MemoryAtomicCoordinator(this);

  async upsertUserByEmail(email: string, now: Date): Promise<UserRecord> {
    const existing = this.users.find((user) => user.email === email);
    if (existing) {
      existing.updatedAt = now;
      return existing;
    }
    const user = { id: randomUUID(), email, createdAt: now, updatedAt: now };
    this.users.push(user);
    return user;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async issueEmailOtp(
    input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
  ): Promise<IssueEmailOtpResult> {
    return this.runAtomically(async () => {
      const reservations = rateLimitReservations(input);
      const limitedUntil = reservations
        .map((reservation) => this.planRateLimitReservation(reservation, input.createdAt))
        .filter((result): result is { allowed: false; retryAt: Date } => !result.allowed)
        .map((result) => result.retryAt);
      if (limitedUntil.length > 0) {
        return {
          status: "rate_limited",
          retryAt: new Date(Math.max(...limitedUntil.map((value) => value.getTime()))),
        };
      }

      for (const reservation of reservations) {
        this.applyRateLimitReservation(reservation, input.createdAt);
      }
      for (const otp of this.emailOtps) {
        if (
          otp.purpose === input.purpose &&
          otp.email === input.email &&
          otp.state === input.state &&
          otp.consumedAt === null
        ) {
          otp.consumedAt = input.createdAt;
        }
      }
      const otp = await this.createEmailOtp(input);
      return { status: "issued", otpId: otp.id };
    });
  }

  async invalidateIssuedOtpAfterDeliveryFailure(otpId: string, now: Date): Promise<void> {
    await this.runAtomically(async () => {
      const otp = this.emailOtps.find((record) => record.id === otpId);
      if (otp?.consumedAt === null) {
        otp.consumedAt = now;
      }
    });
  }

  async verifyDesktopOtpAndCreateTicket(input: {
    email: string;
    state: string;
    codeHash: string;
    ticketHash: string;
    now: Date;
    ticketExpiresAt: Date;
  }): Promise<VerifyDesktopOtpResult> {
    return this.runAtomically(async () => {
      const otp = this.latestUsableOtp("desktop_login", input.email, input.state, input.now);
      if (!otp) {
        return { status: "invalid" };
      }
      otp.attempts += 1;
      if (!constantTimeEqual(otp.codeHash, input.codeHash)) {
        return { status: "invalid" };
      }
      otp.consumedAt = input.now;
      const user = await this.upsertUserByEmail(input.email, input.now);
      const ticket = await this.createDesktopLoginTicket({
        ticketHash: input.ticketHash,
        state: input.state,
        userId: user.id,
        expiresAt: input.ticketExpiresAt,
        createdAt: input.now,
      });
      return { status: "verified", user, ticket };
    });
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
    return this.runAtomically(async () => {
      const otp = this.latestUsableOtp("admin_login", input.email, input.state, input.now);
      if (!otp) {
        return { status: "invalid" };
      }
      otp.attempts += 1;
      if (!constantTimeEqual(otp.codeHash, input.codeHash)) {
        return { status: "invalid" };
      }
      otp.consumedAt = input.now;
      const session = await this.createAdminSession({
        email: input.email,
        tokenHash: input.sessionTokenHash,
        csrfTokenHash: input.csrfTokenHash,
        createdAt: input.now,
        expiresAt: input.sessionExpiresAt,
      });
      return { status: "verified", session };
    });
  }

  async exchangeDesktopTicketAndCreateSession(input: {
    ticketHash: string;
    state: string;
    sessionTokenHash: string;
    now: Date;
    sessionExpiresAt: Date;
  }): Promise<ExchangeDesktopTicketResult> {
    return this.runAtomically(async () => {
      const ticket = this.desktopLoginTickets.find(
        (record) =>
          record.ticketHash === input.ticketHash &&
          record.state === input.state &&
          record.consumedAt === null &&
          record.expiresAt > input.now,
      );
      if (!ticket) {
        return { status: "invalid" };
      }
      const user = await this.getUserById(ticket.userId);
      if (!user) {
        return { status: "invalid" };
      }
      ticket.consumedAt = input.now;
      const session = await this.createSession({
        userId: user.id,
        tokenHash: input.sessionTokenHash,
        createdAt: input.now,
        expiresAt: input.sessionExpiresAt,
      });
      return { status: "exchanged", user, session };
    });
  }

  async createEmailOtp(input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">): Promise<EmailOtpRecord> {
    const otp = { ...input, id: randomUUID(), attempts: 0, consumedAt: null };
    this.emailOtps.push(otp);
    return otp;
  }

  async findLatestUsableOtp(email: string, state: string, now: Date): Promise<EmailOtpRecord | null> {
    return (
      [...this.emailOtps]
        .reverse()
        .find(
          (otp) =>
            otp.email === email &&
            otp.state === state &&
            otp.consumedAt === null &&
            otp.attempts < 5 &&
            otp.expiresAt > now,
        ) ?? null
    );
  }

  async incrementOtpAttempts(otpId: string): Promise<EmailOtpRecord> {
    const otp = this.emailOtps.find((record) => record.id === otpId);
    if (!otp) {
      throw new Error("OTP record not found.");
    }
    otp.attempts += 1;
    return otp;
  }

  async consumeOtp(otpId: string, now: Date): Promise<void> {
    const otp = this.emailOtps.find((record) => record.id === otpId);
    if (otp) {
      otp.consumedAt = now;
    }
  }

  async createDesktopLoginTicket(
    input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">,
  ): Promise<DesktopLoginTicketRecord> {
    const ticket = { ...input, id: randomUUID(), consumedAt: null };
    this.desktopLoginTickets.push(ticket);
    return ticket;
  }

  async consumeDesktopLoginTicket(
    ticketHash: string,
    state: string,
    now: Date,
  ): Promise<DesktopLoginTicketRecord | null> {
    const ticket =
      this.desktopLoginTickets.find(
        (record) =>
          record.ticketHash === ticketHash &&
          record.state === state &&
          record.consumedAt === null &&
          record.expiresAt > now,
      ) ?? null;
    if (ticket) {
      ticket.consumedAt = now;
    }
    return ticket;
  }

  async createSession(input: Omit<SessionRecord, "id" | "revokedAt">): Promise<SessionRecord> {
    const session = { ...input, id: randomUUID(), revokedAt: null };
    this.sessions.push(session);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string, now: Date): Promise<SessionRecord | null> {
    return (
      this.sessions.find(
        (session) => session.tokenHash === tokenHash && session.revokedAt === null && session.expiresAt > now,
      ) ?? null
    );
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    const session = this.sessions.find((record) => record.tokenHash === tokenHash);
    if (session) {
      session.revokedAt = now;
    }
  }

  async createOrder(input: Omit<OrderRecord, "id" | "paidAt" | "transactionId">): Promise<OrderRecord> {
    const order = { ...input, id: randomUUID(), paidAt: null, transactionId: null };
    this.orders.push(order);
    return order;
  }

  async findOrderByOutTradeNo(outTradeNo: string): Promise<OrderRecord | null> {
    return this.orders.find((order) => order.outTradeNo === outTradeNo) ?? null;
  }

  async markOrderPaid(outTradeNo: string, transactionId: string, paidAt: Date): Promise<OrderRecord> {
    const order = await this.findOrderByOutTradeNo(outTradeNo);
    if (!order) {
      throw new Error("Order not found.");
    }
    order.status = "paid";
    order.transactionId = transactionId;
    order.paidAt = paidAt;
    return order;
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
    return this.runAtomically(async () => {
      const existingEvent = this.webhookEvents.find(
        (event) => event.provider === input.provider && event.eventId === input.eventId,
      );
      if (existingEvent && existingEvent.outTradeNo !== input.outTradeNo) {
        return { status: "webhook_order_mismatch" };
      }
      const existingEventTransactionId = existingEvent
        ? storedWebhookTransactionId(existingEvent.payload)
        : null;
      if (existingEvent && existingEventTransactionId !== input.transactionId) {
        return { status: "transaction_mismatch" };
      }
      const order = await this.findOrderByOutTradeNo(input.outTradeNo);
      if (!order) {
        return { status: "order_not_found" };
      }
      if (order.status === "paid") {
        if (!order.transactionId || order.transactionId !== input.transactionId) {
          return { status: "transaction_mismatch" };
        }
        const entitlement = await this.getEntitlement(order.userId);
        if (entitlement) {
          if (!existingEvent) {
            const created = await this.createWebhookEvent({
              provider: input.provider,
              eventId: input.eventId,
              outTradeNo: input.outTradeNo,
              payload: JSON.stringify({
                outTradeNo: input.outTradeNo,
                transactionId: input.transactionId,
                paidAt: input.paidAt.toISOString(),
              }),
              createdAt: input.now,
            });
            if (!created) {
              return { status: "webhook_order_mismatch" };
            }
          }
          return { status: "settled", entitlement };
        }
        if (!existingEvent) {
          return { status: "order_state_conflict" };
        }
        const recovered = await this.extendMonthlyPass(order.userId, order.paidAt ?? input.paidAt, input);
        return { status: "settled", entitlement: recovered };
      }
      if (order.status !== "pending" || order.transactionId !== null || order.paidAt !== null) {
        return { status: "order_state_conflict" };
      }
      if (!existingEvent) {
        const created = await this.createWebhookEvent({
          provider: input.provider,
          eventId: input.eventId,
          outTradeNo: input.outTradeNo,
          payload: JSON.stringify({
            outTradeNo: input.outTradeNo,
            transactionId: input.transactionId,
            paidAt: input.paidAt.toISOString(),
          }),
          createdAt: input.now,
        });
        if (!created) {
          return { status: "webhook_order_mismatch" };
        }
      }
      await this.markOrderPaid(input.outTradeNo, input.transactionId, input.paidAt);
      const entitlement = await this.extendMonthlyPass(order.userId, input.paidAt, input);
      return { status: "settled", entitlement };
    });
  }

  async getEntitlement(userId: string): Promise<EntitlementRecord | null> {
    return this.entitlements.find((entitlement) => entitlement.userId === userId) ?? null;
  }

  async upsertEntitlement(
    userId: string,
    expiresAt: Date,
    now: Date,
    quota: { llmQuotaLimit?: number; llmQuotaUsed?: number } = {},
  ): Promise<EntitlementRecord> {
    const existing = await this.getEntitlement(userId);
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
    this.entitlements.push(entitlement);
    return entitlement;
  }

  async consumeLlmQuota(
    userId: string,
    requestId: string,
    now: Date,
  ): Promise<LlmQuotaCheckoutResult> {
    return this.runAtomically(async () => {
      const existingEvent = this.llmUsageEvents.find(
        (event) => event.userId === userId && event.requestId === requestId,
      );
      const entitlement = await this.getEntitlement(userId);
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
      this.llmUsageEvents.push({
        id: randomUUID(),
        userId,
        entitlementId: entitlement.id,
        requestId,
        createdAt: now,
      });
      return { status: "consumed", entitlement };
    });
  }

  async getLlmConfig(): Promise<LlmConfigRecord | null> {
    return this.llmConfig;
  }

  async upsertLlmConfig(
    input: Omit<LlmConfigRecord, "id" | "createdAt" | "updatedAt">,
    now: Date,
  ): Promise<LlmConfigRecord> {
    if (this.llmConfig) {
      this.llmConfig = { ...this.llmConfig, ...input, updatedAt: now };
      return this.llmConfig;
    }
    this.llmConfig = {
      ...input,
      id: "default",
      createdAt: now,
      updatedAt: now,
    };
    return this.llmConfig;
  }

  async createActivationCode(input: Omit<ActivationCodeRecord, "id">): Promise<ActivationCodeRecord> {
    const code: ActivationCodeRecord = { ...input, id: randomUUID() };
    this.activationCodes.push(code);
    return code;
  }

  async findActivationCodeByHash(codeHash: string): Promise<ActivationCodeRecord | null> {
    return this.activationCodes.find((code) => code.codeHash === codeHash) ?? null;
  }

  async markActivationCodeRedeemed(
    codeHash: string,
    userId: string,
    redeemedAt: Date,
  ): Promise<ActivationCodeRecord | null> {
    const code = await this.findActivationCodeByHash(codeHash);
    if (!code || code.status !== "active" || code.redeemedAt !== null) {
      return null;
    }
    code.status = "redeemed";
    code.redeemedByUserId = userId;
    code.redeemedAt = redeemedAt;
    return code;
  }

  async redeemActivationCodeAndGrantEntitlement(input: {
    sessionTokenHash: string;
    codeHash: string;
    now: Date;
    llmQuotaPerActivation: number;
  }): Promise<ActivationRedemption> {
    return this.runAtomically(async () => {
      const session = await this.findSessionByTokenHash(input.sessionTokenHash, input.now);
      if (!session) {
        return { status: "session_invalid" };
      }
      const code = await this.findActivationCodeByHash(input.codeHash);
      if (!code || code.status !== "active" || code.redeemedAt !== null || code.redeemBy <= input.now) {
        return { status: "code_invalid" };
      }
      const redeemed = await this.markActivationCodeRedeemed(input.codeHash, session.userId, input.now);
      if (!redeemed) {
        return { status: "code_invalid" };
      }
      const existing = await this.getEntitlement(session.userId);
      const active = Boolean(existing && existing.expiresAt > input.now);
      const base = active && existing ? existing.expiresAt : input.now;
      const quota = active && existing
        ? {
            llmQuotaLimit: existing.llmQuotaLimit + input.llmQuotaPerActivation,
            llmQuotaUsed: existing.llmQuotaUsed,
          }
        : { llmQuotaLimit: input.llmQuotaPerActivation, llmQuotaUsed: 0 };
      const entitlement = await this.upsertEntitlement(
        session.userId,
        new Date(base.getTime() + redeemed.entitlementDays * 24 * 60 * 60 * 1000),
        input.now,
        quota,
      );
      return { status: "redeemed", entitlement };
    });
  }

  async listActivationCodes(): Promise<ActivationCodeRecord[]> {
    return [...this.activationCodes].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async listUsers(): Promise<UserRecord[]> {
    return [...this.users].sort((left, right) => left.email.localeCompare(right.email));
  }

  async createAdminSession(input: Omit<AdminSessionRecord, "id" | "revokedAt">): Promise<AdminSessionRecord> {
    const session = { ...input, id: randomUUID(), revokedAt: null };
    this.adminSessions.push(session);
    return session;
  }

  async findAdminSessionByTokenHash(tokenHash: string, now: Date): Promise<AdminSessionRecord | null> {
    return (
      this.adminSessions.find(
        (session) => session.tokenHash === tokenHash && session.revokedAt === null && session.expiresAt > now,
      ) ?? null
    );
  }

  async revokeAdminSession(tokenHash: string, now: Date): Promise<void> {
    const session = this.adminSessions.find((record) => record.tokenHash === tokenHash);
    if (session) {
      session.revokedAt = now;
    }
  }

  async createAdminEntitlementAdjustment(
    input: AdminEntitlementAdjustmentRecord,
  ): Promise<AdminEntitlementAdjustmentRecord> {
    this.adminEntitlementAdjustments.push(input);
    return input;
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
    return this.runAtomically(async () => {
      const user = await this.getUserById(input.userId);
      if (!user) {
        return { status: "user_not_found" };
      }
      const before = await this.getEntitlement(input.userId);
      const beforeExpiresAt = before ? new Date(before.expiresAt) : null;
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
      const entitlement = await this.upsertEntitlement(input.userId, afterExpiresAt, input.now, {
        llmQuotaLimit: beforeLlmQuotaLimit + (input.quotaAdd ?? 0),
        llmQuotaUsed: beforeLlmQuotaUsed,
      });
      const adjustment = await this.createAdminEntitlementAdjustment({
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

  async listAdminEntitlementAdjustments(limit = 50): Promise<AdminEntitlementAdjustmentRecord[]> {
    return [...this.adminEntitlementAdjustments]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit);
  }

  async createWebhookEvent(
    input: Omit<WebhookEventRecord, "id" | "createdAt"> & { createdAt: Date },
  ): Promise<boolean> {
    if (
      this.webhookEvents.some(
        (event) => event.provider === input.provider && event.eventId === input.eventId,
      )
    ) {
      return false;
    }
    this.webhookEvents.push({ ...input, id: randomUUID() });
    return true;
  }

  private latestUsableOtp(
    purpose: OtpPurpose,
    email: string,
    state: string,
    now: Date,
  ): EmailOtpRecord | null {
    return (
      [...this.emailOtps]
        .reverse()
        .find(
          (otp) =>
            otp.purpose === purpose &&
            otp.email === email &&
            otp.state === state &&
            otp.consumedAt === null &&
            otp.attempts < 5 &&
            otp.expiresAt > now,
        ) ?? null
    );
  }

  private planRateLimitReservation(
    reservation: RateLimitReservation,
    now: Date,
  ): { allowed: true } | { allowed: false; retryAt: Date } {
    const existing = this.authRateLimits.find((record) => record.keyHash === reservation.keyHash);
    if (!existing) {
      return { allowed: true };
    }
    if (reservation.scope === "email_minute") {
      return existing.nextAllowedAt > now
        ? { allowed: false, retryAt: existing.nextAllowedAt }
        : { allowed: true };
    }
    const sameWindow = existing.windowStartedAt.getTime() === reservation.windowStartedAt.getTime();
    if (sameWindow && existing.count >= reservation.maxCount) {
      return { allowed: false, retryAt: existing.nextAllowedAt };
    }
    return { allowed: true };
  }

  private applyRateLimitReservation(reservation: RateLimitReservation, now: Date): void {
    const existing = this.authRateLimits.find((record) => record.keyHash === reservation.keyHash);
    if (!existing) {
      this.authRateLimits.push({
        id: randomUUID(),
        keyHash: reservation.keyHash,
        purpose: reservation.purpose,
        scope: reservation.scope,
        windowStartedAt: reservation.windowStartedAt,
        count: 1,
        nextAllowedAt: reservation.nextAllowedAt,
        updatedAt: now,
      });
      return;
    }
    const sameWindow = existing.windowStartedAt.getTime() === reservation.windowStartedAt.getTime();
    existing.windowStartedAt = reservation.windowStartedAt;
    existing.count = sameWindow ? existing.count + 1 : 1;
    existing.nextAllowedAt = reservation.nextAllowedAt;
    existing.updatedAt = now;
  }

  private async extendMonthlyPass(
    userId: string,
    paidAt: Date,
    input: { now: Date; passDays: number },
  ): Promise<EntitlementRecord> {
    const existing = await this.getEntitlement(userId);
    const base = existing && existing.expiresAt > paidAt ? existing.expiresAt : paidAt;
    return this.upsertEntitlement(
      userId,
      new Date(base.getTime() + input.passDays * 24 * 60 * 60 * 1000),
      input.now,
    );
  }

  private async runAtomically<T>(operation: () => Promise<T>): Promise<T> {
    return this.atomic.run(operation);
  }
}

type RateLimitReservation = {
  keyHash: string;
  purpose: OtpPurpose;
  scope: AuthRateLimitScope;
  windowStartedAt: Date;
  nextAllowedAt: Date;
  maxCount: number;
};

function rateLimitReservations(
  input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
): RateLimitReservation[] {
  const now = input.createdAt;
  const hourStart = new Date(Math.floor(now.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000);
  const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
  const reservation = (
    scope: AuthRateLimitScope,
    value: string,
    windowStartedAt: Date,
    nextAllowedAt: Date,
    maxCount: number,
  ): RateLimitReservation => ({
    keyHash: authRateLimitKey(scope, input.purpose, value),
    purpose: input.purpose,
    scope,
    windowStartedAt,
    nextAllowedAt,
    maxCount,
  });
  return [
    reservation("email_minute", input.email, now, new Date(now.getTime() + 60 * 1000), 1),
    reservation("email_hour", input.email, hourStart, hourEnd, 5),
    reservation("ip_hour", input.ip, hourStart, hourEnd, 20),
  ];
}

function storedWebhookTransactionId(payload: string): string | null {
  try {
    const value = JSON.parse(payload) as { transactionId?: unknown };
    return typeof value.transactionId === "string" ? value.transactionId : null;
  } catch {
    return null;
  }
}
