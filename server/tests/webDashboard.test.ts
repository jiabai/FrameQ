import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-08-03T08:00:00.000Z");

function parseCookies(setCookie: string[] | string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of values) {
    const pair = header.split(";")[0] ?? "";
    const [name, ...rest] = pair.split("=");
    if (name && rest.length > 0) {
      cookies.set(name, decodeURIComponent(rest.join("=")));
    }
  }
  return cookies;
}

function buildTestServer(options: {
  sentCodes?: Array<{ email: string; code: string }>;
  secureCookies?: boolean;
} = {}) {
  const sentCodes = options.sentCodes ?? [];
  const store = new MemoryStore();
  const app = buildServer({
    store,
    sendOtp: async (email, code) => {
      sentCodes.push({ email, code });
    },
    createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
    secureCookies: options.secureCookies ?? false,
    now: () => now,
  });
  return { app, store, sentCodes };
}

async function startWebLogin(
  app: ReturnType<typeof buildServer>,
  email: string,
  state: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/user/auth/email/start",
    payload: { email, state },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true });
  return "";
}

async function verifyWebLogin(
  app: ReturnType<typeof buildServer>,
  email: string,
  code: string,
  state: string,
): Promise<{ cookies: Map<string, string>; body: unknown }> {
  const response = await app.inject({
    method: "POST",
    url: "/user/auth/email/verify",
    payload: { email, code, state },
  });
  expect(response.statusCode).toBe(200);
  const cookies = parseCookies(response.headers["set-cookie"]);
  return { cookies, body: response.json() };
}

