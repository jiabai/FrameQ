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

const publicOperationErrors = new Set([
  "Activation code is invalid or expired.",
  "Desktop session is invalid or expired.",
  "LLM API key is required.",
  "Unsupported LLM provider.",
  "LLM base URL must start with http:// or https://.",
  "LLM model is required.",
  "LLM timeout seconds must be between 1 and 600.",
  "FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY is required.",
  "invalid wechat signature",
  "invalid notification",
  "WeChat notification verification is not configured.",
  "WeChat APIv3 key must be 32 bytes.",
  "Payment transaction does not match order.",
  "Webhook does not match order.",
  "Order cannot be settled in its current state.",
]);

export function publicError(error: unknown): string | null {
  if (!(error instanceof Error) || !publicOperationErrors.has(error.message)) {
    return null;
  }
  return error.message;
}

export function isServerTemporarilyUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message === "SERVER_TEMPORARILY_UNAVAILABLE";
}

const publicAuthErrors = new Set([
  "A valid email address is required.",
  "Login state is invalid.",
  "Verification code must be 6 digits.",
  "Verification code is invalid or expired.",
  "Login ticket is invalid or expired.",
  "Please wait before requesting another verification code.",
  "Could not send verification code. Please try again later.",
]);

export function publicAuthError(error: unknown): string | null {
  if (!(error instanceof Error) || !publicAuthErrors.has(error.message)) {
    return null;
  }
  return error.message;
}
