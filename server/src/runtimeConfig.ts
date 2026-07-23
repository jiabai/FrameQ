import { resolveDatabaseUrlFrom } from "./database.js";

export type RuntimeEnvironment = "development" | "test" | "production";

export type SmtpConfig = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}>;

export type WechatConfig = Readonly<{
  appId: string;
  mchId: string;
  serialNo: string;
  privateKey: string;
  notifyUrl: string;
  apiV3Key: string;
  platformCertPem: string;
  allowInsecureNotify: boolean;
}>;

export type RuntimeConfig = Readonly<{
  environment: RuntimeEnvironment;
  host: string;
  port: number;
  databaseUrl: string;
  adminEmail: string;
  llmConfigEncryptionKey: string | undefined;
  smtp: SmtpConfig | null;
  allowConsoleOtp: boolean;
  trustLoopbackProxy: true;
  wechatPayEnabled: boolean;
  wechat: WechatConfig | null;
  releaseManifestPath: string | undefined;
}>;

export class RuntimeConfigurationError extends Error {
  readonly variables: readonly string[];

  constructor(variables: string[]) {
    const normalized = [...new Set(variables)].sort();
    super(`Invalid runtime configuration: ${normalized.join(", ")}`);
    this.name = "RuntimeConfigurationError";
    this.variables = Object.freeze(normalized);
  }
}

const REQUIRED_SMTP_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
] as const;

const WECHAT_PAYMENT_KEYS = [
  "WECHAT_APP_ID",
  "WECHAT_MCH_ID",
  "WECHAT_MCH_SERIAL_NO",
  "WECHAT_MCH_PRIVATE_KEY",
  "WECHAT_NOTIFY_URL",
] as const;

const WECHAT_NOTIFICATION_KEYS = ["WECHAT_API_V3_KEY", "WECHAT_PLATFORM_CERT_PEM"] as const;

export function parseRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const issues: string[] = [];
  const environment = parseEnvironment(env.NODE_ENV, issues);
  const host = clean(env.FRAMEQ_SERVER_HOST) || "127.0.0.1";
  const port = parsePort(env.FRAMEQ_SERVER_PORT, "FRAMEQ_SERVER_PORT", 8787, issues);
  const databaseUrl = clean(env.DATABASE_URL);
  const adminEmail = clean(env.FRAMEQ_ADMIN_EMAIL);
  const llmConfigEncryptionKey = clean(env.FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY);
  const allowConsoleOtp = parseFlag(
    env.FRAMEQ_ALLOW_CONSOLE_OTP,
    "FRAMEQ_ALLOW_CONSOLE_OTP",
    issues,
  );
  const wechatPayEnabled = parseFlag(env.WECHAT_PAY_ENABLED, "WECHAT_PAY_ENABLED", issues);
  const allowInsecureWechatNotify = parseFlag(
    env.WECHAT_DEV_INSECURE_NOTIFY,
    "WECHAT_DEV_INSECURE_NOTIFY",
    issues,
  );

  if (environment === "production") {
    requireValue(databaseUrl, "DATABASE_URL", issues);
    requireValue(adminEmail, "FRAMEQ_ADMIN_EMAIL", issues);
    requireValue(llmConfigEncryptionKey, "FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY", issues);
    if (llmConfigEncryptionKey && llmConfigEncryptionKey.length < 32) {
      issues.push("FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY");
    }
    if (allowConsoleOtp) {
      issues.push("FRAMEQ_ALLOW_CONSOLE_OTP");
    }
    if (allowInsecureWechatNotify) {
      issues.push("WECHAT_DEV_INSECURE_NOTIFY");
    }
  }

  if (adminEmail && !isEmail(adminEmail)) {
    issues.push("FRAMEQ_ADMIN_EMAIL");
  }

  const smtp = parseSmtpConfig(env, environment, issues);
  if (!smtp && environment !== "production" && !allowConsoleOtp) {
    issues.push("FRAMEQ_ALLOW_CONSOLE_OTP");
  }

  const wechat = wechatPayEnabled
    ? parseWechatConfig(env, allowInsecureWechatNotify, environment, issues)
    : null;

  if (issues.length > 0) {
    throw invalidConfiguration(issues);
  }

  const config: RuntimeConfig = {
    environment,
    host,
    port,
    databaseUrl: databaseUrl || resolveDatabaseUrlFrom(undefined),
    adminEmail: adminEmail || "lantianye@163.com",
    llmConfigEncryptionKey: llmConfigEncryptionKey || undefined,
    smtp,
    allowConsoleOtp,
    trustLoopbackProxy: true,
    wechatPayEnabled,
    wechat,
    releaseManifestPath: clean(env.FRAMEQ_RELEASE_MANIFEST_PATH) || undefined,
  };
  return Object.freeze(config);
}