describe("web user dashboard login flow", () => {
  test("completes the full web login → dashboard → logout cycle", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    await startWebLogin(app, "user@example.com", "web-state-1");
    expect(sentCodes).toHaveLength(1);
    expect(sentCodes[0]?.email).toBe("user@example.com");

    const { cookies, body } = await verifyWebLogin(
      app,
      "user@example.com",
      sentCodes[0]!.code,
      "web-state-1",
    );
    expect(body).toEqual({ ok: true, redirect_url: "/dashboard" });
    expect(cookies.has("frameq_user_session")).toBe(true);
    expect(cookies.has("frameq_user_csrf")).toBe(true);

    const sessionCookie = cookies.get("frameq_user_session")!;
    const csrfCookie = cookies.get("frameq_user_csrf")!;

    const dashboardPage = await app.inject({
      method: "GET",
      url: "/dashboard",
      cookies: { frameq_user_session: sessionCookie, frameq_user_csrf: csrfCookie },
    });
    expect(dashboardPage.statusCode).toBe(200);
    expect(dashboardPage.headers["content-type"]).toContain("text/html");
    expect(dashboardPage.headers["cache-control"]).toBe("no-store");
    expect(dashboardPage.body).toContain("user@example.com");
    expect(dashboardPage.body).toContain("控制台");
    expect(dashboardPage.body).not.toContain("frameq_user_session");
    expect(dashboardPage.body).not.toContain(sessionCookie);

    const dashboardJson = await app.inject({
      method: "GET",
      url: "/api/dashboard/account",
      cookies: { frameq_user_session: sessionCookie },
    });
    expect(dashboardJson.statusCode).toBe(200);
    const account = dashboardJson.json();
    expect(account.email).toBe("user@example.com");
    expect(account).toHaveProperty("entitlement_status");
    expect(account).toHaveProperty("llm_quota_limit");
    expect(account).toHaveProperty("can_process");

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/user/auth/logout",
      cookies: { frameq_user_session: sessionCookie },
      headers: { "x-frameq-csrf": csrfCookie },
    });
    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({ ok: true, redirect_url: "/login" });

    const redirectAfterLogout = await app.inject({
      method: "GET",
      url: "/dashboard",
      cookies: { frameq_user_session: sessionCookie },
    });
    expect(redirectAfterLogout.statusCode).toBe(302);
    expect(redirectAfterLogout.headers.location).toBe("/login");
  });

  test("sets Secure and HttpOnly cookie attributes when secureCookies is enabled", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes, secureCookies: true });

    await startWebLogin(app, "secure@example.com", "secure-state-1");
    const response = await app.inject({
      method: "POST",
      url: "/user/auth/email/verify",
      payload: {
        email: "secure@example.com",
        code: sentCodes[0]!.code,
        state: "secure-state-1",
      },
    });
    expect(response.statusCode).toBe(200);

    const setCookieHeaders = Array.isArray(response.headers["set-cookie"])
      ? response.headers["set-cookie"]
      : response.headers["set-cookie"]
        ? [response.headers["set-cookie"]]
        : [];

    const sessionHeader = setCookieHeaders.find((h) =>
      h.startsWith("frameq_user_session="),
    );
    const csrfHeader = setCookieHeaders.find((h) =>
      h.startsWith("frameq_user_csrf="),
    );

    expect(sessionHeader).toContain("HttpOnly");
    expect(sessionHeader).toContain("Secure");
    expect(sessionHeader).toContain("SameSite=Lax");

    expect(csrfHeader).not.toContain("HttpOnly");
    expect(csrfHeader).toContain("Secure");
    expect(csrfHeader).toContain("SameSite=Lax");
  });

  test("rejects web verify with invalid code", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    await startWebLogin(app, "invalid@example.com", "invalid-state-1");
    const response = await app.inject({
      method: "POST",
      url: "/user/auth/email/verify",
      payload: {
        email: "invalid@example.com",
        code: "000000",
        state: "invalid-state-1",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Verification code is invalid or expired.");
  });

  test("rejects web verify with wrong state", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    await startWebLogin(app, "state@example.com", "correct-state");
    const response = await app.inject({
      method: "POST",
      url: "/user/auth/email/verify",
      payload: {
        email: "state@example.com",
        code: sentCodes[0]!.code,
        state: "wrong-state",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  test("rejects logout without session cookie (401) and with bad CSRF (403)", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    const noSession = await app.inject({
      method: "POST",
      url: "/user/auth/logout",
    });
    expect(noSession.statusCode).toBe(401);

    await startWebLogin(app, "csrf@example.com", "csrf-state");
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/user/auth/email/verify",
      payload: {
        email: "csrf@example.com",
        code: sentCodes[0]!.code,
        state: "csrf-state",
      },
    });
    const cookies = parseCookies(verifyResponse.headers["set-cookie"]);
    const sessionCookie = cookies.get("frameq_user_session")!;

    const badCsrf = await app.inject({
      method: "POST",
      url: "/user/auth/logout",
      cookies: { frameq_user_session: sessionCookie },
      headers: { "x-frameq-csrf": "wrong-csrf-token" },
    });
    expect(badCsrf.statusCode).toBe(403);
    expect(badCsrf.json()).toEqual({ error: "CSRF_INVALID" });
  });

  test("redirects unauthenticated dashboard access to /login", async () => {
    const { app } = buildTestServer();

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/dashboard",
    });
    expect(dashboardResponse.statusCode).toBe(302);
    expect(dashboardResponse.headers.location).toBe("/login");

    const apiResponse = await app.inject({
      method: "GET",
      url: "/api/dashboard/account",
    });
    expect(apiResponse.statusCode).toBe(401);
    expect(apiResponse.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  test("does not leak secrets in rendered dashboard HTML", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app, store } = buildTestServer({ sentCodes });

    await startWebLogin(app, "secrets@example.com", "secrets-state");
    const verifyResponse = await verifyWebLogin(
      app,
      "secrets@example.com",
      sentCodes[0]!.code,
      "secrets-state",
    );

    const sessionCookie = verifyResponse.cookies.get("frameq_user_session")!;
    const csrfCookie = verifyResponse.cookies.get("frameq_user_csrf")!;

    const code = await store.createActivationCode({
      codeHash: "test-hash-for-secret-check",
      codePrefix: "FQ-SECRET",
      status: "active",
      entitlementDays: 31,
      redeemBy: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      createdAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
    });
    const user = store.users.find((u) => u.email === "secrets@example.com");
    if (user) {
      await store.markActivationCodeRedeemed(code.codeHash, user.id, now);
    }

    const dashboardPage = await app.inject({
      method: "GET",
      url: "/dashboard",
      cookies: {
        frameq_user_session: sessionCookie,
        frameq_user_csrf: csrfCookie,
      },
    });
    expect(dashboardPage.statusCode).toBe(200);
    expect(dashboardPage.body).toContain("FQ-SECRET****");
    expect(dashboardPage.body).not.toContain("test-hash-for-secret-check");
    expect(dashboardPage.body).not.toContain(sessionCookie);
  });
});

