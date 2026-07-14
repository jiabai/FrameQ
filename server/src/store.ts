import { randomUUID } from "node:crypto";

export type UserRecord = {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
};

export type EmailOtpRecord = {
  id: string;
  email: string;
  state: string;
  codeHash: string;
  ip: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type DesktopLoginTicketRecord = {
  id: string;
  ticketHash: string;
  state: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type OrderRecord = {
  id: string;
  userId: string;
  outTradeNo: string;
  amountFen: number;
  status: "pending" | "paid" | "expired" | "cancelled";
  codeUrl: string;
  expiresAt: Date;
  createdAt: Date;
  paidAt: Date | null;
  transactionId: string | null;
  providerPayload: string;
};

export type EntitlementRecord = {
  id: string;
  userId: string;
  status: "active" | "inactive";
  expiresAt: Date;
  llmQuotaLimit: number;
  llmQuotaUsed: number;
  updatedAt: Date;
};

export type LlmConfigRecord = {
  id: string;
  provider: string;
  baseUrl: string;
  model: string;
  encryptedApiKey: string;
  apiKeyLast4: string;
  timeoutSeconds: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AnysearchConfigRecord = {
  id: string;
  mcpUrl: string;
  encryptedApiKey: string;
  apiKeyLast4: string;
  createdAt: Date;
  updatedAt: Date;
};

export type LlmUsageEventRecord = {
  id: string;
  userId: string;
  entitlementId: string;
  requestId: string;
  createdAt: Date;
};

export type ActivationCodeRecord = {
  id: string;
  codeHash: string;
  codePrefix: string;
  status: "active" | "redeemed" | "expired" | "disabled";
  entitlementDays: number;
  redeemBy: Date;
  createdAt: Date;
  redeemedAt: Date | null;
  redeemedByUserId: string | null;
};

export type AdminSessionRecord = {
  id: string;
  email: string;
  tokenHash: string;
  csrfTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type AdminEntitlementAdjustmentRecord = {
  id: string;
  adminEmail: string;
  userId: string;
  reason: string;
  note: string | null;
  beforeExpiresAt: Date | null;
  afterExpiresAt: Date;
  beforeLlmQuotaLimit: number;
  afterLlmQuotaLimit: number;
  beforeLlmQuotaUsed: number;
  afterLlmQuotaUsed: number;
  createdAt: Date;
};

export type WebhookEventRecord = {
  id: string;
  provider: string;
  eventId: string;
  outTradeNo: string;
  payload: string;
  createdAt: Date;
};

export type PaidOrderSettlement =
  | { status: "settled"; entitlement: EntitlementRecord }
  | { status: "order_not_found" }
  | { status: "order_state_conflict" }
  | { status: "webhook_order_mismatch" }
  | { status: "transaction_mismatch" };

export type ActivationRedemption =
  | { status: "redeemed"; entitlement: EntitlementRecord }
  | { status: "session_invalid" }
  | { status: "code_invalid" };

export type EntitlementAdjustmentApplication =
  | { status: "applied"; entitlement: EntitlementRecord; adjustment: AdminEntitlementAdjustmentRecord }
  | { status: "user_not_found" }
  | { status: "expiry_required" };

export type Store = {
  upsertUserByEmail(email: string, now: Date): Promise<UserRecord>;
  getUserById(userId: string): Promise<UserRecord | null>;
  createEmailOtp(input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">): Promise<EmailOtpRecord>;
  findLatestUsableOtp(email: string, state: string, now: Date): Promise<EmailOtpRecord | null>;
  incrementOtpAttempts(otpId: string): Promise<EmailOtpRecord>;
  consumeOtp(otpId: string, now: Date): Promise<void>;
  createDesktopLoginTicket(input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">): Promise<DesktopLoginTicketRecord>;
  consumeDesktopLoginTicket(ticketHash: string, state: string, now: Date): Promise<DesktopLoginTicketRecord | null>;
  createSession(input: Omit<SessionRecord, "id" | "revokedAt">): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  createOrder(input: Omit<OrderRecord, "id" | "paidAt" | "transactionId">): Promise<OrderRecord>;
  findOrderByOutTradeNo(outTradeNo: string): Promise<OrderRecord | null>;
  markOrderPaid(outTradeNo: string, transactionId: string, paidAt: Date): Promise<OrderRecord>;
  settlePaidOrder(input: {
    provider: string;
    eventId: string;
    outTradeNo: string;
    transactionId: string;
    paidAt: Date;
    now: Date;
    passDays: number;
  }): Promise<PaidOrderSettlement>;
  getEntitlement(userId: string): Promise<EntitlementRecord | null>;
  upsertEntitlement(
    userId: string,
    expiresAt: Date,
    now: Date,
    quota?: { llmQuotaLimit?: number; llmQuotaUsed?: number },
  ): Promise<EntitlementRecord>;
  consumeLlmQuota(userId: string, requestId: string, now: Date): Promise<{ entitlement: EntitlementRecord; reused: boolean } | null>;
  getLlmConfig(): Promise<LlmConfigRecord | null>;
  upsertLlmConfig(input: Omit<LlmConfigRecord, "id" | "createdAt" | "updatedAt">, now: Date): Promise<LlmConfigRecord>;
  getAnysearchConfig(): Promise<AnysearchConfigRecord | null>;
  upsertAnysearchConfig(
    input: Omit<AnysearchConfigRecord, "id" | "createdAt" | "updatedAt">,
    now: Date,
  ): Promise<AnysearchConfigRecord>;
  createActivationCode(input: Omit<ActivationCodeRecord, "id">): Promise<ActivationCodeRecord>;
  findActivationCodeByHash(codeHash: string): Promise<ActivationCodeRecord | null>;
  markActivationCodeRedeemed(codeHash: string, userId: string, redeemedAt: Date): Promise<ActivationCodeRecord | null>;
  redeemActivationCodeAndGrantEntitlement(input: {
    sessionTokenHash: string;
    codeHash: string;
    now: Date;
    llmQuotaPerActivation: number;
  }): Promise<ActivationRedemption>;
  listActivationCodes(): Promise<ActivationCodeRecord[]>;
  listUsers(): Promise<UserRecord[]>;
  createAdminSession(input: Omit<AdminSessionRecord, "id" | "revokedAt">): Promise<AdminSessionRecord>;
  findAdminSessionByTokenHash(tokenHash: string, now: Date): Promise<AdminSessionRecord | null>;
  revokeAdminSession(tokenHash: string, now: Date): Promise<void>;
  createAdminEntitlementAdjustment(
    input: AdminEntitlementAdjustmentRecord,
  ): Promise<AdminEntitlementAdjustmentRecord>;
  applyEntitlementAdjustmentWithAudit(input: {
    adminEmail: string;
    userId: string;
    reason: string;
    note: string | null;
    extendDays?: number;
    expiresAt?: Date;
    quotaAdd?: number;
    now: Date;
  }): Promise<EntitlementAdjustmentApplication>;
  listAdminEntitlementAdjustments(limit?: number): Promise<AdminEntitlementAdjustmentRecord[]>;
  createWebhookEvent(input: Omit<WebhookEventRecord, "id" | "createdAt"> & { createdAt: Date }): Promise<boolean>;
};

export class MemoryStore implements Store {
  users: UserRecord[] = [];
  emailOtps: EmailOtpRecord[] = [];
  desktopLoginTickets: DesktopLoginTicketRecord[] = [];
  sessions: SessionRecord[] = [];
  orders: OrderRecord[] = [];
  entitlements: EntitlementRecord[] = [];
  llmConfig: LlmConfigRecord | null = null;
  anysearchConfig: AnysearchConfigRecord | null = null;
  llmUsageEvents: LlmUsageEventRecord[] = [];
  activationCodes: ActivationCodeRecord[] = [];
  adminSessions: AdminSessionRecord[] = [];
  adminEntitlementAdjustments: AdminEntitlementAdjustmentRecord[] = [];
  webhookEvents: WebhookEventRecord[] = [];
  private atomicTail: Promise<void> = Promise.resolve();

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
  ): Promise<{ entitlement: EntitlementRecord; reused: boolean } | null> {
    const existingEvent = this.llmUsageEvents.find(
      (event) => event.userId === userId && event.requestId === requestId,
    );
    const entitlement = await this.getEntitlement(userId);
    if (!entitlement || entitlement.expiresAt <= now) {
      return null;
    }
    if (existingEvent) {
      return { entitlement, reused: true };
    }
    if (entitlement.llmQuotaUsed >= entitlement.llmQuotaLimit) {
      return null;
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
    return { entitlement, reused: false };
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

  async getAnysearchConfig(): Promise<AnysearchConfigRecord | null> {
    return this.anysearchConfig;
  }

  async upsertAnysearchConfig(
    input: Omit<AnysearchConfigRecord, "id" | "createdAt" | "updatedAt">,
    now: Date,
  ): Promise<AnysearchConfigRecord> {
    if (this.anysearchConfig) {
      this.anysearchConfig = { ...this.anysearchConfig, ...input, updatedAt: now };
      return this.anysearchConfig;
    }
    this.anysearchConfig = {
      ...input,
      id: "default",
      createdAt: now,
      updatedAt: now,
    };
    return this.anysearchConfig;
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
    const previous = this.atomicTail;
    let release = () => {};
    this.atomicTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone({
      users: this.users,
      emailOtps: this.emailOtps,
      desktopLoginTickets: this.desktopLoginTickets,
      sessions: this.sessions,
      orders: this.orders,
      entitlements: this.entitlements,
      llmConfig: this.llmConfig,
      llmUsageEvents: this.llmUsageEvents,
      activationCodes: this.activationCodes,
      adminSessions: this.adminSessions,
      adminEntitlementAdjustments: this.adminEntitlementAdjustments,
      webhookEvents: this.webhookEvents,
    });
    try {
      return await operation();
    } catch (error) {
      this.users = snapshot.users;
      this.emailOtps = snapshot.emailOtps;
      this.desktopLoginTickets = snapshot.desktopLoginTickets;
      this.sessions = snapshot.sessions;
      this.orders = snapshot.orders;
      this.entitlements = snapshot.entitlements;
      this.llmConfig = snapshot.llmConfig;
      this.llmUsageEvents = snapshot.llmUsageEvents;
      this.activationCodes = snapshot.activationCodes;
      this.adminSessions = snapshot.adminSessions;
      this.adminEntitlementAdjustments = snapshot.adminEntitlementAdjustments;
      this.webhookEvents = snapshot.webhookEvents;
      throw error;
    } finally {
      release();
    }
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
