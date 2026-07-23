import { randomBytes } from "node:crypto";
import { sha256 } from "./security.js";
import type { ActivationCodeRecord, Store } from "./store.js";

type ActivationStore = Pick<
  Store,
  "createActivationCode" | "redeemActivationCodeAndGrantEntitlement"
>;

const ACTIVATION_CODE_DAYS = 31;
const DEFAULT_REDEEM_BY_DAYS = 30;
const LLM_QUOTA_PER_ACTIVATION = 20;

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
      input.redeemBy ?? new Date(now.getTime() + DEFAULT_REDEEM_BY_DAYS * 24 * 60 * 60 * 1000);
    const record = await this.store.createActivationCode({
      codeHash: sha256(normalizeActivationCode(code)),
      codePrefix: code.slice(0, 7),
      status: "active",
      entitlementDays: ACTIVATION_CODE_DAYS,
      redeemBy,
      createdAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
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
      codeHash: sha256(normalizeActivationCode(input.code)),
      now,
      llmQuotaPerActivation: LLM_QUOTA_PER_ACTIVATION,
    });
    if (redeemed.status === "session_invalid") {
      throw new Error("Desktop session is invalid or expired.");
    }
    if (redeemed.status === "code_invalid") {
      throw invalidActivationCodeError();
    }
    return { entitlementExpiresAt: redeemed.entitlement.expiresAt };
  }
}

export function normalizeActivationCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function generateActivationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  const bytes = randomBytes(16);
  for (const byte of bytes) {
    raw += alphabet[byte % alphabet.length];
  }
  return `FQ-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function invalidActivationCodeError(): Error {
  return new Error("Activation code is invalid or expired.");
}

export const activationCodeDays = ACTIVATION_CODE_DAYS;
export const llmQuotaPerActivation = LLM_QUOTA_PER_ACTIVATION;
