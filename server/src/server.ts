import Fastify from "fastify";
import { ActivationCodeService } from "./activation.js";
import { AdminAuthService } from "./adminAuth.js";
import { AuthService } from "./auth.js";
import { BillingService, type NativePaymentResult } from "./billing.js";
import { EntitlementAdjustmentService } from "./entitlementAdjustment.js";
import { LlmConfigService } from "./llmConfig.js";
import {
  createFastifyOptions,
  createObservabilityConfig,
  registerObservability,
  type ObservabilityConfig,
} from "./observability.js";
import { ReadinessController } from "./readiness.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerDesktopAccountRoutes } from "./routes/desktopAccount.js";
import { registerDesktopAuthRoutes } from "./routes/desktopAuth.js";
import { registerDesktopLlmRoutes } from "./routes/desktopLlm.js";
import { registerDesktopUpdateRoutes } from "./routes/desktopUpdates.js";
import { registerHealthRoutes } from "./routes/health.js";
import type { Store } from "./store.js";
import { loadDesktopReleaseManifest, type DesktopReleaseManifest } from "./updates.js";
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
  observability?: ObservabilityConfig;
  trustLoopbackProxy?: boolean;
  readiness?: ReadinessController;
  secureCookies?: boolean;
  now?: () => Date;
};

export function buildServer(dependencies: ServerDependencies) {
  const observability = dependencies.observability ?? createObservabilityConfig(false);
  const app = Fastify(
    createFastifyOptions({
      observability,
      trustLoopbackProxy: dependencies.trustLoopbackProxy ?? false,
    }),
  );
  registerObservability(app, observability);
  const readiness =
    dependencies.readiness ??
    new ReadinessController({
      verifySchema: async () => {},
      ping: async () => {},
      timeoutMs: 1000,
    });
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
    adminEmail: dependencies.adminEmail,
  });
  const activationCodes = new ActivationCodeService({
    store: dependencies.store,
    now,
  });
  const llmConfig = new LlmConfigService({
    store: dependencies.store,
    now,
    encryptionKey: dependencies.llmConfigEncryptionKey,
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
    dependencies.parseWechatNotification ?? createWechatNotificationParser(null);
  const wechatPayEnabled = dependencies.wechatPayEnabled ?? false;
  const releaseManifest =
    dependencies.releaseManifest ??
    loadDesktopReleaseManifest(
      dependencies.releaseManifestPath,
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

  registerHealthRoutes(app, readiness);
  registerDesktopAuthRoutes(app, { store: dependencies.store, auth, now });
  registerAdminRoutes(app, {
    store: dependencies.store,
    adminAuth,
    activationCodes,
    llmConfig,
    entitlementAdjustments,
    secureCookies: dependencies.secureCookies ?? false,
    now,
  });
  registerDesktopAccountRoutes(app, {
    store: dependencies.store,
    activationCodes,
    llmConfig,
    now,
  });
  registerDesktopLlmRoutes(app, { store: dependencies.store, llmConfig, now });
  registerDesktopUpdateRoutes(app, { releaseManifest });
  registerBillingRoutes(app, {
    store: dependencies.store,
    billing,
    parseWechatNotification,
    wechatPayEnabled,
    now,
  });

  return app;
}
