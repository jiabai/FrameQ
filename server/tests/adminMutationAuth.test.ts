import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, test } from "vitest";
import { createOtpSender } from "../src/email.js";
import { PrismaStore } from "../src/prismaStore.js";
import { sha256 } from "../src/security.js";
import { buildServer } from "../src/server.js";
import { createWechatNativePayment } from "../src/wechat.js";
import { createTemporaryPrismaClient } from "./prismaTestHarness.js";

const now = new Date("2026-10-29T08:00:00.000Z");
const adminEmail = "admin@example.com";
const sessionToken = "admin-mutation-session";
const csrfToken = "admin-mutation-csrf";
const otherSessionToken = "other-admin-session";
const otherCsrfToken = "other-admin-csrf";
const encryptionKey = "0123456789abcdef0123456789abcdef";
const sendOtp = createOtpSender({
  environment: "test",
  allowConsoleOtp: false,
  smtp: {
    host: "127.0.0.1",
    port: 1,
    secure: false,
    user: "admin-test",
    pass: "admin-test",
    from: adminEmail,
  },
});
const apps: Array<ReturnType<typeof buildServer>> = [];
const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

type RejectedState = "missing" | "empty" | "unknown" | "expired" | "revoked"
  | "csrf-missing" | "csrf-wrong" | "csrf-other-session";

async function prepare(state: RejectedState | "valid" = "valid") {
  const fixture = await createTemporaryPrismaClient();
  fixtures.push(fixture);
  const store = new PrismaStore(fixture.prisma);
  for (const [token, csrf] of [[sessionToken, csrfToken], [otherSessionToken, otherCsrfToken]] as const) {
    await store.createAdminSession({
      email: adminEmail,
      tokenHash: sha256(token),
      csrfTokenHash: sha256(csrf),
      createdAt: new Date(now.getTime() - 60_000),
      expiresAt: state === "expired" && token === sessionToken
        ? now
        : new Date(now.getTime() + 43_200_000),
    });
  }
  if (state === "revoked") {
    await store.revokeAdminSession(sha256(sessionToken), now);
  }
  const user = await store.upsertUserByEmail("member@example.com", now);
  await store.upsertEntitlement(user.id, new Date(now.getTime() + 2_678_400_000), now, {
    llmQuotaLimit: 20,
    llmQuotaUsed: 2,
  });
  const app = buildServer({
    store,
    sendOtp,
    createNativePayment: createWechatNativePayment(),
    adminEmail,
    llmConfigEncryptionKey: encryptionKey,
    secureCookies: true,
    now: () => now,
  });
  apps.push(app);
  const headers: Record<string, string> = {};
  if (state !== "missing") {
    const token = state === "empty" ? "" : state === "unknown" ? "unknown-token" : sessionToken;
    headers.cookie = `frameq_admin_session=${token}; frameq_admin_csrf=${csrfToken}`;
  }
  if (state !== "csrf-missing") {
    headers["x-frameq-csrf"] = state === "csrf-wrong"
      ? "wrong-csrf"
      : state === "csrf-other-session" ? otherCsrfToken : csrfToken;
  }
  return { app, store, prisma: fixture.prisma, headers, userId: user.id };
}

async function protectedState(prisma: PrismaClient) {
  return {
    sessions: await prisma.adminSession.findMany({ orderBy: { id: "asc" } }),
    codes: await prisma.activationCode.findMany({ orderBy: { id: "asc" } }),
    llm: await prisma.llmConfig.findMany(),
    anysearch: await prisma.anysearchConfig.findMany(),
    entitlements: await prisma.entitlement.findMany({ orderBy: { userId: "asc" } }),
    adjustments: await prisma.adminEntitlementAdjustment.findMany({ orderBy: { id: "asc" } }),
  };
}

const routes = [
  { name: "logout", path: "/admin/auth/logout", payload: {} },
  { name: "activation", path: "/admin/api/activation-codes", payload: { redeem_window_days: 7 } },
  {
    name: "llm",
    path: "/admin/api/llm-config",
    payload: {
      provider: "openai",
      base_url: "https://llm.example/v1",
      model: "admin-test-model",
      api_key: "admin-test-llm-key",
      timeout_seconds: 30,
    },
  },
  {
    name: "anysearch",
    path: "/admin/api/anysearch-config",
    payload: { mcp_url: "https://anysearch.example/mcp", api_key: "admin-test-search-key" },
  },
  {
    name: "adjustment",
    path: "/admin/api/users/:userId/entitlement-adjustments",
    payload: { quota_add: 3, reason: "bug_compensation" },
  },
];

const rejections: Array<{ state: RejectedState; status: 401 | 403 }> = [
  { state: "missing", status: 401 },
  { state: "empty", status: 401 },
  { state: "unknown", status: 401 },
  { state: "expired", status: 401 },
  { state: "revoked", status: 401 },
  { state: "csrf-missing", status: 403 },
  { state: "csrf-wrong", status: 403 },
  { state: "csrf-other-session", status: 403 },
];

describe.each(routes)("administrator mutation $name", (route) => {
  test.each(rejections)("rejects $state before writes or payload validation", async ({ state, status }) => {
    const { app, prisma, headers, userId } = await prepare(state);
    const before = await protectedState(prisma);
    for (const payload of [route.payload, []]) {
      const response = await app.inject({
        method: "POST",
        url: route.path.replace(":userId", userId),
        headers,
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error: status === 401 ? "ADMIN_AUTH_REQUIRED" : "CSRF_INVALID" });
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await protectedState(prisma)).toEqual(before);
    }
  });

  test("accepts the session-bound CSRF token and performs the requested mutation", async () => {
    const { app, store, prisma, headers, userId } = await prepare();
    const response = await app.inject({
      method: "POST",
      url: route.path.replace(":userId", userId),
      headers,
      payload: route.payload,
    });
    expect(response.statusCode).toBe(200);
    if (route.name === "logout") {
      expect(await store.findAdminSessionByTokenHash(sha256(sessionToken), now)).toBeNull();
      expect(response.json()).toEqual({ ok: true, redirect_url: "/admin/login" });
      expect(String(response.headers["set-cookie"])).toContain("Max-Age=0");
    } else {
      expect(await store.findAdminSessionByTokenHash(sha256(sessionToken), now)).not.toBeNull();
    }
    expect(await store.findAdminSessionByTokenHash(sha256(otherSessionToken), now)).not.toBeNull();
    if (route.name === "activation") {
      expect(await prisma.activationCode.count()).toBe(1);
      expect(response.json().code).toMatch(/^FQ-/);
    } else if (route.name === "llm") {
      const config = await store.getLlmConfig();
      expect(config?.model).toBe("admin-test-model");
      expect(config?.encryptedApiKey).not.toContain("admin-test-llm-key");
      expect(response.json().has_api_key).toBe(true);
    } else if (route.name === "anysearch") {
      const config = await store.getAnysearchConfig();
      expect(config?.mcpUrl).toBe("https://anysearch.example/mcp");
      expect(config?.encryptedApiKey).not.toContain("admin-test-search-key");
      expect(response.json().has_api_key).toBe(true);
    } else if (route.name === "adjustment") {
      const adjustments = await prisma.adminEntitlementAdjustment.findMany();
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]?.adminEmail).toBe(adminEmail);
      expect((await store.getEntitlement(userId))?.llmQuotaLimit).toBe(23);
    }
  });
});
