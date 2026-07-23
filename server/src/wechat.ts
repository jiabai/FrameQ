import { createDecipheriv, createHash, createSign, createVerify, randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { WechatConfig } from "./runtimeConfig.js";

export function createWechatNativePayment(
  config: WechatConfig | null = null,
  fetchImplementation: typeof fetch = fetch,
) {
  if (!config) {
    return async (_input: { outTradeNo: string; amountFen: number; description: string }) => {
      throw new Error("WeChat Native payment is not configured.");
    };
  }

  return async (input: { outTradeNo: string; amountFen: number; description: string }) => {
    const body = JSON.stringify({
      appid: config.appId,
      mchid: config.mchId,
      description: input.description,
      out_trade_no: input.outTradeNo,
      notify_url: config.notifyUrl,
      amount: { total: input.amountFen, currency: "CNY" },
    });
    const response = await wechatRequest({
      method: "POST",
      path: "/v3/pay/transactions/native",
      body,
      mchid: config.mchId,
      serialNo: config.serialNo,
      privateKey: config.privateKey,
      fetchImplementation,
    });
    const payload = (await response.json()) as { code_url?: string };
    if (!response.ok || !payload.code_url) {
      throw new Error("WeChat Native payment request failed.");
    }
    return {
      codeUrl: payload.code_url,
      providerPayload: payload,
    };
  };
}

async function wechatRequest(input: {
  method: string;
  path: string;
  body: string;
  mchid: string;
  serialNo: string;
  privateKey: string;
  fetchImplementation: typeof fetch;
}) {
  const nonce = randomUUID().replace(/-/g, "");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${input.method}\n${input.path}\n${timestamp}\n${nonce}\n${input.body}\n`;
  const signature = createSign("RSA-SHA256").update(message).sign(input.privateKey, "base64");
  const authorization = [
    'WECHATPAY2-SHA256-RSA2048',
    `mchid="${input.mchid}"`,
    `nonce_str="${nonce}"`,
    `signature="${signature}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${input.serialNo}"`,
  ].join(",");

  return input.fetchImplementation(`https://api.mch.weixin.qq.com${input.path}`, {
    method: input.method,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: input.body,
  });
}

export function notificationIdFromBody(body: unknown): string {
  const raw = JSON.stringify(body);
  return createHash("sha256").update(raw).digest("hex");
}

export type ParsedWechatNotification = {
  webhookId: string;
  outTradeNo: string;
  transactionId: string;
  paidAt: Date;
};

export type WechatNotificationParser = (input: {
  headers: IncomingHttpHeaders;
  body: unknown;
  rawBody: string;
}) => Promise<ParsedWechatNotification>;

export function createWechatNotificationParser(
  config: WechatConfig | null = null,
): WechatNotificationParser {
  return async ({ headers, body, rawBody }) => {
    if (config?.allowInsecureNotify) {
      return parsePlainDevelopmentNotification(body);
    }

    const apiV3Key = config?.apiV3Key;
    const platformCert = config?.platformCertPem;
    if (!apiV3Key || !platformCert) {
      throw new Error("WeChat notification verification is not configured.");
    }
    verifyWechatSignature(headers, rawBody, platformCert);
    const envelope = notificationEnvelopeSchema(body);
    const resource = envelope.resource;
    const decrypted = decryptWechatResource(
      {
        ciphertext: resource.ciphertext,
        nonce: resource.nonce,
        associatedData: resource.associated_data ?? "",
      },
      apiV3Key,
    );
    return parsePaidResource(envelope.id, JSON.parse(decrypted) as Record<string, unknown>);
  };
}

function verifyWechatSignature(
  headers: IncomingHttpHeaders,
  rawBody: string,
  platformCert: string,
): void {
  const timestamp = firstHeader(headers["wechatpay-timestamp"]);
  const nonce = firstHeader(headers["wechatpay-nonce"]);
  const signature = firstHeader(headers["wechatpay-signature"]);
  if (!timestamp || !nonce || !signature) {
    throw new Error("invalid wechat signature");
  }
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const verified = createVerify("RSA-SHA256")
    .update(message)
    .verify(platformCert, signature, "base64");
  if (!verified) {
    throw new Error("invalid wechat signature");
  }
}

function decryptWechatResource(
  resource: { ciphertext: string; nonce: string; associatedData: string },
  apiV3Key: string,
): string {
  const key = Buffer.from(apiV3Key, "utf8");
  if (key.length !== 32) {
    throw new Error("WeChat APIv3 key must be 32 bytes.");
  }
  const encrypted = Buffer.from(resource.ciphertext, "base64");
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(resource.nonce, "utf8"));
  if (resource.associatedData) {
    decipher.setAAD(Buffer.from(resource.associatedData, "utf8"));
  }
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function parsePlainDevelopmentNotification(body: unknown): ParsedWechatNotification {
  if (!body || typeof body !== "object") {
    throw new Error("invalid notification");
  }
  const value = body as Record<string, unknown>;
  return parsePaidResource(String(value.id ?? notificationIdFromBody(body)), {
    out_trade_no: value.out_trade_no,
    transaction_id: value.transaction_id,
    success_time: value.success_time,
  });
}

function notificationEnvelopeSchema(body: unknown): {
  id: string;
  resource: { ciphertext: string; nonce: string; associated_data?: string };
} {
  if (!body || typeof body !== "object") {
    throw new Error("invalid notification");
  }
  const value = body as Record<string, unknown>;
  const resource = value.resource;
  if (
    typeof value.id !== "string" ||
    !resource ||
    typeof resource !== "object" ||
    typeof (resource as Record<string, unknown>).ciphertext !== "string" ||
    typeof (resource as Record<string, unknown>).nonce !== "string"
  ) {
    throw new Error("invalid notification");
  }
  const resourceValues = resource as Record<string, unknown>;
  const ciphertext = resourceValues.ciphertext;
  const nonce = resourceValues.nonce;
  if (typeof ciphertext !== "string" || typeof nonce !== "string") {
    throw new Error("invalid notification");
  }
  return {
    id: value.id,
    resource: {
      ciphertext,
      nonce,
      associated_data:
        typeof resourceValues.associated_data === "string"
          ? resourceValues.associated_data
          : undefined,
    },
  };
}

function parsePaidResource(webhookId: string, resource: Record<string, unknown>): ParsedWechatNotification {
  if (
    typeof resource.out_trade_no !== "string" ||
    typeof resource.transaction_id !== "string"
  ) {
    throw new Error("invalid notification");
  }
  return {
    webhookId,
    outTradeNo: resource.out_trade_no,
    transactionId: resource.transaction_id,
    paidAt: typeof resource.success_time === "string" ? new Date(resource.success_time) : new Date(),
  };
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
