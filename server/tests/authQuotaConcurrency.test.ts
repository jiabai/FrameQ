import { describe, expect, test } from "vitest";
import { AdminAuthService } from "../src/adminAuth.js";
import { AuthService } from "../src/auth.js";
import { sha256 } from "../src/security.js";
import type { DesktopLoginTicketRecord } from "../src/store.js";
import { MemoryStore, type SessionRecord } from "../src/store.js";

const now = new Date("2026-07-22T08:00:00.000Z");

class FailOnceSessionStore extends MemoryStore {
  failNextSession = false;

  override async createSession(input: Omit<SessionRecord, "id" | "revokedAt">): Promise<SessionRecord> {
    if (this.failNextSession) {
      this.failNextSession = false;
      throw new Error("injected session write failure");
    }
    return super.createSession(input);
  }
}

class FailOnceTicketStore extends MemoryStore {
  failNextTicket = false;

  override async createDesktopLoginTicket(
    input: Omit<DesktopLoginTicketRecord, "id" | "consumedAt">,
  ): Promise<DesktopLoginTicketRecord> {
    if (this.failNextTicket) {
      this.failNextTicket = false;
      throw new Error("injected ticket write failure");
    }
    return super.createDesktopLoginTicket(input);
  }
}

describe("MemoryStore authentication concurrency boundaries", () => {
  test("one desktop OTP creates at most one ticket under concurrent correct verification", async () => {
    const store = new MemoryStore();
    let code = "";
    const auth = new AuthService({
      store,
      now: () => now,
      sendOtp: async (_email, value) => {
        code = value;
      },
    });
    const input = { email: "desktop@example.com", state: "desktop-state", ip: "203.0.113.10" };
    await auth.startEmailLogin(input);

    const results = await Promise.allSettled([
      auth.verifyEmailCode({ email: input.email, state: input.state, code }),
      auth.verifyEmailCode({ email: input.email, state: input.state, code }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.desktopLoginTickets).toHaveLength(1);
    expect(store.emailOtps[0]?.attempts).toBe(1);
  });

  test("one admin OTP creates at most one session under concurrent correct verification", async () => {
    const store = new MemoryStore();
    let code = "";
    const auth = new AdminAuthService({
      store,
      adminEmail: "admin@example.com",
      now: () => now,
      sendOtp: async (_email, value) => {
        code = value;
      },
    });
    const input = { email: "admin@example.com", state: "admin-state", ip: "203.0.113.11" };
    await auth.startEmailLogin(input);

    const results = await Promise.allSettled([
      auth.verifyEmailCode({ email: input.email, state: input.state, code }),
      auth.verifyEmailCode({ email: input.email, state: input.state, code }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.adminSessions).toHaveLength(1);
    expect(store.emailOtps[0]?.attempts).toBe(1);
  });

  test("a session write failure leaves the desktop ticket usable for retry", async () => {
    const store = new FailOnceSessionStore();
    let code = "";
    const auth = new AuthService({
      store,
      now: () => now,
      sendOtp: async (_email, value) => {
        code = value;
      },
    });
    await auth.startEmailLogin({
      email: "ticket@example.com",
      state: "ticket-state",
      ip: "203.0.113.12",
    });
    const verified = await auth.verifyEmailCode({
      email: "ticket@example.com",
      state: "ticket-state",
      code,
    });

    store.failNextSession = true;
    await expect(
      auth.exchangeDesktopTicket({ ticket: verified.ticket, state: "ticket-state" }),
    ).rejects.toThrow("injected session write failure");
    await expect(
      auth.exchangeDesktopTicket({ ticket: verified.ticket, state: "ticket-state" }),
    ).resolves.toMatchObject({ email: "ticket@example.com" });
    expect(store.sessions).toHaveLength(1);
  });

  test("overlapping OTP dispatches reserve the resend window before SMTP", async () => {
    const store = new MemoryStore();
    let sends = 0;
    const auth = new AuthService({
      store,
      now: () => now,
      sendOtp: async () => {
        sends += 1;
      },
    });
    const input = { email: "rate@example.com", state: "rate-state", ip: "203.0.113.13" };

    const results = await Promise.allSettled([auth.startEmailLogin(input), auth.startEmailLogin(input)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(sends).toBe(1);
    expect(store.emailOtps.filter((otp) => otp.consumedAt === null)).toHaveLength(1);
  });

  test("rolls back OTP consumption and its attempt when ticket creation fails", async () => {
    const store = new FailOnceTicketStore();
    let code = "";
    const auth = new AuthService({
      store,
      now: () => now,
      sendOtp: async (_email, value) => {
        code = value;
      },
    });
    await auth.startEmailLogin({ email: "rollback@example.com", state: "rollback-state", ip: "203.0.113.14" });

    store.failNextTicket = true;
    await expect(
      auth.verifyEmailCode({ email: "rollback@example.com", state: "rollback-state", code }),
    ).rejects.toThrow("injected ticket write failure");
    await expect(
      auth.verifyEmailCode({ email: "rollback@example.com", state: "rollback-state", code }),
    ).resolves.toMatchObject({ ticket: expect.stringMatching(/^flt_/) });
    expect(store.emailOtps[0]).toMatchObject({ attempts: 1, consumedAt: now });
    expect(store.desktopLoginTickets).toHaveLength(1);
  });

  test("isolates desktop and administrator OTP purposes for the same scope", async () => {
    const store = new MemoryStore();
    const shared = {
      email: "shared-admin@example.com",
      state: "shared-state",
      ip: "203.0.113.15",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      createdAt: now,
    };
    await store.issueEmailOtp({ ...shared, purpose: "desktop_login", codeHash: sha256("111111") });
    await store.issueEmailOtp({ ...shared, purpose: "admin_login", codeHash: sha256("222222") });

    await expect(store.verifyDesktopOtpAndCreateTicket({
      email: shared.email,
      state: shared.state,
      codeHash: sha256("222222"),
      ticketHash: sha256("desktop-ticket-wrong-purpose"),
      now,
      ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    })).resolves.toEqual({ status: "invalid" });
    await expect(store.verifyAdminOtpAndCreateSession({
      email: shared.email,
      state: shared.state,
      codeHash: sha256("111111"),
      sessionTokenHash: sha256("admin-session-wrong-purpose"),
      csrfTokenHash: sha256("admin-csrf-wrong-purpose"),
      now,
      sessionExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    })).resolves.toEqual({ status: "invalid" });
    await expect(store.verifyDesktopOtpAndCreateTicket({
      email: shared.email,
      state: shared.state,
      codeHash: sha256("111111"),
      ticketHash: sha256("desktop-ticket-correct-purpose"),
      now,
      ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    })).resolves.toMatchObject({ status: "verified" });
    await expect(store.verifyAdminOtpAndCreateSession({
      email: shared.email,
      state: shared.state,
      codeHash: sha256("222222"),
      sessionTokenHash: sha256("admin-session-correct-purpose"),
      csrfTokenHash: sha256("admin-csrf-correct-purpose"),
      now,
      sessionExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    })).resolves.toMatchObject({ status: "verified" });
    expect(store.desktopLoginTickets).toHaveLength(1);
    expect(store.adminSessions).toHaveLength(1);
  });

  test("replacement invalidates only the exact purpose, email, and state scope", async () => {
    const store = new MemoryStore();
    const issue = async (purpose: "desktop_login" | "admin_login", state: string, code: string, minute: number) => {
      const createdAt = new Date(now.getTime() + minute * 61 * 1000);
      return store.issueEmailOtp({
        purpose,
        email: "replacement@example.com",
        state,
        codeHash: sha256(code),
        ip: "203.0.113.16",
        expiresAt: new Date(createdAt.getTime() + 20 * 60 * 1000),
        createdAt,
      });
    };
    await expect(issue("desktop_login", "state-one", "111111", 0)).resolves.toMatchObject({ status: "issued" });
    await expect(issue("desktop_login", "state-two", "222222", 1)).resolves.toMatchObject({ status: "issued" });
    await expect(issue("admin_login", "state-one", "333333", 2)).resolves.toMatchObject({ status: "issued" });
    await expect(issue("desktop_login", "state-one", "444444", 3)).resolves.toMatchObject({ status: "issued" });

    const desktopStateOne = store.emailOtps.filter(
      (otp) => otp.purpose === "desktop_login" && otp.state === "state-one",
    );
    expect(desktopStateOne).toHaveLength(2);
    expect(desktopStateOne[0]?.consumedAt).not.toBeNull();
    expect(desktopStateOne[1]?.consumedAt).toBeNull();
    expect(store.emailOtps.find((otp) => otp.state === "state-two")?.consumedAt).toBeNull();
    expect(store.emailOtps.find((otp) => otp.purpose === "admin_login")?.consumedAt).toBeNull();
  });

  test("never exceeds five attempts in a concurrent correct and wrong final-attempt race", async () => {
    for (const correctFirst of [false, true]) {
      const store = new MemoryStore();
      await store.issueEmailOtp({
        purpose: "desktop_login",
        email: `attempt-${correctFirst}@example.com`,
        state: "attempt-state",
        codeHash: sha256("123456"),
        ip: "203.0.113.17",
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        createdAt: now,
      });
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await store.verifyDesktopOtpAndCreateTicket({
          email: `attempt-${correctFirst}@example.com`,
          state: "attempt-state",
          codeHash: sha256("000000"),
          ticketHash: sha256(`early-ticket-${attempt}`),
          now,
          ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        });
      }
      const verify = (code: string, ticket: string) => store.verifyDesktopOtpAndCreateTicket({
        email: `attempt-${correctFirst}@example.com`,
        state: "attempt-state",
        codeHash: sha256(code),
        ticketHash: sha256(ticket),
        now,
        ticketExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      });
      const operations = correctFirst
        ? [verify("123456", "final-correct"), verify("000000", "final-wrong")]
        : [verify("000000", "final-wrong"), verify("123456", "final-correct")];
      await Promise.all(operations);

      expect(store.emailOtps[0]?.attempts).toBe(5);
      expect(store.desktopLoginTickets.length).toBeLessThanOrEqual(1);
    }
  });

  test("enforces email and IP hourly dispatch caps with persisted counters", async () => {
    const emailStore = new MemoryStore();
    for (let index = 0; index < 5; index += 1) {
      const createdAt = new Date(now.getTime() + index * 61 * 1000);
      await expect(emailStore.issueEmailOtp({
        purpose: "desktop_login",
        email: "hourly@example.com",
        state: `hourly-state-${index}`,
        codeHash: sha256("123456"),
        ip: `203.0.113.${30 + index}`,
        expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1000),
        createdAt,
      })).resolves.toMatchObject({ status: "issued" });
    }
    const sixthAt = new Date(now.getTime() + 5 * 61 * 1000);
    await expect(emailStore.issueEmailOtp({
      purpose: "desktop_login",
      email: "hourly@example.com",
      state: "hourly-state-six",
      codeHash: sha256("123456"),
      ip: "203.0.113.39",
      expiresAt: new Date(sixthAt.getTime() + 10 * 60 * 1000),
      createdAt: sixthAt,
    })).resolves.toMatchObject({ status: "rate_limited" });

    const ipStore = new MemoryStore();
    for (let index = 0; index < 20; index += 1) {
      await expect(ipStore.issueEmailOtp({
        purpose: "desktop_login",
        email: `ip-cap-${index}@example.com`,
        state: `ip-cap-state-${index}`,
        codeHash: sha256("123456"),
        ip: "203.0.113.40",
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        createdAt: now,
      })).resolves.toMatchObject({ status: "issued" });
    }
    await expect(ipStore.issueEmailOtp({
      purpose: "desktop_login",
      email: "ip-cap-overflow@example.com",
      state: "ip-cap-overflow-state",
      codeHash: sha256("123456"),
      ip: "203.0.113.40",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      createdAt: now,
    })).resolves.toMatchObject({ status: "rate_limited" });
  });

  test("consumes the final MemoryStore Credit once and reuses an identical request", async () => {
    const store = new MemoryStore();
    const user = await store.upsertUserByEmail("memory-quota@example.com", now);
    await store.upsertEntitlement(user.id, new Date(now.getTime() + 24 * 60 * 60 * 1000), now, {
      llmQuotaLimit: 1,
      llmQuotaUsed: 0,
    });

    const distinct = await Promise.all([
      store.consumeLlmQuota(user.id, "memory-quota-a", now),
      store.consumeLlmQuota(user.id, "memory-quota-b", now),
    ]);
    expect(distinct.filter((result) => result.status === "consumed")).toHaveLength(1);
    expect(distinct.filter((result) => result.status === "unavailable")).toHaveLength(1);
    const consumedRequest = distinct[0]?.status === "consumed" ? "memory-quota-a" : "memory-quota-b";
    await expect(store.consumeLlmQuota(user.id, consumedRequest, now)).resolves.toMatchObject({
      status: "reused",
      entitlement: { llmQuotaUsed: 1 },
    });
  });
});
