import { afterEach, describe, expect, test } from "vitest";
import { PrismaStore } from "../src/prismaStore.js";
import { MemoryStore, type Store } from "../src/store.js";
import { createTemporaryPrismaClient } from "./prismaTestHarness.js";

const createdAt = new Date("2026-10-29T08:00:00.000Z");
const expiresAt = new Date("2026-10-30T08:00:00.000Z");
const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe.each(["Memory", "Prisma"] as const)("%s entitlement expiry", (backend) => {
  test.each([
    { label: "one millisecond before expiry", offset: -1, status: "consumed" },
    { label: "exactly at expiry", offset: 0, status: "unavailable" },
    { label: "one millisecond after expiry", offset: 1, status: "unavailable" },
  ])("uses expiry alone $label", async ({ offset, status }) => {
    let store: Store = new MemoryStore();
    if (backend === "Prisma") {
      const fixture = await createTemporaryPrismaClient();
      fixtures.push(fixture);
      store = new PrismaStore(fixture.prisma);
    }
    const user = await store.upsertUserByEmail("expiry@example.com", createdAt);
    const entitlement = await store.upsertEntitlement(user.id, expiresAt, createdAt, {
      llmQuotaLimit: 3,
      llmQuotaUsed: 0,
    });
    await store.upsertEntitlement(user.id, expiresAt, createdAt);
    const result = await store.consumeLlmQuota(
      user.id,
      "expiry-request",
      new Date(expiresAt.getTime() + offset),
    );

    expect(result.status).toBe(status);
    const saved = await store.getEntitlement(user.id);
    expect(saved).toMatchObject({
      id: entitlement.id,
      userId: user.id,
      expiresAt,
      llmQuotaLimit: 3,
      llmQuotaUsed: status === "consumed" ? 1 : 0,
    });
    expect(entitlement).not.toHaveProperty("status");
    expect(saved).not.toHaveProperty("status");
  });
});
