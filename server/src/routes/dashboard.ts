import type { FastifyInstance } from "fastify";
import type { ActivationCodeRecord } from "../store.js";
import type { LlmConfigService } from "../llmConfig.js";
import { renderDashboardPage, type DashboardAccountView } from "../dashboardPage.js";
import { sha256 } from "../security.js";
import type { Store } from "../store.js";
import { parseCookies } from "./cookies.js";
import { llmQuotaRemaining } from "./shared.js";
import type { UserAuthService } from "../userAuth.js";

type DashboardRouteStore = Pick<
  Store,
  | "getUserById"
  | "getEntitlement"
  | "listActivationCodes"
>;

type DashboardRouteDependencies = {
  store: DashboardRouteStore;
  userAuth: UserAuthService;
  llmConfig: LlmConfigService;
  now: () => Date;
};

export function registerDashboardRoutes(
  app: FastifyInstance,
  dependencies: DashboardRouteDependencies,
): void {
  app.get("/dashboard", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const sessionToken = cookies.get("frameq_user_session") ?? null;
    const session = await dependencies.userAuth.authenticate(sessionToken);
    if (!session || !sessionToken) {
      return reply.redirect("/login");
    }
    const account = await assembleDashboardAccount({
      store: dependencies.store,
      llmConfig: dependencies.llmConfig,
      userId: session.userId,
      now: dependencies.now(),
    });
    const csrfToken = cookies.get("frameq_user_csrf") ?? "";
    reply.type("text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return renderDashboardPage({ account, csrfToken });
  });

  app.get("/api/dashboard/account", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const sessionToken = cookies.get("frameq_user_session") ?? null;
    const session = await dependencies.userAuth.authenticate(sessionToken);
    if (!session || !sessionToken) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const account = await assembleDashboardAccount({
      store: dependencies.store,
      llmConfig: dependencies.llmConfig,
      userId: session.userId,
      now: dependencies.now(),
    });
    return account;
  });
}

async function assembleDashboardAccount(input: {
  store: DashboardRouteStore;
  llmConfig: LlmConfigService;
  userId: string;
  now: Date;
}): Promise<DashboardAccountView> {
  const user = await input.store.getUserById(input.userId);
  const entitlement = await input.store.getEntitlement(input.userId);
  const llmConfigured = await input.llmConfig.isConfigured();
  const codes = await input.store.listActivationCodes();
  const redeemed = latestRedeemedCode(codes, input.userId);

  const entitlementActive = Boolean(entitlement && entitlement.expiresAt > input.now);
  const quotaLimit = entitlement?.llmQuotaLimit ?? 0;
  const quotaUsed = entitlement?.llmQuotaUsed ?? 0;
  const quotaRemaining =
    entitlementActive && entitlement ? llmQuotaRemaining(entitlement, input.now) : 0;
  const canProcess = entitlementActive;
  const canGenerateAi = canProcess && quotaRemaining > 0 && llmConfigured;

  return {
    email: user?.email ?? "",
    entitlement_status: entitlementActive ? "active" : "inactive",
    entitlement_expires_at: entitlement?.expiresAt.toISOString() ?? null,
    llm_quota_limit: quotaLimit,
    llm_quota_used: quotaUsed,
    llm_quota_remaining: quotaRemaining,
    llm_quota_resets_at:
      entitlementActive ? entitlement?.expiresAt.toISOString() ?? null : null,
    llm_configured: llmConfigured,
    can_process: canProcess,
    can_generate_ai: canGenerateAi,
    activation_code_prefix: redeemed?.codePrefix ?? null,
    activation_code_redeemed_at: redeemed?.redeemedAt?.toISOString() ?? null,
  };
}

function latestRedeemedCode(
  codes: ActivationCodeRecord[],
  userId: string,
): ActivationCodeRecord | null {
  const redeemed = codes.filter(
    (code) => code.redeemedByUserId === userId && code.redeemedAt !== null,
  );
  if (redeemed.length === 0) {
    return null;
  }
  redeemed.sort((left, right) => {
    const leftTime = left.redeemedAt?.getTime() ?? 0;
    const rightTime = right.redeemedAt?.getTime() ?? 0;
    return rightTime - leftTime;
  });
  return redeemed[0] ?? null;
}
