import { randomUUID } from "node:crypto";
import { constantTimeEqual } from "../../security.js";
import type {
  AdminSessionRecord,
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  OtpPurpose,
  SessionRecord,
  Store,
  UserRecord,
} from "../contracts.js";
import { emailDispatchRateLimitReservations } from "../rateLimitPolicy.js";
import type { MemoryAtomicCoordinator, MemoryState } from "./atomic.js";
import { reserveEmailDispatchRateLimits } from "./rateLimits.js";
export type MemoryAuthContext = {
  state: MemoryState;
  atomic: MemoryAtomicCoordinator;
  upsertUserByEmail: Store["upsertUserByEmail"];
  getUserById: Store["getUserById"];
  createEmailOtp: (
    input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
  ) => Promise<EmailOtpRecord>;
  createDesktopLoginTicket: (
    input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">,
  ) => Promise<DesktopLoginTicketRecord>;
  createSession: Store["createSession"];
  createAdminSession: Store["createAdminSession"];
  createUserSession: Store["createUserSession"];
};

export async function upsertUserByEmail(
  context: MemoryAuthContext, email: string, now: Date,
): ReturnType<Store["upsertUserByEmail"]> {
  const existing = context.state.users.find((user) => user.email === email);
  if (existing) {
    existing.updatedAt = now;
    return existing;
  }
  const user = { id: randomUUID(), email, createdAt: now, updatedAt: now };
  context.state.users.push(user);
  return user;
}
export async function getUserById(
  context: MemoryAuthContext, userId: string,
): ReturnType<Store["getUserById"]> {
  return context.state.users.find((user) => user.id === userId) ?? null;
}
export async function issueEmailOtp(
  context: MemoryAuthContext, input: Parameters<Store["issueEmailOtp"]>[0],
): ReturnType<Store["issueEmailOtp"]> {
  return context.atomic.run(async () => {
    const reserved = reserveEmailDispatchRateLimits(
      context.state,
      emailDispatchRateLimitReservations({
        purpose: input.purpose,
        normalizedEmail: input.email,
        ip: input.ip,
        now: input.createdAt,
      }),
      input.createdAt,
    );
    if (reserved.status === "rate_limited") {
      return reserved;
    }
    for (const otp of context.state.emailOtps) {
      if (
        otp.purpose === input.purpose &&
        otp.email === input.email &&
        otp.state === input.state &&
        otp.consumedAt === null
      ) {
        otp.consumedAt = input.createdAt;
      }
    }
    const otp = await context.createEmailOtp(input);
    return { status: "issued", otpId: otp.id };
  });
}
export async function invalidateIssuedOtpAfterDeliveryFailure(
  context: MemoryAuthContext, otpId: string, now: Date,
): ReturnType<Store["invalidateIssuedOtpAfterDeliveryFailure"]> {
  await context.atomic.run(async () => {
    const otp = context.state.emailOtps.find((record) => record.id === otpId);
    if (otp?.consumedAt === null) {
      otp.consumedAt = now;
    }
  });
}
export async function verifyDesktopOtpAndCreateTicket(
  context: MemoryAuthContext, input: Parameters<Store["verifyDesktopOtpAndCreateTicket"]>[0],
): ReturnType<Store["verifyDesktopOtpAndCreateTicket"]> {
  return context.atomic.run(async () => {
    const otp = latestUsableOtp(
      context,
      "desktop_login",
      input.email,
      input.state,
      input.now,
    );
    if (!otp) {
      return { status: "invalid" };
    }
    otp.attempts += 1;
    if (!constantTimeEqual(otp.codeHash, input.codeHash)) {
      return { status: "invalid" };
    }
    otp.consumedAt = input.now;
    const user = await context.upsertUserByEmail(input.email, input.now);
    const ticket = await context.createDesktopLoginTicket({
      ticketHash: input.ticketHash,
      state: input.state,
      userId: user.id,
      expiresAt: input.ticketExpiresAt,
      createdAt: input.now,
    });
    return { status: "verified", user, ticket };
  });
}
export async function verifyAdminOtpAndCreateSession(
  context: MemoryAuthContext, input: Parameters<Store["verifyAdminOtpAndCreateSession"]>[0],
): ReturnType<Store["verifyAdminOtpAndCreateSession"]> {
  return context.atomic.run(async () => {
    const otp = latestUsableOtp(
      context,
      "admin_login",
      input.email,
      input.state,
      input.now,
    );
    if (!otp) {
      return { status: "invalid" };
    }
    otp.attempts += 1;
    if (!constantTimeEqual(otp.codeHash, input.codeHash)) {
      return { status: "invalid" };
    }
    otp.consumedAt = input.now;
    const session = await context.createAdminSession({
      email: input.email,
      tokenHash: input.sessionTokenHash,
      csrfTokenHash: input.csrfTokenHash,
      createdAt: input.now,
      expiresAt: input.sessionExpiresAt,
    });
    return { status: "verified", session };
  });
}
export async function exchangeDesktopTicketAndCreateSession(
  context: MemoryAuthContext, input: Parameters<Store["exchangeDesktopTicketAndCreateSession"]>[0],
): ReturnType<Store["exchangeDesktopTicketAndCreateSession"]> {
  return context.atomic.run(async () => {
    const ticket = context.state.desktopLoginTickets.find(
      (record) =>
        record.ticketHash === input.ticketHash &&
        record.state === input.state &&
        record.consumedAt === null &&
        record.expiresAt > input.now,
    );
    if (!ticket) {
      return { status: "invalid" };
    }
    const user = await context.getUserById(ticket.userId);
    if (!user) {
      return { status: "invalid" };
    }
    ticket.consumedAt = input.now;
    const session = await context.createSession({
      userId: user.id,
      tokenHash: input.sessionTokenHash,
      createdAt: input.now,
      expiresAt: input.sessionExpiresAt,
    });
    return { status: "exchanged", user, session };
  });
}
export async function createEmailOtp(
  context: MemoryAuthContext, input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
): Promise<EmailOtpRecord> {
  const otp = { ...input, id: randomUUID(), attempts: 0, consumedAt: null };
  context.state.emailOtps.push(otp);
  return otp;
}
export async function findLatestUsableOtp(
  context: MemoryAuthContext, email: string, state: string, now: Date,
): Promise<EmailOtpRecord | null> {
  return (
    [...context.state.emailOtps]
      .reverse()
      .find(
        (otp) =>
          otp.email === email &&
          otp.state === state &&
          otp.consumedAt === null &&
          otp.attempts < 5 &&
          otp.expiresAt > now,
      ) ?? null
  );
}
export async function incrementOtpAttempts(
  context: MemoryAuthContext, otpId: string,
): Promise<EmailOtpRecord> {
  const otp = context.state.emailOtps.find((record) => record.id === otpId);
  if (!otp) {
    throw new Error("OTP record not found.");
  }
  otp.attempts += 1;
  return otp;
}
export async function consumeOtp(
  context: MemoryAuthContext, otpId: string, now: Date,
): Promise<void> {
  const otp = context.state.emailOtps.find((record) => record.id === otpId);
  if (otp) {
    otp.consumedAt = now;
  }
}
export async function createDesktopLoginTicket(
  context: MemoryAuthContext, input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">,
): Promise<DesktopLoginTicketRecord> {
  const ticket = { ...input, id: randomUUID(), consumedAt: null };
  context.state.desktopLoginTickets.push(ticket);
  return ticket;
}
export async function consumeDesktopLoginTicket(
  context: MemoryAuthContext, ticketHash: string, state: string, now: Date,
): Promise<DesktopLoginTicketRecord | null> {
  const ticket =
    context.state.desktopLoginTickets.find(
      (record) =>
        record.ticketHash === ticketHash &&
        record.state === state &&
        record.consumedAt === null &&
        record.expiresAt > now,
    ) ?? null;
  if (ticket) {
    ticket.consumedAt = now;
  }
  return ticket;
}
export async function createSession(
  context: MemoryAuthContext, input: Omit<SessionRecord, "id" | "revokedAt">,
): ReturnType<Store["createSession"]> {
  const session = { ...input, id: randomUUID(), revokedAt: null };
  context.state.sessions.push(session);
  return session;
}
export async function findSessionByTokenHash(
  context: MemoryAuthContext, tokenHash: string, now: Date,
): ReturnType<Store["findSessionByTokenHash"]> {
  return (
    context.state.sessions.find(
      (session) =>
        session.tokenHash === tokenHash &&
        session.revokedAt === null &&
        session.expiresAt > now,
    ) ?? null
  );
}
export async function revokeSession(
  context: MemoryAuthContext, tokenHash: string, now: Date,
): ReturnType<Store["revokeSession"]> {
  const session = context.state.sessions.find((record) => record.tokenHash === tokenHash);
  if (session) {
    session.revokedAt = now;
  }
}
export async function listUsers(context: MemoryAuthContext): ReturnType<Store["listUsers"]> {
  return [...context.state.users].sort((left, right) => left.email.localeCompare(right.email));
}
export async function createAdminSession(
  context: MemoryAuthContext, input: Omit<AdminSessionRecord, "id" | "revokedAt">,
): ReturnType<Store["createAdminSession"]> {
  const session = { ...input, id: randomUUID(), revokedAt: null };
  context.state.adminSessions.push(session);
  return session;
}
export async function findAdminSessionByTokenHash(
  context: MemoryAuthContext, tokenHash: string, now: Date,
): ReturnType<Store["findAdminSessionByTokenHash"]> {
  return (
    context.state.adminSessions.find(
      (session) =>
        session.tokenHash === tokenHash &&
        session.revokedAt === null &&
        session.expiresAt > now,
    ) ?? null
  );
}
export async function revokeAdminSession(
  context: MemoryAuthContext, tokenHash: string, now: Date,
): ReturnType<Store["revokeAdminSession"]> {
  const session = context.state.adminSessions.find(
    (record) => record.tokenHash === tokenHash,
  );
  if (session) {
    session.revokedAt = now;
  }
}
export function latestUsableOtp(
  context: MemoryAuthContext, purpose: OtpPurpose, email: string, state: string, now: Date,
): EmailOtpRecord | null {
  return (
    [...context.state.emailOtps]
      .reverse()
      .find(
        (otp) =>
          otp.purpose === purpose &&
          otp.email === email &&
          otp.state === state &&
          otp.consumedAt === null &&
          otp.attempts < 5 &&
          otp.expiresAt > now,
      ) ?? null
  );
}