describe("desktop login regression (contract preserved, cookies added)", () => {
  test("desktop mode login returns ticket + frameq:// redirect AND sets user session cookies", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    const state = "desktop-state-regression";
    const startResponse = await app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email: "desktop@example.com", state },
    });
    expect(startResponse.statusCode).toBe(200);

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/email/verify",
      payload: {
        email: "desktop@example.com",
        code: sentCodes[0]!.code,
        state,
      },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const body = verifyResponse.json();
    // Desktop client contract preserved: ticket + frameq:// redirect_url.
    expect(body).toHaveProperty("ticket");
    expect(body.redirect_url).toMatch(/^frameq:\/\/auth\/callback/);

    // New behavior: the same verify call also sets the web session cookies so the
    // user can optionally visit /dashboard without re-authenticating.
    const setCookieHeaders = Array.isArray(verifyResponse.headers["set-cookie"])
      ? verifyResponse.headers["set-cookie"]
      : verifyResponse.headers["set-cookie"]
        ? [verifyResponse.headers["set-cookie"]]
        : [];
    const cookieNames = setCookieHeaders.map((h) => h.split("=")[0]);
    expect(cookieNames).toContain("frameq_user_session");
    expect(cookieNames).toContain("frameq_user_csrf");

    // Desktop exchange still works with the ticket.
    const exchangeResponse = await app.inject({
      method: "POST",
      url: "/api/desktop/sessions/exchange",
      payload: { ticket: body.ticket, state },
    });
    expect(exchangeResponse.statusCode).toBe(200);
    const sessionToken = exchangeResponse.json<{ session_token: string }>().session_token;

    const desktopAccount = await app.inject({
      method: "GET",
      url: "/api/desktop/account",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(desktopAccount.statusCode).toBe(200);
    expect(desktopAccount.json()).toMatchObject({
      authenticated: true,
      email: "desktop@example.com",
    });
  });

  test("desktop-mode verify cookies grant /dashboard access without re-auth", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    const state = "desktop-dashboard-state";
    await app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email: "dash@example.com", state },
    });
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/email/verify",
      payload: { email: "dash@example.com", code: sentCodes[0]!.code, state },
    });
    expect(verifyResponse.statusCode).toBe(200);

    const cookies = parseCookies(verifyResponse.headers["set-cookie"]);
    const sessionCookie = cookies.get("frameq_user_session")!;
    const csrfCookie = cookies.get("frameq_user_csrf")!;

    const dashboardPage = await app.inject({
      method: "GET",
      url: "/dashboard",
      cookies: { frameq_user_session: sessionCookie, frameq_user_csrf: csrfCookie },
    });
    expect(dashboardPage.statusCode).toBe(200);
    expect(dashboardPage.body).toContain("dash@example.com");

    const dashboardJson = await app.inject({
      method: "GET",
      url: "/api/dashboard/account",
      cookies: { frameq_user_session: sessionCookie },
    });
    expect(dashboardJson.statusCode).toBe(200);
    expect(dashboardJson.json()).toMatchObject({ email: "dash@example.com" });
  });

  test("web logout revokes web session but desktop bearer token stays valid", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    const state = "independence-state";
    await app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email: "independence@example.com", state },
    });
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/email/verify",
      payload: { email: "independence@example.com", code: sentCodes[0]!.code, state },
    });
    const body = verifyResponse.json<{ ticket: string }>();
    const cookies = parseCookies(verifyResponse.headers["set-cookie"]);
    const sessionCookie = cookies.get("frameq_user_session")!;
    const csrfCookie = cookies.get("frameq_user_csrf")!;

    // Exchange the ticket for a desktop bearer token.
    const exchangeResponse = await app.inject({
      method: "POST",
      url: "/api/desktop/sessions/exchange",
      payload: { ticket: body.ticket, state },
    });
    const desktopToken = exchangeResponse.json<{ session_token: string }>().session_token;

    // Logout of the web dashboard.
    const logoutResponse = await app.inject({
      method: "POST",
      url: "/user/auth/logout",
      cookies: { frameq_user_session: sessionCookie },
      headers: { "x-frameq-csrf": csrfCookie },
    });
    expect(logoutResponse.statusCode).toBe(200);

    // Web session is revoked: /dashboard redirects to /login.
    const webAfterLogout = await app.inject({
      method: "GET",
      url: "/dashboard",
      cookies: { frameq_user_session: sessionCookie },
    });
    expect(webAfterLogout.statusCode).toBe(302);
    expect(webAfterLogout.headers.location).toBe("/login");

    // Desktop bearer token still works (session independence).
    const desktopAccount = await app.inject({
      method: "GET",
      url: "/api/desktop/account",
      headers: { authorization: `Bearer ${desktopToken}` },
    });
    expect(desktopAccount.statusCode).toBe(200);
    expect(desktopAccount.json()).toMatchObject({
      authenticated: true,
      email: "independence@example.com",
    });
  });

  test("desktop login page renders with desktop-mode form targets and success panel", async () => {
    const { app } = buildTestServer();

    const response = await app.inject({
      method: "GET",
      url: "/login?desktop=1&state=state-regression&redirect_uri=frameq%3A%2F%2Fauth%2Fcallback",
    });
    expect(response.statusCode).toBe(200);
    // The login page script contains both ternary branches (desktop and web) as string
    // literals; we assert the desktop targets are present. Desktop-mode runtime behavior
    // (frameq:// redirect + cookie setting) is verified by the tests above.
    expect(response.body).toContain("/auth/email/start");
    expect(response.body).toContain("/auth/email/verify");
    expect(response.body).toContain("assertDesktopLoginRequest");
    expect(response.body).toContain('redirectUri !== "frameq://auth/callback"');
    // Success panel is present (hidden by default, shown after desktop verify).
    expect(response.body).toContain("登录成功");
    expect(response.body).toContain("此窗口可关闭，请返回并继续使用 FrameQ");
    expect(response.body).toContain('href="/dashboard"');
    expect(response.body).toContain("去到 Web Dashboard");
  });
});

