import Fastify from "fastify";
import { z } from "zod";
import { ActivationCodeService } from "./activation.js";
import { AdminAuthService, adminSessionMaxAgeSeconds } from "./adminAuth.js";
import { AnysearchConfigService } from "./anysearchConfig.js";
import { renderAdminLoginPage, renderAdminPage } from "./adminPage.js";
import { AuthService } from "./auth.js";
import { BillingService, type NativePaymentResult } from "./billing.js";
import { EntitlementAdjustmentService } from "./entitlementAdjustment.js";
import { LlmConfigService } from "./llmConfig.js";
import { renderLoginPage } from "./loginPage.js";
import { sha256 } from "./security.js";
import type { EntitlementRecord, SessionRecord, Store } from "./store.js";
import {
  findDesktopUpdate,
  loadDesktopReleaseManifest,
  type DesktopReleaseManifest,
} from "./updates.js";
import { createWechatNotificationParser, type WechatNotificationParser } from "./wechat.js";

export type ServerDependencies = {
  store: Store;
  sendOtp: (email: string, code: string) => Promise<void>;
  createNativePayment: (input: {
    outTradeNo: string;
    amountFen: number;
    description: string;
  }) => Promise<NativePaymentResult>;
  parseWechatNotification?: WechatNotificationParser;
  adminEmail?: string;
  wechatPayEnabled?: boolean;
  llmConfigEncryptionKey?: string;
  releaseManifest?: DesktopReleaseManifest | null;
  releaseManifestPath?: string;
  now?: () => Date;
};

const emailStartSchema = z.object({
  email: z.string(),
  state: z.string(),
});

const emailVerifySchema = z.object({
  email: z.string(),
  code: z.string(),
  state: z.string(),
});

const ticketExchangeSchema = z.object({
  ticket: z.string(),
  state: z.string(),
});

const activationRedeemSchema = z.object({
  code: z.string().min(8).max(64),
});

const adminActivationCreateSchema = z.object({
  redeem_window_days: z.number().int().min(1).max(365).optional(),
});

const adminLlmConfigSchema = z.object({
  provider: z.string().min(1).max(64),
  base_url: z.string().min(1).max(2048),
  model: z.string().min(1).max(256),
  api_key: z.string().max(4096).optional(),
  timeout_seconds: z.number().int().min(1).max(600),
});

const adminAnysearchConfigSchema = z.object({
  mcp_url: z.string().min(1).max(2048),
  api_key: z.string().max(4096).optional(),
  clear_api_key: z.boolean().optional(),
});

const llmCheckoutSchema = z.object({
  request_id: z
    .string()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9._~-]+$/),
});

const adminEntitlementAdjustmentSchema = z
  .object({
    extend_days: z.number().int().min(1).max(365).optional(),
    expires_at: z
      .string()
      .max(64)
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid ISO date")
      .optional(),
    quota_add: z.number().int().min(1).max(100000).optional(),
    reason: z.enum(["bug_compensation", "support_goodwill", "manual_repair", "other"]),
    note: z.string().max(1024).optional(),
  })
  .refine(
    (value) =>
      value.extend_days !== undefined || value.expires_at !== undefined || value.quota_add !== undefined,
  );

