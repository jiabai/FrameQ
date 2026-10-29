import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import { PrismaStore } from "../src/prismaStore.js";
import {
  RateLimitExceededError,
  reserveEmailDispatchRateLimits as reservePrisma,
} from "../src/prismaStore/rateLimits.js";
import type { AuthRateLimitRecord, AuthRateLimitScope } from "../src/store/contracts.js";
import { reserveEmailDispatchRateLimits as reserveMemory } from "../src/store/memory/rateLimits.js";
import { emailDispatchRateLimitReservations } from "../src/store/rateLimitPolicy.js";
import { createTemporaryPrismaClient } from "./prismaTestHarness.js";

type DispatchInput = Parameters<typeof emailDispatchRateLimitReservations>[0];
const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

function existingCounters(
  input: DispatchInput,
  blocked: readonly AuthRateLimitScope[],
): AuthRateLimitRecord[] {
  return emailDispatchRateLimitReservations(input).map((reservation) => {
    const isBlocked = blocked.includes(reservation.scope);
    const windowStartedAt = reservation.scope === "email_minute"
      ? new Date(input.now.getTime() - (isBlocked ? 1_000 : 60_000))
      : reservation.windowStart;
    return {
      id: randomUUID(),
      keyHash: reservation.key,
      purpose: reservation.purpose,
      scope: reservation.scope,
      windowStartedAt,
      count: reservation.scope === "email_minute" ? 1 : reservation.limit - (isBlocked ? 0 : 1),
      nextAllowedAt: new Date(windowStartedAt.getTime() + reservation.windowSeconds * 1_000),
      updatedAt: windowStartedAt,
    };
  });
}

async function reserveDatabase(
  prisma: PrismaClient,
  input: DispatchInput,
): Promise<ReturnType<typeof reserveMemory>> {
  try {
    await prisma.$transaction((tx) =>
      reservePrisma(tx, emailDispatchRateLimitReservations(input), input.now),
    );
    return { status: "reserved" };
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return { status: "rate_limited", retryAt: error.retryAt };
    }
    throw error;
  }
}

const windowCases: Array<{
  label: string;
  blocked: AuthRateLimitScope[];
  retryAt: string | null;
  nowAt?: string;
}> = [
  { label: "last available slots", blocked: [], retryAt: null },
  { label: "email minute", blocked: ["email_minute"], retryAt: "2026-10-29T08:05:09.000Z" },
  { label: "email hour", blocked: ["email_hour"], retryAt: "2026-10-29T09:00:00.000Z" },
  { label: "IP hour", blocked: ["ip_hour"], retryAt: "2026-10-29T09:00:00.000Z" },
  { label: "minute and email hour", blocked: ["email_minute", "email_hour"], retryAt: "2026-10-29T09:00:00.000Z" },
  { label: "minute and IP hour", blocked: ["email_minute", "ip_hour"], retryAt: "2026-10-29T09:00:00.000Z" },
  { label: "both hourly windows", blocked: ["email_hour", "ip_hour"], retryAt: "2026-10-29T09:00:00.000Z" },
  { label: "all windows", blocked: ["email_minute", "email_hour", "ip_hour"], retryAt: "2026-10-29T09:00:00.000Z" },
  {
    label: "minute window ending after the hour",
    blocked: ["email_minute", "email_hour", "ip_hour"],
    nowAt: "2026-10-29T08:59:30.000Z",
    retryAt: "2026-10-29T09:00:29.000Z",
  },
];

describe.each(["desktop_login", "admin_login", "self_service_activation"] as const)(
  "%s dispatch retry time",
  (purpose) => {
    test.each(windowCases)("matches Memory for $label and preserves rejected counters", async ({
      blocked, retryAt, nowAt,
    }) => {
      const fixture = await createTemporaryPrismaClient();
      fixtures.push(fixture);
      const input: DispatchInput = {
        purpose,
        normalizedEmail: "retry@example.com",
        ip: "203.0.113.100",
        now: new Date(nowAt ?? "2026-10-29T08:04:10.000Z"),
      };
      const records = existingCounters(input, blocked);
      await fixture.prisma.authRateLimit.createMany({ data: records });
      const memory = { authRateLimits: structuredClone(records) };
      const before = await fixture.prisma.authRateLimit.findMany({ orderBy: { keyHash: "asc" } });
      const reserveBoth = async (at: Date) => {
        const current = { ...input, now: at };
        const memoryResult = reserveMemory(memory, emailDispatchRateLimitReservations(current), at);
        const databaseResult = await reserveDatabase(fixture.prisma, current);
        expect(databaseResult).toEqual(memoryResult);
        return databaseResult;
      };
      const expected = retryAt === null
        ? { status: "reserved" }
        : { status: "rate_limited", retryAt: new Date(retryAt) };

      expect(await reserveBoth(input.now)).toEqual(expected);
      if (retryAt !== null) {
        expect(await fixture.prisma.authRateLimit.findMany({ orderBy: { keyHash: "asc" } })).toEqual(before);
        expect(await reserveBoth(new Date(new Date(retryAt).getTime() - 1))).toEqual(expected);
        expect(await fixture.prisma.authRateLimit.findMany({ orderBy: { keyHash: "asc" } })).toEqual(before);
        expect(await reserveBoth(new Date(retryAt))).toEqual({ status: "reserved" });
      }
      expect(await fixture.prisma.authRateLimit.findMany({ orderBy: { keyHash: "asc" } })).toEqual(
        [...memory.authRateLimits].sort((left, right) => left.keyHash.localeCompare(right.keyHash)),
      );
    });
  },
);

test("independent Prisma clients reserve the last slots once and report every remaining blocker", async () => {
  const fixture = await createTemporaryPrismaClient();
  fixtures.push(fixture);
  const secondClient = await fixture.createClient();
  const input: DispatchInput = {
    purpose: "desktop_login",
    normalizedEmail: "retry@example.com",
    ip: "203.0.113.100",
    now: new Date("2026-10-29T08:04:10.000Z"),
  };
  await fixture.prisma.authRateLimit.createMany({ data: existingCounters(input, []) });
  const request = {
    purpose: "desktop_login" as const,
    email: input.normalizedEmail,
    ip: input.ip,
    state: "last-slot-state",
    codeHash: "last-slot-code-hash",
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + 600_000),
  };
  const results = await Promise.all([
    new PrismaStore(fixture.prisma).issueEmailOtp(request),
    new PrismaStore(secondClient).issueEmailOtp({ ...request, codeHash: "second-code-hash" }),
  ]);

  expect(results.filter((result) => result.status === "issued")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rate_limited")).toEqual([
    { status: "rate_limited", retryAt: new Date("2026-10-29T09:00:00.000Z") },
  ]);
  expect(await fixture.prisma.emailOtp.count()).toBe(1);
  expect(await fixture.prisma.authRateLimit.findMany({
    orderBy: { scope: "asc" },
    select: { scope: true, count: true },
  })).toEqual([
    { scope: "email_hour", count: 5 },
    { scope: "email_minute", count: 1 },
    { scope: "ip_hour", count: 20 },
  ]);
});
