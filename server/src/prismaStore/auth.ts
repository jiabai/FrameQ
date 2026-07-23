import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { constantTimeEqual } from "../security.js";
import type {
  AdminSessionRecord,
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  SessionRecord,
  Store,
  UserRecord,
} from "../store/contracts.js";
import {
  RateLimitExceededError,
  StoreTemporarilyUnavailableError,
  prismaRateLimitReservations,
  reserveAuthRateLimit,
  withConflictRetry,
} from "./concurrency.js";

export async function upsertUserByEmail(
  prisma: PrismaClient, email: string, now: Date,
): ReturnType<Store["upsertUserByEmail"]> {
  return prisma.user.upsert({
    where: { email },
    update: { updatedAt: now },
    create: { id: randomUUID(), email, createdAt: now, updatedAt: now },
  });
}

export async function getUserById(
  prisma: PrismaClient, userId: string,
): ReturnType<Store["getUserById"]> {
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function issueEmailOtp(
  prisma: PrismaClient, input: Parameters<Store["issueEmailOtp"]>[0],
): ReturnType<Store["issueEmailOtp"]> {
  const otpId = randomUUID();
  const reservations = prismaRateLimitReservations(input);
  const attempted = await withConflictRetry(async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        for (const reservation of reservations) {
          await reserveAuthRateLimit(tx, reservation, input.createdAt);
        }
        await tx.emailOtp.updateMany({
          where: {
            purpose: input.purpose,
            email: input.email,
            state: input.state,
            consumedAt: null,
          },
          data: { consumedAt: input.createdAt },
        });
        await tx.emailOtp.create({
          data: { ...input, id: otpId, attempts: 0, consumedAt: null },
        });
        return { status: "issued", otpId } as const;
      });
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return { status: "rate_limited", retryAt: error.retryAt } as const;
      }
      throw error;
    }
  });
  return attempted.status === "exhausted"
    ? { status: "temporarily_unavailable" }
    : attempted.value;
}

export async function invalidateIssuedOtpAfterDeliveryFailure(
  prisma: PrismaClient, otpId: string, now: Date,
): ReturnType<Store["invalidateIssuedOtpAfterDeliveryFailure"]> {
  const attempted = await withConflictRetry(async () => {
    await prisma.emailOtp.updateMany({
      where: { id: otpId, consumedAt: null },
      data: { consumedAt: now },
    });
  });
  if (attempted.status === "exhausted") {
    throw new StoreTemporarilyUnavailableError();
  }
}

export async function verifyDesktopOtpAndCreateTicket(
  prisma: PrismaClient,
  input: Parameters<Store["verifyDesktopOtpAndCreateTicket"]>[0],
): ReturnType<Store["verifyDesktopOtpAndCreateTicket"]> {
  const ticketId = randomUUID();
  const userId = randomUUID();
  const attempted = await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const otp = await tx.emailOtp.findFirst({
        where: {
          purpose: "desktop_login",
          email: input.email,
          state: input.state,
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: input.now },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!otp) {
        return { status: "invalid" } as const;
      }
      const matches = constantTimeEqual(otp.codeHash, input.codeHash);
      const attemptedOtp = await tx.emailOtp.updateMany({
        where: {
          id: otp.id,
          purpose: "desktop_login",
          email: input.email,
          state: input.state,
          codeHash: otp.codeHash,
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: input.now },
        },
        data: matches
          ? { attempts: { increment: 1 }, consumedAt: input.now }
          : { attempts: { increment: 1 } },
      });
      if (attemptedOtp.count !== 1 || !matches) {
        return { status: "invalid" } as const;
      }
      const user = await tx.user.upsert({
        where: { email: input.email },
        update: { updatedAt: input.now },
        create: {
          id: userId,
          email: input.email,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      const ticket = await tx.desktopLoginTicket.create({
        data: {
          id: ticketId,
          ticketHash: input.ticketHash,
          state: input.state,
          userId: user.id,
          expiresAt: input.ticketExpiresAt,
          consumedAt: null,
          createdAt: input.now,
        },
      });
      return {
        status: "verified",
        user: user as UserRecord,
        ticket: ticket as DesktopLoginTicketRecord,
      } as const;
    }),
  );
  return attempted.status === "exhausted"
    ? { status: "temporarily_unavailable" }
    : attempted.value;
}

export async function verifyAdminOtpAndCreateSession(
  prisma: PrismaClient, input: Parameters<Store["verifyAdminOtpAndCreateSession"]>[0],
): ReturnType<Store["verifyAdminOtpAndCreateSession"]> {
  const sessionId = randomUUID();
  const attempted = await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const otp = await tx.emailOtp.findFirst({
        where: {
          purpose: "admin_login",
          email: input.email,
          state: input.state,
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: input.now },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!otp) {
        return { status: "invalid" } as const;
      }
      const matches = constantTimeEqual(otp.codeHash, input.codeHash);
      const attemptedOtp = await tx.emailOtp.updateMany({
        where: {
          id: otp.id,
          purpose: "admin_login",
          email: input.email,
          state: input.state,
          codeHash: otp.codeHash,
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: input.now },
        },
        data: matches
          ? { attempts: { increment: 1 }, consumedAt: input.now }
          : { attempts: { increment: 1 } },
      });
      if (attemptedOtp.count !== 1 || !matches) {
        return { status: "invalid" } as const;
      }
      const session = await tx.adminSession.create({
        data: {
          id: sessionId,
          email: input.email,
          tokenHash: input.sessionTokenHash,
          csrfTokenHash: input.csrfTokenHash,
          createdAt: input.now,
          expiresAt: input.sessionExpiresAt,
          revokedAt: null,
        },
      });
      return { status: "verified", session: session as AdminSessionRecord } as const;
    }),
  );
  return attempted.status === "exhausted"
    ? { status: "temporarily_unavailable" }
    : attempted.value;
}

