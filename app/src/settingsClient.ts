import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";

export type LlmConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: string;
  outputDir: string;
  asrModel: string;
  supportedAsrModels: string[];
  hasApiKey: boolean;
};

export type LlmConfigDraft = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutSeconds: string;
  outputDir: string;
  asrModel: string;
};

export type FirstRunStatus = {
  missingLlmConfig: boolean;
  userDataDir: string;
  defaultOutputDir: string;
  bundledModel: string;
  bundledModelAvailable: boolean;
};

export type FirstRunStatusResponse = {
  missing_llm_config: boolean;
  user_data_dir: string;
  default_output_dir: string;
  bundled_model: string;
  bundled_model_available: boolean;
};

export type LlmConfigResponse = {
  provider: string;
  base_url: string;
  model: string;
  timeout_seconds: string;
  output_dir: string;
  asr_model: string;
  supported_asr_models: string[];
  has_api_key: boolean;
};

export type SettingsCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;

const defaultSettingsRunner: SettingsCommandRunner = (command, args) => invoke(command, args);

export async function getLlmConfig(
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<LlmConfig> {
  return mapLlmConfigResponse((await runner("get_llm_config", {})) as LlmConfigResponse);
}

export async function saveLlmConfig(
  draft: LlmConfigDraft,
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<LlmConfig> {
  return mapLlmConfigResponse(
    (await runner("save_llm_config", {
      config: {
        base_url: draft.baseUrl,
        api_key: draft.apiKey,
        model: draft.model,
        timeout_seconds: draft.timeoutSeconds,
        output_dir: draft.outputDir,
        asr_model: draft.asrModel,
      },
    })) as LlmConfigResponse,
  );
}

export async function checkFirstRun(
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<FirstRunStatus> {
  return mapFirstRunStatusResponse(
    (await runner("check_first_run", {})) as FirstRunStatusResponse,
  );
}

function mapLlmConfigResponse(response: LlmConfigResponse): LlmConfig {
  return {
    provider: response.provider,
    baseUrl: response.base_url,
    model: response.model,
    timeoutSeconds: response.timeout_seconds,
    outputDir: response.output_dir,
    asrModel: response.asr_model,
    supportedAsrModels: response.supported_asr_models,
    hasApiKey: response.has_api_key,
  };
}

function mapFirstRunStatusResponse(response: FirstRunStatusResponse): FirstRunStatus {
  return {
    missingLlmConfig: response.missing_llm_config,
    userDataDir: response.user_data_dir,
    defaultOutputDir: response.default_output_dir,
    bundledModel: response.bundled_model,
    bundledModelAvailable: response.bundled_model_available,
  };
}
