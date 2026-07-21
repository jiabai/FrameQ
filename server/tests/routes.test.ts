import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { sha256 } from "../src/security.js";
import { MemoryStore } from "../src/store.js";

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
      ["POST", "/api/desktop/logout"],
      ["POST", "/api/desktop/activation-codes/redeem"],
      ["POST", "/api/desktop/llm/checkouts"],
      ["GET", "/api/desktop/updates/:target/:arch/:currentVersion"],
      ["POST", "/api/desktop/billing/wechat-native"],
      ["GET", "/api/desktop/billing/orders/:orderId"],
      ["POST", "/api/wechat/notify"],
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
      can_process: false,
    });
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
      entitlementDays: 31,
      redeemBy: new Date("2026-07-21T08:00:00.000Z"),
      createdAt: new Date("2026-06-21T08:00:00.000Z"),
      redeemedAt: null,
      redeemedByUserId: null,
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

    expect(response.statusCode).toBe(400);
    expect(captured?.body).toEqual({ id: "notice-raw", nested: { amount: 1 } });
    expect(captured?.rawBody).toBe(rawBody);
  });
});
