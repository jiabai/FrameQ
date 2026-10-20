import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { sha256 } from "../src/security.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-06-22T08:00:00.000Z");
const encryptionKey = "0123456789abcdef0123456789abcdef";

async function buildAdminServer() {
  const store = new MemoryStore();
  const adminToken = "admin-session-token";
  const csrfToken = "csrf-token";
  await store.createAdminSession({
    email: "lantianye@163.com",
    tokenHash: sha256(adminToken),
    csrfTokenHash: sha256(csrfToken),
    createdAt: now,
    expiresAt: new Date("2026-07-22T08:00:00.000Z"),
  });
  const app = buildServer({
    store,
    sendOtp: async () => {},
    createNativePayment: async () => ({ codeUrl: "unused", providerPayload: {} }),
    adminEmail: "lantianye@163.com",
    llmConfigEncryptionKey: encryptionKey,
    now: () => now,
  } as any);
  const cookie = `frameq_admin_session=${adminToken}; frameq_admin_csrf=${csrfToken}`;
  return { store, app, cookie, csrfToken };
}

describe("GET /admin — anysearch config section", () => {
  test("renders the anysearch config form with url field and anonymous checkbox", async () => {
    const { app, cookie } = await buildAdminServer();
    const response = await app.inject({ method: "GET", url: "/admin", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("anysearch-config-form");
    expect(response.body).toContain("匿名访问");
    expect(response.body).toContain("/admin/api/anysearch-config");
  });

  test("shows the saved-key placeholder after a key is configured", async () => {
    const { app, cookie, csrfToken } = await buildAdminServer();
    await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie, "x-frameq-csrf": csrfToken },
      payload: { mcp_url: "https://anysearch.example/mcp", api_key: "sk-secret-1234" },
    });
    const response = await app.inject({ method: "GET", url: "/admin", headers: { cookie } });
    expect(response.body).toContain("Saved key ending 1234");
  });
});

describe("POST /admin/api/anysearch-config", () => {
  test("saves url + key and returns the public config", async () => {
    const { app, cookie, csrfToken } = await buildAdminServer();
    const response = await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie, "x-frameq-csrf": csrfToken },
      payload: { mcp_url: "https://anysearch.example/mcp", api_key: "sk-secret-1234" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      mcp_url: "https://anysearch.example/mcp",
      has_api_key: true,
      api_key_last4: "1234",
    });
  });

  test("clear_api_key true removes the key (anonymous)", async () => {
    const { app, cookie, csrfToken } = await buildAdminServer();
    await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie, "x-frameq-csrf": csrfToken },
      payload: { mcp_url: "https://anysearch.example/mcp", api_key: "sk-secret-1234" },
    });
    const cleared = await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie, "x-frameq-csrf": csrfToken },
      payload: { mcp_url: "https://anysearch.example/mcp", clear_api_key: true },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ has_api_key: false, api_key_last4: "" });
  });

  test("blank api_key without clear preserves the existing key", async () => {
    const { app, cookie, csrfToken } = await buildAdminServer();
    await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie, "x-frameq-csrf": csrfToken },
      payload: { mcp_url: "https://anysearch.example/mcp", api_key: "sk-secret-1234" },
    });
    const kept = await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie, "x-frameq-csrf": csrfToken },
      payload: { mcp_url: "https://anysearch.example/mcp" },
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toMatchObject({ has_api_key: true, api_key_last4: "1234" });
  });

  test("admin save is reflected by desktop checkout (live, no restart)", async () => {
    const { store, app, cookie, csrfToken } = await buildAdminServer();
    // Create a desktop session to exercise checkout end-to-end.
    const user = await store.upsertUserByEmail("user@example.com", now);
    const sessionToken = "desktop-session-token";
    await store.createSession({
      userId: user.id,
      tokenHash: sha256(sessionToken),
      createdAt: now,
      expiresAt: new Date("2026-07-22T08:00:00.000Z"),
    });

    await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie, "x-frameq-csrf": csrfToken },
      payload: { mcp_url: "https://anysearch.example/mcp", api_key: "sk-secret-1234" },
    });

    const checkout = await app.inject({
      method: "POST",
      url: "/api/desktop/anysearch/checkout",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json()).toEqual({
      mcp_url: "https://anysearch.example/mcp",
      api_key: "sk-secret-1234",
    });
  });

  test("rejects unauthenticated requests with 401", async () => {
    const { app } = await buildAdminServer();
    const response = await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      payload: { mcp_url: "https://anysearch.example/mcp" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "ADMIN_AUTH_REQUIRED" });
  });

  test("rejects missing csrf with 403", async () => {
    const { app, cookie } = await buildAdminServer();
    const response = await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie },
      payload: { mcp_url: "https://anysearch.example/mcp" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "CSRF_INVALID" });
  });

  test("rejects an invalid mcp url with 400", async () => {
    const { app, cookie, csrfToken } = await buildAdminServer();
    const response = await app.inject({
      method: "POST",
      url: "/admin/api/anysearch-config",
      headers: { cookie, "x-frameq-csrf": csrfToken },
      payload: { mcp_url: "ftp://nope.example/mcp" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/http/i);
  });
});
