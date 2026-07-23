import "./env.js";
import { createServerLifecycle } from "./bootstrap.js";
import { createDatabaseReadinessChecks, createPrismaClient } from "./database.js";
import { createOtpSender } from "./email.js";
import { createObservabilityConfig } from "./observability.js";
import { PrismaStore } from "./prismaStore.js";
import { ReadinessController } from "./readiness.js";
import { parseRuntimeConfig, RuntimeConfigurationError } from "./runtimeConfig.js";
import { buildServer } from "./server.js";
import { createWechatNativePayment, createWechatNotificationParser } from "./wechat.js";

async function main(): Promise<void> {
  const runtimeConfig = parseRuntimeConfig(process.env);
  const prisma = await createPrismaClient(runtimeConfig.databaseUrl);
  try {
    const readiness = new ReadinessController({
      ...createDatabaseReadinessChecks(prisma),
      timeoutMs: 1000,
    });
    const app = buildServer({
      store: new PrismaStore(prisma),
      sendOtp: createOtpSender(runtimeConfig),
      createNativePayment: createWechatNativePayment(runtimeConfig.wechat),
      parseWechatNotification: createWechatNotificationParser(runtimeConfig.wechat),
      adminEmail: runtimeConfig.adminEmail,
      wechatPayEnabled: runtimeConfig.wechatPayEnabled,
      llmConfigEncryptionKey: runtimeConfig.llmConfigEncryptionKey,
      releaseManifestPath: runtimeConfig.releaseManifestPath,
      observability: createObservabilityConfig(runtimeConfig.environment === "production"),
      trustLoopbackProxy: runtimeConfig.trustLoopbackProxy,
      readiness,
      secureCookies: runtimeConfig.environment === "production",
    });
    const lifecycle = createServerLifecycle({
      app,
      readiness,
      listen: { host: runtimeConfig.host, port: runtimeConfig.port },
      disconnect: () => prisma.$disconnect(),
      shutdownDeadlineMs: 15_000,
      logger: {
        info: (fields, message) => app.log.info(fields, message),
        error: (fields, message) => app.log.error(fields, message),
      },
    });

    await lifecycle.start();
    lifecycle.installSignalHandlers();
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}

await main().catch((error: unknown) => {
  const failure =
    error instanceof RuntimeConfigurationError
      ? {
          event: "lifecycle.server.config_rejected",
          error_code: "RUNTIME_CONFIGURATION_INVALID",
          variables: error.variables,
        }
      : {
          event: "lifecycle.server.start_failed",
          error_code: "SERVER_STARTUP_FAILED",
        };
  console.error(
    JSON.stringify(failure),
  );
  process.exitCode = 1;
});
