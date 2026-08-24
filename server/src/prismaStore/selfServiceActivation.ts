import { type Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ActivationCodeRecord, Store } from "../store/contracts.js";
import { emailDispatchRateLimitReservations } from "../store/rateLimitPolicy.js";
import {
  StoreTemporarilyUnavailableError,
  withConflictRetry,
} from "./concurrency.js";
import {
  RateLimitExceededError,
  reserveEmailDispatchRateLimits,
} from "./rateLimits.js";

export async function prepareSelfServiceActivationCode(
  prisma: PrismaClient,
  input: Parameters<Store["prepareSelfServiceActivationCode"]>[0],
): ReturnType<Store["prepareSelfServiceActivationCode"]> {
  const attempted = await withConflictRetry(async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const session = await tx.session.findFirst({
          where: {
            tokenHash: input.sessionTokenHash,
            revokedAt: null,
            expiresAt: { gt: input.now },
          },
        });
        if (!session) {
          return { status: "session_invalid" } as const;
        }
        const user = await tx.user.findUnique({ where: { id: session.userId } });
        if (!user) {
          return { status: "session_invalid" } as const;
        }
        const entitlement = await tx.entitlement.findUnique({ where: { userId: user.id } });
        if (isActiveEntitlementAt(entitlement, input.now)) {
          return { status: "entitlement_active" } as const;
        }

        const userReservations = emailDispatchRateLimitReservations({
          purpose: "self_service_activation",
          normalizedEmail: user.email,
          ip: input.ip,
          now: input.now,
        });
        await reserveEmailDispatchRateLimits(tx, userReservations, input.now);

        await tx.activationCode.updateMany({
          where: {
            issuanceSource: "self_service_email",
            issuedToUserId: user.id,
            status: "pending_delivery",
            redeemBy: { lte: input.now },
          },
          data: { status: "expired", disabledReason: null },
        });
        await tx.activationCode.updateMany({
          where: {
            issuanceSource: "self_service_email",
            issuedToUserId: user.id,
            status: "pending_delivery",
            redeemBy: { gt: input.now },
          },
          data: { status: "disabled", disabledReason: "superseded" },
        });

        const code = await tx.activationCode.create({
          data: {
            id: randomUUID(),
            codeHash: input.codeHash,
            codePrefix: input.codePrefix,
            status: "pending_delivery",
            issuanceSource: "self_service_email",
            entitlementDays: input.entitlementDays,
            issuedToUserId: user.id,
            redeemBy: input.redeemBy,
            createdAt: input.now,
            sentAt: null,
            redeemedAt: null,
            redeemedByUserId: null,
            disabledReason: null,
          },
        });
        return {
          status: "prepared",
          activationCodeId: code.id,
          email: user.email,
          retryAt: emailMinuteRetryAt(userReservations),
          redeemBy: code.redeemBy,
        } as const;
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

export async function disablePreparedSelfServiceActivationCode(
  prisma: PrismaClient,
  input: Parameters<Store["disablePreparedSelfServiceActivationCode"]>[0],
): ReturnType<Store["disablePreparedSelfServiceActivationCode"]> {
  const attempted = await withConflictRetry(async () => {
    const updated = await prisma.activationCode.updateMany({
      where: {
        id: input.activationCodeId,
        issuanceSource: "self_service_email",
        status: "pending_delivery",
      },
      data: {
        status: "disabled",
        disabledReason: input.reason,
      },
    });
    if (updated.count !== 1) {
      return null;
    }
    return prisma.activationCode.findUnique({
      where: { id: input.activationCodeId },
    }) as Promise<ActivationCodeRecord | null>;
  });
  if (attempted.status === "exhausted") {
    throw new StoreTemporarilyUnavailableError();
  }
  return attempted.value;
}

export async function activatePreparedSelfServiceActivationCode(
  prisma: PrismaClient,
  input: Parameters<Store["activatePreparedSelfServiceActivationCode"]>[0],
): ReturnType<Store["activatePreparedSelfServiceActivationCode"]> {
  const attempted = await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const code = await tx.activationCode.findUnique({
        where: { id: input.activationCodeId },
      });
      if (
        !code ||
        code.issuanceSource !== "self_service_email" ||
        code.status !== "pending_delivery" ||
        code.issuedToUserId === null
      ) {
        return { status: "invalid" } as const;
      }
      if (await expireActivationCodeIfNeeded(tx, code, input.now)) {
        return { status: "invalid" } as const;
      }

      const entitlement = await tx.entitlement.findUnique({
        where: { userId: code.issuedToUserId },
      });
      if (isActiveEntitlementAt(entitlement, input.now)) {
        const disabled = await tx.activationCode.updateMany({
          where: {
            id: code.id,
            issuanceSource: "self_service_email",
            status: "pending_delivery",
          },
          data: {
            status: "disabled",
            disabledReason: "activation_became_active",
          },
        });
        return disabled.count === 1
          ? ({ status: "entitlement_active" } as const)
          : ({ status: "invalid" } as const);
      }

      await tx.activationCode.updateMany({
        where: {
          id: { not: code.id },
          issuanceSource: "self_service_email",
          issuedToUserId: code.issuedToUserId,
          status: "active",
        },
        data: {
          status: "disabled",
          disabledReason: "superseded",
        },
      });
      const activated = await tx.activationCode.updateMany({
        where: {
          id: code.id,
          issuanceSource: "self_service_email",
          issuedToUserId: code.issuedToUserId,
          status: "pending_delivery",
          redeemBy: { gt: input.now },
        },
        data: {
          status: "active",
          sentAt: input.now,
          disabledReason: null,
        },
      });
      return activated.count === 1
        ? ({ status: "activated" } as const)
        : ({ status: "invalid" } as const);
    }),
  );
  return attempted.status === "exhausted"
    ? { status: "temporarily_unavailable" }
    : attempted.value;
}

export async function expireActivationCodeIfNeeded(
  tx: Prisma.TransactionClient,
  code: { id: string; status: string; redeemBy: Date },
  now: Date,
): Promise<boolean> {
  if (code.status !== "active" || code.redeemBy > now) {
    return false;
  }
  const updated = await tx.activationCode.updateMany({
    where: {
      id: code.id,
      status: "active",
      redeemBy: { lte: now },
    },
    data: { status: "expired", disabledReason: null },
  });
  return updated.count === 1;
}

export function isActiveEntitlementAt(
  entitlement: { expiresAt: Date } | null,
  now: Date,
): boolean {
  return Boolean(entitlement && entitlement.expiresAt > now);
}

function emailMinuteRetryAt(
  reservations: ReturnType<typeof emailDispatchRateLimitReservations>,
): Date {
  const minuteReservation = reservations.find((reservation) => reservation.scope === "email_minute");
  if (!minuteReservation) {
    throw new Error("self-service email minute reservation is required");
  }
  return new Date(
    minuteReservation.windowStart.getTime() + minuteReservation.windowSeconds * 1000,
  );
}
