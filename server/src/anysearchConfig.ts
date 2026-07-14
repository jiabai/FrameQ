import type { AnysearchConfigRecord, Store } from "./store.js";
import { decryptSecret, encryptSecret, requireEncryptionKey } from "./llmConfig.js";

export type PublicAnysearchConfig = {
  mcpUrl: string;
  hasApiKey: boolean;
  apiKeyLast4: string;
  updatedAt: Date | null;
};

export type DesktopAnysearchConfig = {
  mcpUrl: string;
  apiKey: string | null;
};

export class AnysearchConfigService {
  constructor(
    private readonly options: {
      store: Store;
      encryptionKey?: string;
      now?: () => Date;
    },
  ) {}

  async getPublicConfig(): Promise<PublicAnysearchConfig> {
    const config = await this.options.store.getAnysearchConfig();
    return publicConfig(config);
  }

  async isConfigured(): Promise<boolean> {
    const config = await this.options.store.getAnysearchConfig();
    return Boolean(config && config.mcpUrl);
  }

  async saveConfig(input: {
    mcpUrl: string;
    apiKey?: string;
    clearApiKey?: boolean;
  }): Promise<PublicAnysearchConfig> {
    const now = this.options.now?.() ?? new Date();
    const existing = await this.options.store.getAnysearchConfig();
    const mcpUrl = normalizeMcpUrl(input.mcpUrl);
    const providedKey = input.apiKey?.trim() || "";
    let encryptedApiKey: string;
    let apiKeyLast4: string;
    if (input.clearApiKey) {
      encryptedApiKey = "";
      apiKeyLast4 = "";
    } else if (providedKey) {
      encryptedApiKey = encryptSecret(providedKey, requireEncryptionKey(this.options.encryptionKey));
      apiKeyLast4 = providedKey.slice(-4);
    } else {
      encryptedApiKey = existing?.encryptedApiKey ?? "";
      apiKeyLast4 = existing?.apiKeyLast4 ?? "";
    }
    const saved = await this.options.store.upsertAnysearchConfig(
      { mcpUrl, encryptedApiKey, apiKeyLast4 },
      now,
    );
    return publicConfig(saved);
  }

  async getDesktopConfig(): Promise<DesktopAnysearchConfig | null> {
    const config = await this.options.store.getAnysearchConfig();
    if (!config || !config.mcpUrl) {
      return null;
    }
    const apiKey = config.encryptedApiKey
      ? decryptSecret(config.encryptedApiKey, requireEncryptionKey(this.options.encryptionKey))
      : null;
    return { mcpUrl: config.mcpUrl, apiKey };
  }
}

function publicConfig(config: AnysearchConfigRecord | null): PublicAnysearchConfig {
  return {
    mcpUrl: config?.mcpUrl ?? "",
    hasApiKey: Boolean(config?.encryptedApiKey),
    apiKeyLast4: config?.apiKeyLast4 ?? "",
    updatedAt: config?.updatedAt ?? null,
  };
}

function normalizeMcpUrl(mcpUrl: string): string {
  const normalized = mcpUrl.trim();
  if (!normalized) {
    throw new Error("Anysearch MCP URL is required.");
  }
  const stripped = normalized.replace(/\/+$/, "");
  if (!stripped.startsWith("https://") && !stripped.startsWith("http://")) {
    throw new Error("Anysearch MCP URL must start with http:// or https://.");
  }
  return stripped;
}
