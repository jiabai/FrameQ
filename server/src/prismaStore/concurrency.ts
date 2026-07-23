import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { authRateLimitKey } from "../security.js";
import type {
  AuthRateLimitScope,
  EmailOtpRecord,
  OtpPurpose,
} from "../store/contracts.js";

export type PrismaRateLimitReservation = {
  id: string;
  keyHash: string;
  purpose: OtpPurpose;
  scope: AuthRateLimitScope;
  windowStartedAt: Date;
  nextAllowedAt: Date;
  maxCount: number;
};

export class RateLimitExceededError extends Error {
  constructor(readonly retryAt: Date) {
    super("AUTH_RATE_LIMITED");
    this.name = "RateLimitExceededError";
  }
}

export class StoreTemporarilyUnavailableError extends Error {
  constructor() {
    super("SERVER_TEMPORARILY_UNAVAILABLE");
    this.name = "StoreTemporarilyUnavailableError";
  }
}

export function prismaRateLimitReservations(
  input: Omit<EmailOtpRecord, "id" | "attempts" | "consumedAt">,
): PrismaRateLimitReservation[] {
  const hourStart = new Date(
    Math.floor(input.createdAt.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000,
  );
  const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
  const reservation = (
    scope: AuthRateLimitScope,
    value: string,
    windowStartedAt: Date,
    nextAllowedAt: Date,
    maxCount: number,
  ): PrismaRateLimitReservation => ({
    id: randomUUID(),
    keyHash: authRateLimitKey(scope, input.purpose, value),
    purpose: input.purpose,
    scope,
    windowStartedAt,
    nextAllowedAt,
    maxCount,
  });
  return [
    reservation(
      "email_minute",
      input.email,
      input.createdAt,
      new Date(input.createdAt.getTime() + 60 * 1000),
      1,
    ),
    reservation("email_hour", input.email, hourStart, hourEnd, 5),
    reservation("ip_hour", input.ip, hourStart, hourEnd, 20),
  ];
}

export async function reserveAuthRateLimit(
  tx: Prisma.TransactionClient,
  reservation: PrismaRateLimitReservation,
  now: Date,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ nextAllowedAt: Date }>>(Prisma.sql`
    INSERT INTO "AuthRateLimit" (
      "id", "keyHash", "purpose", "scope", "windowStartedAt", "count", "nextAllowedAt", "updatedAt"
    ) VALUES (
      ${reservation.id}, ${reservation.keyHash}, ${reservation.purpose}, ${reservation.scope},
      ${reservation.windowStartedAt}, 1, ${reservation.nextAllowedAt}, ${now}
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
        OR "AuthRateLimit"."count" < ${reservation.maxCount}
      ))
    RETURNING "nextAllowedAt"
  `);
  if (rows.length > 0) {
    return;
  }
  const existing = await tx.authRateLimit.findUnique({
    where: { keyHash: reservation.keyHash },
  });
  throw new RateLimitExceededError(existing?.nextAllowedAt ?? reservation.nextAllowedAt);
}

export type ConflictRetryResult<T> =
  | { status: "completed"; value: T }
  | { status: "exhausted" };

export async function withConflictRetry<T>(
  operation: () => Promise<T>,
  isAdditionalRetryable: (error: unknown) => boolean = () => false,
): Promise<ConflictRetryResult<T>> {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return { status: "completed", value: await operation() };
    } catch (error) {
      if (!isRetryablePrismaConflict(error) && !isAdditionalRetryable(error)) {
        throw error;
      }
      if (attempt === maximumAttempts) {
        return { status: "exhausted" };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 5));
    }
  }
  return { status: "exhausted" };
}

function isRetryablePrismaConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034" || error.code === "P1008") {
      return true;
    }
    if (error.code === "P2010") {
      const meta = error.meta as { code?: unknown; message?: unknown } | undefined;
      return meta?.code === "5" || hasSqliteBusyMarker(meta?.message);
    }
    return error.code === "P2028" && hasSqliteBusyMarker(error.message);
  }
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    hasSqliteBusyMarker(error.message)
  );
}

function hasSqliteBusyMarker(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /SQLITE_BUSY|database (?:table )?is locked/i.test(value)
  );
}

export function isLlmUsageEventIdempotencyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.includes("userId") && target.includes("requestId");
  }
  return (
    typeof target === "string" &&
    target.includes("userId") &&
    target.includes("requestId")
  );
}

export function isPrismaKnownError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
