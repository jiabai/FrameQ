import { afterEach, describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { sha256 } from "../src/security.js";
import { MemoryStore } from "../src/store.js";
import { encryptSecret, requireEncryptionKey } from "../src/llmConfig.js";

const now = new Date("2026-06-22T08:00:00.000Z");
const encryptionKey = "0123456789abcdef0123456789abcdef";
const keyBuffer = requireEncryptionKey(encryptionKey);

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

// Seeds the anysearch config singleton the same way the encrypted store would hold it.
async function seedAnysearchConfig(
  store: MemoryStore,
  input: { mcpUrl: string; apiKey?: string | null },
) {
  const apiKey = input.apiKey?.trim() || "";
  const hasKey = apiKey.length > 0;
  await store.upsertAnysearchConfig(
    {
      mcpUrl: input.mcpUrl,
      encryptedApiKey: hasKey ? encryptSecret(apiKey, keyBuffer) : "",
      apiKeyLast4: hasKey ? apiKey.slice(-4) : "",
    },
    now,
  );
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

const envMcpUrl = process.env.FRAMEQ_ANYSEARCH_MCP_URL;
const envApiKey = process.env.FRAMEQ_ANYSEARCH_API_KEY;

afterEach(() => {
  if (envMcpUrl === undefined) {
    delete process.env.FRAMEQ_ANYSEARCH_MCP_URL;
  } else {
    process.env.FRAMEQ_ANYSEARCH_MCP_URL = envMcpUrl;
  }
  if (envApiKey === undefined) {
    delete process.env.FRAMEQ_ANYSEARCH_API_KEY;
  } else {
    process.env.FRAMEQ_ANYSEARCH_API_KEY = envApiKey;
  }
});

describe("POST /api/desktop/anysearch/checkout", () => {
  test("rejects unauthenticated requests with 401 AUTH_REQUIRED", async () => {
    const store = new MemoryStore();
    await seedAnysearchConfig(store, {
      mcpUrl: "https://anysearch.example/mcp",
      apiKey: "the-key",
    });
    const app = buildTestServer(store);

    const noToken = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
    });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json()).toEqual({ error: "AUTH_REQUIRED" });

    await createAuthorizedUser(store);
    const invalidToken = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(invalidToken.statusCode).toBe(401);
    expect(invalidToken.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  test("returns 400 ANYSEARCH_CONFIG_MISSING when no config is stored", async () => {
    const store = new MemoryStore();
    await createAuthorizedUser(store);
    const app = buildTestServer(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
      headers: { authorization: "Bearer desktop-session-token" },
      // 请求体故意带 request_id，端点应忽略（anysearch 无 request_id 契约）。
      payload: { request_id: "should-be-ignored" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "ANYSEARCH_CONFIG_MISSING" });
  });

  test("issues credentials with an api key when configured", async () => {
    const store = new MemoryStore();
    const { user } = await createAuthorizedUser(store);
    await seedAnysearchConfig(store, {
      mcpUrl: "https://anysearch.example/mcp",
      apiKey: "the-key",
    });
    const app = buildTestServer(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
      headers: { authorization: "Bearer desktop-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mcp_url: "https://anysearch.example/mcp",
      api_key: "the-key",
    });

    // 不计费、不改 entitlement（design D4）：配额与到期日保持不变。
    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });
  });

  test("issues anonymous credentials (api_key null) when no key configured", async () => {
    const store = new MemoryStore();
    const { user } = await createAuthorizedUser(store);
    await seedAnysearchConfig(store, { mcpUrl: "https://anysearch.example/mcp" });
    const app = buildTestServer(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
      headers: { authorization: "Bearer desktop-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mcp_url: "https://anysearch.example/mcp",
      api_key: null,
    });

    // 仍不计费、不改 entitlement。
    await expect(store.getEntitlement(user.id)).resolves.toMatchObject({
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
    });
  });

  test("reflects live config changes without a restart (D6)", async () => {
    const store = new MemoryStore();
    await createAuthorizedUser(store);
    await seedAnysearchConfig(store, {
      mcpUrl: "https://old.example/mcp",
      apiKey: "old-key",
    });
    const app = buildTestServer(store);

    const first = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
      headers: { authorization: "Bearer desktop-session-token" },
    });
    expect(first.json()).toEqual({
      mcp_url: "https://old.example/mcp",
      api_key: "old-key",
    });

    // 保存新值到同一 store（模拟管理员在 /admin 改配置），不重建 server。
    await seedAnysearchConfig(store, {
      mcpUrl: "https://new.example/mcp",
      apiKey: "new-key",
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
      headers: { authorization: "Bearer desktop-session-token" },
    });
    expect(second.json()).toEqual({
      mcp_url: "https://new.example/mcp",
      api_key: "new-key",
    });
  });

  test("ignores anysearch env vars (hard cut, D2)", async () => {
    const store = new MemoryStore();
    await createAuthorizedUser(store);
    await seedAnysearchConfig(store, {
      mcpUrl: "https://from-store.example/mcp",
      apiKey: "store-key",
    });
    process.env.FRAMEQ_ANYSEARCH_MCP_URL = "https://from-env.example/mcp";
    process.env.FRAMEQ_ANYSEARCH_API_KEY = "env-key";
    const app = buildTestServer(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
      headers: { authorization: "Bearer desktop-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mcp_url: "https://from-store.example/mcp",
      api_key: "store-key",
    });
  });
});
