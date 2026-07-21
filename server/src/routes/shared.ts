import { sha256 } from "../security.js";
import type { EntitlementRecord, SessionRecord, Store } from "../store.js";

export async function authenticateDesktop(
  store: Store,
  authorization: string | undefined,
  now: Date,
): Promise<SessionRecord | null> {
  const token = bearerToken(authorization);
  if (!token) {
    return null;
  }
  return store.findSessionByTokenHash(sha256(token), now);
}

export function bearerToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function llmQuotaRemaining(entitlement: EntitlementRecord, now: Date): number {
  if (entitlement.expiresAt <= now) {
    return 0;
  }
  return Math.max(0, entitlement.llmQuotaLimit - entitlement.llmQuotaUsed);
}

export function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}
