import Fastify from "fastify";
import { z } from "zod";
import { AuthService } from "./auth.js";
import { BillingService, type NativePaymentResult } from "./billing.js";
import { renderLoginPage } from "./loginPage.js";
import { sha256 } from "./security.js";
import type { SessionRecord, Store } from "./store.js";
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

export function buildServer(dependencies: ServerDependencies) {
  const app = Fastify({ logger: false });
  const now = dependencies.now ?? (() => new Date());
  const auth = new AuthService({
    store: dependencies.store,
    now,
    sendOtp: dependencies.sendOtp,
  });
  const billing = new BillingService({
    store: dependencies.store,
    now,
    createNativePayment: dependencies.createNativePayment,
  });
  const parseWechatNotification =
    dependencies.parseWechatNotification ?? createWechatNotificationParser();

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
    const entitlementActive = Boolean(entitlement && entitlement.expiresAt > now());
    return {
      authenticated: true,
      email: user?.email ?? "",
      entitlement_status: entitlementActive ? "active" : "inactive",
      entitlement_expires_at: entitlement?.expiresAt.toISOString() ?? null,
      last_verified_at: now().toISOString(),
      can_process: entitlementActive,
    };
  });

  app.post("/api/desktop/logout", async (request) => {
    const token = bearerToken(request.headers.authorization);
    if (token) {
      await dependencies.store.revokeSession(sha256(token), now());
    }
    return { ok: true };
  });

  app.post("/api/desktop/billing/wechat-native", async (request, reply) => {
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

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}
