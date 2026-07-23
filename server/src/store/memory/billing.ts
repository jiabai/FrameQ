import { randomUUID } from "node:crypto";
import type {
  EntitlementRecord,
  OrderRecord,
  PaidOrderSettlement,
  Store,
  WebhookEventRecord,
} from "../contracts.js";
import type { MemoryAtomicCoordinator, MemoryState } from "./atomic.js";

export type MemoryBillingContext = {
  state: MemoryState;
  atomic: MemoryAtomicCoordinator;
  findOrderByOutTradeNo: Store["findOrderByOutTradeNo"];
  markOrderPaid: Store["markOrderPaid"];
  getEntitlement: Store["getEntitlement"];
  upsertEntitlement: Store["upsertEntitlement"];
  createWebhookEvent: Store["createWebhookEvent"];
};

export async function createOrder(
  context: MemoryBillingContext,
  input: Omit<OrderRecord, "id" | "paidAt" | "transactionId">,
): ReturnType<Store["createOrder"]> {
  const order = { ...input, id: randomUUID(), paidAt: null, transactionId: null };
  context.state.orders.push(order);
  return order;
}

export async function findOrderByOutTradeNo(
  context: MemoryBillingContext,
  outTradeNo: string,
): ReturnType<Store["findOrderByOutTradeNo"]> {
  return context.state.orders.find((order) => order.outTradeNo === outTradeNo) ?? null;
}

export async function markOrderPaid(
  context: MemoryBillingContext,
  outTradeNo: string,
  transactionId: string,
  paidAt: Date,
): ReturnType<Store["markOrderPaid"]> {
  const order = await context.findOrderByOutTradeNo(outTradeNo);
  if (!order) {
    throw new Error("Order not found.");
  }
  order.status = "paid";
  order.transactionId = transactionId;
  order.paidAt = paidAt;
  return order;
}

export async function settlePaidOrder(
  context: MemoryBillingContext,
  input: Parameters<Store["settlePaidOrder"]>[0],
): Promise<PaidOrderSettlement> {
  return context.atomic.run(async () => {
    const existingEvent = context.state.webhookEvents.find(
      (event) => event.provider === input.provider && event.eventId === input.eventId,
    );
    if (existingEvent && existingEvent.outTradeNo !== input.outTradeNo) {
      return { status: "webhook_order_mismatch" };
    }
    const existingEventTransactionId = existingEvent
      ? storedWebhookTransactionId(existingEvent.payload)
      : null;
    if (existingEvent && existingEventTransactionId !== input.transactionId) {
      return { status: "transaction_mismatch" };
    }
    const order = await context.findOrderByOutTradeNo(input.outTradeNo);
    if (!order) {
      return { status: "order_not_found" };
    }
    if (order.status === "paid") {
      if (!order.transactionId || order.transactionId !== input.transactionId) {
        return { status: "transaction_mismatch" };
      }
      const entitlement = await context.getEntitlement(order.userId);
      if (entitlement) {
        if (!existingEvent) {
          const created = await context.createWebhookEvent({
            provider: input.provider,
            eventId: input.eventId,
            outTradeNo: input.outTradeNo,
            payload: JSON.stringify({
              outTradeNo: input.outTradeNo,
              transactionId: input.transactionId,
              paidAt: input.paidAt.toISOString(),
            }),
            createdAt: input.now,
          });
          if (!created) {
            return { status: "webhook_order_mismatch" };
          }
        }
        return { status: "settled", entitlement };
      }
      if (!existingEvent) {
        return { status: "order_state_conflict" };
      }
      const recovered = await extendMonthlyPass(
        context,
        order.userId,
        order.paidAt ?? input.paidAt,
        input,
      );
      return { status: "settled", entitlement: recovered };
    }
    if (order.status !== "pending" || order.transactionId !== null || order.paidAt !== null) {
      return { status: "order_state_conflict" };
    }
    if (!existingEvent) {
      const created = await context.createWebhookEvent({
        provider: input.provider,
        eventId: input.eventId,
        outTradeNo: input.outTradeNo,
        payload: JSON.stringify({
          outTradeNo: input.outTradeNo,
          transactionId: input.transactionId,
          paidAt: input.paidAt.toISOString(),
        }),
        createdAt: input.now,
      });
      if (!created) {
        return { status: "webhook_order_mismatch" };
      }
    }
    await context.markOrderPaid(input.outTradeNo, input.transactionId, input.paidAt);
    const entitlement = await extendMonthlyPass(
      context,
      order.userId,
      input.paidAt,
      input,
    );
    return { status: "settled", entitlement };
  });
}

export async function createWebhookEvent(
  context: MemoryBillingContext,
  input: Omit<WebhookEventRecord, "id" | "createdAt"> & { createdAt: Date },
): ReturnType<Store["createWebhookEvent"]> {
  if (
    context.state.webhookEvents.some(
      (event) => event.provider === input.provider && event.eventId === input.eventId,
    )
  ) {
    return false;
  }
  context.state.webhookEvents.push({ ...input, id: randomUUID() });
  return true;
}

async function extendMonthlyPass(
  context: MemoryBillingContext,
  userId: string,
  paidAt: Date,
  input: { now: Date; passDays: number },
): Promise<EntitlementRecord> {
  const existing = await context.getEntitlement(userId);
  const base = existing && existing.expiresAt > paidAt ? existing.expiresAt : paidAt;
  return context.upsertEntitlement(
    userId,
    new Date(base.getTime() + input.passDays * 24 * 60 * 60 * 1000),
    input.now,
  );
}

function storedWebhookTransactionId(payload: string): string | null {
  try {
    const value = JSON.parse(payload) as { transactionId?: unknown };
    return typeof value.transactionId === "string" ? value.transactionId : null;
  } catch {
    return null;
  }
}
