import { randomBytes } from "node:crypto";
import { sha256 } from "./security.js";
import type { ActivationCodeRecord, Store } from "./store.js";

const ACTIVATION_CODE_DAYS = 31;
const DEFAULT_REDEEM_BY_DAYS = 30;
const LLM_QUOTA_PER_ACTIVATION = 20;

export type ActivationCodeServiceOptions = {
  store: Store;
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
  private readonly store: Store;
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
    const session = await this.store.findSessionByTokenHash(input.sessionTokenHash, now);
    if (!session) {
      throw new Error("Desktop session is invalid or expired.");
    }

    const codeHash = sha256(normalizeActivationCode(input.code));
    const code = await this.store.findActivationCodeByHash(codeHash);
    if (!code || code.status !== "active" || code.redeemedAt !== null || code.redeemBy <= now) {
      throw invalidActivationCodeError();
    }

    const redeemed = await this.store.markActivationCodeRedeemed(codeHash, session.userId, now);
    if (!redeemed) {
      throw invalidActivationCodeError();
    }

    const existing = await this.store.getEntitlement(session.userId);
    const existingActive = Boolean(existing && existing.expiresAt > now);
    const base = existingActive && existing ? existing.expiresAt : now;
    const quota = existingActive && existing
      ? {
          llmQuotaLimit: existing.llmQuotaLimit + LLM_QUOTA_PER_ACTIVATION,
          llmQuotaUsed: existing.llmQuotaUsed,
        }
      : { llmQuotaLimit: LLM_QUOTA_PER_ACTIVATION, llmQuotaUsed: 0 };
    const entitlement = await this.store.upsertEntitlement(
      session.userId,
      new Date(base.getTime() + redeemed.entitlementDays * 24 * 60 * 60 * 1000),
      now,
      quota,
    );
    return { entitlementExpiresAt: entitlement.expiresAt };
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
