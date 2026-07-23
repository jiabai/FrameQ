import { otpCode, secureToken, sha256 } from "./security.js";
import type { Store } from "./store.js";

type AuthStore = Pick<
  Store,
  | "issueEmailOtp"
  | "invalidateIssuedOtpAfterDeliveryFailure"
  | "verifyDesktopOtpAndCreateTicket"
  | "exchangeDesktopTicketAndCreateSession"
>;

const OTP_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type AuthServiceOptions = {
  store: AuthStore;
  now?: () => Date;
  sendOtp: (email: string, code: string) => Promise<void>;
};

export class AuthService {
  private readonly store: AuthStore;
  private readonly now: () => Date;
  private readonly sendOtp: (email: string, code: string) => Promise<void>;

  constructor(options: AuthServiceOptions) {
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
  }): Promise<{ ticket: string; redirectUrl: string }> {
    const email = normalizeEmail(input.email);
    validateState(input.state);
    if (!/^\d{6}$/.test(input.code)) {
      throw new Error("Verification code is invalid or expired.");
    }

    const now = this.now();
    const ticket = secureToken("flt_");
    const result = await this.store.verifyDesktopOtpAndCreateTicket({
      email,
      state: input.state,
      codeHash: sha256(input.code),
      ticketHash: sha256(ticket),
      now,
      ticketExpiresAt: new Date(now.getTime() + TICKET_TTL_MS),
    });
    if (result.status === "temporarily_unavailable") {
      throw temporarilyUnavailableError();
    }
    if (result.status === "invalid") {
      throw new Error("Verification code is invalid or expired.");
    }

    return {
      ticket,
      redirectUrl: `frameq://auth/callback?ticket=${encodeURIComponent(ticket)}&state=${encodeURIComponent(input.state)}`,
    };
  }

  async exchangeDesktopTicket(input: {
    ticket: string;
    state: string;
  }): Promise<{ sessionToken: string; email: string; expiresAt: Date }> {
    validateState(input.state);
    if (!input.ticket.startsWith("flt_")) {
      throw new Error("Login ticket is invalid or expired.");
    }
    const now = this.now();
    const sessionToken = secureToken("fq_");
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const result = await this.store.exchangeDesktopTicketAndCreateSession({
      ticketHash: sha256(input.ticket),
      state: input.state,
      sessionTokenHash: sha256(sessionToken),
      now,
      sessionExpiresAt: expiresAt,
    });
    if (result.status === "temporarily_unavailable") {
      throw temporarilyUnavailableError();
    }
    if (result.status === "invalid") {
      throw new Error("Login ticket is invalid or expired.");
    }

    return { sessionToken, email: result.user.email, expiresAt };
  }
}

function temporarilyUnavailableError(): Error {
  return new Error("SERVER_TEMPORARILY_UNAVAILABLE");
}

export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || value.length > 254) {
    throw new Error("A valid email address is required.");
  }
  return value;
}

export function validateState(state: string): void {
  if (!/^[a-zA-Z0-9._~-]{8,160}$/.test(state)) {
    throw new Error("Login state is invalid.");
  }
}
