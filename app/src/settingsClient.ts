import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";

export type LlmConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: string;
  hasApiKey: boolean;
};

export type LlmConfigDraft = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutSeconds: string;
};

export type LlmConfigResponse = {
  provider: string;
  base_url: string;
  model: string;
  timeout_seconds: string;
  has_api_key: boolean;
};

export type SettingsCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<LlmConfigResponse>;

const defaultSettingsRunner: SettingsCommandRunner = (command, args) => invoke(command, args);

export async function getLlmConfig(
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<LlmConfig> {
  return mapLlmConfigResponse(await runner("get_llm_config", {}));
}

export async function saveLlmConfig(
  draft: LlmConfigDraft,
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<LlmConfig> {
  return mapLlmConfigResponse(
    await runner("save_llm_config", {
      config: {
        base_url: draft.baseUrl,
        api_key: draft.apiKey,
        model: draft.model,
        timeout_seconds: draft.timeoutSeconds,
      },
    }),
  );
}

function mapLlmConfigResponse(response: LlmConfigResponse): LlmConfig {
  return {
    provider: response.provider,
    baseUrl: response.base_url,
    model: response.model,
    timeoutSeconds: response.timeout_seconds,
    hasApiKey: response.has_api_key,
  };
}