export function buildServer(dependencies: ServerDependencies) {
  const app = Fastify({ logger: false });
  const now = dependencies.now ?? (() => new Date());
  const auth = new AuthService({
    store: dependencies.store,
    now,
    sendOtp: dependencies.sendOtp,
  });
  const adminAuth = new AdminAuthService({
    store: dependencies.store,
    now,
    sendOtp: dependencies.sendOtp,
    adminEmail: dependencies.adminEmail ?? process.env.FRAMEQ_ADMIN_EMAIL,
  });
  const activationCodes = new ActivationCodeService({
    store: dependencies.store,
    now,
  });
  const llmConfig = new LlmConfigService({
    store: dependencies.store,
    now,
    encryptionKey: dependencies.llmConfigEncryptionKey ?? process.env.FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY,
  });
  const anysearchConfig = new AnysearchConfigService({
    store: dependencies.store,
    now,
    encryptionKey: dependencies.llmConfigEncryptionKey ?? process.env.FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY,
  });
  const billing = new BillingService({
    store: dependencies.store,
    now,
    createNativePayment: dependencies.createNativePayment,
  });
  const entitlementAdjustments = new EntitlementAdjustmentService({
    store: dependencies.store,
    now,
  });
  const parseWechatNotification =
    dependencies.parseWechatNotification ?? createWechatNotificationParser();
  const wechatPayEnabled = dependencies.wechatPayEnabled ?? process.env.WECHAT_PAY_ENABLED === "1";
  const releaseManifest =
    dependencies.releaseManifest ??
    loadDesktopReleaseManifest(
      dependencies.releaseManifestPath ?? process.env.FRAMEQ_RELEASE_MANIFEST_PATH,
    );

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    try {
      (request as typeof request & { rawBody?: string }).rawBody = body as string;
      done(null, body ? JSON.parse(body as string) : {});
    } catch (error) {
      done(error as Error);
    }
  });

  app.get("/login", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return renderLoginPage();
  });

  app.get("/admin/login", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return renderAdminLoginPage();
  });

  app.post("/admin/auth/email/start", async (request, reply) => {
    const parsed = emailStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      await adminAuth.startEmailLogin({
        email: parsed.data.email,
        state: parsed.data.state,
        ip: request.ip,
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof Error && error.message === "ADMIN_ONLY") {
        return reply.code(403).send({ error: "ADMIN_ONLY" });
      }
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/admin/auth/email/verify", async (request, reply) => {
    const parsed = emailVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const result = await adminAuth.verifyEmailCode(parsed.data);
      setCookie(reply, "frameq_admin_session", result.sessionToken, {
        httpOnly: true,
        maxAgeSeconds: adminSessionMaxAgeSeconds,
      });
      setCookie(reply, "frameq_admin_csrf", result.csrfToken, {
        httpOnly: false,
        maxAgeSeconds: adminSessionMaxAgeSeconds,
      });
      return { ok: true, redirect_url: "/admin" };
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/admin/auth/logout", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const sessionToken = cookies.get("frameq_admin_session") ?? null;
    const session = await adminAuth.authenticate(sessionToken);
    if (!session || !sessionToken) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    await dependencies.store.revokeAdminSession(sha256(sessionToken), now());
    clearCookie(reply, "frameq_admin_session", true);
    clearCookie(reply, "frameq_admin_csrf", false);
    return { ok: true, redirect_url: "/admin/login" };
  });

  app.get("/admin", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await adminAuth.authenticate(cookies.get("frameq_admin_session") ?? null);
    if (!session) {
      return reply.redirect("/admin/login");
    }
    const csrfToken = cookies.get("frameq_admin_csrf") ?? "";
    const publicLlmConfig = await llmConfig.getPublicConfig();
    const publicAnysearchConfig = await anysearchConfig.getPublicConfig();
    const users = await dependencies.store.listUsers();
    const entitlements = new Map(
      await Promise.all(
        users.map(async (user) => [user.id, await dependencies.store.getEntitlement(user.id)] as const),
      ),
    );
    const codes = await dependencies.store.listActivationCodes();
    const entitlementAdjustments = await dependencies.store.listAdminEntitlementAdjustments(50);
    reply.type("text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return renderAdminPage({
      adminEmail: session.email,
      csrfToken,
      users,
      entitlements,
      llmConfig: publicLlmConfig,
      anysearchConfig: publicAnysearchConfig,
      activationCodes: codes,
      entitlementAdjustments,
    });
  });

  app.post("/admin/api/activation-codes", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await adminAuth.authenticate(cookies.get("frameq_admin_session") ?? null);
    if (!session) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    const parsed = adminActivationCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    const redeemBy = parsed.data.redeem_window_days
      ? new Date(now().getTime() + parsed.data.redeem_window_days * 24 * 60 * 60 * 1000)
      : undefined;
    const generated = await activationCodes.generateCode({ redeemBy });
    return {
      code: generated.code,
      code_prefix: generated.codePrefix,
      entitlement_days: generated.entitlementDays,
      redeem_by: generated.redeemBy.toISOString(),
    };
  });

  app.post("/admin/api/llm-config", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await adminAuth.authenticate(cookies.get("frameq_admin_session") ?? null);
    if (!session) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    const parsed = adminLlmConfigSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const saved = await llmConfig.saveConfig({
        provider: parsed.data.provider,
        baseUrl: parsed.data.base_url,
        model: parsed.data.model,
        apiKey: parsed.data.api_key,
        timeoutSeconds: parsed.data.timeout_seconds,
      });
      return publicLlmConfigResponse(saved);
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/admin/api/anysearch-config", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await adminAuth.authenticate(cookies.get("frameq_admin_session") ?? null);
    if (!session) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    const parsed = adminAnysearchConfigSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const saved = await anysearchConfig.saveConfig({
        mcpUrl: parsed.data.mcp_url,
        apiKey: parsed.data.api_key,
        clearApiKey: parsed.data.clear_api_key,
      });
      return publicAnysearchConfigResponse(saved);
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/admin/api/users/:userId/entitlement-adjustments", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await adminAuth.authenticate(cookies.get("frameq_admin_session") ?? null);
    if (!session) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    const params = request.params as { userId?: string };
    const userId = params.userId ?? "";
    const parsed = adminEntitlementAdjustmentSchema.safeParse(request.body ?? {});
    if (!userId || !parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    const applied = await entitlementAdjustments.apply({
      adminEmail: session.email,
      userId,
      reason: parsed.data.reason,
      note: parsed.data.note,
      extendDays: parsed.data.extend_days,
      expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at) : undefined,
      quotaAdd: parsed.data.quota_add,
    });
    if (applied.status === "user_not_found") {
      return reply.code(404).send({ error: "USER_NOT_FOUND" });
    }
    if (applied.status === "expiry_required") {
      return reply.code(400).send({ error: "EXPIRY_REQUIRED" });
    }
    const { adjustment, entitlement } = applied;
    const currentNow = now();
    return {
      adjustment_id: adjustment.id,
      user_id: userId,
      entitlement_expires_at: entitlement.expiresAt.toISOString(),
      llm_quota_limit: entitlement.llmQuotaLimit,
      llm_quota_used: entitlement.llmQuotaUsed,
      llm_quota_remaining: llmQuotaRemaining(entitlement, currentNow),
      reason: adjustment.reason,
    };
  });

  app.post("/auth/email/start", async (request, reply) => {
    const parsed = emailStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      await auth.startEmailLogin({
        email: parsed.data.email,
        state: parsed.data.state,
        ip: request.ip,
      });
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/auth/email/verify", async (request, reply) => {
    const parsed = emailVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const result = await auth.verifyEmailCode(parsed.data);
      return {
        ticket: result.ticket,
        redirect_url: result.redirectUrl,
      };
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/api/desktop/sessions/exchange", async (request, reply) => {
    const parsed = ticketExchangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const result = await auth.exchangeDesktopTicket(parsed.data);
      return {
        session_token: result.sessionToken,
        email: result.email,
        expires_at: result.expiresAt.toISOString(),
      };
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.get("/api/desktop/account", async (request, reply) => {
    const session = await authenticateDesktop(dependencies.store, request.headers.authorization, now());
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const user = await dependencies.store.getUserById(session.userId);
    const entitlement = await dependencies.store.getEntitlement(session.userId);
    return accountStatusPayload({
      email: user?.email ?? "",
      entitlement,
      llmConfigured: await llmConfig.isConfigured(),
      now: now(),
    });
  });

  app.post("/api/desktop/logout", async (request) => {
    const token = bearerToken(request.headers.authorization);
    if (token) {
      await dependencies.store.revokeSession(sha256(token), now());
    }
    return { ok: true };
  });

  app.post("/api/desktop/activation-codes/redeem", async (request, reply) => {
    const session = await authenticateDesktop(dependencies.store, request.headers.authorization, now());
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const parsed = activationRedeemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      await activationCodes.redeemCode({
        sessionTokenHash: session.tokenHash,
        code: parsed.data.code,
      });
      return accountStatusResponse(dependencies.store, llmConfig, session, now());
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/api/desktop/llm/checkouts", async (request, reply) => {
    const session = await authenticateDesktop(dependencies.store, request.headers.authorization, now());
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const parsed = llmCheckoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    const config = await llmConfig.getDesktopConfig();
    if (!config) {
      return reply.code(400).send({ error: "LLM_CONFIG_MISSING" });
    }
    const consumed = await dependencies.store.consumeLlmQuota(session.userId, parsed.data.request_id, now());
    if (!consumed) {
      return reply.code(403).send({ error: "LLM_QUOTA_UNAVAILABLE" });
    }
    const remaining = llmQuotaRemaining(consumed.entitlement, now());
    return {
      provider: config.provider,
      base_url: config.baseUrl,
      model: config.model,
      api_key: config.apiKey,
      timeout_seconds: config.timeoutSeconds,
      quota_remaining: remaining,
    };
  });

  app.post("/api/desktop/anysearch/checkout", async (request, reply) => {
    const session = await authenticateDesktop(dependencies.store, request.headers.authorization, now());
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const cfg = await anysearchConfig.getDesktopConfig();
    if (!cfg) {
      return reply.code(400).send({ error: "ANYSEARCH_CONFIG_MISSING" });
    }
    return {
      mcp_url: cfg.mcpUrl,
      api_key: cfg.apiKey,
    };
  });

  // Reserved for a future server-hosted update manifest. Current desktop builds
  // use Tauri's GitHub Releases `latest.json` endpoint configured in tauri.conf.json.
  app.get("/api/desktop/updates/:target/:arch/:currentVersion", async (request, reply) => {
    const params = request.params as {
      target?: string;
      arch?: string;
      currentVersion?: string;
    };
    const query = request.query as { channel?: string };
    const update = findDesktopUpdate(releaseManifest, {
      target: params.target ?? "",
      arch: params.arch ?? "",
      currentVersion: params.currentVersion ?? "",
      channel: query.channel,
    });

    if (!update) {
      return reply.code(204).send();
    }

    return update;
  });

  app.post("/api/desktop/billing/wechat-native", async (request, reply) => {
    if (!wechatPayEnabled) {
      return reply.code(404).send({ error: "WECHAT_PAY_DISABLED" });
    }
    const session = await authenticateDesktop(dependencies.store, request.headers.authorization, now());
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const order = await billing.createWechatNativeOrder({ sessionTokenHash: session.tokenHash });
    return {
      order_id: order.outTradeNo,
      amount_fen: order.amountFen,
      currency: "CNY",
      code_url: order.codeUrl,
      expires_at: order.expiresAt.toISOString(),
      status: order.status,
    };
  });

  app.get("/api/desktop/billing/orders/:orderId", async (request, reply) => {
    if (!wechatPayEnabled) {
      return reply.code(404).send({ error: "WECHAT_PAY_DISABLED" });
    }
    const session = await authenticateDesktop(dependencies.store, request.headers.authorization, now());
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const params = request.params as { orderId?: string };
    const order = params.orderId ? await billing.getOrderStatus(params.orderId) : null;
    if (!order || order.userId !== session.userId) {
      return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    }
    const entitlement = await dependencies.store.getEntitlement(session.userId);
    return {
      order_id: order.outTradeNo,
      status: order.status,
      entitlement_expires_at: entitlement?.expiresAt.toISOString() ?? null,
    };
  });

  app.post("/api/wechat/notify", async (request, reply) => {
    if (!wechatPayEnabled) {
      return reply.code(404).send({ error: "WECHAT_PAY_DISABLED" });
    }
    try {
      const rawBody = JSON.stringify(request.body ?? {});
      const exactRawBody =
        (request as typeof request & { rawBody?: string }).rawBody ?? rawBody;
      const notification = await parseWechatNotification({
        headers: request.headers,
        body: request.body,
        rawBody: exactRawBody,
      });
      await billing.applyPaidOrder({
        webhookId: notification.webhookId,
        outTradeNo: notification.outTradeNo,
        transactionId: notification.transactionId,
        paidAt: notification.paidAt,
      });
      return { code: "SUCCESS", message: "success" };
    } catch (error) {
      return reply.code(400).send({ code: "FAIL", message: publicError(error) });
    }
  });

  return app;
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
  const quotaRemaining = entitlementActive && input.entitlement
    ? llmQuotaRemaining(input.entitlement, input.now)
    : 0;
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

function llmQuotaRemaining(entitlement: EntitlementRecord, now: Date): number {
  if (entitlement.expiresAt <= now) {
    return 0;
  }
  return Math.max(0, entitlement.llmQuotaLimit - entitlement.llmQuotaUsed);
}

function quotaResponse(userId: string, entitlement: EntitlementRecord, now: Date) {
  return {
    user_id: userId,
    llm_quota_limit: entitlement.llmQuotaLimit,
    llm_quota_used: entitlement.llmQuotaUsed,
    llm_quota_remaining: llmQuotaRemaining(entitlement, now),
  };
}

function publicLlmConfigResponse(config: {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  hasApiKey: boolean;
  apiKeyLast4: string;
  updatedAt: Date | null;
}) {
  return {
    ok: true,
    provider: config.provider,
    base_url: config.baseUrl,
    model: config.model,
    timeout_seconds: config.timeoutSeconds,
    has_api_key: config.hasApiKey,
    api_key_last4: config.apiKeyLast4,
    updated_at: config.updatedAt?.toISOString() ?? null,
  };
}

function publicAnysearchConfigResponse(config: {
  mcpUrl: string;
  hasApiKey: boolean;
  apiKeyLast4: string;
  updatedAt: Date | null;
}) {
  return {
    ok: true,
    mcp_url: config.mcpUrl,
    has_api_key: config.hasApiKey,
    api_key_last4: config.apiKeyLast4,
    updated_at: config.updatedAt?.toISOString() ?? null,
  };
}

async function authenticateDesktop(
  store: Store,
  authorization: string | undefined,
  now: Date,
): Promise<SessionRecord | null> {
  const token = bearerToken(authorization);
  if (!token) {
    return null;
  }
  return store.findSessionByTokenHash(sha256(token), now);
}

function bearerToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader?.split(";") ?? []) {
    const [name, ...rest] = part.trim().split("=");
    if (!name || rest.length === 0) {
      continue;
    }
    cookies.set(name, decodeURIComponent(rest.join("=")));
  }
  return cookies;
}

function setCookie(
  reply: { header(name: string, value: string | string[]): unknown; getHeader(name: string): unknown },
  name: string,
  value: string,
  options: { httpOnly: boolean; maxAgeSeconds: number },
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.floor(options.maxAgeSeconds)}`,
    "SameSite=Lax",
  ];
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  const existing = reply.getHeader("set-cookie");
  const values = Array.isArray(existing)
    ? [...existing.map(String), parts.join("; ")]
    : existing
      ? [String(existing), parts.join("; ")]
      : [parts.join("; ")];
  reply.header("set-cookie", values);
}

function clearCookie(
  reply: { header(name: string, value: string | string[]): unknown; getHeader(name: string): unknown },
  name: string,
  httpOnly: boolean,
): void {
  setCookie(reply, name, "", { httpOnly, maxAgeSeconds: 0 });
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}
