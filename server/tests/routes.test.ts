import { describe, expect, test, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { sha256 } from "../src/security.js";
import type {
  SelfServiceActivationResult,
  SelfServiceActivationService,
} from "../src/selfServiceActivation.js";
import { SelfServiceActivationError } from "../src/selfServiceActivation.js";
import { MemoryStore } from "../src/store.js";

class TemporarilyUnavailableAuthStore extends MemoryStore {
  override async issueEmailOtp(
    _input: Parameters<MemoryStore["issueEmailOtp"]>[0],
  ): ReturnType<MemoryStore["issueEmailOtp"]> {
    return { status: "temporarily_unavailable" };
  }

  override async verifyDesktopOtpAndCreateTicket(
    _input: Parameters<MemoryStore["verifyDesktopOtpAndCreateTicket"]>[0],
  ): ReturnType<MemoryStore["verifyDesktopOtpAndCreateTicket"]> {
    return { status: "temporarily_unavailable" };
  }

  override async verifyDesktopOtpAndCreateTicketAndWebSession(
    _input: Parameters<MemoryStore["verifyDesktopOtpAndCreateTicketAndWebSession"]>[0],
  ): ReturnType<MemoryStore["verifyDesktopOtpAndCreateTicketAndWebSession"]> {
    return { status: "temporarily_unavailable" };
  }

  override async verifyAdminOtpAndCreateSession(
    _input: Parameters<MemoryStore["verifyAdminOtpAndCreateSession"]>[0],
  ): ReturnType<MemoryStore["verifyAdminOtpAndCreateSession"]> {
    return { status: "temporarily_unavailable" };
  }

  override async exchangeDesktopTicketAndCreateSession(
    _input: Parameters<MemoryStore["exchangeDesktopTicketAndCreateSession"]>[0],
  ): ReturnType<MemoryStore["exchangeDesktopTicketAndCreateSession"]> {
    return { status: "temporarily_unavailable" };
  }
}

class FailingAuthStore extends MemoryStore {
  override async issueEmailOtp(
    _input: Parameters<MemoryStore["issueEmailOtp"]>[0],
  ): ReturnType<MemoryStore["issueEmailOtp"]> {
    throw new Error("SQLITE_BUSY seeded authentication database detail");
  }

  override async verifyDesktopOtpAndCreateTicket(
    _input: Parameters<MemoryStore["verifyDesktopOtpAndCreateTicket"]>[0],
  ): ReturnType<MemoryStore["verifyDesktopOtpAndCreateTicket"]> {
    throw new Error("SQLITE_BUSY seeded authentication database detail");
  }

  override async verifyDesktopOtpAndCreateTicketAndWebSession(
    _input: Parameters<MemoryStore["verifyDesktopOtpAndCreateTicketAndWebSession"]>[0],
  ): ReturnType<MemoryStore["verifyDesktopOtpAndCreateTicketAndWebSession"]> {
    throw new Error("SQLITE_BUSY seeded authentication database detail");
  }

  override async verifyAdminOtpAndCreateSession(
    _input: Parameters<MemoryStore["verifyAdminOtpAndCreateSession"]>[0],
  ): ReturnType<MemoryStore["verifyAdminOtpAndCreateSession"]> {
    throw new Error("SQLITE_BUSY seeded authentication database detail");
  }

  override async exchangeDesktopTicketAndCreateSession(
    _input: Parameters<MemoryStore["exchangeDesktopTicketAndCreateSession"]>[0],
  ): ReturnType<MemoryStore["exchangeDesktopTicketAndCreateSession"]> {
    throw new Error("SQLITE_BUSY seeded authentication database detail");
  }
}

function createSelfServiceStub(
  implementation: (
    input: Parameters<SelfServiceActivationService["requestCode"]>[0],
  ) => Promise<SelfServiceActivationResult>,
): Pick<SelfServiceActivationService, "requestCode"> {
  return { requestCode: vi.fn(implementation) };
}

function buildDesktopAuthApp(options: {
  store?: MemoryStore;
  now?: () => Date;
  selfServiceActivationEnabled?: boolean;
  selfServiceActivationService?: Pick<SelfServiceActivationService, "requestCode"> | null;
} = {}) {
  let sentCode = "";
  const store = options.store ?? new MemoryStore();
  const app = buildServer({
    store,
    sendOtp: async (_email, code) => {
      sentCode = code;
    },
    createNativePayment: async () => ({
      codeUrl: "weixin://wxpay/bizpayurl?pr=test",
      providerPayload: {},
    }),
    now: options.now,
    selfServiceActivationEnabled: options.selfServiceActivationEnabled,
    selfServiceActivationService: options.selfServiceActivationService,
  });
  return { app, store, readSentCode: () => sentCode };
}

async function createDesktopSession(
  app: ReturnType<typeof buildServer>,
  readSentCode: () => string,
  email = "user@example.com",
) {
  const state = `state-${email.replace(/[^a-z0-9]/gi, "-")}`;

  const start = await app.inject({
    method: "POST",
    url: "/auth/email/start",
    payload: { email, state },
    remoteAddress: "203.0.113.10",
  });
  expect(start.statusCode).toBe(200);

  const verify = await app.inject({
    method: "POST",
    url: "/auth/email/verify",
    payload: { email, code: readSentCode(), state },
  });
  expect(verify.statusCode).toBe(200);

  const exchange = await app.inject({
    method: "POST",
    url: "/api/desktop/sessions/exchange",
    payload: { ticket: verify.json<{ ticket: string }>().ticket, state },
  });
  expect(exchange.statusCode).toBe(200);
  return exchange.json<{ session_token: string }>().session_token;
}

describe("desktop account routes", () => {
  test("registers the complete stable HTTP route table", () => {
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
    });
    const routes = [
      ["GET", "/health/live"],
      ["GET", "/health/ready"],
      ["GET", "/login"],
      ["GET", "/admin/login"],
      ["POST", "/admin/auth/email/start"],
      ["POST", "/admin/auth/email/verify"],
      ["POST", "/admin/auth/logout"],
      ["GET", "/admin"],
      ["POST", "/admin/api/activation-codes"],
      ["POST", "/admin/api/llm-config"],
      ["POST", "/admin/api/users/:userId/entitlement-adjustments"],
      ["POST", "/auth/email/start"],
      ["POST", "/auth/email/verify"],
      ["POST", "/api/desktop/sessions/exchange"],
      ["GET", "/api/desktop/account"],
      ["POST", "/api/desktop/activation-codes/request"],
      ["POST", "/api/desktop/logout"],
      ["POST", "/api/desktop/activation-codes/redeem"],
      ["POST", "/api/desktop/llm/checkouts"],
      ["GET", "/api/desktop/updates/:target/:arch/:currentVersion"],
      ["POST", "/api/desktop/billing/wechat-native"],
      ["GET", "/api/desktop/billing/orders/:orderId"],
      ["POST", "/api/wechat/notify"],
      ["POST", "/user/auth/email/start"],
      ["POST", "/user/auth/email/verify"],
      ["POST", "/user/auth/logout"],
      ["GET", "/dashboard"],
      ["GET", "/api/dashboard/account"],
    ] as const;

    for (const [method, url] of routes) {
      expect(app.hasRoute({ method, url }), `${method} ${url}`).toBe(true);
    }
  });

  test("serves the desktop email login page", async () => {
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/login?desktop=1&state=state-1001&redirect_uri=frameq%3A%2F%2Fauth%2Fcallback",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("type=\"email\"");
    expect(response.body).toContain("/auth/email/start");
    expect(response.body).toContain("/auth/email/verify");
    expect(response.body).toContain("window.location.href = data.redirect_url");
  });

  test("rejects account route without a desktop session", async () => {
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/desktop/account",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  test("runs the email OTP to desktop session exchange flow", async () => {
    let sentCode = "";
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async (_email, code) => {
        sentCode = code;
      },
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
    });

    const start = await app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email: "user@example.com", state: "state-1001" },
      remoteAddress: "203.0.113.10",
    });
    expect(start.statusCode).toBe(200);

    const verify = await app.inject({
      method: "POST",
      url: "/auth/email/verify",
      payload: { email: "user@example.com", code: sentCode, state: "state-1001" },
    });
    expect(verify.statusCode).toBe(200);
    const ticket = verify.json<{ ticket: string }>().ticket;

    const exchange = await app.inject({
      method: "POST",
      url: "/api/desktop/sessions/exchange",
      payload: { ticket, state: "state-1001" },
    });
    expect(exchange.statusCode).toBe(200);
    const sessionToken = exchange.json<{ session_token: string }>().session_token;

    const account = await app.inject({
      method: "GET",
      url: "/api/desktop/account",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(account.statusCode).toBe(200);
    expect(account.json()).toMatchObject({
      authenticated: true,
      email: "user@example.com",
      entitlement_status: "inactive",
      can_request_activation_code: false,
      can_process: false,
    });
  });

  test("reports self-service capability only when the feature is enabled, available, and inactive", async () => {
    const now = new Date("2026-08-24T08:00:00.000Z");
    const service = createSelfServiceStub(async () => {
      throw new Error("not called");
    });
    const { app, store, readSentCode } = buildDesktopAuthApp({
      now: () => now,
      selfServiceActivationEnabled: true,
      selfServiceActivationService: service,
    });
    const sessionToken = await createDesktopSession(app, readSentCode, "capability@example.com");

    const inactive = await app.inject({
      method: "GET",
      url: "/api/desktop/account",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(inactive.statusCode).toBe(200);
    expect(inactive.json()).toMatchObject({
      email: "capability@example.com",
      can_request_activation_code: true,
    });

    const user = store.users.find((entry) => entry.email === "capability@example.com");
    if (!user) {
      throw new Error("expected user to exist");
    }
    await store.upsertEntitlement(
      user.id,
      new Date("2026-09-24T08:00:00.000Z"),
      now,
      { llmQuotaLimit: 20, llmQuotaUsed: 0 },
    );

    const active = await app.inject({
      method: "GET",
      url: "/api/desktop/account",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({
      entitlement_status: "active",
      can_request_activation_code: false,
    });
  });

  test("returns feature not available when self-service activation is disabled", async () => {
    const { app, readSentCode } = buildDesktopAuthApp({
      selfServiceActivationEnabled: false,
    });
    const sessionToken = await createDesktopSession(app, readSentCode, "feature-off@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/desktop/activation-codes/request",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { locale: "zh-CN" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "FEATURE_NOT_AVAILABLE" });
  });

  test("returns activation email unavailable when feature is enabled but service is absent", async () => {
    const { app, readSentCode } = buildDesktopAuthApp({
      selfServiceActivationEnabled: true,
      selfServiceActivationService: null,
    });
    const sessionToken = await createDesktopSession(app, readSentCode, "no-smtp@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/desktop/activation-codes/request",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { locale: "zh-CN" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "ACTIVATION_EMAIL_UNAVAILABLE" });
  });

  test("rejects unauthenticated, invalid, and unknown self-service request bodies", async () => {
    const service = createSelfServiceStub(async () => ({
      status: "sent",
      retryAt: new Date("2026-08-24T09:00:00.000Z"),
      redeemBy: new Date("2026-08-31T09:00:00.000Z"),
    } satisfies SelfServiceActivationResult));
    const { app, readSentCode } = buildDesktopAuthApp({
      selfServiceActivationEnabled: true,
      selfServiceActivationService: service,
    });
    const sessionToken = await createDesktopSession(app, readSentCode, "invalid-body@example.com");

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/desktop/activation-codes/request",
      payload: { locale: "zh-CN" },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toEqual({ error: "AUTH_REQUIRED" });

    const invalidLocale = await app.inject({
      method: "POST",
      url: "/api/desktop/activation-codes/request",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { locale: "ja-JP" },
    });
    expect(invalidLocale.statusCode).toBe(400);
    expect(invalidLocale.json()).toEqual({ error: "INVALID_REQUEST" });

    const unknownFields = await app.inject({
      method: "POST",
      url: "/api/desktop/activation-codes/request",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { locale: "zh-CN", email: "attacker@example.com", quota: 999 },
    });
    expect(unknownFields.statusCode).toBe(400);
    expect(unknownFields.json()).toEqual({ error: "INVALID_REQUEST" });
    expect(service.requestCode).not.toHaveBeenCalled();
  });

  test("maps self-service activation outcomes to sanitized responses", async () => {
    const now = new Date("2026-08-24T08:00:00.000Z");
    const retryAt = new Date("2026-08-24T09:15:00.000Z");
    const redeemBy = new Date("2026-08-31T08:00:00.000Z");
    const service = createSelfServiceStub(async () => {
      throw new Error("placeholder");
    });
    const { app, store, readSentCode } = buildDesktopAuthApp({
      now: () => now,
      selfServiceActivationEnabled: true,
      selfServiceActivationService: service,
    });
    const sessionToken = await createDesktopSession(app, readSentCode, "mapper@example.com");
    const user = store.users.find((entry) => entry.email === "mapper@example.com");
    const session = store.sessions.find((entry) => entry.tokenHash === sha256(sessionToken));
    if (!user || !session) {
      throw new Error("expected authenticated session state");
    }

    const scenarios = [
      {
        name: "success",
        implementation: async () =>
          ({
            status: "sent",
            retryAt,
            redeemBy,
          } satisfies SelfServiceActivationResult),
        expectedStatus: 200,
        expectedBody: {
          status: "sent",
          retry_at: retryAt.toISOString(),
          redeem_by: redeemBy.toISOString(),
        },
      },
      {
        name: "rate limited",
        implementation: async () => {
          throw new SelfServiceActivationError("ACTIVATION_REQUEST_RATE_LIMITED", { retryAt });
        },
        expectedStatus: 429,
        expectedBody: {
          error: "ACTIVATION_REQUEST_RATE_LIMITED",
          retry_at: retryAt.toISOString(),
        },
        expectedRetryAfter: "4500",
      },
      {
        name: "active entitlement",
        implementation: async () => {
          throw new SelfServiceActivationError("ENTITLEMENT_ACTIVE");
        },
        expectedStatus: 409,
        expectedBody: { error: "ENTITLEMENT_ACTIVE" },
      },
      {
        name: "email unavailable",
        implementation: async () => {
          throw new SelfServiceActivationError("ACTIVATION_EMAIL_UNAVAILABLE");
        },
        expectedStatus: 503,
        expectedBody: { error: "ACTIVATION_EMAIL_UNAVAILABLE" },
      },
      {
        name: "temporary unavailable",
        implementation: async () => {
          throw new SelfServiceActivationError("SERVER_TEMPORARILY_UNAVAILABLE");
        },
        expectedStatus: 503,
        expectedBody: { error: "SERVER_TEMPORARILY_UNAVAILABLE" },
      },
    ] as const;

    for (const scenario of scenarios) {
      vi.mocked(service.requestCode).mockImplementationOnce(async (input) => {
        expect(input).toEqual({
          sessionTokenHash: session.tokenHash,
          ip: "203.0.113.77",
          locale: "en-US",
        });
        return scenario.implementation();
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/desktop/activation-codes/request",
        headers: { authorization: `Bearer ${sessionToken}` },
        remoteAddress: "203.0.113.77",
        payload: { locale: "en-US" },
      });

      expect(response.statusCode, scenario.name).toBe(scenario.expectedStatus);
      expect(response.json(), scenario.name).toEqual(scenario.expectedBody);
      expect(response.body, scenario.name).not.toContain(user.email);
      expect(response.body, scenario.name).not.toContain(sessionToken);
      if ("expectedRetryAfter" in scenario) {
        expect(response.headers["retry-after"], scenario.name).toBe(scenario.expectedRetryAfter);
      } else {
        expect(response.headers["retry-after"], scenario.name).toBeUndefined();
      }
    }
  });

  test("redeems an activation code through an authenticated desktop session", async () => {
    let sentCode = "";
    const store = new MemoryStore();
    const app = buildServer({
      store,
      sendOtp: async (_email, code) => {
        sentCode = code;
      },
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
      now: () => new Date("2026-06-21T08:00:00.000Z"),
    });

    await app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email: "user@example.com", state: "state-1001" },
      remoteAddress: "203.0.113.10",
    });
    const verify = await app.inject({
      method: "POST",
      url: "/auth/email/verify",
      payload: { email: "user@example.com", code: sentCode, state: "state-1001" },
    });
    const ticket = verify.json<{ ticket: string }>().ticket;
    const exchange = await app.inject({
      method: "POST",
      url: "/api/desktop/sessions/exchange",
      payload: { ticket, state: "state-1001" },
    });
    const sessionToken = exchange.json<{ session_token: string }>().session_token;
    const activationCode = "FQ-ABCD-EFGH-JKLM-NPQR";
    await store.createActivationCode({
      codeHash: sha256(activationCode),
      codePrefix: "FQ-ABCD",
      status: "active",
      issuanceSource: "admin",
      entitlementDays: 31,
      issuedToUserId: null,
      redeemBy: new Date("2026-07-21T08:00:00.000Z"),
      createdAt: new Date("2026-06-21T08:00:00.000Z"),
      sentAt: new Date("2026-06-21T08:00:00.000Z"),
      redeemedAt: null,
      redeemedByUserId: null,
      disabledReason: null,
    });

    const redeemed = await app.inject({
      method: "POST",
      url: "/api/desktop/activation-codes/redeem",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { code: activationCode },
    });

    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({
      authenticated: true,
      email: "user@example.com",
      entitlement_status: "active",
      llm_quota_limit: 20,
      llm_quota_used: 0,
      llm_quota_remaining: 20,
      llm_configured: false,
      can_process: true,
      can_generate_ai: false,
    });
  });

  test("keeps WeChat routes disabled unless explicitly enabled", async () => {
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
      wechatPayEnabled: false,
    });

    const responses = await Promise.all([
      app.inject({ method: "POST", url: "/api/desktop/billing/wechat-native" }),
      app.inject({ method: "GET", url: "/api/desktop/billing/orders/fq_disabled" }),
      app.inject({ method: "POST", url: "/api/wechat/notify", payload: { id: "notice-1" } }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "WECHAT_PAY_DISABLED" });
    }
  });

  test("returns a generic error when email delivery fails", async () => {
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async () => {
        throw new Error("smtp password secret leaked by provider");
      },
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email: "user@example.com", state: "state-1001" },
      remoteAddress: "203.0.113.10",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Could not send verification code. Please try again later.",
    });
  });

  test("maps authentication transaction exhaustion to one stable retryable response", async () => {
    const app = buildServer({
      store: new TemporarilyUnavailableAuthStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
      adminEmail: "admin@example.com",
    });

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/auth/email/start",
        payload: { email: "user@example.com", state: "state-1001" },
      }),
      app.inject({
        method: "POST",
        url: "/auth/email/verify",
        payload: { email: "user@example.com", state: "state-1001", code: "123456" },
      }),
      app.inject({
        method: "POST",
        url: "/api/desktop/sessions/exchange",
        payload: { ticket: "flt_retryable", state: "state-1001" },
      }),
      app.inject({
        method: "POST",
        url: "/admin/auth/email/start",
        payload: { email: "admin@example.com", state: "admin-state-1001" },
      }),
      app.inject({
        method: "POST",
        url: "/admin/auth/email/verify",
        payload: { email: "admin@example.com", state: "admin-state-1001", code: "123456" },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "SERVER_TEMPORARILY_UNAVAILABLE" });
    }
  });

  test("does not echo unexpected authentication database errors", async () => {
    const app = buildServer({
      store: new FailingAuthStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
      adminEmail: "admin@example.com",
    });

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/auth/email/start",
        payload: { email: "user@example.com", state: "state-1001" },
      }),
      app.inject({
        method: "POST",
        url: "/auth/email/verify",
        payload: { email: "user@example.com", state: "state-1001", code: "123456" },
      }),
      app.inject({
        method: "POST",
        url: "/api/desktop/sessions/exchange",
        payload: { ticket: "flt_internal_failure", state: "state-1001" },
      }),
      app.inject({
        method: "POST",
        url: "/admin/auth/email/start",
        payload: { email: "admin@example.com", state: "admin-state-1001" },
      }),
      app.inject({
        method: "POST",
        url: "/admin/auth/email/verify",
        payload: { email: "admin@example.com", state: "admin-state-1001", code: "123456" },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
      expect(response.body).not.toContain("SQLITE_BUSY");
      expect(response.body).not.toContain("seeded authentication database detail");
    }
  });

  test("rejects WeChat notifications when signature parsing fails", async () => {
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
      parseWechatNotification: async () => {
        throw new Error("invalid wechat signature");
      },
      wechatPayEnabled: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/wechat/notify",
      payload: { id: "notice-1" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "FAIL", message: "invalid wechat signature" });
  });

  test("forwards the exact WeChat JSON bytes to the notification parser", async () => {
    const rawBody = '{\n  "id": "notice-raw",\n  "nested": { "amount": 1 }\n}';
    let captured: { body: unknown; rawBody: string } | undefined;
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
      parseWechatNotification: async (input) => {
        captured = { body: input.body, rawBody: input.rawBody };
        throw new Error("capture complete");
      },
      wechatPayEnabled: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/wechat/notify",
      headers: { "content-type": "application/json" },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: "FAIL", message: "internal error" });
    expect(captured?.body).toEqual({ id: "notice-raw", nested: { amount: 1 } });
    expect(captured?.rawBody).toBe(rawBody);
  });
});
