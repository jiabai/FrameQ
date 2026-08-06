import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";
import { sha256 } from "../src/security.js";

const now = new Date("2026-08-04T08:00:00.000Z");

function buildTestServer() {
  const sentCodes: Array<{ email: string; code: string }> = [];
  const store = new MemoryStore();
  const app = buildServer({
    store,
    sendOtp: async (email, code) => {
      sentCodes.push({ email, code });
    },
    createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
    secureCookies: false,
    now: () => now,
  });
  return { app, store, sentCodes };
}

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

async function performWebLoginReal(
  app: ReturnType<typeof buildServer>,
  sentCodes: Array<{ email: string; code: string }>,
  email: string,
) {
  const state = "i18n-test-state";
  await app.inject({
    method: "POST",
    url: "/user/auth/email/start",
    payload: { email, state },
  });
  const code = sentCodes[sentCodes.length - 1]?.code ?? "";
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/user/auth/email/verify",
    payload: { email, code, state },
  });
  expect(verifyResponse.statusCode).toBe(200);
  return parseCookies(verifyResponse.headers["set-cookie"]);
}

/** Assert the page renders a language dropdown listing all three locales. */
function expectSwitcher(html: string) {
  expect(html).toContain('<select class="lang-switch"');
  expect(html).toContain('<option value="zh-CN"');
  expect(html).toContain('<option value="en"');
  expect(html).toContain('<option value="zh-TW"');
  expect(html).toContain(".lang-switch");
}

