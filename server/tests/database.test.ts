import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createPrismaClient } from "../src/database.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // A failed Prisma startup can leave SQLite handles alive on Windows.
    }
    tempDir = null;
  }
});

describe("SQLite database startup", () => {
  test("initializes WAL pragmas without execute-returned-results errors", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "app-sqlite-"));
    const databasePath = join(tempDir, "app.sqlite").replace(/\\/g, "/");
    process.env.DATABASE_URL = `file:${databasePath}`;

    const prisma = await createPrismaClient();
    try {
      const journalMode = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>(
        "PRAGMA journal_mode",
      );

      expect(journalMode[0]?.journal_mode.toLowerCase()).toBe("wal");
    } finally {
      await prisma.$disconnect();
    }
  });
});
