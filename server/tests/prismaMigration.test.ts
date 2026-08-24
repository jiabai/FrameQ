import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(serverRoot, "prisma", "schema.prisma");
const baselinePath = join(serverRoot, "prisma", "migrations", "202607220001_baseline", "migration.sql");
const prismaCliPath = join(serverRoot, "node_modules", "prisma", "build", "index.js");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function temporaryDatabase(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "frameq-prisma-migration-"));
  directories.push(directory);
  return { directory, databasePath: join(directory, "frameq.sqlite") };
}

function databaseUrl(databasePath: string): string {
  return `file:${databasePath.replace(/\\/g, "/")}`;
}

function runPrisma(databasePath: string, args: string[]): string {
  return execFileSync(process.execPath, [prismaCliPath, ...args, "--schema", schemaPath], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl(databasePath) },
    stdio: "pipe",
  }).toString("utf8");
}

function applyBaseline(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(readFileSync(baselinePath, "utf8"));
  } finally {
    database.close();
  }
}

function seedBaseline(databasePath: string, input: { invalidQuota?: boolean } = {}): void {
  const database = new DatabaseSync(databasePath);
  try {
    const timestamp = Date.parse("2026-07-22T08:00:00.000Z");
    database.prepare(
      'INSERT INTO "User" ("id", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)',
    ).run("migration-user", "migration@example.com", timestamp, timestamp);
    database.prepare(
      'INSERT INTO "Entitlement" ("id", "userId", "status", "expiresAt", "llmQuotaLimit", "llmQuotaUsed", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      "migration-entitlement",
      "migration-user",
      "active",
      Date.parse("2026-08-22T08:00:00.000Z"),
      input.invalidQuota ? 0 : 3,
      input.invalidQuota ? 1 : 1,
      timestamp,
    );
    database.prepare(
      'INSERT INTO "EmailOtp" ("id", "email", "state", "codeHash", "ip", "attempts", "expiresAt", "consumedAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
    ).run(
      "legacy-otp",
      "migration@example.com",
      "migration-state",
      "legacy-code-hash",
      "203.0.113.50",
      0,
      Date.parse("2026-07-22T08:10:00.000Z"),
      timestamp,
    );
    database.prepare(
      'INSERT INTO "ActivationCode" ("id", "codeHash", "codePrefix", "status", "entitlementDays", "redeemBy", "createdAt", "redeemedAt", "redeemedByUserId") VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)',
    ).run(
      "legacy-active-code",
      "legacy-active-code-hash",
      "FQ-LEGACY",
      "active",
      31,
      Date.parse("2026-08-31T08:00:00.000Z"),
      timestamp,
    );
    database.prepare(
      'INSERT INTO "ActivationCode" ("id", "codeHash", "codePrefix", "status", "entitlementDays", "redeemBy", "createdAt", "redeemedAt", "redeemedByUserId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      "legacy-redeemed-code",
      "legacy-redeemed-code-hash",
      "FQ-USED",
      "redeemed",
      31,
      Date.parse("2026-08-15T08:00:00.000Z"),
      timestamp,
      Date.parse("2026-07-25T08:00:00.000Z"),
      "migration-user",
    );
  } finally {
    database.close();
  }
}

