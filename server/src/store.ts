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

export type WebhookEventRecord = {
  id: string;
  provider: string;
  eventId: string;
  outTradeNo: string;
  payload: string;
  createdAt: Date;
};

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
  getEntitlement(userId: string): Promise<EntitlementRecord | null>;
  upsertEntitlement(
    userId: string,
    expiresAt: Date,
    now: Date,
    quota?: { llmQuotaLimit?: number; llmQuotaUsed?: number },
  ): Promise<EntitlementRecord>;
  updateEntitlementQuota(userId: string, llmQuotaLimit: number, llmQuotaUsed: number, now: Date): Promise<EntitlementRecord | null>;
  consumeLlmQuota(userId: string, requestId: string, now: Date): Promise<{ entitlement: EntitlementRecord; reused: boolean } | null>;
  getLlmConfig(): Promise<LlmConfigRecord | null>;
  upsertLlmConfig(input: Omit<LlmConfigRecord, "id" | "createdAt" | "updatedAt">, now: Date): Promise<LlmConfigRecord>;
  createActivationCode(input: Omit<ActivationCodeRecord, "id">): Promise<ActivationCodeRecord>;
  findActivationCodeByHash(codeHash: string): Promise<ActivationCodeRecord | null>;
  markActivationCodeRedeemed(codeHash: string, userId: string, redeemedAt: Date): Promise<ActivationCodeRecord | null>;
  listActivationCodes(): Promise<ActivationCodeRecord[]>;
  listUsers(): Promise<UserRecord[]>;
  createAdminSession(input: Omit<AdminSessionRecord, "id" | "revokedAt">): Promise<AdminSessionRecord>;
  findAdminSessionByTokenHash(tokenHash: string, now: Date): Promise<AdminSessionRecord | null>;
  revokeAdminSession(tokenHash: string, now: Date): Promise<void>;
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
  llmUsageEvents: LlmUsageEventRecord[] = [];
  activationCodes: ActivationCodeRecord[] = [];
  adminSessions: AdminSessionRecord[] = [];
  webhookEvents: WebhookEventRecord[] = [];

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

  async updateEntitlementQuota(
    userId: string,
    llmQuotaLimit: number,
    llmQuotaUsed: number,
    now: Date,
  ): Promise<EntitlementRecord | null> {
    const entitlement = await this.getEntitlement(userId);
    if (!entitlement) {
      return null;
    }
    entitlement.llmQuotaLimit = llmQuotaLimit;
    entitlement.llmQuotaUsed = llmQuotaUsed;
    entitlement.updatedAt = now;
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
}
