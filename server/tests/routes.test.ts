import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

describe("desktop account routes", () => {
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
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/wechat/notify",
      payload: { id: "notice-1" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "FAIL", message: "invalid wechat signature" });
  });
});
