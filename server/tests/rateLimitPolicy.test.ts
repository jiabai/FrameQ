import { describe, expect, test } from "vitest";
import { authRateLimitKey } from "../src/security.js";
import { emailDispatchRateLimitReservations } from "../src/store/rateLimitPolicy.js";

describe("email dispatch rate limit policy", () => {
  test("builds the shared email and IP reservations for a dispatch purpose", () => {
    const now = new Date("2026-08-24T05:34:45.000Z");

    expect(emailDispatchRateLimitReservations({
      purpose: "self_service_activation",
      normalizedEmail: "user@example.com",
      ip: "203.0.113.90",
      now,
    })).toEqual([
      {
        key: authRateLimitKey("email_minute", "self_service_activation", "user@example.com"),
        purpose: "self_service_activation",
        scope: "email_minute",
        windowStart: now,
        windowSeconds: 60,
        limit: 1,
      },
      {
        key: authRateLimitKey("email_hour", "self_service_activation", "user@example.com"),
        purpose: "self_service_activation",
        scope: "email_hour",
        windowStart: new Date("2026-08-24T05:00:00.000Z"),
        windowSeconds: 60 * 60,
        limit: 5,
      },
      {
        key: authRateLimitKey("ip_hour", "self_service_activation", "203.0.113.90"),
        purpose: "self_service_activation",
        scope: "ip_hour",
        windowStart: new Date("2026-08-24T05:00:00.000Z"),
        windowSeconds: 60 * 60,
        limit: 20,
      },
    ]);
  });
});
