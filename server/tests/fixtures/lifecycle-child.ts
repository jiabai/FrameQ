import Fastify from "fastify";
import { createServerLifecycle } from "../../src/bootstrap.js";

function write(record: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

const app = Fastify({ logger: false });
app.get("/probe", async () => ({ ok: true }));

const lifecycle = createServerLifecycle({
  app,
  readiness: {
    async initialize() {},
    beginShutdown() {
      write({ event: "readiness.draining" });
    },
  },
  listen: { host: "127.0.0.1", port: 0 },
  disconnect: async () => {
    write({ event: "database.disconnected" });
  },
  shutdownDeadlineMs: 2000,
  logger: {
    info: (fields) => write(fields),
    error: (fields) => write(fields),
  },
});

await lifecycle.start();
lifecycle.installSignalHandlers();
const address = app.server.address();
if (!address || typeof address === "string") {
  throw new Error("SERVER_STARTUP_FAILED");
}
write({ event: "fixture.ready", port: address.port });
