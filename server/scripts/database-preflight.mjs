import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const requiredMigrations = [
  "202607220001_baseline",
  "202607220002_auth_quota_hardening",
];
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prismaRoot = join(serverRoot, "prisma");

class OperationalCheckError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function resolveDatabasePath(input) {
  const raw = input?.trim();
  if (!raw) {
    throw new OperationalCheckError("DATABASE_LOCATION_REQUIRED");
  }
  const isPrismaUrl = raw.startsWith("file:");
  const pathValue = isPrismaUrl ? raw.slice("file:".length).split("?", 1)[0] : raw;
  if (!pathValue || pathValue.startsWith("//") || pathValue.startsWith("\\\\")) {
    throw new OperationalCheckError("UNSUPPORTED_DATABASE_LOCATION");
  }
  return isAbsolute(pathValue)
    ? pathValue
    : resolve(isPrismaUrl ? prismaRoot : process.cwd(), pathValue);
}

export function runDatabasePreflight({ databasePath, mode = "current", readOnly = false }) {
  if (mode !== "baseline" && mode !== "current") {
    throw new OperationalCheckError("INVALID_PREFLIGHT_MODE");
  }
  const resolvedPath = resolveDatabasePath(databasePath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new OperationalCheckError("DATABASE_FILE_NOT_FOUND");
  }

  let database;
  try {
    database = new DatabaseSync(resolvedPath, { readOnly });
  } catch {
    throw new OperationalCheckError("DATABASE_OPEN_FAILED");
  }

  const checks = [];
  let exclusiveTransaction = false;
  try {
    if (!readOnly) {
      database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      checks.push("wal_checkpoint");
      database.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;");
      exclusiveTransaction = true;
      checks.push("exclusive_access");
    }

    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") {
      throw new OperationalCheckError("DATABASE_INTEGRITY_FAILED");
    }
    checks.push("integrity");

    const foreignKeyViolation = database.prepare("PRAGMA foreign_key_check").get();
    if (foreignKeyViolation) {
      throw new OperationalCheckError("FOREIGN_KEY_CHECK_FAILED");
    }
    checks.push("foreign_keys");

    requireColumns(database, "Entitlement", [
      "id",
      "userId",
      "llmQuotaLimit",
      "llmQuotaUsed",
    ]);
    const invalidQuota = database
      .prepare(
        'SELECT COUNT(*) AS "count" FROM "Entitlement" WHERE "llmQuotaLimit" < 0 OR "llmQuotaUsed" < 0 OR "llmQuotaUsed" > "llmQuotaLimit"',
      )
      .get();
    if (Number(invalidQuota?.count ?? 0) !== 0) {
      throw new OperationalCheckError("INVALID_QUOTA_STATE");
    }
    checks.push("quota_invariants");

    if (mode === "baseline") {
      requireColumns(database, "EmailOtp", ["id", "email", "state", "attempts"]);
      if (tableColumns(database, "EmailOtp").has("purpose")) {
        throw new OperationalCheckError("UNEXPECTED_BASELINE_SCHEMA");
      }
      checks.push("baseline_schema");
    } else {
      requireColumns(database, "EmailOtp", ["id", "purpose", "email", "state", "attempts"]);
      requireColumns(database, "AuthRateLimit", [
        "id",
        "keyHash",
        "purpose",
        "scope",
        "count",
      ]);
      requireColumns(database, "LlmUsageEvent", ["id", "userId", "requestId"]);
      verifyMigrationHistory(database);
      checks.push("current_schema", "migration_history");
    }

    if (exclusiveTransaction) {
      database.exec("ROLLBACK;");
      exclusiveTransaction = false;
    }
    return { status: "ok", mode, checks };
  } catch (error) {
    if (exclusiveTransaction) {
      try {
        database.exec("ROLLBACK;");
      } catch {
        // The public result remains the original fixed operational code.
      }
    }
    if (error instanceof OperationalCheckError) {
      throw error;
    }
    throw new OperationalCheckError("DATABASE_PREFLIGHT_FAILED");
  } finally {
    database.close();
  }
}

function requireColumns(database, table, requiredColumns) {
  const columns = tableColumns(database, table);
  if (requiredColumns.some((column) => !columns.has(column))) {
    throw new OperationalCheckError("DATABASE_SCHEMA_INCOMPATIBLE");
  }
}

function tableColumns(database, table) {
  const allowedTables = new Set(["Entitlement", "EmailOtp", "AuthRateLimit", "LlmUsageEvent"]);
  if (!allowedTables.has(table)) {
    throw new OperationalCheckError("DATABASE_SCHEMA_INCOMPATIBLE");
  }
  try {
    return new Set(database.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name));
  } catch {
    throw new OperationalCheckError("DATABASE_SCHEMA_INCOMPATIBLE");
  }
}

function verifyMigrationHistory(database) {
  let migrations;
  try {
    migrations = database
      .prepare(
        'SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations"',
      )
      .all();
  } catch {
    throw new OperationalCheckError("MIGRATION_HISTORY_INCOMPATIBLE");
  }
  const applied = new Set(
    migrations
      .filter((migration) => migration.finished_at && !migration.rolled_back_at)
      .map((migration) => migration.migration_name),
  );
  if (requiredMigrations.some((migration) => !applied.has(migration))) {
    throw new OperationalCheckError("MIGRATION_HISTORY_INCOMPATIBLE");
  }
}

function parseArguments(argv) {
  const options = { databasePath: process.env.DATABASE_URL, mode: "current" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") {
      options.databasePath = argv[++index];
    } else if (argument === "--mode") {
      options.mode = argv[++index];
    } else {
      throw new OperationalCheckError("INVALID_PREFLIGHT_ARGUMENT");
    }
  }
  return options;
}

function printFailure(error) {
  const code = error instanceof OperationalCheckError ? error.code : "DATABASE_PREFLIGHT_FAILED";
  process.stderr.write(`${JSON.stringify({ status: "failed", error_code: code })}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    const result = runDatabasePreflight(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    printFailure(error);
    process.exitCode = 1;
  }
}
