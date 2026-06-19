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
  asrModel: string;
  asrModelDir: string;
  asrModelAvailable: boolean;
  asrModelSource: string;
};

export type FirstRunStatusResponse = {
  missing_llm_config: boolean;
  user_data_dir: string;
  default_output_dir: string;
  asr_model: string;
  asr_model_dir: string;
  asr_model_available: boolean;
  asr_model_source: string;
};

export type AsrModelDownloadResult = {
  started: boolean;
};

export type CancelAsrModelDownloadResult = {
  cancelled: boolean;
  error?: string | null;
};

export type AsrModelDownloadProgress = {
  status: string;
  message: string;
  progress: number;
  currentFile?: string;
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
export const ASR_MODEL_DOWNLOAD_PROGRESS_EVENT = "asr-model-download-progress";

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

export async function downloadAsrModel(
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<AsrModelDownloadResult> {
  return (await runner("download_asr_model", {})) as AsrModelDownloadResult;
}

export async function cancelAsrModelDownload(
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<CancelAsrModelDownloadResult> {
  return (await runner("cancel_asr_model_download", {})) as CancelAsrModelDownloadResult;
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
    asrModel: response.asr_model,
    asrModelDir: response.asr_model_dir,
    asrModelAvailable: response.asr_model_available,
    asrModelSource: response.asr_model_source,
  };
}
