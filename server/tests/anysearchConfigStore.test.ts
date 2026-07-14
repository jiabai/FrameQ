import { afterEach, describe, expect, test } from "vitest";
import { MemoryStore } from "../src/store.js";
import { PrismaStore } from "../src/prismaStore.js";
import { createTemporaryPrismaClient } from "./prismaTestHarness.js";

const createdAt = new Date("2026-07-15T08:00:00.000Z");
const updatedAt = new Date("2026-07-15T09:00:00.000Z");

describe("AnysearchConfig store (MemoryStore)", () => {
  test("getAnysearchConfig returns null when no record exists", async () => {
    const store = new MemoryStore();
    await expect(store.getAnysearchConfig()).resolves.toBeNull();
  });

  test("upsertAnysearchConfig creates the singleton with id default and timestamps", async () => {
    const store = new MemoryStore();
    const saved = await store.upsertAnysearchConfig(
      {
        mcpUrl: "https://anysearch.example/mcp",
        encryptedApiKey: "enc",
        apiKeyLast4: "1234",
      },
      createdAt,
    );
    expect(saved).toMatchObject({
      id: "default",
      mcpUrl: "https://anysearch.example/mcp",
      encryptedApiKey: "enc",
      apiKeyLast4: "1234",
      createdAt,
      updatedAt: createdAt,
    });
    await expect(store.getAnysearchConfig()).resolves.toMatchObject({ id: "default" });
  });

  test("upsertAnysearchConfig updates in place, preserving createdAt", async () => {
    const store = new MemoryStore();
    await store.upsertAnysearchConfig(
      {
        mcpUrl: "https://old.example/mcp",
        encryptedApiKey: "enc-old",
        apiKeyLast4: "old0",
      },
      createdAt,
    );
    const updated = await store.upsertAnysearchConfig(
      {
        mcpUrl: "https://new.example/mcp",
        encryptedApiKey: "enc-new",
        apiKeyLast4: "new0",
      },
      updatedAt,
    );
    expect(updated).toMatchObject({
      id: "default",
      mcpUrl: "https://new.example/mcp",
      encryptedApiKey: "enc-new",
      apiKeyLast4: "new0",
      createdAt,
      updatedAt,
    });
    expect(updated.createdAt).toEqual(createdAt);
    expect(updated.updatedAt).toEqual(updatedAt);
  });
});

describe("AnysearchConfig store (PrismaStore)", () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  test("get returns null, upsert creates, second upsert updates in place", async () => {
    const fixture = await createTemporaryPrismaClient();
    cleanup = fixture.cleanup;
    const store = new PrismaStore(fixture.prisma);

    await expect(store.getAnysearchConfig()).resolves.toBeNull();

    const saved = await store.upsertAnysearchConfig(
      {
        mcpUrl: "https://anysearch.example/mcp",
        encryptedApiKey: "enc",
        apiKeyLast4: "1234",
      },
      createdAt,
    );
    expect(saved).toMatchObject({
      id: "default",
      mcpUrl: "https://anysearch.example/mcp",
      encryptedApiKey: "enc",
      apiKeyLast4: "1234",
    });
    expect(saved.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(saved.updatedAt.toISOString()).toBe(createdAt.toISOString());

    const updated = await store.upsertAnysearchConfig(
      {
        mcpUrl: "https://new.example/mcp",
        encryptedApiKey: "enc-new",
        apiKeyLast4: "new0",
      },
      updatedAt,
    );
    expect(updated).toMatchObject({
      id: "default",
      mcpUrl: "https://new.example/mcp",
      encryptedApiKey: "enc-new",
      apiKeyLast4: "new0",
    });
    expect(updated.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(updated.updatedAt.toISOString()).toBe(updatedAt.toISOString());

    await expect(store.getAnysearchConfig()).resolves.toMatchObject({
      mcpUrl: "https://new.example/mcp",
      apiKeyLast4: "new0",
    });
  });
});
