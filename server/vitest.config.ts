import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    // Prisma temporary SQLite fixtures may take longer than Vitest's 5s default
    // when multiple worker processes initialize migrations concurrently on Windows.
    testTimeout: 15_000,
  },
});
