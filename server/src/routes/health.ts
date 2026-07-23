import type { FastifyInstance } from "fastify";
import type { ReadinessController } from "../readiness.js";

export function registerHealthRoutes(
  app: FastifyInstance,
  readiness: ReadinessController,
): void {
  app.get("/health/live", async () => ({ status: "live" }));

  app.get("/health/ready", async (_request, reply) => {
    if (await readiness.isReady()) {
      return { status: "ready" };
    }
    return reply.code(503).send({ status: "not_ready" });
  });
}
