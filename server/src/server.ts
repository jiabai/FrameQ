import Fastify from "fastify";
import { ActivationCodeService } from "./activation.js";
import { AdminAuthService } from "./adminAuth.js";
import { AnysearchConfigService } from "./anysearchConfig.js";
import { AuthService } from "./auth.js";
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
import { registerDesktopAccountRoutes } from "./routes/desktopAccount.js";
import { registerDesktopAuthRoutes } from "./routes/desktopAuth.js";
import { registerDesktopLlmRoutes } from "./routes/desktopLlm.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerUserAuthRoutes } from "./routes/userAuth.js";
import {
  SelfServiceActivationService,
  type ActivationCodeEmailSender,
} from "./selfServiceActivation.js";
import type { Store } from "./store.js";
import { UserAuthService } from "./userAuth.js";

export type ServerDependencies = {
  store: Store;
  sendOtp: (email: string, code: string) => Promise<void>;
  sendActivationCode?: ActivationCodeEmailSender;
  selfServiceActivationEnabled?: boolean;
  selfServiceActivationService?: Pick<SelfServiceActivationService, "requestCode"> | null;
  adminEmail?: string;
  llmConfigEncryptionKey?: string;
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
  const userAuth = new UserAuthService({
    store: dependencies.store,
    now,
    sendOtp: dependencies.sendOtp,
  });
  const activationCodes = new ActivationCodeService({
    store: dependencies.store,
    now,
  });
  const selfServiceActivation =
    dependencies.selfServiceActivationEnabled === true
      ? (dependencies.selfServiceActivationService ??
        (dependencies.sendActivationCode
          ? new SelfServiceActivationService({
              store: dependencies.store,
              now,
              sendActivationCode: dependencies.sendActivationCode,
            })
          : null))
      : null;
  const llmConfig = new LlmConfigService({
    store: dependencies.store,
    now,
    encryptionKey: dependencies.llmConfigEncryptionKey,
  });
  const anysearchConfig = new AnysearchConfigService({
    store: dependencies.store,
    now,
    encryptionKey: dependencies.llmConfigEncryptionKey,
  });
  const entitlementAdjustments = new EntitlementAdjustmentService({
    store: dependencies.store,
    now,
  });
  registerHealthRoutes(app, readiness);
  registerDesktopAuthRoutes(app, {
    store: dependencies.store,
    auth,
    secureCookies: dependencies.secureCookies ?? false,
    now,
  });
  registerAdminRoutes(app, {
    store: dependencies.store,
    adminAuth,
    activationCodes,
    llmConfig,
    anysearchConfig,
    entitlementAdjustments,
    secureCookies: dependencies.secureCookies ?? false,
    now,
  });
  registerUserAuthRoutes(app, {
    store: dependencies.store,
    userAuth,
    secureCookies: dependencies.secureCookies ?? false,
    now,
  });
  registerDashboardRoutes(app, {
    store: dependencies.store,
    userAuth,
    llmConfig,
    now,
  });
  registerDesktopAccountRoutes(app, {
    store: dependencies.store,
    activationCodes,
    selfServiceActivationEnabled: dependencies.selfServiceActivationEnabled === true,
    selfServiceActivation,
    llmConfig,
    now,
  });
  registerDesktopLlmRoutes(app, {
    store: dependencies.store,
    llmConfig,
    anysearchConfig,
    now,
  });

  return app;
}