function parseEnvironment(value: string | undefined, issues: string[]): RuntimeEnvironment {
  const normalized = clean(value) || "development";
  if (normalized === "development" || normalized === "test" || normalized === "production") {
    return normalized;
  }
  issues.push("NODE_ENV");
  return "development";
}

function parseSmtpConfig(
  env: NodeJS.ProcessEnv,
  environment: RuntimeEnvironment,
  issues: string[],
): SmtpConfig | null {
  const values = {
    SMTP_HOST: clean(env.SMTP_HOST),
    SMTP_PORT: clean(env.SMTP_PORT),
    SMTP_USER: clean(env.SMTP_USER),
    SMTP_PASS: clean(env.SMTP_PASS),
    SMTP_FROM: clean(env.SMTP_FROM),
  };
  const hasAnyCredential = [
    values.SMTP_HOST,
    values.SMTP_USER,
    values.SMTP_PASS,
    values.SMTP_FROM,
  ].some(Boolean);
  if (environment !== "production" && !hasAnyCredential) {
    return null;
  }

  for (const key of REQUIRED_SMTP_KEYS) {
    requireValue(values[key], key, issues);
  }
  const port = parsePort(values.SMTP_PORT, "SMTP_PORT", 587, issues);
  if (REQUIRED_SMTP_KEYS.some((key) => !values[key])) {
    return null;
  }

  return Object.freeze({
    host: values.SMTP_HOST,
    port,
    secure: port === 465,
    user: values.SMTP_USER,
    pass: values.SMTP_PASS,
    from: values.SMTP_FROM,
  });
}

function parseWechatConfig(
  env: NodeJS.ProcessEnv,
  allowInsecureNotify: boolean,
  environment: RuntimeEnvironment,
  issues: string[],
): WechatConfig | null {
  const requiredKeys = [
    ...WECHAT_PAYMENT_KEYS,
    ...(allowInsecureNotify && environment !== "production" ? [] : WECHAT_NOTIFICATION_KEYS),
  ];
  for (const key of requiredKeys) {
    requireValue(clean(env[key]), key, issues);
  }
  const apiV3Key = clean(env.WECHAT_API_V3_KEY);
  if (
    !(allowInsecureNotify && environment !== "production") &&
    apiV3Key &&
    Buffer.byteLength(apiV3Key, "utf8") !== 32
  ) {
    issues.push("WECHAT_API_V3_KEY");
  }
  if (requiredKeys.some((key) => !clean(env[key]))) {
    return null;
  }
  return Object.freeze({
    appId: clean(env.WECHAT_APP_ID),
    mchId: clean(env.WECHAT_MCH_ID),
    serialNo: clean(env.WECHAT_MCH_SERIAL_NO),
    privateKey: clean(env.WECHAT_MCH_PRIVATE_KEY).replace(/\\n/g, "\n"),
    notifyUrl: clean(env.WECHAT_NOTIFY_URL),
    apiV3Key,
    platformCertPem: clean(env.WECHAT_PLATFORM_CERT_PEM).replace(/\\n/g, "\n"),
    allowInsecureNotify,
  });
}

function parsePort(
  value: string | undefined,
  name: string,
  defaultValue: number,
  issues: string[],
): number {
  const normalized = clean(value);
  if (!normalized) {
    return defaultValue;
  }
  const port = Number(normalized);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    issues.push(name);
    return defaultValue;
  }
  return port;
}

function parseFlag(value: string | undefined, name: string, issues: string[]): boolean {
  const normalized = clean(value);
  if (!normalized || normalized === "0") {
    return false;
  }
  if (normalized === "1") {
    return true;
  }
  issues.push(name);
  return false;
}

function requireValue(value: string, name: string, issues: string[]): void {
  if (!value) {
    issues.push(name);
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function invalidConfiguration(issues: string[]): Error {
  return new RuntimeConfigurationError(issues);
}