describe("OTP cross-consumption between web and desktop paths", () => {
  test("an OTP verified via web path is rejected by the desktop verify path", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    const email = "cross@example.com";
    const state = "cross-state-web-first";

    await app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email, state },
    });

    const webVerify = await app.inject({
      method: "POST",
      url: "/user/auth/email/verify",
      payload: { email, code: sentCodes[0]!.code, state },
    });
    expect(webVerify.statusCode).toBe(200);

    const desktopRetry = await app.inject({
      method: "POST",
      url: "/auth/email/verify",
      payload: { email, code: sentCodes[0]!.code, state },
    });
    expect(desktopRetry.statusCode).toBe(400);
  });

  test("an OTP verified via desktop path is rejected by the web verify path", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    const email = "cross2@example.com";
    const state = "cross-state-desktop-first";

    await app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email, state },
    });

    const desktopVerify = await app.inject({
      method: "POST",
      url: "/auth/email/verify",
      payload: { email, code: sentCodes[0]!.code, state },
    });
    expect(desktopVerify.statusCode).toBe(200);

    const webRetry = await app.inject({
      method: "POST",
      url: "/user/auth/email/verify",
      payload: { email, code: sentCodes[0]!.code, state },
    });
    expect(webRetry.statusCode).toBe(400);
  });
});

describe("web login open-redirect protection", () => {
  test("web mode ignores external redirect_uri and lands on /dashboard", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const { app } = buildTestServer({ sentCodes });

    const loginPage = await app.inject({
      method: "GET",
      url: "/login?redirect_uri=https%3A%2F%2Fevil.example%2Fsteal",
    });
    expect(loginPage.statusCode).toBe(200);
    // The page script contains both ternary branches as literals; the open-redirect
    // guard is what actually prevents external redirects at runtime. We verify the
    // guard is in place and that the web targets are present.
    expect(loginPage.body).toContain("/user/auth/email/start");
    expect(loginPage.body).toContain("/user/auth/email/verify");
    expect(loginPage.body).toContain('redirectUri !== "frameq://auth/callback"');

    await app.inject({
      method: "POST",
      url: "/user/auth/email/start",
      payload: { email: "openredirect@example.com", state: "open-redirect-state" },
    });
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/user/auth/email/verify",
      payload: {
        email: "openredirect@example.com",
        code: sentCodes[0]!.code,
        state: "open-redirect-state",
      },
    });
    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json().redirect_url).toBe("/dashboard");
  });
});
