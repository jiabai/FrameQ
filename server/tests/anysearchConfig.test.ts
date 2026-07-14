import { describe, expect, test } from "vitest";
import { AnysearchConfigService } from "../src/anysearchConfig.js";
import { MemoryStore } from "../src/store.js";

const now = new Date("2026-07-15T08:00:00.000Z");
const encryptionKey = "0123456789abcdef0123456789abcdef";

function buildService(store: MemoryStore) {
  return new AnysearchConfigService({ store, now: () => now, encryptionKey });
}

describe("AnysearchConfigService.getPublicConfig", () => {
  test("returns defaults when no record exists", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    await expect(service.getPublicConfig()).resolves.toEqual({
      mcpUrl: "",
      hasApiKey: false,
      apiKeyLast4: "",
      updatedAt: null,
    });
  });
});

describe("AnysearchConfigService.saveConfig — three-state key (D4)", () => {
  test("set: non-blank key overwrites, encrypts, masks last-4", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    const saved = await service.saveConfig({
      mcpUrl: "https://anysearch.example/mcp",
      apiKey: "sk-secret-1234",
    });
    expect(saved).toMatchObject({
      mcpUrl: "https://anysearch.example/mcp",
      hasApiKey: true,
      apiKeyLast4: "1234",
      updatedAt: now,
    });
    // Stored ciphertext is not the plaintext.
    const record = await store.getAnysearchConfig();
    expect(record?.encryptedApiKey).not.toBe("sk-secret-1234");
    expect(record?.encryptedApiKey.length).toBeGreaterThan(0);
  });

  test("set then keep (blank key, no clear): preserves existing key plaintext", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    await service.saveConfig({
      mcpUrl: "https://anysearch.example/mcp",
      apiKey: "sk-secret-1234",
    });
    const kept = await service.saveConfig({ mcpUrl: "https://anysearch.example/mcp" });
    expect(kept.hasApiKey).toBe(true);
    expect(kept.apiKeyLast4).toBe("1234");
    const desktop = await service.getDesktopConfig();
    expect(desktop?.apiKey).toBe("sk-secret-1234");
  });

  test("clear (clearApiKey true): removes key → anonymous", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    await service.saveConfig({
      mcpUrl: "https://anysearch.example/mcp",
      apiKey: "sk-secret-1234",
    });
    const cleared = await service.saveConfig({
      mcpUrl: "https://anysearch.example/mcp",
      clearApiKey: true,
    });
    expect(cleared.hasApiKey).toBe(false);
    expect(cleared.apiKeyLast4).toBe("");
    const desktop = await service.getDesktopConfig();
    expect(desktop?.apiKey).toBeNull();
  });

  test("anonymous without prior key: blank key + no clear yields no key", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    const saved = await service.saveConfig({ mcpUrl: "https://anysearch.example/mcp" });
    expect(saved.hasApiKey).toBe(false);
    const desktop = await service.getDesktopConfig();
    expect(desktop?.apiKey).toBeNull();
    expect(desktop?.mcpUrl).toBe("https://anysearch.example/mcp");
  });

  test("clearApiKey takes precedence over a supplied key", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    const saved = await service.saveConfig({
      mcpUrl: "https://anysearch.example/mcp",
      apiKey: "sk-secret-1234",
      clearApiKey: true,
    });
    expect(saved.hasApiKey).toBe(false);
  });
});

describe("AnysearchConfigService.saveConfig — validation", () => {
  test("rejects missing mcp url", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    await expect(service.saveConfig({ mcpUrl: "" })).rejects.toThrow(/required/i);
  });

  test("rejects a non-http(s) mcp url", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    await expect(
      service.saveConfig({ mcpUrl: "ftp://anysearch.example/mcp" }),
    ).rejects.toThrow(/http/i);
  });

  test("trims and strips trailing slashes from the url", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    const saved = await service.saveConfig({ mcpUrl: "  https://anysearch.example/mcp///  " });
    expect(saved.mcpUrl).toBe("https://anysearch.example/mcp");
  });
});

describe("AnysearchConfigService.getDesktopConfig", () => {
  test("returns null when no record exists", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    await expect(service.getDesktopConfig()).resolves.toBeNull();
  });

  test("returns null when the stored url is empty", async () => {
    const store = new MemoryStore();
    await store.upsertAnysearchConfig(
      { mcpUrl: "", encryptedApiKey: "", apiKeyLast4: "" },
      now,
    );
    const service = buildService(store);
    await expect(service.getDesktopConfig()).resolves.toBeNull();
  });

  test("decrypts and returns the key when set", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    await service.saveConfig({
      mcpUrl: "https://anysearch.example/mcp",
      apiKey: "sk-secret-1234",
    });
    await expect(service.getDesktopConfig()).resolves.toEqual({
      mcpUrl: "https://anysearch.example/mcp",
      apiKey: "sk-secret-1234",
    });
  });
});

describe("AnysearchConfigService.isConfigured", () => {
  test("false when no record, true once a url is saved", async () => {
    const store = new MemoryStore();
    const service = buildService(store);
    await expect(service.isConfigured()).resolves.toBe(false);
    await service.saveConfig({ mcpUrl: "https://anysearch.example/mcp" });
    await expect(service.isConfigured()).resolves.toBe(true);
  });
});
