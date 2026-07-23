import { secureToken } from "./security.js";
import type { OrderRecord, Store } from "./store.js";

type BillingStore = Pick<
  Store,
  "findSessionByTokenHash" | "createOrder" | "settlePaidOrder" | "findOrderByOutTradeNo"
>;

const MONTHLY_PASS_AMOUNT_FEN = 990;
const PASS_DAYS = 31;
const ORDER_TTL_MS = 30 * 60 * 1000;

export type NativePaymentInput = {
  outTradeNo: string;
  amountFen: number;
  description: string;
};

export type NativePaymentResult = {
  codeUrl: string;
  providerPayload: unknown;
};

export type BillingServiceOptions = {
  store: BillingStore;
  now?: () => Date;
  createNativePayment: (input: NativePaymentInput) => Promise<NativePaymentResult>;
};

export class BillingService {
  private readonly store: BillingStore;
  private readonly now: () => Date;
  private readonly createNativePayment: (input: NativePaymentInput) => Promise<NativePaymentResult>;

  constructor(options: BillingServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.createNativePayment = options.createNativePayment;
  }

  async createWechatNativeOrder(input: {
    sessionTokenHash: string;
  }): Promise<OrderRecord> {
    const now = this.now();
    const session = await this.store.findSessionByTokenHash(input.sessionTokenHash, now);
    if (!session) {
      throw new Error("Desktop session is invalid or expired.");
    }
    const outTradeNo = `fq_${now.getTime()}_${secureToken().slice(0, 12)}`;
    const payment = await this.createNativePayment({
      outTradeNo,
      amountFen: MONTHLY_PASS_AMOUNT_FEN,
      description: "FrameQ monthly pass",
    });
    return this.store.createOrder({
      userId: session.userId,
      outTradeNo,
      amountFen: MONTHLY_PASS_AMOUNT_FEN,
      status: "pending",
      codeUrl: payment.codeUrl,
      expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
      createdAt: now,
      providerPayload: JSON.stringify(payment.providerPayload),
    });
  }

  async applyPaidOrder(input: {
    outTradeNo: string;
    transactionId: string;
    webhookId: string;
    paidAt: Date;
  }): Promise<{ entitlementExpiresAt: Date }> {
    const now = this.now();
    const settled = await this.store.settlePaidOrder({
      provider: "wechat",
      eventId: input.webhookId,
      outTradeNo: input.outTradeNo,
      transactionId: input.transactionId,
      paidAt: input.paidAt,
      now,
      passDays: PASS_DAYS,
    });
    switch (settled.status) {
      case "settled":
        return { entitlementExpiresAt: settled.entitlement.expiresAt };
      case "order_not_found":
        throw new Error("Order not found.");
      case "transaction_mismatch":
        throw new Error("Payment transaction does not match order.");
      case "webhook_order_mismatch":
        throw new Error("Webhook does not match order.");
      case "order_state_conflict":
        throw new Error("Order cannot be settled in its current state.");
    }
  }

  async getOrderStatus(outTradeNo: string): Promise<OrderRecord | null> {
    return this.store.findOrderByOutTradeNo(outTradeNo);
  }
}

export const monthlyPassAmountFen = MONTHLY_PASS_AMOUNT_FEN;
