import Fastify from "fastify";
import { ActivationCodeService } from "./activation.js";
import { AdminAuthService } from "./adminAuth.js";
import { AuthService } from "./auth.js";
import { BillingService, type NativePaymentResult } from "./billing.js";
import { EntitlementAdjustmentService } from "./entitlementAdjustment.js";
import { LlmConfigService } from "./llmConfig.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerDesktopAccountRoutes } from "./routes/desktopAccount.js";
import { registerDesktopAuthRoutes } from "./routes/desktopAuth.js";
import { registerDesktopLlmRoutes } from "./routes/desktopLlm.js";
import { registerDesktopUpdateRoutes } from "./routes/desktopUpdates.js";
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
  now?: () => Date;
};

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

  registerDesktopAuthRoutes(app, { store: dependencies.store, auth, now });
  registerAdminRoutes(app, {
    store: dependencies.store,
    adminAuth,
    activationCodes,
    llmConfig,
    entitlementAdjustments,
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
