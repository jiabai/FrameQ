import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ActivationCodeService } from "../activation.js";
import type { LlmConfigService } from "../llmConfig.js";
import type { EntitlementRecord, SessionRecord, Store } from "../store.js";
import { authenticateDesktop, llmQuotaRemaining, publicError } from "./shared.js";

const activationRedeemSchema = z.object({
  code: z.string().min(8).max(64),
});

type DesktopAccountRouteDependencies = {
  store: Store;
  activationCodes: ActivationCodeService;
  llmConfig: LlmConfigService;
  now: () => Date;
};

export function registerDesktopAccountRoutes(
  app: FastifyInstance,
  dependencies: DesktopAccountRouteDependencies,
): void {
  app.get("/api/desktop/account", async (request, reply) => {
    const session = await authenticateDesktop(
      dependencies.store,
      request.headers.authorization,
      dependencies.now(),
    );
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const user = await dependencies.store.getUserById(session.userId);
    const entitlement = await dependencies.store.getEntitlement(session.userId);
    return accountStatusPayload({
      email: user?.email ?? "",
      entitlement,
      llmConfigured: await dependencies.llmConfig.isConfigured(),
      now: dependencies.now(),
    });
  });

  app.post("/api/desktop/activation-codes/redeem", async (request, reply) => {
    const session = await authenticateDesktop(
      dependencies.store,
      request.headers.authorization,
      dependencies.now(),
    );
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const parsed = activationRedeemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      await dependencies.activationCodes.redeemCode({
        sessionTokenHash: session.tokenHash,
        code: parsed.data.code,
      });
      return accountStatusResponse(
        dependencies.store,
        dependencies.llmConfig,
        session,
        dependencies.now(),
      );
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });
}

async function accountStatusResponse(
  store: Store,
  llmConfig: LlmConfigService,
  session: SessionRecord,
  now: Date,
) {
  const user = await store.getUserById(session.userId);
  const entitlement = await store.getEntitlement(session.userId);
  return accountStatusPayload({
    email: user?.email ?? "",
    entitlement,
    llmConfigured: await llmConfig.isConfigured(),
    now,
  });
}

function accountStatusPayload(input: {
  email: string;
  entitlement: EntitlementRecord | null;
  llmConfigured: boolean;
  now: Date;
}) {
  const entitlementActive = Boolean(input.entitlement && input.entitlement.expiresAt > input.now);
  const quotaLimit = input.entitlement?.llmQuotaLimit ?? 0;
  const quotaUsed = input.entitlement?.llmQuotaUsed ?? 0;
  const quotaRemaining =
    entitlementActive && input.entitlement ? llmQuotaRemaining(input.entitlement, input.now) : 0;
  const canProcess = entitlementActive;
  const canGenerateAi = canProcess && quotaRemaining > 0 && input.llmConfigured;
  return {
    authenticated: true,
    email: input.email,
    entitlement_status: entitlementActive ? "active" : "inactive",
    entitlement_expires_at: input.entitlement?.expiresAt.toISOString() ?? null,
    llm_quota_limit: quotaLimit,
    llm_quota_used: quotaUsed,
    llm_quota_remaining: quotaRemaining,
    llm_quota_resets_at: entitlementActive ? input.entitlement?.expiresAt.toISOString() ?? null : null,
    llm_configured: input.llmConfigured,
    last_verified_at: input.now.toISOString(),
    can_process: canProcess,
    can_generate_ai: canGenerateAi,
  };
}
