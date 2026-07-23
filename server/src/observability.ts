import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

export type OperationalLogStream = {
  write(chunk: string | Uint8Array): void;
};

export type ObservabilityConfig = Readonly<{
  enabled: boolean;
  stream?: OperationalLogStream;
  requestIdFactory: () => string;
}>;

export type ObservabilityOverrides = {
  stream?: OperationalLogStream;
  requestIdFactory?: () => string;
};

const sensitiveLogPaths = Object.freeze([
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "authorization",
  "cookie",
  '["set-cookie"]',
  "apiKey",
  "api_key",
  "smtp.pass",
  "smtpPass",
  "SMTP_PASS",
  "WECHAT_MCH_PRIVATE_KEY",
  "WECHAT_API_V3_KEY",
]);

export function createObservabilityConfig(
  enabled: boolean,
  overrides: ObservabilityOverrides = {},
): ObservabilityConfig {
  return Object.freeze({
    enabled,
    stream: overrides.stream,
    requestIdFactory: overrides.requestIdFactory ?? randomUUID,
  });
}

export function createFastifyOptions(input: {
  observability: ObservabilityConfig;
  trustLoopbackProxy: boolean;
}) {
  const logger = input.observability.enabled
    ? {
        level: "info",
        base: undefined,
        redact: {
          paths: [...sensitiveLogPaths],
          censor: "[REDACTED]",
        },
        ...(input.observability.stream ? { stream: input.observability.stream } : {}),
      }
    : false;

  return {
    logger,
    disableRequestLogging: true,
    requestIdHeader: false as const,
    genReqId: () => input.observability.requestIdFactory(),
    trustProxy: input.trustLoopbackProxy ? isLoopbackAddress : false,
  };
}

export function registerObservability(
  app: FastifyInstance,
  config: ObservabilityConfig,
): void {
  const requestStartedAt = new WeakMap<FastifyRequest, bigint>();

  app.addHook("onRequest", async (request) => {
    requestStartedAt.set(request, process.hrtime.bigint());
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = clientErrorStatus(error);
    const errorCode = statusCode < 500 ? "INVALID_REQUEST" : "INTERNAL_SERVER_ERROR";
    if (config.enabled) {
      request.log.error(
        {
          event: "http.request.failed",
          request_id: request.id,
          error_code: errorCode,
          method: request.method,
          route: matchedRoute(request),
        },
        "request failed",
      );
    }
    return reply.code(statusCode).send({ error: errorCode });
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!config.enabled) {
      return;
    }
    request.log.info(
      {
        event: "http.request.completed",
        request_id: request.id,
        method: request.method,
        route: matchedRoute(request),
        status: reply.statusCode,
        outcome_code: outcomeCode(reply.statusCode),
        duration_bucket: durationBucket(elapsedMilliseconds(requestStartedAt.get(request))),
      },
      "request completed",
    );
  });
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (normalized === "::1") {
    return true;
  }
  const ipv4 = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  const parts = ipv4.split(".");
  if (parts.length !== 4 || parts[0] !== "127") {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function clientErrorStatus(error: unknown): number {
  const statusCode =
    error && typeof error === "object" && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
    ? statusCode
    : 500;
}

function matchedRoute(request: FastifyRequest): string {
  return request.routeOptions.url || "unmatched";
}

function elapsedMilliseconds(startedAt: bigint | undefined): number {
  if (startedAt === undefined) {
    return 0;
  }
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function durationBucket(milliseconds: number): string {
  if (milliseconds < 10) {
    return "lt_10ms";
  }
  if (milliseconds < 100) {
    return "lt_100ms";
  }
  if (milliseconds < 1000) {
    return "lt_1s";
  }
  return "gte_1s";
}

function outcomeCode(statusCode: number): string {
  if (statusCode < 400) {
    return "OK";
  }
  if (statusCode === 503) {
    return "SERVER_TEMPORARILY_UNAVAILABLE";
  }
  if (statusCode >= 500) {
    return "INTERNAL_SERVER_ERROR";
  }
  return "CLIENT_ERROR";
}
