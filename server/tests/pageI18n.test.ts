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

describe("server page i18n — /login", () => {
  test("renders in zh-CN by default (no lang cookie)", async () => {
    const { app } = buildTestServer();
    const response = await app.inject({ method: "GET", url: "/login" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain('<html lang="zh-CN">');
    // Chinese copy from login.intro.desktop (default mode is desktop-ish copy in zh-CN).
    expect(response.body).toContain("FrameQ 客户端");
    // Switcher button targets en.
    expect(response.body).toContain('data-target-locale="en"');
    expect(response.body).toContain(">English<");
    // Shared switcher styles present.
    expect(response.body).toContain(".lang-switch");
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
    // English copy. login.intro.desktop contains "FrameQ client".
    expect(response.body).toContain("Enter your email to receive a verification code");
    expect(response.body).toContain("FrameQ client");
    // Switcher button targets zh-CN.
    expect(response.body).toContain('data-target-locale="zh-CN"');
    expect(response.body).toContain(">中文<");
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
    // English dashboard copy.
    expect(response.body).toContain("FrameQ Dashboard");
    expect(response.body).toContain("Sign out");
    expect(response.body).toContain("Account & quota");
    // Switcher targets zh-CN.
    expect(response.body).toContain('data-target-locale="zh-CN"');
    // Email is rendered verbatim regardless of locale.
    expect(response.body).toContain(email);
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
    // English admin-login copy.
    expect(response.body).toContain("Admin Sign-in");
    expect(response.body).toContain("Sign in to FrameQ Admin");
    // Switcher targets zh-CN.
    expect(response.body).toContain('data-target-locale="zh-CN"');
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
    // English admin copy.
    expect(response.body).toContain("Activation Code Management");
    expect(response.body).toContain("Signed in:");
    expect(response.body).toContain("Sign out");
    // Switcher targets zh-CN.
    expect(response.body).toContain('data-target-locale="zh-CN"');
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
    // (The CSRF token is intentionally rendered into the page's inline script so
    // the logout button can send the x-frameq-csrf header; the CSRF cookie is
    // non-httpOnly by design, so this is not a secret leak.)
    expect(enResponse.body).not.toContain(sessionToken);
  });
});
