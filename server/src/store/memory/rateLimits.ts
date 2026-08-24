import { randomUUID } from "node:crypto";
import type {
  AuthRateLimitRecord,
} from "../contracts.js";
import type { MemoryState } from "./atomic.js";
import type { EmailDispatchRateLimitReservation } from "../rateLimitPolicy.js";

type RateLimitReservationResult =
  | { status: "reserved" }
  | { status: "rate_limited"; retryAt: Date };

export function reserveEmailDispatchRateLimits(
  state: Pick<MemoryState, "authRateLimits">,
  reservations: EmailDispatchRateLimitReservation[],
  now: Date,
): RateLimitReservationResult {
  const blockedAt = reservations
    .map((reservation) => planReservation(state.authRateLimits, reservation, now))
    .filter((result): result is { status: "rate_limited"; retryAt: Date } => result.status === "rate_limited")
    .map((result) => result.retryAt);
  if (blockedAt.length > 0) {
    return {
      status: "rate_limited",
      retryAt: new Date(Math.max(...blockedAt.map((value) => value.getTime()))),
    };
  }

  for (const reservation of reservations) {
    applyReservation(state.authRateLimits, reservation, now);
  }
  return { status: "reserved" };
}

function planReservation(
  records: AuthRateLimitRecord[],
  reservation: EmailDispatchRateLimitReservation,
  now: Date,
): RateLimitReservationResult {
  const existing = records.find((record) => record.keyHash === reservation.key);
  if (!existing) {
    return { status: "reserved" };
  }
  if (reservation.scope === "email_minute") {
    return existing.nextAllowedAt > now
      ? { status: "rate_limited", retryAt: existing.nextAllowedAt }
      : { status: "reserved" };
  }
  const sameWindow = existing.windowStartedAt.getTime() === reservation.windowStart.getTime();
  if (sameWindow && existing.count >= reservation.limit) {
    return { status: "rate_limited", retryAt: existing.nextAllowedAt };
  }
  return { status: "reserved" };
}

function applyReservation(
  records: AuthRateLimitRecord[],
  reservation: EmailDispatchRateLimitReservation,
  now: Date,
): void {
  const existing = records.find((record) => record.keyHash === reservation.key);
  const nextAllowedAt = new Date(
    reservation.windowStart.getTime() + reservation.windowSeconds * 1000,
  );
  if (!existing) {
    records.push({
      id: randomUUID(),
      keyHash: reservation.key,
      purpose: reservation.purpose,
      scope: reservation.scope,
      windowStartedAt: reservation.windowStart,
      count: 1,
      nextAllowedAt,
      updatedAt: now,
    });
    return;
  }
  const sameWindow = existing.windowStartedAt.getTime() === reservation.windowStart.getTime();
  existing.windowStartedAt = reservation.windowStart;
  existing.count = sameWindow ? existing.count + 1 : 1;
  existing.nextAllowedAt = nextAllowedAt;
  existing.updatedAt = now;
}
