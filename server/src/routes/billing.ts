import type { FastifyInstance } from "fastify";
import type { BillingService } from "../billing.js";
import type { Store } from "../store.js";
import type { WechatNotificationParser } from "../wechat.js";
import { authenticateDesktop, publicError } from "./shared.js";

type BillingRouteDependencies = {
  store: Store;
  billing: BillingService;
  parseWechatNotification: WechatNotificationParser;
  wechatPayEnabled: boolean;
  now: () => Date;
};

export function registerBillingRoutes(
  app: FastifyInstance,
  dependencies: BillingRouteDependencies,
): void {
  app.post("/api/desktop/billing/wechat-native", async (request, reply) => {
    if (!dependencies.wechatPayEnabled) {
      return reply.code(404).send({ error: "WECHAT_PAY_DISABLED" });
    }
    const session = await authenticateDesktop(
      dependencies.store,
      request.headers.authorization,
      dependencies.now(),
    );
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const order = await dependencies.billing.createWechatNativeOrder({
      sessionTokenHash: session.tokenHash,
    });
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
    if (!dependencies.wechatPayEnabled) {
      return reply.code(404).send({ error: "WECHAT_PAY_DISABLED" });
    }
    const session = await authenticateDesktop(
      dependencies.store,
      request.headers.authorization,
      dependencies.now(),
    );
    if (!session) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const params = request.params as { orderId?: string };
    const order = params.orderId
      ? await dependencies.billing.getOrderStatus(params.orderId)
      : null;
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
    if (!dependencies.wechatPayEnabled) {
      return reply.code(404).send({ error: "WECHAT_PAY_DISABLED" });
    }
    try {
      const rawBody = JSON.stringify(request.body ?? {});
      const exactRawBody =
        (request as typeof request & { rawBody?: string }).rawBody ?? rawBody;
      const notification = await dependencies.parseWechatNotification({
        headers: request.headers,
        body: request.body,
        rawBody: exactRawBody,
      });
      await dependencies.billing.applyPaidOrder({
        webhookId: notification.webhookId,
        outTradeNo: notification.outTradeNo,
        transactionId: notification.transactionId,
        paidAt: notification.paidAt,
      });
      return { code: "SUCCESS", message: "success" };
    } catch (error) {
      const message = publicError(error);
      return message
        ? reply.code(400).send({ code: "FAIL", message })
        : reply.code(500).send({ code: "FAIL", message: "internal error" });
    }
  });
}