describe("reviewed Prisma migration chain", () => {
  test("deploys baseline and hardening migrations to a fresh database with authoritative checks", () => {
    const { databasePath } = temporaryDatabase();
    new DatabaseSync(databasePath).close();

    expect(runPrisma(databasePath, ["migrate", "deploy"])).toContain("6 migrations");
    expect(runPrisma(databasePath, ["migrate", "deploy"])).toContain("No pending migrations");
    expect(runPrisma(databasePath, ["migrate", "status"])).toContain(
      "Database schema is up to date",
    );

    const database = new DatabaseSync(databasePath);
    try {
      const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      expect(integrity.integrity_check).toBe("ok");
      const otpColumns = database.prepare('PRAGMA table_info("EmailOtp")').all() as Array<{ name: string }>;
      expect(otpColumns.map((column) => column.name)).toContain("purpose");
      const activationColumns = database.prepare('PRAGMA table_info("ActivationCode")').all() as Array<{ name: string }>;
      expect(activationColumns.map((column) => column.name)).toEqual([
        "id",
        "codeHash",
        "codePrefix",
        "status",
        "issuanceSource",
        "entitlementDays",
        "issuedToUserId",
        "redeemBy",
        "createdAt",
        "sentAt",
        "redeemedAt",
        "redeemedByUserId",
        "disabledReason",
      ]);
      const migrations = database.prepare('SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name').all();
      expect(migrations).toEqual([
        { migration_name: "202607220001_baseline" },
        { migration_name: "202607220002_auth_quota_hardening" },
        { migration_name: "202608030001_user_session" },
        { migration_name: "202608240001_self_service_email_activation" },
        { migration_name: "202608240002_auth_rate_limit_self_service_purpose" },
        { migration_name: "202608240003_self_service_active_unique" },
      ]);
      expect(() => database.prepare(
        'INSERT INTO "AuthRateLimit" ("id", "keyHash", "purpose", "scope", "windowStartedAt", "count", "nextAllowedAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run("bad-purpose", "bad-purpose-key", "draft_login", "email_hour", 0, 1, 1, 0)).toThrow();
      expect(() => database.prepare(
        'INSERT INTO "AuthRateLimit" ("id", "keyHash", "purpose", "scope", "windowStartedAt", "count", "nextAllowedAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run("good-purpose", "good-purpose-key", "self_service_activation", "email_hour", 0, 1, 1, 0)).not.toThrow();
      expect(() => database.prepare(
        'INSERT INTO "AuthRateLimit" ("id", "keyHash", "purpose", "scope", "windowStartedAt", "count", "nextAllowedAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run("bad-count", "bad-count-key", "desktop_login", "email_hour", 0, -1, 1, 0)).toThrow();
      expect(() => database.prepare(
        'INSERT INTO "ActivationCode" ("id", "codeHash", "codePrefix", "status", "issuanceSource", "entitlementDays", "issuedToUserId", "redeemBy", "createdAt", "sentAt", "redeemedAt", "redeemedByUserId", "disabledReason") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        "bad-activation-status",
        "bad-activation-status-hash",
        "FQ-BAD",
        "draft",
        "admin",
        31,
        null,
        0,
        0,
        null,
        null,
        null,
        null,
      )).toThrow();
      expect(() => database.prepare(
        'INSERT INTO "ActivationCode" ("id", "codeHash", "codePrefix", "status", "issuanceSource", "entitlementDays", "issuedToUserId", "redeemBy", "createdAt", "sentAt", "redeemedAt", "redeemedByUserId", "disabledReason") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        "bad-activation-source",
        "bad-activation-source-hash",
        "FQ-BAD",
        "active",
        "manual",
        31,
        null,
        0,
        0,
        null,
        null,
        null,
        null,
      )).toThrow();
      expect(() => database.prepare(
        'INSERT INTO "ActivationCode" ("id", "codeHash", "codePrefix", "status", "issuanceSource", "entitlementDays", "issuedToUserId", "redeemBy", "createdAt", "sentAt", "redeemedAt", "redeemedByUserId", "disabledReason") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        "bad-disabled-reason",
        "bad-disabled-reason-hash",
        "FQ-BAD",
        "disabled",
        "admin",
        31,
        null,
        0,
        0,
        null,
        null,
        null,
        "unknown_reason",
      )).toThrow();
      const activationIndexes = database.prepare('PRAGMA index_list("ActivationCode")').all() as Array<{ name: string }>;
      expect(activationIndexes.map((index) => index.name)).toEqual(
        expect.arrayContaining([
          "ActivationCode_codeHash_key",
          "ActivationCode_status_idx",
          "ActivationCode_issuedToUserId_issuanceSource_status_idx",
          "ActivationCode_self_service_active_unique",
          "ActivationCode_redeemedByUserId_idx",
        ]),
      );
    } finally {
      database.close();
    }
  }, 30_000);

  test("upgrades a verified baseline, invalidates legacy OTPs, backfills activation issuance, preserves billing data, and supports restore", () => {
    const { directory, databasePath } = temporaryDatabase();
    const backupPath = join(directory, "pre-hardening.sqlite");
    applyBaseline(databasePath);
    seedBaseline(databasePath);
    copyFileSync(databasePath, backupPath);
    runPrisma(databasePath, ["migrate", "resolve", "--applied", "202607220001_baseline"]);

    expect(runPrisma(databasePath, ["migrate", "deploy"])).toContain("202607220002_auth_quota_hardening");
    const hardened = new DatabaseSync(databasePath);
    try {
      expect(hardened.prepare('SELECT COUNT(*) AS count FROM "EmailOtp"').get()).toEqual({ count: 0 });
      expect(hardened.prepare(
        'SELECT "llmQuotaLimit", "llmQuotaUsed" FROM "Entitlement" WHERE "id" = ?',
      ).get("migration-entitlement")).toEqual({ llmQuotaLimit: 3, llmQuotaUsed: 1 });
      expect(hardened.prepare(
        'SELECT "status", "issuanceSource", "issuedToUserId", "sentAt", "disabledReason", "redeemedByUserId" FROM "ActivationCode" ORDER BY "id"',
      ).all()).toEqual([
        {
          status: "active",
          issuanceSource: "admin",
          issuedToUserId: null,
          sentAt: null,
          disabledReason: null,
          redeemedByUserId: null,
        },
        {
          status: "redeemed",
          issuanceSource: "admin",
          issuedToUserId: null,
          sentAt: null,
          disabledReason: null,
          redeemedByUserId: "migration-user",
        },
      ]);
      expect(hardened.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      hardened.close();
    }

    copyFileSync(backupPath, databasePath);
    const restored = new DatabaseSync(databasePath);
    try {
      const columns = restored.prepare('PRAGMA table_info("EmailOtp")').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).not.toContain("purpose");
      expect(restored.prepare('SELECT COUNT(*) AS count FROM "EmailOtp"').get()).toEqual({ count: 1 });
      expect(restored.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      restored.close();
    }
  }, 30_000);

  test("rejects invalid historical quota instead of clamping accounting state", () => {
    const { databasePath } = temporaryDatabase();
    applyBaseline(databasePath);
    seedBaseline(databasePath, { invalidQuota: true });
    runPrisma(databasePath, ["migrate", "resolve", "--applied", "202607220001_baseline"]);

    expect(() => runPrisma(databasePath, ["migrate", "deploy"])).toThrow();
    const database = new DatabaseSync(databasePath);
    try {
      // Prisma CLI can exit with a transient SQLite WAL lock after a failed
      // migration; wait for it to clear instead of failing with SQLITE_BUSY.
      database.exec("PRAGMA busy_timeout=5000");
      expect(database.prepare(
        'SELECT "llmQuotaLimit", "llmQuotaUsed" FROM "Entitlement" WHERE "id" = ?',
      ).get("migration-entitlement")).toEqual({ llmQuotaLimit: 0, llmQuotaUsed: 1 });
      const columns = database.prepare('PRAGMA table_info("EmailOtp")').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).not.toContain("purpose");
    } finally {
      database.close();
    }
  }, 30_000);
});
