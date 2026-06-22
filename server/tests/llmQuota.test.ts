import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { sha256 } from "../src/security.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-06-22T08:00:00.000Z");
const encryptionKey = "0123456789abcdef0123456789abcdef";

function adminHeaders(adminToken = "admin-token", csrfToken = "csrf-token") {
  return {
    cookie: `frameq_admin_session=${adminToken}; frameq_admin_csrf=${csrfToken}`,
    "x-frameq-csrf": csrfToken,
  };
}

async function createAuthorizedUser(store: MemoryStore) {
  const user = await store.upsertUserByEmail("user@example.com", now);
  const sessionToken = "desktop-session-token";
  await store.createSession({
    userId: user.id,
    tokenHash: sha256(sessionToken),
    createdAt: now,
    expiresAt: new Date("2026-07-22T08:00:00.000Z"),
  });
  await store.upsertEntitlement(user.id, new Date("2026-07-22T08:00:00.000Z"), now);
  const entitlement = await store.getEntitlement(user.id);
  if (entitlement) {
    (entitlement as any).llmQuotaLimit = 20;
    (entitlement as any).llmQuotaUsed = 0;
  }
  return { user, sessionToken };
}

async function createAdminSession(store: MemoryStore) {
  await store.createAdminSession({
    email: "lantianye@163.com",
    tokenHash: sha256("admin-token"),
    csrfTokenHash: sha256("csrf-token"),
    createdAt: now,
    expiresAt: new Date("2026-06-22T20:00:00.000Z"),
  });
}

function buildTestServer(store: MemoryStore) {
  return buildServer({
    store,
    sendOtp: async () => {},
    createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
    adminEmail: "lantianye@163.com",
    llmConfigEncryptionKey: encryptionKey,
    now: () => now,
  } as any);
}

async function saveLlmConfig(app: ReturnType<typeof buildServer>) {
  return app.inject({
    method: "POST",
    url: "/admin/api/llm-config",
    headers: adminHeaders(),
    payload: {
      provider: "openai_compatible",
      base_url: "https://llm.example/v1",
      model: "dedicated-frameq-model",
      api_key: "client-secret-key",
      timeout_seconds: 45,
    },
  });
}

describe("server-managed LLM config and quota", () => {
  test("admin saves encrypted LLM config without echoing the API key", async () => {
    const store = new MemoryStore();
    await createAdminSession(store);
    const app = buildTestServer(store);

    const response = await saveLlmConfig(app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      provider: "openai_compatible",
      base_url: "https://llm.example/v1",
      model: "dedicated-frameq-model",
      timeout_seconds: 45,
      has_api_key: true,
    });
    expect(response.body).not.toContain("client-secret-key");
    expect(JSON.stringify(store)).not.toContain("client-secret-key");
  });

  test("desktop checkout consumes one quota and is idempotent by request id", async () => {
    const store = new MemoryStore();
    await createAdminSession(store);
    const { sessionToken } = await createAuthorizedUser(store);
    const app = buildTestServer(store);
    expect((await saveLlmConfig(app)).statusCode).toBe(200);

    const first = await app.inject({
      method: "POST",
      url: "/api/desktop/llm/checkouts",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { request_id: "insights-run-1" },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      provider: "openai_compatible",
      base_url: "https://llm.example/v1",
      model: "dedicated-frameq-model",
      api_key: "client-secret-key",
      timeout_seconds: 45,
      quota_remaining: 19,
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/desktop/llm/checkouts",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { request_id: "insights-run-1" },
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ quota_remaining: 19 });
    await expect(store.getEntitlement(store.users[0]!.id)).resolves.toMatchObject({
      llmQuotaLimit: 20,
      llmQuotaUsed: 1,
    });
  });

  test("account status reflects quota and blocks processing when quota is exhausted", async () => {
    const store = new MemoryStore();
    const { sessionToken } = await createAuthorizedUser(store);
    const entitlement = await store.getEntitlement(store.users[0]!.id);
    if (entitlement) {
      (entitlement as any).llmQuotaUsed = 20;
    }
    const app = buildTestServer(store);

    const response = await app.inject({
      method: "GET",
      url: "/api/desktop/account",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      llm_quota_limit: 20,
      llm_quota_used: 20,
      llm_quota_remaining: 0,
      llm_quota_resets_at: "2026-07-22T08:00:00.000Z",
      llm_configured: false,
      can_process: false,
    });
  });

  test("admin edits a user's remaining quota", async () => {
    const store = new MemoryStore();
    await createAdminSession(store);
    const { user, sessionToken } = await createAuthorizedUser(store);
    const entitlement = await store.getEntitlement(user.id);
    if (entitlement) {
      (entitlement as any).llmQuotaUsed = 4;
    }
    const app = buildTestServer(store);

    const updated = await app.inject({
      method: "POST",
      url: `/admin/api/users/${user.id}/llm-quota`,
      headers: adminHeaders(),
      payload: { remaining: 7 },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      user_id: user.id,
      llm_quota_used: 4,
      llm_quota_limit: 11,
      llm_quota_remaining: 7,
    });

    const account = await app.inject({
      method: "GET",
      url: "/api/desktop/account",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(account.json()).toMatchObject({ llm_quota_remaining: 7 });
  });
});
