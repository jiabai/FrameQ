import type { PrismaClient } from "@prisma/client";
import type {
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  Store,
} from "./store.js";
import * as authOperations from "./prismaStore/auth.js";
import * as billingOperations from "./prismaStore/billing.js";
import * as entitlementOperations from "./prismaStore/entitlements.js";
import * as llmConfigOperations from "./prismaStore/llmConfig.js";

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


  async createOrder(
    input: Parameters<Store["createOrder"]>[0],
  ): ReturnType<Store["createOrder"]> {
    return billingOperations.createOrder(this.prisma, input);
  }

  async findOrderByOutTradeNo(
    outTradeNo: string,
  ): ReturnType<Store["findOrderByOutTradeNo"]> {
    return billingOperations.findOrderByOutTradeNo(this.prisma, outTradeNo);
  }

  async markOrderPaid(
    outTradeNo: string,
    transactionId: string,
    paidAt: Date,
  ): ReturnType<Store["markOrderPaid"]> {
    return billingOperations.markOrderPaid(this.prisma, outTradeNo, transactionId, paidAt);
  }

  async settlePaidOrder(
    input: Parameters<Store["settlePaidOrder"]>[0],
  ): ReturnType<Store["settlePaidOrder"]> {
    return billingOperations.settlePaidOrder(this.prisma, input);
  }


  async getEntitlement(userId: string): ReturnType<Store["getEntitlement"]> {
    return entitlementOperations.getEntitlement(this.prisma, userId);
  }

  async upsertEntitlement(
    userId: string,
    expiresAt: Date,
    now: Date,
    quota: Parameters<Store["upsertEntitlement"]>[3] = {},
  ): ReturnType<Store["upsertEntitlement"]> {
    return entitlementOperations.upsertEntitlement(
      this.prisma,
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
    return entitlementOperations.consumeLlmQuota(this.prisma, userId, requestId, now);
  }


  async getLlmConfig(): ReturnType<Store["getLlmConfig"]> {
    return llmConfigOperations.getLlmConfig(this.prisma);
  }

  async upsertLlmConfig(
    input: Parameters<Store["upsertLlmConfig"]>[0],
    now: Date,
  ): ReturnType<Store["upsertLlmConfig"]> {
    return llmConfigOperations.upsertLlmConfig(this.prisma, input, now);
  }


  async createActivationCode(
    input: Parameters<Store["createActivationCode"]>[0],
  ): ReturnType<Store["createActivationCode"]> {
    return entitlementOperations.createActivationCode(this.prisma, input);
  }

  async findActivationCodeByHash(
    codeHash: string,
  ): ReturnType<Store["findActivationCodeByHash"]> {
    return entitlementOperations.findActivationCodeByHash(this.prisma, codeHash);
  }

  async markActivationCodeRedeemed(
    codeHash: string,
    userId: string,
    redeemedAt: Date,
  ): ReturnType<Store["markActivationCodeRedeemed"]> {
    return entitlementOperations.markActivationCodeRedeemed(
      this.prisma,
      codeHash,
      userId,
      redeemedAt,
    );
  }

  async redeemActivationCodeAndGrantEntitlement(
    input: Parameters<Store["redeemActivationCodeAndGrantEntitlement"]>[0],
  ): ReturnType<Store["redeemActivationCodeAndGrantEntitlement"]> {
    return entitlementOperations.redeemActivationCodeAndGrantEntitlement(
      this.prisma,
      input,
    );
  }

  async listActivationCodes(): ReturnType<Store["listActivationCodes"]> {
    return entitlementOperations.listActivationCodes(this.prisma);
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
    input: Parameters<Store["createAdminEntitlementAdjustment"]>[0],
  ): ReturnType<Store["createAdminEntitlementAdjustment"]> {
    return entitlementOperations.createAdminEntitlementAdjustment(this.prisma, input);
  }

  async listAdminEntitlementAdjustments(
    limit = 50,
  ): ReturnType<Store["listAdminEntitlementAdjustments"]> {
    return entitlementOperations.listAdminEntitlementAdjustments(this.prisma, limit);
  }

  async applyEntitlementAdjustmentWithAudit(
    input: Parameters<Store["applyEntitlementAdjustmentWithAudit"]>[0],
  ): ReturnType<Store["applyEntitlementAdjustmentWithAudit"]> {
    return entitlementOperations.applyEntitlementAdjustmentWithAudit(this.prisma, input);
  }


  async createWebhookEvent(
    input: Parameters<Store["createWebhookEvent"]>[0],
  ): ReturnType<Store["createWebhookEvent"]> {
    return billingOperations.createWebhookEvent(this.prisma, input);
  }
}
