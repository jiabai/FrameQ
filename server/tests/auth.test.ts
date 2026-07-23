import { beforeEach, describe, expect, test } from "vitest";
import { AuthService } from "../src/auth.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-06-21T08:00:00.000Z");

describe("email OTP auth", () => {
  let store: MemoryStore;
  let sentCodes: Array<{ email: string; code: string }>;

  beforeEach(() => {
    store = new MemoryStore();
    sentCodes = [];
  });

  test("sends a 10 minute OTP and stores only a hash", async () => {
    const auth = new AuthService({
      store,
      now: () => now,
      sendOtp: async (email, code) => {
        sentCodes.push({ email, code });
      },
    });

    await auth.startEmailLogin({
      email: "USER@Example.COM ",
      ip: "203.0.113.10",
      state: "state-123",
    });

    expect(sentCodes).toHaveLength(1);
    expect(sentCodes[0]?.email).toBe("user@example.com");
    expect(sentCodes[0]?.code).toMatch(/^\d{6}$/);
    const otp = store.emailOtps[0];
    expect(otp?.codeHash).not.toBe(sentCodes[0]?.code);
    expect(otp?.expiresAt.toISOString()).toBe("2026-06-21T08:10:00.000Z");
  });

  test("invalidates a failed delivery while preserving the committed resend limit", async () => {
    let attempts = 0;
    const auth = new AuthService({
      store,
      now: () => now,
      sendOtp: async () => {
        attempts += 1;
        throw new Error("smtp password secret leaked by provider");
      },
    });

    await expect(
      auth.startEmailLogin({
        email: "user@example.com",
        ip: "203.0.113.10",
        state: "state-abc",
      }),
    ).rejects.toThrow("Could not send verification code. Please try again later.");
    await expect(auth.startEmailLogin({
      email: "user@example.com",
      ip: "203.0.113.10",
      state: "state-abc",
    })).rejects.toThrow("Please wait before requesting another verification code.");

    expect(attempts).toBe(1);
    expect(store.emailOtps).toHaveLength(1);
    expect(store.emailOtps.every((otp) => otp.consumedAt?.toISOString() === now.toISOString())).toBe(true);
    await expect(
      auth.verifyEmailCode({
        email: "user@example.com",
        code: "123456",
        state: "state-abc",
      }),
    ).rejects.toThrow("Verification code is invalid or expired.");
  });

  test("verifies a code, creates a single-use desktop ticket, and exchanges it once", async () => {
    const auth = new AuthService({
      store,
      now: () => now,
      sendOtp: async (email, code) => {
        sentCodes.push({ email, code });
      },
    });

    await auth.startEmailLogin({
      email: "user@example.com",
      ip: "203.0.113.10",
      state: "state-abc",
    });
    const verified = await auth.verifyEmailCode({
      email: "user@example.com",
      code: sentCodes[0]!.code,
      state: "state-abc",
    });
    const exchanged = await auth.exchangeDesktopTicket({
      ticket: verified.ticket,
      state: "state-abc",
    });

    expect(exchanged.email).toBe("user@example.com");
    expect(exchanged.sessionToken).toMatch(/^fq_/);
    expect(store.sessions[0]?.tokenHash).not.toBe(exchanged.sessionToken);
    await expect(
      auth.exchangeDesktopTicket({ ticket: verified.ticket, state: "state-abc" }),
    ).rejects.toThrow("Login ticket is invalid or expired.");
  });

  test("rejects expired codes and locks after five bad attempts", async () => {
    let clock = now;
    const auth = new AuthService({
      store,
      now: () => clock,
      sendOtp: async (email, code) => {
        sentCodes.push({ email, code });
      },
    });

    await auth.startEmailLogin({
      email: "user@example.com",
      ip: "203.0.113.10",
      state: "state-abc",
    });
    clock = new Date("2026-06-21T08:11:00.000Z");

    await expect(
      auth.verifyEmailCode({ email: "user@example.com", code: sentCodes[0]!.code, state: "state-abc" }),
    ).rejects.toThrow("Verification code is invalid or expired.");

    clock = now;
    await auth.startEmailLogin({
      email: "other@example.com",
      ip: "203.0.113.10",
      state: "state-def",
    });
    for (let index = 0; index < 5; index += 1) {
      await expect(
        auth.verifyEmailCode({ email: "other@example.com", code: "000000", state: "state-def" }),
      ).rejects.toThrow("Verification code is invalid or expired.");
    }

    await expect(
      auth.verifyEmailCode({
        email: "other@example.com",
        code: sentCodes[1]!.code,
        state: "state-def",
      }),
    ).rejects.toThrow("Verification code is invalid or expired.");
  });
});
