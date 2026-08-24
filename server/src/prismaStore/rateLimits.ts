import { Prisma } from "@prisma/client";
import type { EmailDispatchRateLimitReservation } from "../store/rateLimitPolicy.js";
import { emailDispatchRateLimitReservations } from "../store/rateLimitPolicy.js";

export class RateLimitExceededError extends Error {
  constructor(readonly retryAt: Date) {
    super("AUTH_RATE_LIMITED");
    this.name = "RateLimitExceededError";
  }
}

export function toEmailDispatchRateLimitReservations(input: {
  purpose: EmailDispatchRateLimitReservation["purpose"];
  normalizedEmail: string;
  ip: string;
  now: Date;
}): EmailDispatchRateLimitReservation[] {
  return emailDispatchRateLimitReservations(input);
}

export async function reserveEmailDispatchRateLimits(
  tx: Prisma.TransactionClient,
  reservations: EmailDispatchRateLimitReservation[],
  now: Date,
): Promise<void> {
  for (const reservation of reservations) {
    await reserveEmailDispatchRateLimit(tx, reservation, now);
  }
}

async function reserveEmailDispatchRateLimit(
  tx: Prisma.TransactionClient,
  reservation: EmailDispatchRateLimitReservation,
  now: Date,
): Promise<void> {
  const nextAllowedAt = new Date(
    reservation.windowStart.getTime() + reservation.windowSeconds * 1000,
  );
  const rows = await tx.$queryRaw<Array<{ nextAllowedAt: Date }>>(Prisma.sql`
    INSERT INTO "AuthRateLimit" (
      "id", "keyHash", "purpose", "scope", "windowStartedAt", "count", "nextAllowedAt", "updatedAt"
    ) VALUES (
      ${crypto.randomUUID()}, ${reservation.key}, ${reservation.purpose}, ${reservation.scope},
      ${reservation.windowStart}, 1, ${nextAllowedAt}, ${now}
    )
    ON CONFLICT("keyHash") DO UPDATE SET
      "windowStartedAt" = excluded."windowStartedAt",
      "count" = CASE
        WHEN excluded."scope" <> 'email_minute'
          AND "AuthRateLimit"."windowStartedAt" = excluded."windowStartedAt"
        THEN "AuthRateLimit"."count" + 1
        ELSE 1
      END,
      "nextAllowedAt" = excluded."nextAllowedAt",
      "updatedAt" = excluded."updatedAt"
    WHERE
      (excluded."scope" = 'email_minute' AND "AuthRateLimit"."nextAllowedAt" <= ${now})
      OR
      (excluded."scope" <> 'email_minute' AND (
        "AuthRateLimit"."windowStartedAt" <> excluded."windowStartedAt"
        OR "AuthRateLimit"."count" < ${reservation.limit}
      ))
    RETURNING "nextAllowedAt"
  `);
  if (rows.length > 0) {
    return;
  }
  const existing = await tx.authRateLimit.findUnique({
    where: { keyHash: reservation.key },
  });
  throw new RateLimitExceededError(existing?.nextAllowedAt ?? nextAllowedAt);
}
