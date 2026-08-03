import { constantTimeEqual, otpCode, secureToken, sha256 } from "./security.js";
import type { Store, UserSessionRecord } from "./store.js";
import { normalizeEmail, validateState } from "./auth.js";

type UserAuthStore = Pick<
  Store,
  | "issueEmailOtp"
  | "invalidateIssuedOtpAfterDeliveryFailure"
  | "verifyUserOtpAndCreateWebSession"
  | "findUserSessionByTokenHash"
  | "revokeUserSession"
>;

const OTP_TTL_MS = 10 * 60 * 1000;
const USER_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type UserAuthServiceOptions = {
  store: UserAuthStore;
  now?: () => Date;
  sendOtp: (email: string, code: string) => Promise<void>;
};

export type UserSessionTokens = {
  sessionToken: string;
  csrfToken: string;
  session: UserSessionRecord;
};

export class UserAuthService {
  private readonly store: UserAuthStore;
  private readonly now: () => Date;
  private readonly sendOtp: (email: string, code: string) => Promise<void>;

  constructor(options: UserAuthServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.sendOtp = options.sendOtp;
  }

  async startEmailLogin(input: { email: string; ip: string; state: string }): Promise<void> {
    const email = normalizeEmail(input.email);
    validateState(input.state);
    const now = this.now();
    const code = otpCode();
    const issued = await this.store.issueEmailOtp({
      purpose: "desktop_login",
      email,
      state: input.state,
      codeHash: sha256(code),
      ip: input.ip,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      createdAt: now,
    });
    if (issued.status === "rate_limited") {
      throw new Error("Please wait before requesting another verification code.");
    }
    if (issued.status === "temporarily_unavailable") {
      throw temporarilyUnavailableError();
    }
    try {
      await this.sendOtp(email, code);
    } catch {
      try {
        await this.store.invalidateIssuedOtpAfterDeliveryFailure(issued.otpId, now);
      } catch {
        throw temporarilyUnavailableError();
      }
      throw new Error("Could not send verification code. Please try again later.");
    }
  }

  async verifyEmailCode(input: {
    email: string;
    code: string;
    state: string;
  }): Promise<UserSessionTokens> {
    const email = normalizeEmail(input.email);
    validateState(input.state);
    if (!/^\d{6}$/.test(input.code)) {
      throw new Error("Verification code is invalid or expired.");
    }

    const now = this.now();
    const sessionToken = secureToken("fus_");
    const csrfToken = secureToken("fuc_");
    const result = await this.store.verifyUserOtpAndCreateWebSession({
      email,
      state: input.state,
      codeHash: sha256(input.code),
      sessionTokenHash: sha256(sessionToken),
      csrfTokenHash: sha256(csrfToken),
      now,
      sessionExpiresAt: new Date(now.getTime() + USER_SESSION_TTL_MS),
    });
    if (result.status === "temporarily_unavailable") {
      throw temporarilyUnavailableError();
    }
    if (result.status === "invalid") {
      throw new Error("Verification code is invalid or expired.");
    }

    return { sessionToken, csrfToken, session: result.session };
  }

  async authenticate(sessionToken: string | null): Promise<UserSessionRecord | null> {
    if (!sessionToken) {
      return null;
    }
    return this.store.findUserSessionByTokenHash(sha256(sessionToken), this.now());
  }

  validateCsrf(session: UserSessionRecord, csrfToken: string | null): boolean {
    return Boolean(csrfToken && constantTimeEqual(session.csrfTokenHash, sha256(csrfToken)));
  }
}

function temporarilyUnavailableError(): Error {
  return new Error("SERVER_TEMPORARILY_UNAVAILABLE");
}

export const userSessionMaxAgeSeconds = USER_SESSION_TTL_MS / 1000;
