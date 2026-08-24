import {
  activationCodeHash,
  activationCodePrefix,
  DEFAULT_ENTITLEMENT_DAYS,
  DEFAULT_REDEEM_WINDOW_DAYS,
  generateActivationCode,
  normalizeActivationCode,
  SELF_SERVICE_LLM_QUOTA,
} from "./activationPolicy.js";
import type { ActivationCodeRecord, Store } from "./store.js";

type ActivationStore = Pick<
  Store,
  "createActivationCode" | "redeemActivationCodeAndGrantEntitlement"
>;

export type ActivationCodeServiceOptions = {
  store: ActivationStore;
  now?: () => Date;
};

export type GeneratedActivationCode = {
  code: string;
  codePrefix: string;
  entitlementDays: number;
  redeemBy: Date;
  record: ActivationCodeRecord;
};

export class ActivationCodeService {
  private readonly store: ActivationStore;
  private readonly now: () => Date;

  constructor(options: ActivationCodeServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  async generateCode(input: { redeemBy?: Date } = {}): Promise<GeneratedActivationCode> {
    const now = this.now();
    const code = generateActivationCode();
    const redeemBy =
      input.redeemBy ??
      new Date(now.getTime() + DEFAULT_REDEEM_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const record = await this.store.createActivationCode({
      codeHash: activationCodeHash(code),
      codePrefix: activationCodePrefix(code),
      status: "active",
      issuanceSource: "admin",
      entitlementDays: DEFAULT_ENTITLEMENT_DAYS,
      issuedToUserId: null,
      redeemBy,
      createdAt: now,
      sentAt: null,
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });
    return {
      code,
      codePrefix: record.codePrefix,
      entitlementDays: record.entitlementDays,
      redeemBy: record.redeemBy,
      record,
    };
  }

  async redeemCode(input: {
    sessionTokenHash: string;
    code: string;
  }): Promise<{ entitlementExpiresAt: Date }> {
    const now = this.now();
    const redeemed = await this.store.redeemActivationCodeAndGrantEntitlement({
      sessionTokenHash: input.sessionTokenHash,
      codeHash: activationCodeHash(input.code),
      now,
      llmQuotaPerActivation: SELF_SERVICE_LLM_QUOTA,
    });
    if (redeemed.status === "session_invalid") {
      throw new Error("Desktop session is invalid or expired.");
    }
    if (redeemed.status === "entitlement_active") {
      throw new Error("Activation code is not redeemable while your entitlement is active.");
    }
    if (redeemed.status === "code_invalid") {
      throw invalidActivationCodeError();
    }
    return { entitlementExpiresAt: redeemed.entitlement.expiresAt };
  }
}

function invalidActivationCodeError(): Error {
  return new Error("Activation code is invalid or expired.");
}

export { normalizeActivationCode };
export const activationCodeDays = DEFAULT_ENTITLEMENT_DAYS;
export const llmQuotaPerActivation = SELF_SERVICE_LLM_QUOTA;
