import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type {
  AsrModelDownloadWireStatus,
  ProgressMessageDescriptor,
} from "./desktopWorkerProtocol";
import { isLanguagePreference, type LanguagePreference } from "./i18n/locale";
import type { AsrModelDownloadLocalPhase } from "./modelDownloadState";

export {
  ASR_MODEL_DOWNLOAD_PROGRESS_EVENT,
  parseAsrModelDownloadProgressEvent,
} from "./desktopWorkerProtocol";

export type LlmConfig = {
  outputDir: string;
  asrModel: string;
  supportedAsrModels: string[];
  configPath: string;
};

export type LlmConfigDraft = {
  outputDir: string;
  asrModel: string;
};

export type FirstRunStatus = {
  userDataDir: string;
  defaultOutputDir: string;
  asrModel: string;
  asrModelDir: string;
  asrModelAvailable: boolean;
  asrModelSource: string;
};

export type FirstRunStatusResponse = {
  user_data_dir: string;
  default_output_dir: string;
  asr_model: string;
  asr_model_dir: string;
  asr_model_available: boolean;
  asr_model_source: string;
};

export type AsrModelDownloadResult = {
  started: boolean;
  status: "completed" | "cancelled" | "already_available";
};

export type CancelAsrModelDownloadResult = {
  status: "cancelling" | "already_cancelling" | "not_running" | "failed";
  error?: string | null;
};

export type AsrModelDownloadProgress = {
  phase: AsrModelDownloadLocalPhase;
  wireStatus: AsrModelDownloadWireStatus | null;
  message: ProgressMessageDescriptor | null;
  progress: number;
  currentFile?: string;
};

export type LlmConfigResponse = {
  output_dir: string;
  asr_model: string;
  supported_asr_models: string[];
  config_path: string;
};

export type AudioReviewCacheUsage = {
  sizeBytes: number;
  cachePath: string;
};

export type AudioReviewCacheUsageResponse = {
  size_bytes: number;
  cache_path: string;
};

export type SettingsCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;

export type UiPreferencesView = {
  schemaVersion: 1;
  language: LanguagePreference;
  recovered: boolean;
};

const defaultSettingsRunner: SettingsCommandRunner = (command, args) => invoke(command, args);
let browserUiPreferences: UiPreferencesView = {
  schemaVersion: 1,
  language: "system",
  recovered: false,
};

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

const defaultUiPreferencesRunner: SettingsCommandRunner = async (command, args) => {
  if (hasTauriRuntime()) {
    return invoke(command, args);
  }

  if (command === "get_ui_preferences") {
    return { ...browserUiPreferences };
  }
  if (command === "save_ui_preferences") {
    const language = (args as { preferences?: { language?: unknown } }).preferences?.language;
    if (!isLanguagePreference(language)) {
      throw new Error("INVALID_UI_PREFERENCES_REQUEST");
    }
    browserUiPreferences = { schemaVersion: 1, language, recovered: false };
    return { ...browserUiPreferences };
  }
  throw new Error("UNSUPPORTED_UI_PREFERENCES_COMMAND");
};

export async function getUiPreferences(
  runner: SettingsCommandRunner = defaultUiPreferencesRunner,
): Promise<UiPreferencesView> {
  return mapUiPreferencesResponse(await runner("get_ui_preferences", {}));
}

export async function saveUiPreferences(
  language: LanguagePreference,
  runner: SettingsCommandRunner = defaultUiPreferencesRunner,
): Promise<UiPreferencesView> {
  return mapUiPreferencesResponse(
    await runner("save_ui_preferences", { preferences: { language } }),
  );
}

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
        output_dir: draft.outputDir,
        asr_model: draft.asrModel,
      },
    })) as LlmConfigResponse,
  );
}

export async function getAudioReviewCacheUsage(
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<AudioReviewCacheUsage> {
  return mapAudioReviewCacheUsageResponse(
    (await runner("get_audio_review_cache_usage", {})) as AudioReviewCacheUsageResponse,
  );
}

export async function clearAudioReviewCache(
  runner: SettingsCommandRunner = defaultSettingsRunner,
): Promise<AudioReviewCacheUsage> {
  return mapAudioReviewCacheUsageResponse(
    (await runner("clear_audio_review_cache", {})) as AudioReviewCacheUsageResponse,
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
    outputDir: response.output_dir,
    asrModel: response.asr_model,
    supportedAsrModels: response.supported_asr_models,
    configPath: response.config_path,
  };
}

function mapFirstRunStatusResponse(response: FirstRunStatusResponse): FirstRunStatus {
  return {
    userDataDir: response.user_data_dir,
    defaultOutputDir: response.default_output_dir,
    asrModel: response.asr_model,
    asrModelDir: response.asr_model_dir,
    asrModelAvailable: response.asr_model_available,
    asrModelSource: response.asr_model_source,
  };
}

function mapAudioReviewCacheUsageResponse(
  response: AudioReviewCacheUsageResponse,
): AudioReviewCacheUsage {
  return {
    sizeBytes: response.size_bytes,
    cachePath: response.cache_path,
  };
}

function mapUiPreferencesResponse(response: unknown): UiPreferencesView {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("INVALID_UI_PREFERENCES_RESPONSE");
  }

  const record = response as Record<string, unknown>;
  const expectedKeys = ["language", "recovered", "schemaVersion"];
  if (
    JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys) ||
    record.schemaVersion !== 1 ||
    !isLanguagePreference(record.language) ||
    typeof record.recovered !== "boolean"
  ) {
    throw new Error("INVALID_UI_PREFERENCES_RESPONSE");
  }

  return {
    schemaVersion: 1,
    language: record.language,
    recovered: record.recovered,
  };
}
