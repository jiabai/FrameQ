import { authRateLimitKey, startOfFixedWindow } from "../security.js";
import type {
  AuthRateLimitScope,
  EmailDispatchPurpose,
} from "./contracts.js";

export type EmailDispatchRateLimitReservation = {
  key: string;
  purpose: EmailDispatchPurpose;
  scope: AuthRateLimitScope;
  windowStart: Date;
  windowSeconds: number;
  limit: number;
};

export function emailDispatchRateLimitReservations(input: {
  purpose: EmailDispatchPurpose;
  normalizedEmail: string;
  ip: string;
  now: Date;
}): EmailDispatchRateLimitReservation[] {
  const hourWindowStart = startOfFixedWindow(input.now, 60 * 60);
  const reservation = (
    scope: AuthRateLimitScope,
    value: string,
    windowStart: Date,
    windowSeconds: number,
    limit: number,
  ): EmailDispatchRateLimitReservation => ({
    key: authRateLimitKey(scope, input.purpose, value),
    purpose: input.purpose,
    scope,
    windowStart,
    windowSeconds,
    limit,
  });

  return [
    reservation("email_minute", input.normalizedEmail, input.now, 60, 1),
    reservation("email_hour", input.normalizedEmail, hourWindowStart, 60 * 60, 5),
    reservation("ip_hour", input.ip, hourWindowStart, 60 * 60, 20),
  ];
}
