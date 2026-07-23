import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { resolveDatabasePath, runDatabasePreflight } from "./database-preflight.mjs";

class RestoreSmokeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function runRestoreSmoke(databasePath) {
  const preflight = runDatabasePreflight({ databasePath, mode: "current", readOnly: true });
  const resolvedPath = resolveDatabasePath(databasePath);
  let database;
  try {
    database = new DatabaseSync(resolvedPath, { readOnly: true });
    database.prepare('SELECT 1 FROM "User" LIMIT 1').get();
    database.prepare('SELECT 1 FROM "Entitlement" LIMIT 1').get();
  } catch {
    throw new RestoreSmokeError("RESTORE_READ_CHECK_FAILED");
  } finally {
    database?.close();
  }
  return {
    status: "ok",
    checks: [...preflight.checks, "bounded_account_read", "bounded_entitlement_read"],
  };
}

function databaseArgument(argv) {
  if (argv.length !== 2 || argv[0] !== "--database" || !argv[1]) {
    throw new RestoreSmokeError("RESTORE_DATABASE_REQUIRED");
  }
  return argv[1];
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    const result = runRestoreSmoke(databaseArgument(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "RESTORE_SMOKE_FAILED";
    process.stderr.write(`${JSON.stringify({ status: "failed", error_code: code })}\n`);
    process.exitCode = 1;
  }
}
