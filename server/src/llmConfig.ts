import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { LlmConfigRecord, Store } from "./store.js";

const DEFAULT_PROVIDER = "openai_compatible";
const DEFAULT_TIMEOUT_SECONDS = 60;

export type PublicLlmConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  hasApiKey: boolean;
  apiKeyLast4: string;
  updatedAt: Date | null;
};

export type DesktopLlmConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutSeconds: number;
};

export class LlmConfigService {
  constructor(
    private readonly options: {
      store: Store;
      encryptionKey?: string;
      now?: () => Date;
    },
  ) {}

  async getPublicConfig(): Promise<PublicLlmConfig> {
    const config = await this.options.store.getLlmConfig();
    return publicConfig(config);
  }

  async isConfigured(): Promise<boolean> {
    const config = await this.options.store.getLlmConfig();
    return Boolean(config && config.encryptedApiKey && config.baseUrl && config.model);
  }

  async saveConfig(input: {
    provider: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
    timeoutSeconds: number;
  }): Promise<PublicLlmConfig> {
    const now = this.options.now?.() ?? new Date();
    const existing = await this.options.store.getLlmConfig();
    const apiKey = input.apiKey?.trim() || "";
    if (!apiKey && !existing) {
      throw new Error("LLM API key is required.");
    }
    const encryptedApiKey = apiKey
      ? encryptSecret(apiKey, requireEncryptionKey(this.options.encryptionKey))
      : existing?.encryptedApiKey ?? "";
    const apiKeyLast4 = apiKey ? apiKey.slice(-4) : existing?.apiKeyLast4 ?? "";
    const saved = await this.options.store.upsertLlmConfig(
      {
        provider: normalizeProvider(input.provider),
        baseUrl: normalizeBaseUrl(input.baseUrl),
        model: normalizeRequired(input.model, "LLM model"),
        encryptedApiKey,
        apiKeyLast4,
        timeoutSeconds: normalizeTimeout(input.timeoutSeconds),
      },
      now,
    );
    return publicConfig(saved);
  }

  async getDesktopConfig(): Promise<DesktopLlmConfig | null> {
    const config = await this.options.store.getLlmConfig();
    if (!config || !config.encryptedApiKey || !config.baseUrl || !config.model) {
      return null;
    }
    return {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: decryptSecret(config.encryptedApiKey, requireEncryptionKey(this.options.encryptionKey)),
      timeoutSeconds: config.timeoutSeconds,
    };
  }
}

function publicConfig(config: LlmConfigRecord | null): PublicLlmConfig {
  return {
    provider: config?.provider ?? DEFAULT_PROVIDER,
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? "",
    timeoutSeconds: config?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    hasApiKey: Boolean(config?.encryptedApiKey),
    apiKeyLast4: config?.apiKeyLast4 ?? "",
    updatedAt: config?.updatedAt ?? null,
  };
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase() || DEFAULT_PROVIDER;
  if (!["openai", "openai_compatible"].includes(normalized)) {
    throw new Error("Unsupported LLM provider.");
  }
  return normalized;
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = normalizeRequired(baseUrl, "LLM base URL").replace(/\/+$/, "");
  if (!normalized.startsWith("https://") && !normalized.startsWith("http://")) {
    throw new Error("LLM base URL must start with http:// or https://.");
  }
  return normalized;
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeTimeout(timeoutSeconds: number): number {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600) {
    throw new Error("LLM timeout seconds must be between 1 and 600.");
  }
  return timeoutSeconds;
}

export function requireEncryptionKey(rawKey: string | undefined): Buffer {
  const key = rawKey?.trim();
  if (!key) {
    throw new Error("FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY is required.");
  }
  return createHash("sha256").update(key).digest();
}

export function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, rawIv, rawTag, rawCiphertext] = payload.split(":");
  if (version !== "v1" || !rawIv || !rawTag || !rawCiphertext) {
    throw new Error("Stored LLM API key is invalid.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(rawIv, "base64"));
  decipher.setAuthTag(Buffer.from(rawTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(rawCiphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
