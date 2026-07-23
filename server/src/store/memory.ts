import type {
  ActivationCodeRecord,
  AdminEntitlementAdjustmentRecord,
  AdminSessionRecord,
  AuthRateLimitRecord,
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  EntitlementRecord,
  LlmConfigRecord,
  LlmUsageEventRecord,
  OrderRecord,
  SessionRecord,
  Store,
  UserRecord,
  WebhookEventRecord,
} from "./contracts.js";
import { MemoryAtomicCoordinator } from "./memory/atomic.js";
import * as authOperations from "./memory/auth.js";
import * as billingOperations from "./memory/billing.js";
import * as entitlementOperations from "./memory/entitlements.js";
import * as llmConfigOperations from "./memory/llmConfig.js";

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

  async upsertUserByEmail(email: string, now: Date): ReturnType<Store["upsertUserByEmail"]> {
    return authOperations.upsertUserByEmail(this.authContext(), email, now);
  }

  async getUserById(userId: string): ReturnType<Store["getUserById"]> {
    return authOperations.getUserById(this.authContext(), userId);
  }

  async issueEmailOtp(input: Parameters<Store["issueEmailOtp"]>[0]): ReturnType<Store["issueEmailOtp"]> {
    return authOperations.issueEmailOtp(this.authContext(), input);
  }

  async invalidateIssuedOtpAfterDeliveryFailure(
    otpId: string,
    now: Date,
  ): ReturnType<Store["invalidateIssuedOtpAfterDeliveryFailure"]> {
    return authOperations.invalidateIssuedOtpAfterDeliveryFailure(
      this.authContext(),
      otpId,
      now,
    );
  }

  async verifyDesktopOtpAndCreateTicket(
    input: Parameters<Store["verifyDesktopOtpAndCreateTicket"]>[0],
  ): ReturnType<Store["verifyDesktopOtpAndCreateTicket"]> {
    return authOperations.verifyDesktopOtpAndCreateTicket(this.authContext(), input);
  }

  async verifyAdminOtpAndCreateSession(
    input: Parameters<Store["verifyAdminOtpAndCreateSession"]>[0],
  ): ReturnType<Store["verifyAdminOtpAndCreateSession"]> {
    return authOperations.verifyAdminOtpAndCreateSession(this.authContext(), input);
  }

  async exchangeDesktopTicketAndCreateSession(
    input: Parameters<Store["exchangeDesktopTicketAndCreateSession"]>[0],
  ): ReturnType<Store["exchangeDesktopTicketAndCreateSession"]> {
    return authOperations.exchangeDesktopTicketAndCreateSession(this.authContext(), input);
  }

  async createEmailOtp(
    input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
  ): Promise<EmailOtpRecord> {
    return authOperations.createEmailOtp(this.authContext(), input);
  }

  async findLatestUsableOtp(
    email: string,
    state: string,
    now: Date,
  ): Promise<EmailOtpRecord | null> {
    return authOperations.findLatestUsableOtp(this.authContext(), email, state, now);
  }

  async incrementOtpAttempts(otpId: string): Promise<EmailOtpRecord> {
    return authOperations.incrementOtpAttempts(this.authContext(), otpId);
  }

  async consumeOtp(otpId: string, now: Date): Promise<void> {
    return authOperations.consumeOtp(this.authContext(), otpId, now);
  }

  async createDesktopLoginTicket(
    input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">,
  ): Promise<DesktopLoginTicketRecord> {
    return authOperations.createDesktopLoginTicket(this.authContext(), input);
  }

  async consumeDesktopLoginTicket(
    ticketHash: string,
    state: string,
    now: Date,
  ): Promise<DesktopLoginTicketRecord | null> {
    return authOperations.consumeDesktopLoginTicket(
      this.authContext(),
      ticketHash,
      state,
      now,
    );
  }

  async createSession(input: Parameters<Store["createSession"]>[0]): ReturnType<Store["createSession"]> {
    return authOperations.createSession(this.authContext(), input);
  }

  async findSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): ReturnType<Store["findSessionByTokenHash"]> {
    return authOperations.findSessionByTokenHash(this.authContext(), tokenHash, now);
  }

  async revokeSession(
    tokenHash: string,
    now: Date,
  ): ReturnType<Store["revokeSession"]> {
    return authOperations.revokeSession(this.authContext(), tokenHash, now);
  }

  async createOrder(input: Parameters<Store["createOrder"]>[0]): ReturnType<Store["createOrder"]> {
    return billingOperations.createOrder(this.billingContext(), input);
  }

  async findOrderByOutTradeNo(
    outTradeNo: string,
  ): ReturnType<Store["findOrderByOutTradeNo"]> {
    return billingOperations.findOrderByOutTradeNo(this.billingContext(), outTradeNo);
  }

  async markOrderPaid(
    outTradeNo: string,
    transactionId: string,
    paidAt: Date,
  ): ReturnType<Store["markOrderPaid"]> {
    return billingOperations.markOrderPaid(
      this.billingContext(),
      outTradeNo,
      transactionId,
      paidAt,
    );
  }

  async settlePaidOrder(input: Parameters<Store["settlePaidOrder"]>[0]): ReturnType<Store["settlePaidOrder"]> {
    return billingOperations.settlePaidOrder(this.billingContext(), input);
  }

  async getEntitlement(userId: string): ReturnType<Store["getEntitlement"]> {
    return entitlementOperations.getEntitlement(this.entitlementContext(), userId);
  }

  async upsertEntitlement(
    userId: string,
    expiresAt: Date,
    now: Date,
    quota: Parameters<Store["upsertEntitlement"]>[3] = {},
  ): ReturnType<Store["upsertEntitlement"]> {
    return entitlementOperations.upsertEntitlement(
      this.entitlementContext(),
      userId,
      expiresAt,
      now,
      quota,
    );
  }

  async consumeLlmQuota(
    userId: string,
    requestId: string,
    now: Date,
  ): ReturnType<Store["consumeLlmQuota"]> {
    return entitlementOperations.consumeLlmQuota(
      this.entitlementContext(),
      userId,
      requestId,
      now,
    );
  }

  async getLlmConfig(): ReturnType<Store["getLlmConfig"]> {
    return llmConfigOperations.getLlmConfig(this.llmConfigContext());
  }

  async upsertLlmConfig(
    input: Parameters<Store["upsertLlmConfig"]>[0],
    now: Date,
  ): ReturnType<Store["upsertLlmConfig"]> {
    return llmConfigOperations.upsertLlmConfig(this.llmConfigContext(), input, now);
  }

  async createActivationCode(input: Parameters<Store["createActivationCode"]>[0]): ReturnType<Store["createActivationCode"]> {
    return entitlementOperations.createActivationCode(this.entitlementContext(), input);
  }

  async findActivationCodeByHash(
    codeHash: string,
  ): ReturnType<Store["findActivationCodeByHash"]> {
    return entitlementOperations.findActivationCodeByHash(
      this.entitlementContext(),
      codeHash,
    );
  }

  async markActivationCodeRedeemed(
    codeHash: string,
    userId: string,
    redeemedAt: Date,
  ): ReturnType<Store["markActivationCodeRedeemed"]> {
    return entitlementOperations.markActivationCodeRedeemed(
      this.entitlementContext(),
      codeHash,
      userId,
      redeemedAt,
    );
  }

  async redeemActivationCodeAndGrantEntitlement(
    input: Parameters<Store["redeemActivationCodeAndGrantEntitlement"]>[0],
  ): ReturnType<Store["redeemActivationCodeAndGrantEntitlement"]> {
    return entitlementOperations.redeemActivationCodeAndGrantEntitlement(
      this.entitlementContext(),
      input,
    );
  }

  async listActivationCodes(): ReturnType<Store["listActivationCodes"]> {
    return entitlementOperations.listActivationCodes(this.entitlementContext());
  }

  async listUsers(): ReturnType<Store["listUsers"]> {
    return authOperations.listUsers(this.authContext());
  }

  async createAdminSession(input: Parameters<Store["createAdminSession"]>[0]): ReturnType<Store["createAdminSession"]> {
    return authOperations.createAdminSession(this.authContext(), input);
  }

  async findAdminSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): ReturnType<Store["findAdminSessionByTokenHash"]> {
    return authOperations.findAdminSessionByTokenHash(this.authContext(), tokenHash, now);
  }

  async revokeAdminSession(
    tokenHash: string,
    now: Date,
  ): ReturnType<Store["revokeAdminSession"]> {
    return authOperations.revokeAdminSession(this.authContext(), tokenHash, now);
  }

  async createAdminEntitlementAdjustment(
    input: Parameters<Store["createAdminEntitlementAdjustment"]>[0],
  ): ReturnType<Store["createAdminEntitlementAdjustment"]> {
    return entitlementOperations.createAdminEntitlementAdjustment(
      this.entitlementContext(),
      input,
    );
  }

  async applyEntitlementAdjustmentWithAudit(
    input: Parameters<Store["applyEntitlementAdjustmentWithAudit"]>[0],
  ): ReturnType<Store["applyEntitlementAdjustmentWithAudit"]> {
    return entitlementOperations.applyEntitlementAdjustmentWithAudit(
      this.entitlementContext(),
      input,
    );
  }

  async listAdminEntitlementAdjustments(
    limit = 50,
  ): ReturnType<Store["listAdminEntitlementAdjustments"]> {
    return entitlementOperations.listAdminEntitlementAdjustments(
      this.entitlementContext(),
      limit,
    );
  }

  async createWebhookEvent(
    input: Parameters<Store["createWebhookEvent"]>[0],
  ): ReturnType<Store["createWebhookEvent"]> {
    return billingOperations.createWebhookEvent(this.billingContext(), input);
  }

  private llmConfigContext() {
    return { state: this };
  }

  private entitlementContext() {
    return {
      state: this,
      atomic: this.atomic,
      findSessionByTokenHash: this.findSessionByTokenHash.bind(this),
      getUserById: this.getUserById.bind(this),
      findActivationCodeByHash: this.findActivationCodeByHash.bind(this),
      markActivationCodeRedeemed: this.markActivationCodeRedeemed.bind(this),
      getEntitlement: this.getEntitlement.bind(this),
      upsertEntitlement: this.upsertEntitlement.bind(this),
      createAdminEntitlementAdjustment:
        this.createAdminEntitlementAdjustment.bind(this),
    };
  }

  private billingContext() {
    return {
      state: this,
      atomic: this.atomic,
      findOrderByOutTradeNo: this.findOrderByOutTradeNo.bind(this),
      markOrderPaid: this.markOrderPaid.bind(this),
      getEntitlement: this.getEntitlement.bind(this),
      upsertEntitlement: this.upsertEntitlement.bind(this),
      createWebhookEvent: this.createWebhookEvent.bind(this),
    };
  }

  private authContext() {
    return {
      state: this,
      atomic: this.atomic,
      upsertUserByEmail: this.upsertUserByEmail.bind(this),
      getUserById: this.getUserById.bind(this),
      createEmailOtp: this.createEmailOtp.bind(this),
      createDesktopLoginTicket: this.createDesktopLoginTicket.bind(this),
      createSession: this.createSession.bind(this),
      createAdminSession: this.createAdminSession.bind(this),
    };
  }
}
