import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ActivationCodeService } from "../activation.js";
import type { LlmConfigService } from "../llmConfig.js";
import {
  SelfServiceActivationError,
  type SelfServiceActivationService,
} from "../selfServiceActivation.js";
import type { EntitlementRecord, SessionRecord, Store } from "../store.js";
import { authenticateDesktop, llmQuotaRemaining, publicError } from "./shared.js";

type DesktopAccountStore = Pick<
  Store,
  "findSessionByTokenHash" | "getUserById" | "getEntitlement"
>;

const activationRedeemSchema = z.object({
  code: z.string().min(8).max(64),
});

const activationRequestSchema = z
  .object({
    locale: z.enum(["zh-CN", "zh-TW", "en-US"]),
  })
  .strict();

type DesktopAccountRouteDependencies = {
  store: DesktopAccountStore;
  activationCodes: ActivationCodeService;
  selfServiceActivationEnabled: boolean;
  selfServiceActivation: Pick<SelfServiceActivationService, "requestCode"> | null;
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
      canRequestActivationCode: canRequestActivationCode({
        entitlement,
        now: dependencies.now(),
        selfServiceActivationEnabled: dependencies.selfServiceActivationEnabled,
        selfServiceActivation: dependencies.selfServiceActivation,
      }),
      llmConfigured: await dependencies.llmConfig.isConfigured(),
      now: dependencies.now(),
    });
  });

  app.post("/api/desktop/activation-codes/request", async (request, reply) => {
    if (!dependencies.selfServiceActivationEnabled) {
      return reply.code(404).send({ error: "FEATURE_NOT_AVAILABLE" });
    }
    const session = await authenticateDesktop(
      dependencies.store,
      request.headers.authorization,
      dependencies.now(),
    );
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const parsed = activationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    if (!dependencies.selfServiceActivation) {
      return reply.code(503).send({ error: "ACTIVATION_EMAIL_UNAVAILABLE" });
    }

    try {
      const result = await dependencies.selfServiceActivation.requestCode({
        sessionTokenHash: session.tokenHash,
        ip: request.ip,
        locale: parsed.data.locale,
      });
      return {
        status: result.status,
        retry_at: result.retryAt.toISOString(),
        redeem_by: result.redeemBy.toISOString(),
      };
    } catch (error) {
      if (error instanceof SelfServiceActivationError) {
        switch (error.code) {
          case "AUTH_REQUIRED":
            return reply.code(401).send({ error: "AUTH_REQUIRED" });
          case "ENTITLEMENT_ACTIVE":
            return reply.code(409).send({ error: "ENTITLEMENT_ACTIVE" });
          case "ACTIVATION_REQUEST_RATE_LIMITED": {
            const retryAt = error.retryAt?.toISOString() ?? dependencies.now().toISOString();
            if (error.retryAt) {
              const retryAfterSeconds = Math.max(
                0,
                Math.ceil((error.retryAt.getTime() - dependencies.now().getTime()) / 1000),
              );
              reply.header("Retry-After", String(retryAfterSeconds));
            }
            return reply.code(429).send({
              error: "ACTIVATION_REQUEST_RATE_LIMITED",
              retry_at: retryAt,
            });
          }
          case "ACTIVATION_EMAIL_UNAVAILABLE":
            return reply.code(503).send({ error: "ACTIVATION_EMAIL_UNAVAILABLE" });
          case "SERVER_TEMPORARILY_UNAVAILABLE":
            return reply.code(503).send({ error: "SERVER_TEMPORARILY_UNAVAILABLE" });
        }
      }
      return reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
    }
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
      const message = publicError(error);
      return message
        ? reply.code(400).send({ error: message })
        : reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
    }
  });
}

async function accountStatusResponse(
  store: DesktopAccountStore,
  llmConfig: LlmConfigService,
  session: SessionRecord,
  now: Date,
) {
  const user = await store.getUserById(session.userId);
  const entitlement = await store.getEntitlement(session.userId);
  return accountStatusPayload({
    email: user?.email ?? "",
    entitlement,
    canRequestActivationCode: canRequestActivationCode({
      entitlement,
      now,
      selfServiceActivationEnabled: false,
      selfServiceActivation: null,
    }),
    llmConfigured: await llmConfig.isConfigured(),
    now,
  });
}

function accountStatusPayload(input: {
  email: string;
  entitlement: EntitlementRecord | null;
  canRequestActivationCode: boolean;
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
    can_request_activation_code: input.canRequestActivationCode,
    can_process: canProcess,
    can_generate_ai: canGenerateAi,
  };
}

function canRequestActivationCode(input: {
  entitlement: EntitlementRecord | null;
  now: Date;
  selfServiceActivationEnabled: boolean;
  selfServiceActivation: Pick<SelfServiceActivationService, "requestCode"> | null;
}): boolean {
  const entitlementActive = Boolean(input.entitlement && input.entitlement.expiresAt > input.now);
  return (
    input.selfServiceActivationEnabled &&
    input.selfServiceActivation !== null &&
    !entitlementActive
  );
}
