import { describe, expect, test } from "vitest";
import { ReadinessController } from "../src/readiness.js";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

function buildHealthServer(readiness: ReadinessController) {
  return buildServer({
    store: new MemoryStore(),
    sendOtp: async () => {
      throw new Error("health must not call SMTP");
    },
    createNativePayment: async () => {
      throw new Error("health must not call payment providers");
    },
    readiness,
  });
}

describe("health endpoints", () => {
  test("liveness is fixed and independent of readiness", async () => {
    const readiness = new ReadinessController({
      verifySchema: async () => {
        throw new Error("schema unavailable");
      },
      ping: async () => {
        throw new Error("database unavailable");
      },
      timeoutMs: 20,
    });
    const app = buildHealthServer(readiness);

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "live" });
    await app.close();
  });

  test("readiness transitions through startup, serving, and draining", async () => {
    let schemaChecks = 0;
    let pings = 0;
    const readiness = new ReadinessController({
      verifySchema: async () => {
        schemaChecks += 1;
      },
      ping: async () => {
        pings += 1;
      },
      timeoutMs: 20,
    });
    const app = buildHealthServer(readiness);

    const starting = await app.inject({ method: "GET", url: "/health/ready" });
    expect(starting.statusCode).toBe(503);
    expect(starting.json()).toEqual({ status: "not_ready" });

    await readiness.initialize();
    const serving = await app.inject({ method: "GET", url: "/health/ready" });
    expect(serving.statusCode).toBe(200);
    expect(serving.json()).toEqual({ status: "ready" });

    readiness.beginShutdown();
    const draining = await app.inject({ method: "GET", url: "/health/ready" });
    expect(draining.statusCode).toBe(503);
    expect(draining.json()).toEqual({ status: "not_ready" });
    expect(schemaChecks).toBe(1);
    expect(pings).toBe(2);
    await app.close();
  });

  test("database failure and timeout return the same non-secret readiness response", async () => {
    const failures = [
      async () => {
        throw new Error("SQLITE_BUSY private-path-marker");
      },
      () => new Promise<void>(() => {}),
    ];

    for (const failingPing of failures) {
      let pingCount = 0;
      const readiness = new ReadinessController({
        verifySchema: async () => {},
        ping: async () => {
          pingCount += 1;
          if (pingCount > 1) {
            await failingPing();
          }
        },
        timeoutMs: 10,
      });
      await readiness.initialize();
      const app = buildHealthServer(readiness);
      const response = await app.inject({ method: "GET", url: "/health/ready" });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "not_ready" });
      expect(response.body).not.toContain("SQLITE_BUSY");
      expect(response.body).not.toContain("private-path-marker");
      await app.close();
    }
  });
});
