import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

export function resolveDatabaseUrl(): string {
  return resolveDatabaseUrlFrom(process.env.DATABASE_URL);
}

export function resolveDatabaseUrlFrom(configured: string | undefined): string {
  if (configured && configured.trim()) {
    return configured.trim();
  }
  const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sqlitePath = resolve(serverRoot, "data", "frameq.sqlite").replace(/\\/g, "/");
  return `file:${sqlitePath}`;
}

export async function createPrismaClient(databaseUrl = resolveDatabaseUrl()): Promise<PrismaClient> {
  if (databaseUrl === resolveDatabaseUrlFrom(undefined)) {
    const sqlitePath = databaseUrl.slice("file:".length);
    mkdirSync(dirname(sqlitePath), { recursive: true });
  }
  process.env.DATABASE_URL = databaseUrl;
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000");
    return prisma;
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}

export function createDatabaseReadinessChecks(prisma: PrismaClient) {
  return {
    verifySchema: async () => {
      await prisma.$queryRawUnsafe(
        'SELECT "purpose", "email", "state" FROM "EmailOtp" LIMIT 0',
      );
      await prisma.$queryRawUnsafe(
        'SELECT "purpose", "scope", "keyHash" FROM "AuthRateLimit" LIMIT 0',
      );
      await prisma.$queryRawUnsafe(
        'SELECT "llmQuotaLimit", "llmQuotaUsed" FROM "Entitlement" LIMIT 0',
      );
      await prisma.$queryRawUnsafe(
        'SELECT "requestId" FROM "LlmUsageEvent" LIMIT 0',
      );
    },
    ping: async () => {
      await prisma.$queryRawUnsafe("SELECT 1");
    },
  };
}