export async function exchangeDesktopTicketAndCreateSession(
  prisma: PrismaClient,
  input: Parameters<Store["exchangeDesktopTicketAndCreateSession"]>[0],
): ReturnType<Store["exchangeDesktopTicketAndCreateSession"]> {
  const sessionId = randomUUID();
  const attempted = await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const ticket = await tx.desktopLoginTicket.findUnique({
        where: { ticketHash: input.ticketHash },
      });
      if (
        !ticket ||
        ticket.state !== input.state ||
        ticket.consumedAt !== null ||
        ticket.expiresAt <= input.now
      ) {
        return { status: "invalid" } as const;
      }
      const user = await tx.user.findUnique({ where: { id: ticket.userId } });
      if (!user) {
        return { status: "invalid" } as const;
      }
      const consumed = await tx.desktopLoginTicket.updateMany({
        where: {
          id: ticket.id,
          ticketHash: input.ticketHash,
          state: input.state,
          consumedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { consumedAt: input.now },
      });
      if (consumed.count !== 1) {
        return { status: "invalid" } as const;
      }
      const session = await tx.session.create({
        data: {
          id: sessionId,
          userId: user.id,
          tokenHash: input.sessionTokenHash,
          createdAt: input.now,
          expiresAt: input.sessionExpiresAt,
          revokedAt: null,
        },
      });
      return {
        status: "exchanged",
        user: user as UserRecord,
        session: session as SessionRecord,
      } as const;
    }),
  );
  return attempted.status === "exhausted"
    ? { status: "temporarily_unavailable" }
    : attempted.value;
}

export async function createEmailOtp(
  prisma: PrismaClient,
  input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
): Promise<EmailOtpRecord> {
  return prisma.emailOtp.create({
    data: { ...input, id: randomUUID(), attempts: 0, consumedAt: null },
  }) as Promise<EmailOtpRecord>;
}

export async function findLatestUsableOtp(
  prisma: PrismaClient, email: string, state: string, now: Date,
): Promise<EmailOtpRecord | null> {
  return prisma.emailOtp.findFirst({
    where: {
      email,
      state,
      consumedAt: null,
      attempts: { lt: 5 },
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  }) as Promise<EmailOtpRecord | null>;
}

export async function incrementOtpAttempts(
  prisma: PrismaClient, otpId: string,
): Promise<EmailOtpRecord> {
  return prisma.emailOtp.update({
    where: { id: otpId },
    data: { attempts: { increment: 1 } },
  }) as Promise<EmailOtpRecord>;
}

export async function consumeOtp(
  prisma: PrismaClient, otpId: string, now: Date,
): Promise<void> {
  await prisma.emailOtp.update({
    where: { id: otpId },
    data: { consumedAt: now },
  });
}

export async function createDesktopLoginTicket(
  prisma: PrismaClient,
  input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">,
): Promise<DesktopLoginTicketRecord> {
  return prisma.desktopLoginTicket.create({
    data: { ...input, id: randomUUID(), consumedAt: null },
  });
}

export async function consumeDesktopLoginTicket(
  prisma: PrismaClient, ticketHash: string, state: string, now: Date,
): Promise<DesktopLoginTicketRecord | null> {
  const ticket = await prisma.desktopLoginTicket.findFirst({
    where: { ticketHash, state, consumedAt: null, expiresAt: { gt: now } },
  });
  if (!ticket) {
    return null;
  }
  return prisma.desktopLoginTicket.update({
    where: { id: ticket.id },
    data: { consumedAt: now },
  });
}

export async function createSession(
  prisma: PrismaClient, input: Omit<SessionRecord, "id" | "revokedAt">,
): ReturnType<Store["createSession"]> {
  return prisma.session.create({
    data: { ...input, id: randomUUID(), revokedAt: null },
  });
}

export async function findSessionByTokenHash(
  prisma: PrismaClient, tokenHash: string, now: Date,
): ReturnType<Store["findSessionByTokenHash"]> {
  return prisma.session.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
  });
}

export async function revokeSession(
  prisma: PrismaClient, tokenHash: string, now: Date,
): ReturnType<Store["revokeSession"]> {
  await prisma.session.updateMany({ where: { tokenHash }, data: { revokedAt: now } });
}

export async function listUsers(prisma: PrismaClient): ReturnType<Store["listUsers"]> {
  return prisma.user.findMany({ orderBy: { email: "asc" } });
}

export async function createAdminSession(
  prisma: PrismaClient, input: Omit<AdminSessionRecord, "id" | "revokedAt">,
): ReturnType<Store["createAdminSession"]> {
  return prisma.adminSession.create({
    data: { ...input, id: randomUUID(), revokedAt: null },
  });
}

export async function findAdminSessionByTokenHash(
  prisma: PrismaClient, tokenHash: string, now: Date,
): ReturnType<Store["findAdminSessionByTokenHash"]> {
  return prisma.adminSession.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
  });
}

export async function revokeAdminSession(
  prisma: PrismaClient, tokenHash: string, now: Date,
): ReturnType<Store["revokeAdminSession"]> {
  await prisma.adminSession.updateMany({
    where: { tokenHash },
    data: { revokedAt: now },
  });
}
