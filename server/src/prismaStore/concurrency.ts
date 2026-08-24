import { Prisma } from "@prisma/client";

export class StoreTemporarilyUnavailableError extends Error {
  constructor() {
    super("SERVER_TEMPORARILY_UNAVAILABLE");
    this.name = "StoreTemporarilyUnavailableError";
  }
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
