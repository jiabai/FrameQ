import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LlmConfigService } from "../llmConfig.js";
import type { Store } from "../store.js";
import { authenticateDesktop, llmQuotaRemaining } from "./shared.js";

const llmCheckoutSchema = z.object({
  request_id: z
    .string()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9._~-]+$/),
});

type DesktopLlmRouteDependencies = {
  store: Store;
  llmConfig: LlmConfigService;
  now: () => Date;
};

export function registerDesktopLlmRoutes(
  app: FastifyInstance,
  dependencies: DesktopLlmRouteDependencies,
): void {
  app.post("/api/desktop/llm/checkouts", async (request, reply) => {
    const session = await authenticateDesktop(
      dependencies.store,
      request.headers.authorization,
      dependencies.now(),
    );
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const parsed = llmCheckoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    const config = await dependencies.llmConfig.getDesktopConfig();
    if (!config) {
      return reply.code(400).send({ error: "LLM_CONFIG_MISSING" });
    }
    let consumed: Awaited<ReturnType<Store["consumeLlmQuota"]>>;
    try {
      consumed = await dependencies.store.consumeLlmQuota(
        session.userId,
        parsed.data.request_id,
        dependencies.now(),
      );
    } catch {
      return reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
    }
    if (consumed.status === "temporarily_unavailable") {
      return reply.code(503).send({ error: "SERVER_TEMPORARILY_UNAVAILABLE" });
    }
    if (consumed.status === "unavailable") {
      return reply.code(403).send({ error: "LLM_QUOTA_UNAVAILABLE" });
    }
    const remaining = llmQuotaRemaining(consumed.entitlement, dependencies.now());
    return {
      provider: config.provider,
      base_url: config.baseUrl,
      model: config.model,
      api_key: config.apiKey,
      timeout_seconds: config.timeoutSeconds,
      quota_remaining: remaining,
    };
  });
}
