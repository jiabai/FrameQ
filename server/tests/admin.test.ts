import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { sha256 } from "../src/security.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-06-21T08:00:00.000Z");

function parseCookie(setCookie: string[] | string | undefined, name: string): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Cookie ${name} was not set.`);
  }
  return cookie.split(";")[0] ?? "";
}

describe("admin activation code routes", () => {
  test("renders a structured Admin login page", async () => {
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async () => {},
      createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
      adminEmail: "lantianye@163.com",
      now: () => now,
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/login",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("login-card");
    expect(response.body).toContain("admin-form");
    expect(response.body).toContain("管理员登录");
    expect(response.body).toContain("获取验证码");
    expect(response.body).toContain('type="email"');
    expect(response.body).not.toContain('placeholder="lantianye@163.com"');
  });

  test("allows only the configured admin email to start OTP login", async () => {
    const sent: Array<{ email: string; code: string }> = [];
    const app = buildServer({
      store: new MemoryStore(),
      sendOtp: async (email, code) => {
        sent.push({ email, code });
      },
      createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
      adminEmail: "lantianye@163.com",
      now: () => now,
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/admin/auth/email/start",
      payload: { email: "other@example.com", state: "admin-state-1" },
    });
    expect(rejected.statusCode).toBe(403);

    const accepted = await app.inject({
      method: "POST",
      url: "/admin/auth/email/start",
      payload: { email: "lantianye@163.com", state: "admin-state-1" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.email).toBe("lantianye@163.com");
  });

  test("sets HttpOnly admin session and validates csrf on activation creation", async () => {
    const store = new MemoryStore();
    let sentCode = "";
    const app = buildServer({
      store,
      sendOtp: async (_email, code) => {
        sentCode = code;
      },
      createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
      adminEmail: "lantianye@163.com",
      now: () => now,
    });

    await app.inject({
      method: "POST",
      url: "/admin/auth/email/start",
      payload: { email: "lantianye@163.com", state: "admin-state-1" },
    });
    const verified = await app.inject({
      method: "POST",
      url: "/admin/auth/email/verify",
      payload: { email: "lantianye@163.com", code: sentCode, state: "admin-state-1" },
    });

    expect(verified.statusCode).toBe(200);
    const verifiedCookies = Array.isArray(verified.headers["set-cookie"])
      ? verified.headers["set-cookie"]
      : verified.headers["set-cookie"]
        ? [verified.headers["set-cookie"]]
        : [];
    expect(verifiedCookies.map((value) => value.split("=")[0])).toEqual([
      "frameq_admin_session",
      "frameq_admin_session",
      "frameq_admin_csrf",
    ]);
    const sessionCookieHeader = verifiedCookies.find((value) =>
      value.startsWith("frameq_admin_session="),
    );
    const csrfCookieHeader = verifiedCookies.find((value) =>
      value.startsWith("frameq_admin_csrf="),
    );
    for (const cookie of [sessionCookieHeader, csrfCookieHeader]) {
      expect(cookie).toContain("Path=/");
      expect(cookie).toMatch(/Max-Age=\d+/);
      expect(cookie).toContain("SameSite=Lax");
    }
    expect(sessionCookieHeader).toContain("HttpOnly");
    expect(csrfCookieHeader).not.toContain("HttpOnly");
    const sessionCookie = parseCookie(verified.headers["set-cookie"], "frameq_admin_session");
    const csrfCookie = parseCookie(verified.headers["set-cookie"], "frameq_admin_csrf");
    expect(String(verified.headers["set-cookie"])).toContain("HttpOnly");

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/admin/api/activation-codes",
      headers: { cookie: `${sessionCookie}; ${csrfCookie}` },
      payload: {},
    });
    expect(missingCsrf.statusCode).toBe(403);

    const invalid = await app.inject({
      method: "POST",
      url: "/admin/api/activation-codes",
      headers: {
        cookie: `${sessionCookie}; ${csrfCookie}`,
        "x-frameq-csrf": csrfCookie.replace("frameq_admin_csrf=", ""),
      },
      payload: { redeem_window_days: 0 },
    });
    expect(invalid.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/admin/api/activation-codes",
      headers: {
        cookie: `${sessionCookie}; ${csrfCookie}`,
        "x-frameq-csrf": csrfCookie.replace("frameq_admin_csrf=", ""),
      },
      payload: { redeem_window_days: 7 },
    });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ entitlement_days: 31 });
    expect(created.json<{ redeem_by: string }>().redeem_by).toBe("2026-06-28T08:00:00.000Z");
    expect(created.json<{ code: string }>().code).toMatch(/^FQ-/);
    expect(store.activationCodes[0]?.codeHash).not.toContain(created.json<{ code: string }>().code);
  });

  test("admin page lists users and activation code status", async () => {
    const store = new MemoryStore();
    const adminToken = "admin-session-token";
    const adminSession = await store.createAdminSession({
      email: "lantianye@163.com",
      tokenHash: sha256(adminToken),
      csrfTokenHash: "csrf-hash",
      createdAt: now,
      expiresAt: new Date("2026-06-21T20:00:00.000Z"),
    });
    const user = await store.upsertUserByEmail("user@example.com", now);
    await store.upsertEntitlement(user.id, new Date("2026-07-22T08:00:00.000Z"), now, {
      llmQuotaLimit: 20,
      llmQuotaUsed: 5,
    });
    await store.createActivationCode({
      codeHash: "code-hash",
      codePrefix: "FQ-ABCD",
      status: "active",
      entitlementDays: 31,
      redeemBy: new Date("2026-07-21T08:00:00.000Z"),
      createdAt: now,
      redeemedAt: null,
      redeemedByUserId: null,
    });
    const app = buildServer({
      store,
      sendOtp: async () => {},
      createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
      adminEmail: "lantianye@163.com",
      now: () => now,
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { cookie: `frameq_admin_session=${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("FrameQ Admin");
    expect(response.body).toContain("user@example.com");
    expect(response.body).toContain("FQ-ABCD");
    expect(response.body).toContain("已登录");
    expect(response.body).toContain("lantianye@163.com");
    expect(response.body).toContain("退出登录");
    expect(response.body).toContain("llm-config-form");
    expect(response.body).toContain("llm-quota-table");
    expect(response.body).toContain("entitlement-adjustment-table");
    expect(response.body).toContain("/entitlement-adjustments");
    expect(response.body).not.toContain("/llm-quota");
    expect(response.body).not.toContain("quota-remaining-input");
    expect(response.body).not.toContain("quota-save");
    expect(response.body).toContain("权益调整");
    expect(response.body).toContain("增加 LLM API 调用次数");
    expect(response.body).toContain("延长天数");
    expect(response.body).toContain(`data-user-id="${user.id}"`);
    expect(response.body).toContain("<td>15</td>");
    expect(response.body).toContain("生成月卡激活码");
    expect(response.body).toContain("兑换后获得 31 天月卡权益");
    expect(response.body).toContain("激活码有效期");
    expect(response.body).not.toContain("生成 31 天月卡码");
    expect(response.body).not.toContain("兑换有效期");
  });

  test("logs out admin sessions and clears admin cookies", async () => {
    const store = new MemoryStore();
    const adminToken = "admin-session-token";
    const csrfToken = "csrf-token";
    await store.createAdminSession({
      email: "lantianye@163.com",
      tokenHash: sha256(adminToken),
      csrfTokenHash: sha256(csrfToken),
      createdAt: now,
      expiresAt: new Date("2026-06-21T20:00:00.000Z"),
    });
    const app = buildServer({
      store,
      sendOtp: async () => {},
      createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
      adminEmail: "lantianye@163.com",
      now: () => now,
    });

    const noSession = await app.inject({
      method: "POST",
      url: "/admin/auth/logout",
      headers: { "x-frameq-csrf": csrfToken },
    });
    expect(noSession.statusCode).toBe(401);

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/admin/auth/logout",
      headers: { cookie: `frameq_admin_session=${adminToken}; frameq_admin_csrf=${csrfToken}` },
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(store.adminSessions[0]?.revokedAt).toBeNull();

    const loggedOut = await app.inject({
      method: "POST",
      url: "/admin/auth/logout",
      headers: {
        cookie: `frameq_admin_session=${adminToken}; frameq_admin_csrf=${csrfToken}`,
        "x-frameq-csrf": csrfToken,
      },
    });

    expect(loggedOut.statusCode).toBe(200);
    expect(loggedOut.json()).toEqual({ ok: true, redirect_url: "/admin/login" });
    expect(store.adminSessions[0]?.revokedAt).toEqual(now);
    expect(String(loggedOut.headers["set-cookie"])).toContain("frameq_admin_session=");
    expect(String(loggedOut.headers["set-cookie"])).toContain("frameq_admin_csrf=");
    expect(String(loggedOut.headers["set-cookie"])).toContain("Max-Age=0");
    const clearedCookies = Array.isArray(loggedOut.headers["set-cookie"])
      ? loggedOut.headers["set-cookie"]
      : loggedOut.headers["set-cookie"]
        ? [loggedOut.headers["set-cookie"]]
        : [];
    expect(clearedCookies.map((value) => value.split("=")[0])).toEqual([
      "frameq_admin_session",
      "frameq_admin_session",
      "frameq_admin_csrf",
    ]);
    for (const cookie of clearedCookies) {
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("SameSite=Lax");
    }
    expect(clearedCookies.find((value) => value.startsWith("frameq_admin_session="))).toContain(
      "HttpOnly",
    );
    expect(clearedCookies.find((value) => value.startsWith("frameq_admin_csrf="))).not.toContain(
      "HttpOnly",
    );

    const afterLogout = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { cookie: `frameq_admin_session=${adminToken}; frameq_admin_csrf=${csrfToken}` },
    });
    expect(afterLogout.statusCode).toBe(302);
    expect(afterLogout.headers.location).toBe("/admin/login");
  });
});
