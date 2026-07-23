import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ActivationCodeService } from "../activation.js";
import { adminSessionMaxAgeSeconds, type AdminAuthService } from "../adminAuth.js";
import { renderAdminLoginPage, renderAdminPage } from "../adminPage.js";
import type { EntitlementAdjustmentService } from "../entitlementAdjustment.js";
import type { LlmConfigService } from "../llmConfig.js";
import { sha256 } from "../security.js";
import type { Store } from "../store.js";
import { emailStartSchema, emailVerifySchema } from "./authSchemas.js";
import {
  isServerTemporarilyUnavailable,
  llmQuotaRemaining,
  publicAuthError,
  publicError,
} from "./shared.js";

type AdminRouteStore = Pick<
  Store,
  | "revokeAdminSession"
  | "listUsers"
  | "getEntitlement"
  | "listActivationCodes"
  | "listAdminEntitlementAdjustments"
>;

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

type AdminRouteDependencies = {
  store: AdminRouteStore;
  adminAuth: AdminAuthService;
  activationCodes: ActivationCodeService;
  llmConfig: LlmConfigService;
  entitlementAdjustments: EntitlementAdjustmentService;
  secureCookies: boolean;
  now: () => Date;
};

export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AdminRouteDependencies,
): void {
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
      await dependencies.adminAuth.startEmailLogin({
        email: parsed.data.email,
        state: parsed.data.state,
        ip: request.ip,
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof Error && error.message === "ADMIN_ONLY") {
        return reply.code(403).send({ error: "ADMIN_ONLY" });
      }
      if (isServerTemporarilyUnavailable(error)) {
        return reply.code(503).send({ error: "SERVER_TEMPORARILY_UNAVAILABLE" });
      }
      const publicMessage = publicAuthError(error);
      return publicMessage
        ? reply.code(400).send({ error: publicMessage })
        : reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
    }
  });

  app.post("/admin/auth/email/verify", async (request, reply) => {
    const parsed = emailVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const result = await dependencies.adminAuth.verifyEmailCode(parsed.data);
      setCookie(reply, "frameq_admin_session", result.sessionToken, {
        httpOnly: true,
        maxAgeSeconds: adminSessionMaxAgeSeconds,
        secure: dependencies.secureCookies,
      });
      setCookie(reply, "frameq_admin_csrf", result.csrfToken, {
        httpOnly: false,
        maxAgeSeconds: adminSessionMaxAgeSeconds,
        secure: dependencies.secureCookies,
      });
      return { ok: true, redirect_url: "/admin" };
    } catch (error) {
      if (isServerTemporarilyUnavailable(error)) {
        return reply.code(503).send({ error: "SERVER_TEMPORARILY_UNAVAILABLE" });
      }
      const publicMessage = publicAuthError(error);
      return publicMessage
        ? reply.code(400).send({ error: publicMessage })
        : reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
    }
  });

  app.post("/admin/auth/logout", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const sessionToken = cookies.get("frameq_admin_session") ?? null;
    const session = await dependencies.adminAuth.authenticate(sessionToken);
    if (!session || !sessionToken) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!dependencies.adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    await dependencies.store.revokeAdminSession(sha256(sessionToken), dependencies.now());
    clearCookie(reply, "frameq_admin_session", true, dependencies.secureCookies);
    clearCookie(reply, "frameq_admin_csrf", false, dependencies.secureCookies);
    return { ok: true, redirect_url: "/admin/login" };
  });

  app.get("/admin", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await dependencies.adminAuth.authenticate(
      cookies.get("frameq_admin_session") ?? null,
    );
    if (!session) {
      return reply.redirect("/admin/login");
    }
    const csrfToken = cookies.get("frameq_admin_csrf") ?? "";
    const publicLlmConfig = await dependencies.llmConfig.getPublicConfig();
    const users = await dependencies.store.listUsers();
    const entitlements = new Map(
      await Promise.all(
        users.map(
          async (user) => [user.id, await dependencies.store.getEntitlement(user.id)] as const,
        ),
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
      activationCodes: codes,
      entitlementAdjustments,
    });
  });

  app.post("/admin/api/activation-codes", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await dependencies.adminAuth.authenticate(
      cookies.get("frameq_admin_session") ?? null,
    );
    if (!session) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!dependencies.adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    const parsed = adminActivationCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    const redeemBy = parsed.data.redeem_window_days
      ? new Date(dependencies.now().getTime() + parsed.data.redeem_window_days * 24 * 60 * 60 * 1000)
      : undefined;
    const generated = await dependencies.activationCodes.generateCode({ redeemBy });
    return {
      code: generated.code,
      code_prefix: generated.codePrefix,
      entitlement_days: generated.entitlementDays,
      redeem_by: generated.redeemBy.toISOString(),
    };
  });

  app.post("/admin/api/llm-config", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await dependencies.adminAuth.authenticate(
      cookies.get("frameq_admin_session") ?? null,
    );
    if (!session) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!dependencies.adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    const parsed = adminLlmConfigSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const saved = await dependencies.llmConfig.saveConfig({
        provider: parsed.data.provider,
        baseUrl: parsed.data.base_url,
        model: parsed.data.model,
        apiKey: parsed.data.api_key,
        timeoutSeconds: parsed.data.timeout_seconds,
      });
      return publicLlmConfigResponse(saved);
    } catch (error) {
      const message = publicError(error);
      return message
        ? reply.code(400).send({ error: message })
        : reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
    }
  });

  app.post("/admin/api/users/:userId/entitlement-adjustments", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const session = await dependencies.adminAuth.authenticate(
      cookies.get("frameq_admin_session") ?? null,
    );
    if (!session) {
      return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!dependencies.adminAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    const params = request.params as { userId?: string };
    const userId = params.userId ?? "";
    const parsed = adminEntitlementAdjustmentSchema.safeParse(request.body ?? {});
    if (!userId || !parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    const applied = await dependencies.entitlementAdjustments.apply({
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
    const currentNow = dependencies.now();
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
  options: { httpOnly: boolean; maxAgeSeconds: number; secure: boolean },
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
  if (options.secure) {
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
  secure: boolean,
): void {
  setCookie(reply, name, "", { httpOnly, maxAgeSeconds: 0, secure });
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
