import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { constantTimeEqual } from "../security.js";
import type {
  Store,
  UserRecord,
  UserSessionRecord,
} from "../store/contracts.js";
import { withConflictRetry } from "./concurrency.js";

export async function verifyUserOtpAndCreateWebSession(
  prisma: PrismaClient,
  input: Parameters<Store["verifyUserOtpAndCreateWebSession"]>[0],
): ReturnType<Store["verifyUserOtpAndCreateWebSession"]> {
  const sessionId = randomUUID();
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
      const session = await tx.userSession.create({
        data: {
          id: sessionId,
          userId: user.id,
          email: input.email,
          tokenHash: input.sessionTokenHash,
          csrfTokenHash: input.csrfTokenHash,
          createdAt: input.now,
          expiresAt: input.sessionExpiresAt,
          revokedAt: null,
        },
      });
      return {
        status: "verified",
        user: user as UserRecord,
        session: session as UserSessionRecord,
      } as const;
    }),
  );
  return attempted.status === "exhausted"
    ? { status: "temporarily_unavailable" }
    : attempted.value;
}

export async function createUserSession(
  prisma: PrismaClient,
  input: Omit<UserSessionRecord, "id" | "revokedAt">,
): Promise<UserSessionRecord> {
  return prisma.userSession.create({
    data: { ...input, id: randomUUID(), revokedAt: null },
  }) as Promise<UserSessionRecord>;
}

export async function findUserSessionByTokenHash(
  prisma: PrismaClient,
  tokenHash: string,
  now: Date,
): Promise<UserSessionRecord | null> {
  return prisma.userSession.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
  }) as Promise<UserSessionRecord | null>;
}

export async function revokeUserSession(
  prisma: PrismaClient,
  tokenHash: string,
  now: Date,
): Promise<void> {
  await prisma.userSession.updateMany({
    where: { tokenHash },
    data: { revokedAt: now },
  });
}
