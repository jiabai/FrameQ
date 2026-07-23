import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { createDatabaseReadinessChecks, createPrismaClient } from "../src/database.js";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(serverRoot, "..");
const schemaPath = join(serverRoot, "prisma", "schema.prisma");
const prismaCliPath = join(serverRoot, "node_modules", "prisma", "build", "index.js");
const preflightPath = join(serverRoot, "scripts", "database-preflight.mjs");
const restoreSmokePath = join(serverRoot, "scripts", "restore-smoke.mjs");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function temporaryDatabase(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "frameq-deployment-contract-"));
  directories.push(directory);
  return { directory, databasePath: join(directory, "frameq.sqlite") };
}

function databaseUrl(databasePath: string): string {
  return `file:${databasePath.replace(/\\/g, "/")}`;
}

function migrate(databasePath: string): void {
  new DatabaseSync(databasePath).close();
  execFileSync(process.execPath, [prismaCliPath, "migrate", "deploy", "--schema", schemaPath], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl(databasePath) },
    stdio: "pipe",
  });
}

describe("production deployment contracts", () => {
  test("package scripts use reviewed migrations and operational checks, never schema push", () => {
    const packageJson = JSON.parse(readFileSync(join(serverRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts).not.toHaveProperty("db:push");
    expect(packageJson.scripts["db:migrate:deploy"]).toContain("prisma migrate deploy");
    expect(packageJson.scripts["db:migrate:status"]).toContain("prisma migrate status");
    expect(packageJson.scripts["db:preflight"]).toContain("database-preflight.mjs");
    expect(packageJson.scripts["db:restore-smoke"]).toContain("restore-smoke.mjs");
  });

  test("preflight and restore smoke validate a migrated disposable database without leaking data", () => {
    const { directory, databasePath } = temporaryDatabase();
    const restoredPath = join(directory, "restored.sqlite");
    migrate(databasePath);
    const database = new DatabaseSync(databasePath);
    try {
      const timestamp = Date.parse("2026-07-23T00:00:00.000Z");
      database
        .prepare('INSERT INTO "User" ("id", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)')
        .run("private-user-id", "private-user@example.com", timestamp, timestamp);
    } finally {
      database.close();
    }
    copyFileSync(databasePath, restoredPath);

    const preflight = spawnSync(
      process.execPath,
      [preflightPath, "--database", databasePath, "--mode", "current"],
      { cwd: serverRoot, encoding: "utf8" },
    );
    expect(preflight.status, preflight.stderr).toBe(0);
    expect(preflight.stdout).toContain('"status":"ok"');

    const restore = spawnSync(
      process.execPath,
      [restoreSmokePath, "--database", restoredPath],
      { cwd: serverRoot, encoding: "utf8" },
    );
    expect(restore.status, restore.stderr).toBe(0);
    expect(restore.stdout).toContain('"status":"ok"');

    const output = `${preflight.stdout}${preflight.stderr}${restore.stdout}${restore.stderr}`;
    expect(output).not.toContain("private-user-id");
    expect(output).not.toContain("private-user@example.com");
    expect(output).not.toContain(databasePath);
    expect(output).not.toContain(restoredPath);
  }, 30_000);

  test("runtime readiness accepts the reviewed migrated schema", async () => {
    const { databasePath } = temporaryDatabase();
    migrate(databasePath);
    const prisma = await createPrismaClient(databaseUrl(databasePath));
    try {
      const checks = createDatabaseReadinessChecks(prisma);
      await expect(checks.verifySchema()).resolves.toBeUndefined();
      await expect(checks.ping()).resolves.toBeUndefined();
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  test("preflight rejects invalid historical quota with a fixed non-row error", () => {
    const { databasePath } = temporaryDatabase();
    const baselineSql = readFileSync(
      join(serverRoot, "prisma", "migrations", "202607220001_baseline", "migration.sql"),
      "utf8",
    );
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(baselineSql);
      const timestamp = Date.parse("2026-07-23T00:00:00.000Z");
      database
        .prepare('INSERT INTO "User" ("id", "email", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)')
        .run("invalid-private-user", "invalid-private@example.com", timestamp, timestamp);
      database
        .prepare(
          'INSERT INTO "Entitlement" ("id", "userId", "status", "expiresAt", "llmQuotaLimit", "llmQuotaUsed", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run("invalid-entitlement", "invalid-private-user", "active", timestamp, 0, 1, timestamp);
    } finally {
      database.close();
    }

    const result = spawnSync(
      process.execPath,
      [preflightPath, "--database", databasePath, "--mode", "baseline"],
      { cwd: serverRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("INVALID_QUOTA_STATE");
    expect(`${result.stdout}${result.stderr}`).not.toContain("invalid-private-user");
    expect(`${result.stdout}${result.stderr}`).not.toContain("invalid-private@example.com");
    expect(`${result.stdout}${result.stderr}`).not.toContain(databasePath);
  });

  test("deployment assets expose exact health paths and align shutdown deadlines", () => {
    const nginx = readFileSync(join(repositoryRoot, "deploy", "nginx", "frameq-server.conf"), "utf8");
    const systemd = readFileSync(
      join(repositoryRoot, "deploy", "systemd", "frameq-server.service"),
      "utf8",
    );
    const runbook = readFileSync(join(repositoryRoot, "deploy", "server-deployment.md"), "utf8");

    expect(nginx).toContain("location = /health/live");
    expect(nginx).toContain("location = /health/ready");
    expect(nginx).not.toMatch(/location\s+\^~\s+\/health/);
    expect(systemd).toContain("KillSignal=SIGTERM");
    expect(systemd).toContain("TimeoutStopSec=20");
    expect(systemd).toContain("ExecStartPre=/opt/frameq/FrameQ/server/node_modules/.bin/prisma migrate status");
    expect(runbook).not.toContain("db:push");
    for (const phrase of [
      "prisma migrate deploy",
      "database preflight",
      "stop the service",
      "SHA-256",
      "off-host",
      "restore",
      "PRAGMA integrity_check",
      "matched code, database, and configuration",
    ]) {
      expect(runbook).toContain(phrase);
    }
  });

  test("server CI runs the complete secret-free migration and restore gate on Node 22", () => {
    const workflow = readFileSync(
      join(repositoryRoot, ".github", "workflows", "server-ci.yml"),
      "utf8",
    );
    for (const expected of [
      "server/**",
      "deploy/**",
      "node-version: 22",
      "npm ci",
      "npm run prisma:generate",
      "npm run db:migrate:deploy",
      "npm run db:migrate:status",
      "npm run db:preflight",
      "npm run db:restore-smoke",
      "npm test",
      "npm run build",
    ]) {
      expect(workflow).toContain(expected);
    }
    expect(workflow).not.toMatch(/SMTP_PASS|WECHAT_MCH_PRIVATE_KEY|FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY/);
  });
});
