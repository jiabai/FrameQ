import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterEach, describe, expect, test } from "vitest";
import { createServerLifecycle } from "../src/bootstrap.js";
import { createPrismaClient } from "../src/database.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const tempDirectories: string[] = [];
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function readiness(events: string[], failInitialize = false) {
  return {
    async initialize() {
      events.push("readiness.initialize");
      if (failInitialize) {
        throw new Error("SQLITE_SCHEMA private-startup-marker");
      }
    },
    beginShutdown() {
      events.push("readiness.draining");
    },
  };
}

describe("server lifecycle", () => {
  test("orders startup and idempotent graceful shutdown exactly once", async () => {
    const events: string[] = [];
    const app = {
      async listen() {
        events.push("app.listen");
      },
      async close() {
        events.push("app.close");
      },
    };
    const lifecycle = createServerLifecycle({
      app,
      readiness: readiness(events),
      listen: { host: "127.0.0.1", port: 0 },
      disconnect: async () => {
        events.push("database.disconnect");
      },
      shutdownDeadlineMs: 100,
    });

    await lifecycle.start();
    const [first, second] = await Promise.all([
      lifecycle.shutdown("SIGTERM"),
      lifecycle.shutdown("SIGINT"),
    ]);

    expect(first).toEqual({ exitCode: 0, timedOut: false });
    expect(second).toEqual(first);
    expect(events).toEqual([
      "readiness.initialize",
      "app.listen",
      "readiness.draining",
      "app.close",
      "database.disconnect",
    ]);
  });

  test("startup failure closes every resource already opened without exposing the cause", async () => {
    const events: string[] = [];
    const logRecords: unknown[] = [];
    const lifecycle = createServerLifecycle({
      app: {
        async listen() {
          events.push("app.listen");
        },
        async close() {
          events.push("app.close");
        },
      },
      readiness: readiness(events, true),
      listen: { host: "127.0.0.1", port: 0 },
      disconnect: async () => {
        events.push("database.disconnect");
      },
      shutdownDeadlineMs: 100,
      logger: {
        info: (fields) => logRecords.push(fields),
        error: (fields) => logRecords.push(fields),
      },
    });

    await expect(lifecycle.start()).rejects.toThrow("SERVER_STARTUP_FAILED");
    expect(events).toEqual([
      "readiness.initialize",
      "readiness.draining",
      "app.close",
      "database.disconnect",
    ]);
    expect(JSON.stringify(logRecords)).not.toContain("private-startup-marker");
    expect(logRecords).toContainEqual(
      expect.objectContaining({ error_code: "SERVER_STARTUP_FAILED" }),
    );
  });

  test("shutdown deadline emits one safe timeout code", async () => {
    const records: unknown[] = [];
    const lifecycle = createServerLifecycle({
      app: {
        async listen() {},
        close: () => new Promise<void>(() => {}),
      },
      readiness: readiness([]),
      listen: { host: "127.0.0.1", port: 0 },
      disconnect: async () => {},
      shutdownDeadlineMs: 10,
      logger: {
        info: (fields) => records.push(fields),
        error: (fields) => records.push(fields),
      },
    });
    await lifecycle.start();

    const result = await lifecycle.shutdown("SIGTERM");

    expect(result).toEqual({ exitCode: 1, timedOut: true });
    expect(records.filter((record) => JSON.stringify(record).includes("SERVER_SHUTDOWN_TIMEOUT")))
      .toHaveLength(1);
  });

  test("two process signals share one shutdown and one exit", async () => {
    const signalSource = new EventEmitter();
    let closeCount = 0;
    const exitCodes: number[] = [];
    const lifecycle = createServerLifecycle({
      app: {
        async listen() {},
        async close() {
          closeCount += 1;
        },
      },
      readiness: readiness([]),
      listen: { host: "127.0.0.1", port: 0 },
      disconnect: async () => {},
      shutdownDeadlineMs: 100,
    });
    await lifecycle.start();
    lifecycle.installSignalHandlers({
      signalSource,
      exit: (code) => exitCodes.push(code),
    });

    signalSource.emit("SIGTERM");
    signalSource.emit("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));

    expect(closeCount).toBe(1);
    expect(exitCodes).toEqual([0]);
  });

  test("normal shutdown closes a real listening port", async () => {
    const app = Fastify({ logger: false });
    app.get("/", async () => ({ ok: true }));
    const lifecycle = createServerLifecycle({
      app,
      readiness: readiness([]),
      listen: { host: "127.0.0.1", port: 0 },
      disconnect: async () => {},
      shutdownDeadlineMs: 1000,
    });
    await lifecycle.start();
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const port = address.port;
    expect(await canListen(port)).toBe(false);

    await lifecycle.shutdown("test");

    expect(await canListen(port)).toBe(true);
  });

  test("normal shutdown releases the SQLite file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "frameq-lifecycle-"));
    tempDirectories.push(directory);
    const databasePath = join(directory, "frameq.sqlite");
    const movedPath = join(directory, "frameq-moved.sqlite");
    const prisma = await createPrismaClient(`file:${databasePath.replace(/\\/g, "/")}`);
    const lifecycle = createServerLifecycle({
      app: {
        async listen() {},
        async close() {},
      },
      readiness: readiness([]),
      listen: { host: "127.0.0.1", port: 0 },
      disconnect: () => prisma.$disconnect(),
      shutdownDeadlineMs: 1000,
    });
    await lifecycle.start();
    await lifecycle.shutdown("test");

    renameSync(databasePath, movedPath);
    expect(() => renameSync(movedPath, databasePath)).not.toThrow();
  });

  const childSignalTest = process.platform === "win32" ? test.skip : test;
  childSignalTest("a real child process drains and exits cleanly on SIGTERM", async () => {
    const tsxCli = join(serverRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const fixture = join(serverRoot, "tests", "fixtures", "lifecycle-child.ts");
    const child = spawn(process.execPath, [tsxCli, fixture], {
      cwd: serverRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      const ready = await waitForRecord(
        () => stdout,
        (record) => record.event === "fixture.ready",
        5000,
      );
      const port = Number(ready.port);
      expect(await canListen(port)).toBe(false);
      expect(child.kill("SIGTERM")).toBe(true);

      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolveExit) => {
          child.once("exit", (code, signal) => resolveExit({ code, signal }));
        },
      );

      expect(exit).toEqual({ code: 0, signal: null });
      expect(stderr).toBe("");
      const records = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: "readiness.draining" }),
          expect.objectContaining({ event: "database.disconnected" }),
          expect.objectContaining({ event: "lifecycle.server.stopped" }),
        ]),
      );
      expect(await canListen(port)).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 10_000);
});

async function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForRecord(
  output: () => string,
  predicate: (record: Record<string, unknown>) => boolean,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const line of output().split("\n").filter(Boolean)) {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (predicate(record)) {
        return record;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("child fixture did not become ready");
}
