import { constantTimeEqual, otpCode, secureToken, sha256 } from "./security.js";
import type { AdminSessionRecord, Store } from "./store.js";
import { normalizeEmail, validateState } from "./auth.js";

type AdminAuthStore = Pick<
  Store,
  | "issueEmailOtp"
  | "invalidateIssuedOtpAfterDeliveryFailure"
  | "verifyAdminOtpAndCreateSession"
  | "findAdminSessionByTokenHash"
>;

const ADMIN_OTP_TTL_MS = 10 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type AdminAuthServiceOptions = {
  store: AdminAuthStore;
  sendOtp: (email: string, code: string) => Promise<void>;
  adminEmail?: string;
  now?: () => Date;
};

export type AdminSessionTokens = {
  sessionToken: string;
  csrfToken: string;
  session: AdminSessionRecord;
};

export class AdminAuthService {
  private readonly store: AdminAuthStore;
  private readonly sendOtp: (email: string, code: string) => Promise<void>;
  private readonly adminEmail: string;
  private readonly now: () => Date;

  constructor(options: AdminAuthServiceOptions) {
    this.store = options.store;
    this.sendOtp = options.sendOtp;
    this.adminEmail = normalizeEmail(options.adminEmail ?? "lantianye@163.com");
    this.now = options.now ?? (() => new Date());
  }

  async startEmailLogin(input: { email: string; state: string; ip: string }): Promise<void> {
    const email = normalizeEmail(input.email);
    validateState(input.state);
    if (email !== this.adminEmail) {
      throw new Error("ADMIN_ONLY");
    }
    const now = this.now();
    const code = otpCode();
    const issued = await this.store.issueEmailOtp({
      purpose: "admin_login",
      email,
      state: input.state,
      codeHash: sha256(code),
      ip: input.ip,
      expiresAt: new Date(now.getTime() + ADMIN_OTP_TTL_MS),
      createdAt: now,
    });
    if (issued.status === "rate_limited") {
      throw new Error("Please wait before requesting another verification code.");
    }
    if (issued.status === "temporarily_unavailable") {
      throw new Error("SERVER_TEMPORARILY_UNAVAILABLE");
    }
    try {
      await this.sendOtp(email, code);
    } catch {
      try {
        await this.store.invalidateIssuedOtpAfterDeliveryFailure(issued.otpId, now);
      } catch {
        throw new Error("SERVER_TEMPORARILY_UNAVAILABLE");
      }
      throw new Error("Could not send verification code. Please try again later.");
    }
  }

  async verifyEmailCode(input: { email: string; code: string; state: string }): Promise<AdminSessionTokens> {
    const email = normalizeEmail(input.email);
    validateState(input.state);
    if (email !== this.adminEmail || !/^\d{6}$/.test(input.code)) {
      throw invalidAdminCodeError();
    }
    const now = this.now();
    const sessionToken = secureToken("fas_");
    const csrfToken = secureToken("fac_");
    const result = await this.store.verifyAdminOtpAndCreateSession({
      email,
      state: input.state,
      codeHash: sha256(input.code),
      sessionTokenHash: sha256(sessionToken),
      csrfTokenHash: sha256(csrfToken),
      now,
      sessionExpiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_MS),
    });
    if (result.status === "temporarily_unavailable") {
      throw new Error("SERVER_TEMPORARILY_UNAVAILABLE");
    }
    if (result.status === "invalid") {
      throw invalidAdminCodeError();
    }
    return { sessionToken, csrfToken, session: result.session };
  }

  async authenticate(sessionToken: string | null): Promise<AdminSessionRecord | null> {
    if (!sessionToken) {
      return null;
    }
    return this.store.findAdminSessionByTokenHash(sha256(sessionToken), this.now());
  }

  validateCsrf(session: AdminSessionRecord, csrfToken: string | null): boolean {
    return Boolean(csrfToken && constantTimeEqual(session.csrfTokenHash, sha256(csrfToken)));
  }
}

function invalidAdminCodeError(): Error {
  return new Error("Verification code is invalid or expired.");
}

export const adminSessionMaxAgeSeconds = ADMIN_SESSION_TTL_MS / 1000;
