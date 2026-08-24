import {
  activationCodeHash,
  activationCodePrefix,
  DEFAULT_ENTITLEMENT_DAYS,
  DEFAULT_REDEEM_WINDOW_DAYS,
  generateActivationCode,
  SELF_SERVICE_LLM_QUOTA,
} from "./activationPolicy.js";
import type { Store } from "./store.js";

export type ActivationEmailLocale = "zh-CN" | "zh-TW" | "en-US";

type SelfServiceActivationStore = Pick<
  Store,
  | "prepareSelfServiceActivationCode"
  | "disablePreparedSelfServiceActivationCode"
  | "activatePreparedSelfServiceActivationCode"
>;

export type SendActivationCodeInput = {
  email: string;
  code: string;
  locale: ActivationEmailLocale;
  redeemBy: Date;
  entitlementDays: number;
  llmCredits: number;
};

export type ActivationCodeEmailSender = {
  sendActivationCode(input: SendActivationCodeInput): Promise<void>;
};

export type SelfServiceActivationServiceOptions = {
  store: SelfServiceActivationStore;
  now?: () => Date;
  generateCode?: () => string;
  sendActivationCode: ActivationCodeEmailSender;
};

export type SelfServiceActivationResult = {
  status: "sent";
  retryAt: Date;
  redeemBy: Date;
};

export class SelfServiceActivationError extends Error {
  readonly code:
    | "AUTH_REQUIRED"
    | "ENTITLEMENT_ACTIVE"
    | "ACTIVATION_REQUEST_RATE_LIMITED"
    | "ACTIVATION_EMAIL_UNAVAILABLE"
    | "SERVER_TEMPORARILY_UNAVAILABLE";
  readonly retryAt?: Date;

  constructor(
    code: SelfServiceActivationError["code"],
    options: { retryAt?: Date } = {},
  ) {
    super(code);
    this.name = "SelfServiceActivationError";
    this.code = code;
    this.retryAt = options.retryAt;
  }
}

export class SelfServiceActivationService {
  private readonly store: SelfServiceActivationStore;
  private readonly now: () => Date;
  private readonly generateCode: () => string;
  private readonly sender: ActivationCodeEmailSender;

  constructor(options: SelfServiceActivationServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.generateCode = options.generateCode ?? (() => generateActivationCode());
    this.sender = options.sendActivationCode;
  }

  async requestCode(input: {
    sessionTokenHash: string;
    ip: string;
    locale: string;
  }): Promise<SelfServiceActivationResult> {
    const locale = parseActivationEmailLocale(input.locale);
    const now = this.now();
    const code = this.generateCode();
    const redeemBy = new Date(
      now.getTime() + DEFAULT_REDEEM_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    let prepared;
    try {
      prepared = await this.store.prepareSelfServiceActivationCode({
        sessionTokenHash: input.sessionTokenHash,
        codeHash: activationCodeHash(code),
        codePrefix: activationCodePrefix(code),
        ip: input.ip,
        now,
        redeemBy,
        entitlementDays: DEFAULT_ENTITLEMENT_DAYS,
      });
    } catch {
      throw serverTemporarilyUnavailable();
    }

    switch (prepared.status) {
      case "session_invalid":
        throw new SelfServiceActivationError("AUTH_REQUIRED");
      case "entitlement_active":
        throw new SelfServiceActivationError("ENTITLEMENT_ACTIVE");
      case "rate_limited":
        throw new SelfServiceActivationError("ACTIVATION_REQUEST_RATE_LIMITED", {
          retryAt: prepared.retryAt,
        });
      case "temporarily_unavailable":
        throw serverTemporarilyUnavailable();
      case "prepared":
        break;
    }

    try {
      await this.sender.sendActivationCode({
        email: prepared.email,
        code,
        locale,
        redeemBy: prepared.redeemBy,
        entitlementDays: DEFAULT_ENTITLEMENT_DAYS,
        llmCredits: SELF_SERVICE_LLM_QUOTA,
      });
    } catch {
      try {
        await this.store.disablePreparedSelfServiceActivationCode({
          activationCodeId: prepared.activationCodeId,
          now,
          reason: "delivery_failed",
        });
      } catch {
        throw serverTemporarilyUnavailable();
      }
      throw new SelfServiceActivationError("ACTIVATION_EMAIL_UNAVAILABLE", {
        retryAt: prepared.retryAt,
      });
    }

    let activated;
    try {
      activated = await this.store.activatePreparedSelfServiceActivationCode({
        activationCodeId: prepared.activationCodeId,
        now,
      });
    } catch {
      throw serverTemporarilyUnavailable();
    }

    switch (activated.status) {
      case "activated":
        return {
          status: "sent",
          retryAt: prepared.retryAt,
          redeemBy: prepared.redeemBy,
        };
      case "entitlement_active":
        throw new SelfServiceActivationError("ENTITLEMENT_ACTIVE");
      case "invalid":
        throw new SelfServiceActivationError("ACTIVATION_EMAIL_UNAVAILABLE", {
          retryAt: prepared.retryAt,
        });
      case "temporarily_unavailable":
        throw serverTemporarilyUnavailable();
    }
  }
}

export function parseActivationEmailLocale(locale: string): ActivationEmailLocale {
  if (locale === "zh-CN" || locale === "zh-TW" || locale === "en-US") {
    return locale;
  }
  throw serverTemporarilyUnavailable();
}

function serverTemporarilyUnavailable(): SelfServiceActivationError {
  return new SelfServiceActivationError("SERVER_TEMPORARILY_UNAVAILABLE");
}