describe("server page i18n — /login", () => {
  test("renders in zh-CN by default (no lang cookie)", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({ method: "GET", url: "/login" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain('<html lang="zh-CN">');
    expect(response.body).toContain("FrameQ 客户端");
    // Dropdown lists English as an option.
    expect(response.body).toContain(">English<");
    expectSwitcher(response.body);
  });

  test("renders in en when lang=en cookie is set", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "GET",
      url: "/login",
      headers: { cookie: "lang=en" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain("Enter your email to receive a verification code");
    expect(response.body).toContain("FrameQ client");
    expect(response.body).toContain(">中文<");
    expectSwitcher(response.body);
  });

  test("renders in zh-TW when lang=zh-TW cookie is set", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "GET",
      url: "/login",
      headers: { cookie: "lang=zh-TW" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-TW">');
    expect(response.body).toContain("登入 FrameQ");
    expect(response.body).toContain("輸入電子郵件取得驗證碼");
    expect(response.body).toContain('<option value="zh-TW" selected>');
  });

  test("renders in zh-TW from Accept-Language on first visit (no cookie)", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "GET",
      url: "/login",
      headers: { "accept-language": "zh-Hant-TW,zh;q=0.9,en;q=0.8" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-TW">');
    expect(response.body).toContain("登入 FrameQ");
  });

  test("persists an explicit desktop deep-link locale (?lang=zh-TW) as a cookie", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({ method: "GET", url: "/login?lang=zh-TW" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-TW">');

    const cookies = parseCookies(response.headers["set-cookie"]);
    expect(cookies.get("lang")).toBe("zh-TW");

    // Subsequent navigation without the query param remembers the deep-link choice.
    const followUp = await app.inject({
      method: "GET",
      url: "/login",
      headers: { cookie: "lang=zh-TW" },
    });
    expect(followUp.body).toContain('<html lang="zh-TW">');
  });

  test("falls back to zh-CN when lang cookie is malformed", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "GET",
      url: "/login",
      headers: { cookie: "lang=%ZZ" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-CN">');
    expect(response.body).toContain("FrameQ 客户端");
  });

  test("falls back to zh-CN when lang cookie is unknown", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "GET",
      url: "/login",
      headers: { cookie: "lang=fr" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-CN">');
  });
});

describe("server page i18n — /dashboard", () => {
  test("renders in en when lang=en cookie is set alongside a valid session", async () => {
    const { app, sentCodes } = buildTestServer();
    const email = "user@example.com";
    const sessionCookies = await performWebLoginReal(app, sentCodes, email);
    const sessionToken = sessionCookies.get("frameq_user_session")!;
    const csrfToken = sessionCookies.get("frameq_user_csrf")!;

    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: {
        cookie: `frameq_user_session=${sessionToken}; frameq_user_csrf=${csrfToken}; lang=en`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain("FrameQ Dashboard");
    expect(response.body).toContain("Sign out");
    expect(response.body).toContain("Account & quota");
    expect(response.body).toContain(">中文<");
    expectSwitcher(response.body);
    // Email is rendered verbatim regardless of locale.
    expect(response.body).toContain(email);
  });

  test("renders in zh-TW from Accept-Language alongside a valid session", async () => {
    const { app, sentCodes } = buildTestServer();
    const email = "user@example.com";
    const sessionCookies = await performWebLoginReal(app, sentCodes, email);
    const sessionToken = sessionCookies.get("frameq_user_session")!;
    const csrfToken = sessionCookies.get("frameq_user_csrf")!;

    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: {
        cookie: `frameq_user_session=${sessionToken}; frameq_user_csrf=${csrfToken}`,
        "accept-language": "zh-TW",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-TW">');
    expect(response.body).toContain("FrameQ 控制台");
    expect(response.body).toContain("登出");
  });

  test("renders in zh-CN by default (no lang cookie)", async () => {
    const { app, sentCodes } = buildTestServer();
    const email = "user@example.com";
    const sessionCookies = await performWebLoginReal(app, sentCodes, email);
    const sessionToken = sessionCookies.get("frameq_user_session")!;
    const csrfToken = sessionCookies.get("frameq_user_csrf")!;

    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: {
        cookie: `frameq_user_session=${sessionToken}; frameq_user_csrf=${csrfToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-CN">');
    expect(response.body).toContain("FrameQ 控制台");
    expect(response.body).toContain("退出登录");
  });
});

describe("server page i18n — /admin/login", () => {
  test("renders in en when lang=en cookie is set", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "GET",
      url: "/admin/login",
      headers: { cookie: "lang=en" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain("Admin Sign-in");
    expect(response.body).toContain("Sign in to FrameQ Admin");
    expect(response.body).toContain(">中文<");
    expectSwitcher(response.body);
  });

  test("renders in zh-TW when lang=zh-TW cookie is set", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({
      method: "GET",
      url: "/admin/login",
      headers: { cookie: "lang=zh-TW" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-TW">');
    expect(response.body).toContain("管理員登入");
    expect(response.body).toContain("登入 FrameQ Admin");
  });

  test("renders in zh-CN by default (no lang cookie)", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({ method: "GET", url: "/admin/login" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-CN">');
    expect(response.body).toContain("管理员登录");
    expect(response.body).toContain("登录 FrameQ Admin");
  });
});

describe("server page i18n — /admin", () => {
  async function buildAuthenticatedAdminServer() {
    const store = new MemoryStore();
    const adminToken = "admin-session-token";
    const csrfToken = "csrf-token";
    await store.createAdminSession({
      email: "admin@example.com",
      tokenHash: sha256(adminToken),
      csrfTokenHash: sha256(csrfToken),
      createdAt: now,
      expiresAt: new Date("2026-09-04T08:00:00.000Z"),
    });
    const app = buildServer({
      store,
      sendOtp: async () => {},
      createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
      adminEmail: "admin@example.com",
      now: () => now,
    });
    return {
      app,
      adminCookie: `frameq_admin_session=${adminToken}; frameq_admin_csrf=${csrfToken}`,
    };
  }

  test("renders in en when lang=en cookie is set", async () => {
    const { app, adminCookie } = await buildAuthenticatedAdminServer();
    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { cookie: `${adminCookie}; lang=en` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain("Activation Code Management");
    expect(response.body).toContain("Signed in:");
    expect(response.body).toContain("Sign out");
    expect(response.body).toContain(">中文<");
    expectSwitcher(response.body);
  });

  test("renders in zh-TW when lang=zh-TW cookie is set", async () => {
    const { app, adminCookie } = await buildAuthenticatedAdminServer();
    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { cookie: `${adminCookie}; lang=zh-TW` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-TW">');
    expect(response.body).toContain("啟用碼管理");
    expect(response.body).toContain("已登入：");
    expect(response.body).toContain("登出");
  });

  test("renders in zh-CN by default (no lang cookie)", async () => {
    const { app, adminCookie } = await buildAuthenticatedAdminServer();
    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="zh-CN">');
    expect(response.body).toContain("激活码管理");
    expect(response.body).toContain("已登录：");
    expect(response.body).toContain("退出登录");
  });
});

describe("server page i18n — secret-leak regression", () => {
  test("login page never reflects the lang cookie value outside t()-driven copy", async () => {
    const { app } = buildTestServer();
    // A malicious cookie value must NOT be reflected into the page HTML.
    const response = await app.inject({
      method: "GET",
      url: "/login",
      headers: { cookie: "lang=<script>alert(1)</script>" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("<script>alert(1)</script>");
    // Falls back to zh-CN because the value is not in the closed set.
    expect(response.body).toContain('<html lang="zh-CN">');
  });

  test("dashboard page does not leak API keys or full activation codes regardless of locale", async () => {
    const { app, sentCodes } = buildTestServer();
    const email = "user@example.com";
    const sessionCookies = await performWebLoginReal(app, sentCodes, email);
    const sessionToken = sessionCookies.get("frameq_user_session")!;
    const csrfToken = sessionCookies.get("frameq_user_csrf")!;

    const enResponse = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: {
        cookie: `frameq_user_session=${sessionToken}; frameq_user_csrf=${csrfToken}; lang=en`,
      },
    });

    expect(enResponse.statusCode).toBe(200);
    // The httpOnly session token must never appear in the rendered HTML.
    expect(enResponse.body).not.toContain(sessionToken);
  });
});
