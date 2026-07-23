import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  EntitlementRecord,
  OrderRecord,
  PaidOrderSettlement,
  Store,
  WebhookEventRecord,
} from "../store/contracts.js";
import { isPrismaKnownError } from "./concurrency.js";

type SettlementInput = Parameters<Store["settlePaidOrder"]>[0];
type WebhookMatch =
  | { status: "recorded" }
  | { status: "webhook_order_mismatch" }
  | { status: "transaction_mismatch" };

export async function createOrder(
  prisma: PrismaClient,
  input: Omit<OrderRecord, "id" | "paidAt" | "transactionId">,
): ReturnType<Store["createOrder"]> {
  const order = await prisma.order.create({
    data: { ...input, id: randomUUID(), paidAt: null, transactionId: null },
  });
  return order as OrderRecord;
}

export async function findOrderByOutTradeNo(
  prisma: PrismaClient,
  outTradeNo: string,
): ReturnType<Store["findOrderByOutTradeNo"]> {
  const order = await prisma.order.findUnique({ where: { outTradeNo } });
  return order as OrderRecord | null;
}

export async function markOrderPaid(
  prisma: PrismaClient,
  outTradeNo: string,
  transactionId: string,
  paidAt: Date,
): ReturnType<Store["markOrderPaid"]> {
  const order = await prisma.order.update({
    where: { outTradeNo },
    data: { status: "paid", transactionId, paidAt },
  });
  return order as OrderRecord;
}

export async function settlePaidOrder(
  prisma: PrismaClient,
  input: SettlementInput,
): ReturnType<Store["settlePaidOrder"]> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { outTradeNo: input.outTradeNo } });
    if (!order) {
      return { status: "order_not_found" };
    }
    const existingEvent = await tx.webhookEvent.findUnique({
      where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
    });
    if (existingEvent && existingEvent.outTradeNo !== input.outTradeNo) {
      return { status: "webhook_order_mismatch" };
    }
    const existingEventTransactionId = existingEvent
      ? storedWebhookTransactionId(existingEvent.payload)
      : null;
    if (existingEvent && existingEventTransactionId !== input.transactionId) {
      return { status: "transaction_mismatch" };
    }
    if (order.status === "paid") {
      const entitlement = await tx.entitlement.findUnique({ where: { userId: order.userId } });
      if (!existingEvent && !entitlement) {
        return { status: "order_state_conflict" };
      }
      const webhook = await ensureWebhookEvent(tx, input);
      if (webhook.status !== "recorded") {
        return webhook;
      }
      return settleExistingPaidOrder(tx, order, input);
    }
    if (order.status !== "pending" || order.transactionId !== null || order.paidAt !== null) {
      return { status: "order_state_conflict" };
    }
    const webhook = await ensureWebhookEvent(tx, input);
    if (webhook.status !== "recorded") {
      return webhook;
    }
    const marked = await tx.order.updateMany({
      where: {
        outTradeNo: input.outTradeNo,
        status: "pending",
        transactionId: null,
        paidAt: null,
      },
      data: {
        status: "paid",
        transactionId: input.transactionId,
        paidAt: input.paidAt,
      },
    });
    if (marked.count === 0) {
      const latest = await tx.order.findUnique({ where: { outTradeNo: input.outTradeNo } });
      if (!latest) {
        return { status: "order_state_conflict" };
      }
      return settleExistingPaidOrder(tx, latest, input);
    }
    return {
      status: "settled",
      entitlement: await extendMonthlyPass(
        tx,
        order.userId,
        input.paidAt,
        input.now,
        input.passDays,
      ),
    };
  });
}

export async function createWebhookEvent(
  prisma: PrismaClient,
  input: Omit<WebhookEventRecord, "id" | "createdAt"> & { createdAt: Date },
): ReturnType<Store["createWebhookEvent"]> {
  try {
    await prisma.webhookEvent.create({ data: { ...input, id: randomUUID() } });
    return true;
  } catch (error) {
    if (isPrismaKnownError(error, "P2002")) {
      return false;
    }
    throw error;
  }
}

async function ensureWebhookEvent(
  tx: Prisma.TransactionClient,
  input: SettlementInput,
): Promise<WebhookMatch> {
  const existing = await tx.webhookEvent.findUnique({
    where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
  });
  if (existing) {
    return webhookEventMatch(existing, input);
  }
  try {
    await tx.webhookEvent.create({
      data: {
        id: randomUUID(),
        provider: input.provider,
        eventId: input.eventId,
        outTradeNo: input.outTradeNo,
        payload: JSON.stringify({
          outTradeNo: input.outTradeNo,
          transactionId: input.transactionId,
          paidAt: input.paidAt.toISOString(),
        }),
        createdAt: input.now,
      },
    });
    return { status: "recorded" };
  } catch (error) {
    if (!isPrismaKnownError(error, "P2002")) {
      throw error;
    }
    const duplicate = await tx.webhookEvent.findUnique({
      where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
    });
    return duplicate
      ? webhookEventMatch(duplicate, input)
      : { status: "webhook_order_mismatch" };
  }
}

function webhookEventMatch(
  event: { outTradeNo: string; payload: string },
  input: { outTradeNo: string; transactionId: string },
): WebhookMatch {
  if (event.outTradeNo !== input.outTradeNo) {
    return { status: "webhook_order_mismatch" };
  }
  const transactionId = storedWebhookTransactionId(event.payload);
  return transactionId === input.transactionId
    ? { status: "recorded" }
    : { status: "transaction_mismatch" };
}

async function settleExistingPaidOrder(
  tx: Prisma.TransactionClient,
  order: {
    status: string;
    transactionId: string | null;
    userId: string;
    paidAt: Date | null;
  },
  input: Pick<SettlementInput, "transactionId" | "paidAt" | "now" | "passDays">,
): Promise<PaidOrderSettlement> {
  if (order.status !== "paid") {
    return { status: "order_state_conflict" };
  }
  if (!order.transactionId || order.transactionId !== input.transactionId) {
    return { status: "transaction_mismatch" };
  }
  const entitlement = await tx.entitlement.findUnique({ where: { userId: order.userId } });
  if (entitlement) {
    return { status: "settled", entitlement: entitlement as EntitlementRecord };
  }
  return {
    status: "settled",
    entitlement: await extendMonthlyPass(
      tx,
      order.userId,
      order.paidAt ?? input.paidAt,
      input.now,
      input.passDays,
    ),
  };
}

async function extendMonthlyPass(
  tx: Prisma.TransactionClient,
  userId: string,
  paidAt: Date,
  now: Date,
  passDays: number,
): Promise<EntitlementRecord> {
  const existing = await tx.entitlement.findUnique({ where: { userId } });
  const base = existing && existing.expiresAt > paidAt ? existing.expiresAt : paidAt;
  const entitlement = await tx.entitlement.upsert({
    where: { userId },
    update: {
      status: "active",
      expiresAt: new Date(base.getTime() + passDays * 24 * 60 * 60 * 1000),
      updatedAt: now,
    },
    create: {
      id: randomUUID(),
      userId,
      status: "active",
      expiresAt: new Date(base.getTime() + passDays * 24 * 60 * 60 * 1000),
      llmQuotaLimit: 0,
      llmQuotaUsed: 0,
      updatedAt: now,
    },
  });
  return entitlement as EntitlementRecord;
}

function storedWebhookTransactionId(payload: string): string | null {
  try {
    const value = JSON.parse(payload) as { transactionId?: unknown };
    return typeof value.transactionId === "string" ? value.transactionId : null;
  } catch {
    return null;
  }
}
