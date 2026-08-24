import { emailDispatchRateLimitReservations } from "../rateLimitPolicy.js";
import type {
  ActivationCodeRecord,
  PrepareSelfServiceActivationCodeResult,
  Store,
} from "../contracts.js";
import type { MemoryAtomicCoordinator, MemoryState } from "./atomic.js";
import { reserveEmailDispatchRateLimits } from "./rateLimits.js";

export type MemorySelfServiceActivationContext = {
  state: MemoryState;
  atomic: MemoryAtomicCoordinator;
  findSessionByTokenHash: Store["findSessionByTokenHash"];
  getUserById: Store["getUserById"];
  getEntitlement: Store["getEntitlement"];
  createActivationCode: Store["createActivationCode"];
};

export async function prepareSelfServiceActivationCode(
  context: MemorySelfServiceActivationContext,
  input: Parameters<Store["prepareSelfServiceActivationCode"]>[0],
): ReturnType<Store["prepareSelfServiceActivationCode"]> {
  return context.atomic.run(async () => {
    const session = await context.findSessionByTokenHash(input.sessionTokenHash, input.now);
    if (!session) {
      return { status: "session_invalid" };
    }
    const user = await context.getUserById(session.userId);
    if (!user) {
      return { status: "session_invalid" };
    }
    const entitlement = await context.getEntitlement(user.id);
    if (entitlement && entitlement.expiresAt > input.now) {
      return { status: "entitlement_active" };
    }

    const reservations = emailDispatchRateLimitReservations({
      purpose: "self_service_activation",
      normalizedEmail: user.email,
      ip: input.ip,
      now: input.now,
    });
    const reserved = reserveEmailDispatchRateLimits(context.state, reservations, input.now);
    if (reserved.status === "rate_limited") {
      return reserved;
    }

    for (const code of context.state.activationCodes) {
      if (
        code.issuanceSource !== "self_service_email" ||
        code.issuedToUserId !== user.id ||
        code.status !== "pending_delivery"
      ) {
        continue;
      }
      if (code.redeemBy <= input.now) {
        code.status = "expired";
        code.disabledReason = null;
        continue;
      }
      code.status = "disabled";
      code.disabledReason = "superseded";
    }

    await context.createActivationCode({
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
    });

    return {
      status: "prepared",
      code: "",
      email: user.email,
      retryAt: emailMinuteRetryAt(reservations),
    };
  });
}

export async function disablePreparedSelfServiceActivationCode(
  context: MemorySelfServiceActivationContext,
  input: Parameters<Store["disablePreparedSelfServiceActivationCode"]>[0],
): ReturnType<Store["disablePreparedSelfServiceActivationCode"]> {
  return context.atomic.run(async () => {
    const code = context.state.activationCodes.find(
      (record) =>
        record.id === input.activationCodeId &&
        record.issuanceSource === "self_service_email" &&
        record.status === "pending_delivery",
    );
    if (!code) {
      return null;
    }
    code.status = "disabled";
    code.disabledReason = input.reason;
    return code;
  });
}

export async function activatePreparedSelfServiceActivationCode(
  context: MemorySelfServiceActivationContext,
  input: Parameters<Store["activatePreparedSelfServiceActivationCode"]>[0],
): ReturnType<Store["activatePreparedSelfServiceActivationCode"]> {
  return context.atomic.run(async () => {
    const code = context.state.activationCodes.find(
      (record) => record.id === input.activationCodeId,
    );
    if (
      !code ||
      code.issuanceSource !== "self_service_email" ||
      code.status !== "pending_delivery" ||
      code.issuedToUserId === null
    ) {
      return { status: "invalid" };
    }
    if (code.redeemBy <= input.now) {
      code.status = "expired";
      return { status: "invalid" };
    }
    const entitlement = await context.getEntitlement(code.issuedToUserId);
    if (entitlement && entitlement.expiresAt > input.now) {
      return { status: "entitlement_active" };
    }

    for (const existing of context.state.activationCodes) {
      if (
        existing.id === code.id ||
        existing.issuanceSource !== "self_service_email" ||
        existing.issuedToUserId !== code.issuedToUserId ||
        existing.status !== "active"
      ) {
        continue;
      }
      existing.status = "disabled";
      existing.disabledReason = "superseded";
    }

    code.status = "active";
    code.sentAt = input.now;
    code.disabledReason = null;
    return { status: "activated" };
  });
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

export function expireActivationCodeIfNeeded(code: ActivationCodeRecord, now: Date): boolean {
  if (
    code.redeemBy > now ||
    code.status === "redeemed" ||
    code.status === "disabled" ||
    code.status === "expired"
  ) {
    return false;
  }
  code.status = "expired";
  code.disabledReason = null;
  return true;
}

export function isActiveEntitlementAt(
  entitlement: { expiresAt: Date } | null,
  now: Date,
): boolean {
  return Boolean(entitlement && entitlement.expiresAt > now);
}
