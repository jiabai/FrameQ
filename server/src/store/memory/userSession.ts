import { randomUUID } from "node:crypto";
import { constantTimeEqual } from "../../security.js";
import type { Store, UserSessionRecord } from "../contracts.js";
import type { MemoryAuthContext } from "./auth.js";
import { latestUsableOtp } from "./auth.js";

export async function verifyUserOtpAndCreateWebSession(
  context: MemoryAuthContext,
  input: Parameters<Store["verifyUserOtpAndCreateWebSession"]>[0],
): ReturnType<Store["verifyUserOtpAndCreateWebSession"]> {
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
    const session = await context.createUserSession({
      userId: user.id,
      email: input.email,
      tokenHash: input.sessionTokenHash,
      csrfTokenHash: input.csrfTokenHash,
      createdAt: input.now,
      expiresAt: input.sessionExpiresAt,
    });
    return { status: "verified", user, session };
  });
}

export async function createUserSession(
  context: MemoryAuthContext,
  input: Omit<UserSessionRecord, "id" | "revokedAt">,
): ReturnType<Store["createUserSession"]> {
  const session = { ...input, id: randomUUID(), revokedAt: null };
  context.state.userSessions.push(session);
  return session;
}

export async function findUserSessionByTokenHash(
  context: MemoryAuthContext,
  tokenHash: string,
  now: Date,
): ReturnType<Store["findUserSessionByTokenHash"]> {
  return (
    context.state.userSessions.find(
      (session) =>
        session.tokenHash === tokenHash &&
        session.revokedAt === null &&
        session.expiresAt > now,
    ) ?? null
  );
}

export async function revokeUserSession(
  context: MemoryAuthContext,
  tokenHash: string,
  now: Date,
): ReturnType<Store["revokeUserSession"]> {
  const session = context.state.userSessions.find(
    (record) => record.tokenHash === tokenHash,
  );
  if (session) {
    session.revokedAt = now;
  }
}
