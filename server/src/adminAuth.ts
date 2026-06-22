import { constantTimeEqual, otpCode, secureToken, sha256 } from "./security.js";
import type { AdminSessionRecord, Store } from "./store.js";
import { normalizeEmail, validateState } from "./auth.js";

const ADMIN_OTP_TTL_MS = 10 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_RESEND_WINDOW_MS = 60 * 1000;

export type AdminAuthServiceOptions = {
  store: Store;
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
  private readonly store: Store;
  private readonly sendOtp: (email: string, code: string) => Promise<void>;
  private readonly adminEmail: string;
  private readonly now: () => Date;
  private readonly recentStarts = new Map<string, Date>();

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
    const rateKey = `${email}:${input.ip}`;
    const lastStart = this.recentStarts.get(rateKey);
    if (lastStart && now.getTime() - lastStart.getTime() < ADMIN_RESEND_WINDOW_MS) {
      throw new Error("Please wait before requesting another verification code.");
    }
    const code = otpCode();
    const otp = await this.store.createEmailOtp({
      email,
      state: input.state,
      codeHash: sha256(code),
      ip: input.ip,
      expiresAt: new Date(now.getTime() + ADMIN_OTP_TTL_MS),
      createdAt: now,
    });
    try {
      await this.sendOtp(email, code);
      this.recentStarts.set(rateKey, now);
    } catch {
      await this.store.consumeOtp(otp.id, now).catch(() => undefined);
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
    const otp = await this.store.findLatestUsableOtp(email, input.state, now);
    if (!otp) {
      throw invalidAdminCodeError();
    }
    await this.store.incrementOtpAttempts(otp.id);
    if (!constantTimeEqual(otp.codeHash, sha256(input.code))) {
      throw invalidAdminCodeError();
    }
    await this.store.consumeOtp(otp.id, now);
    const sessionToken = secureToken("fas_");
    const csrfToken = secureToken("fac_");
    const session = await this.store.createAdminSession({
      email,
      tokenHash: sha256(sessionToken),
      csrfTokenHash: sha256(csrfToken),
      createdAt: now,
      expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_MS),
    });
    return { sessionToken, csrfToken, session };
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
