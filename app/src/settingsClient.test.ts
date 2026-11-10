import { describe, expect, test } from "vitest";
import {
  ASR_MODEL_DOWNLOAD_PROGRESS_EVENT,
  cancelAsrModelDownload,
  clearAudioReviewCache,
  dismissAsrModelMigration,
  downloadAsrModel,
  downloadRuntimeComponent,
  getAudioReviewCacheUsage,
  getAsrModelStatus,
  getUiPreferences,
  getLlmConfig,
  saveUiPreferences,
  saveLlmConfig,
  deleteLlmProvider,
  getLlmProviders,
  saveLlmProvider,
  setActiveLlmProvider,
  setLlmSource,
  testLlmConnection,
  type LlmProviderDraft,
  type SettingsCommandRunner,
} from "./settingsClient";
import { IpcProtocolError } from "./tauriIpcProtocol";

describe("settings client", () => {
  test("starts the PyTorch runtime component download through Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { started: true, status: "completed" };
    };

    await expect(downloadRuntimeComponent(runner)).resolves.toEqual({
      started: true,
      status: "completed",
    });
    expect(calls).toEqual([
      { command: "download_runtime_component", args: {} },
    ]);
  });

  test("loads selected ASR model status from Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        user_data_dir: "C:\\Users\\demo\\AppData\\Local\\Locus",
        default_output_dir: "C:\\Users\\demo\\AppData\\Local\\Locus\\outputs",
        asr_model: "iic/SenseVoiceSmall",
        asr_model_dir: "C:\\Users\\demo\\AppData\\Local\\Locus\\models",
        asr_model_available: false,
        asr_model_source: "modelscope",
      };
    };

    const status = await getAsrModelStatus(runner);

    expect(calls).toEqual([
      {
        command: "get_asr_model_status",
        args: { asrModel: "iic/SenseVoiceSmall-onnx" },
      },
    ]);
    expect(status).toEqual({
      userDataDir: "C:\\Users\\demo\\AppData\\Local\\Locus",
      defaultOutputDir: "C:\\Users\\demo\\AppData\\Local\\Locus\\outputs",
      asrModel: "iic/SenseVoiceSmall",
      asrModelDir: "C:\\Users\\demo\\AppData\\Local\\Locus\\models",
      asrModelAvailable: false,
      asrModelSource: "modelscope",
    });
  });

  test("starts and cancels ASR model download through Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "download_asr_model") {
        return { started: true, status: "completed" };
      }
      return { status: "cancelling", error: null };
    };

    await expect(downloadAsrModel(runner)).resolves.toEqual({
      started: true,
      status: "completed",
    });
    await expect(cancelAsrModelDownload(runner)).resolves.toEqual({
      status: "cancelling",
      error: null,
    });

    expect(calls).toEqual([
      {
        command: "download_asr_model",
        args: { asrModel: "iic/SenseVoiceSmall-onnx" },
      },
      { command: "cancel_asr_model_download", args: {} },
    ]);
    expect(ASR_MODEL_DOWNLOAD_PROGRESS_EVENT).toBe("asr-model-download-progress");
  });

  test.each([
    { started: false, status: "completed", secret: "model-result-secret" },
    { started: true, status: "cancelled" },
    { started: false, status: "already_available", extra: true },
  ])("rejects malformed model-download responses without echoing payloads", async (payload) => {
    const runner: SettingsCommandRunner = async () => payload;

    await expect(downloadAsrModel(runner)).rejects.toThrow(
      "INVALID_ASR_MODEL_DOWNLOAD_RESPONSE",
    );
  });

  test.each([
    { status: "cancelling", error: "unexpected", secret: "cancel-result-secret" },
    { status: "failed", error: null },
    { status: "not_running", error: null, extra: true },
  ])("rejects malformed model-cancel responses without echoing payloads", async (payload) => {
    const runner: SettingsCommandRunner = async () => payload;

    await expect(cancelAsrModelDownload(runner)).rejects.toThrow(
      "INVALID_CANCEL_PROCESS_RESPONSE",
    );
  });

  test("loads app settings without LLM config from Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        output_dir: "D:\\Locus\\outputs",
        asr_model: "iic/SenseVoiceSmall",
        supported_asr_models: ["iic/SenseVoiceSmall"],
        config_path: "C:\\Users\\demo\\AppData\\Local\\Locus\\.env",
        asr_model_migrated: true,
      };
    };

    const config = await getLlmConfig(runner);

    expect(calls).toEqual([{ command: "get_llm_config", args: {} }]);
    expect(config).toEqual({
      outputDir: "D:\\Locus\\outputs",
      asrModel: "iic/SenseVoiceSmall",
      supportedAsrModels: ["iic/SenseVoiceSmall"],
      configPath: "C:\\Users\\demo\\AppData\\Local\\Locus\\.env",
      asrModelMigrated: true,
    });
  });

  test("saves app settings without LLM fields through Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        output_dir: "D:\\Locus\\outputs",
        asr_model: "iic/SenseVoiceSmall-onnx",
        supported_asr_models: ["iic/SenseVoiceSmall"],
        config_path: "C:\\Users\\demo\\AppData\\Local\\Locus\\.env",
        asr_model_migrated: false,
      };
    };

    const config = await saveLlmConfig(
      {
        outputDir: "D:\\Locus\\outputs",
        asrModel: "iic/SenseVoiceSmall-onnx",
      },
      runner,
    );

    expect(calls).toEqual([
      {
        command: "save_llm_config",
        args: {
          config: {
            asr_model: "iic/SenseVoiceSmall-onnx",
          },
        },
      },
    ]);
    expect(config).toMatchObject({
      outputDir: "D:\\Locus\\outputs",
      configPath: "C:\\Users\\demo\\AppData\\Local\\Locus\\.env",
    });
  });

  test("dismisses the model migration notice through Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        output_dir: "",
        asr_model: "iic/SenseVoiceSmall-onnx",
        supported_asr_models: [],
        config_path: "C:\\Users\\demo\\AppData\\Local\\Locus\\.env",
        asr_model_migrated: false,
      };
    };

    const config = await dismissAsrModelMigration(runner);

    expect(calls).toEqual([{ command: "dismiss_asr_model_migration", args: {} }]);
    expect(config.asrModelMigrated).toBe(false);
  });

  test("loads and clears audio review cache usage through Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "get_audio_review_cache_usage") {
        return {
          size_bytes: 1_572_864,
          cache_path: "C:\\Users\\demo\\AppData\\Local\\Locus\\cache\\.app-audio-review",
        };
      }
      return {
        size_bytes: 0,
        cache_path: "C:\\Users\\demo\\AppData\\Local\\Locus\\cache\\.app-audio-review",
      };
    };

    await expect(getAudioReviewCacheUsage(runner)).resolves.toEqual({
      sizeBytes: 1_572_864,
      cachePath: "C:\\Users\\demo\\AppData\\Local\\Locus\\cache\\.app-audio-review",
    });
    await expect(clearAudioReviewCache(runner)).resolves.toEqual({
      sizeBytes: 0,
      cachePath: "C:\\Users\\demo\\AppData\\Local\\Locus\\cache\\.app-audio-review",
    });

    expect(calls).toEqual([
      { command: "get_audio_review_cache_usage", args: {} },
      { command: "clear_audio_review_cache", args: {} },
    ]);
  });

  test("rejects malformed runtime settings and model arrays", async () => {
    await expect(
      getLlmConfig(async () => ({
        output_dir: "D:\\Locus\\outputs",
        asr_model: "iic/SenseVoiceSmall",
        supported_asr_models: ["iic/SenseVoiceSmall", 42],
        config_path: "C:\\Users\\private\\Locus\\.env",
        asr_model_migrated: false,
      })),
    ).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
    await expect(
      saveLlmConfig(
        { outputDir: "", asrModel: "iic/SenseVoiceSmall" },
        async () => ({
          output_dir: "",
          asr_model: "iic/SenseVoiceSmall",
          supported_asr_models: [],
          config_path: "C:\\Users\\private\\Locus\\.env",
          asr_model_migrated: false,
          unexpected: true,
        }),
      ),
    ).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
  });

  test("rejects malformed audio cache usage and model-status responses", async () => {
    await expect(
      getAudioReviewCacheUsage(async () => ({
        size_bytes: -1,
        cache_path: "C:\\Users\\private\\cache",
      })),
    ).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
    await expect(
      getAsrModelStatus(async () => ({
        user_data_dir: "C:\\Users\\private\\Locus",
        default_output_dir: "C:\\Users\\private\\Locus\\outputs",
        asr_model: "iic/SenseVoiceSmall",
        asr_model_dir: "C:\\Users\\private\\Locus\\models",
        asr_model_available: "false",
        asr_model_source: "modelscope",
      })),
    ).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
  });

  test("maps Tauri errors to settings errors", async () => {
    const runner: SettingsCommandRunner = async () => {
      throw new Error("Unsupported ASR model");
    };

    await expect(saveLlmConfig({ outputDir: "", asrModel: "iic/SenseVoiceSmall" }, runner)).rejects.toThrow(
      "Unsupported ASR model",
    );
  });

  test("strictly loads and maps UI preferences from Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { schemaVersion: 1, language: "zh-TW", recovered: false };
    };

    await expect(getUiPreferences(runner)).resolves.toEqual({
      schemaVersion: 1,
      language: "zh-TW",
      recovered: false,
    });
    expect(calls).toEqual([{ command: "get_ui_preferences", args: {} }]);
  });

  test("saves only the UI language preference through the exact command envelope", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { schemaVersion: 1, language: "system", recovered: false };
    };

    await expect(saveUiPreferences("system", runner)).resolves.toEqual({
      schemaVersion: 1,
      language: "system",
      recovered: false,
    });
    expect(calls).toEqual([
      {
        command: "save_ui_preferences",
        args: { preferences: { language: "system" } },
      },
    ]);
  });

  test.each([
    null,
    {},
    { schemaVersion: 2, language: "system", recovered: false },
    { schemaVersion: 1, language: "fr-FR", recovered: false },
    { schemaVersion: 1, language: "system", recovered: "false" },
    { schemaVersion: 1, language: "system", recovered: false, extra: true },
  ])("rejects malformed UI preference responses without echoing payloads", async (payload) => {
    const runner: SettingsCommandRunner = async () => payload;
    await expect(getUiPreferences(runner)).rejects.toThrow(
      "INVALID_UI_PREFERENCES_RESPONSE",
    );
  });

  test("does not evaluate accessor-backed UI preferences", async () => {
    let getterCalls = 0;
    const response = Object.defineProperty(
      { schemaVersion: 1, language: "system" },
      "recovered",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return false;
        },
      },
    );

    await expect(getUiPreferences(async () => response)).rejects.toThrow(
      "INVALID_UI_PREFERENCES_RESPONSE",
    );
    expect(getterCalls).toBe(0);
  });

  test("uses an immediate in-memory UI-preferences mock outside Tauri", async () => {
    await expect(getUiPreferences()).resolves.toMatchObject({
      schemaVersion: 1,
      language: "en-US",
      recovered: false,
    });
  });
});

describe("BYOK LLM provider client", () => {
  const providerWire = {
    id: "provider-1",
    label: "DeepSeek",
    provider: "openai_compatible",
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    timeout_seconds: 30,
    has_key: true,
  };
  const providersWire = {
    source: "byok",
    active_id: "provider-1",
    providers: [providerWire],
  };
  const mappedView = {
    id: "provider-1",
    label: "DeepSeek",
    provider: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    timeoutSeconds: 30,
    hasKey: true,
  };
  const mappedState = {
    source: "byok",
    activeId: "provider-1",
    providers: [mappedView],
  };

  function capture() {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return providersWire;
    };
    return { calls, runner };
  }

  const draft: LlmProviderDraft = {
    label: "DeepSeek",
    provider: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    timeoutSeconds: 30,
    apiKey: "sk-secret-value",
  };
  const providerEnvelope = {
    label: "DeepSeek",
    provider: "openai_compatible",
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    timeout_seconds: 30,
  };

  test("lists providers through the exact command and maps has_key without any key", async () => {
    const { calls, runner } = capture();

    await expect(getLlmProviders(runner)).resolves.toEqual(mappedState);
    expect(calls).toEqual([{ command: "list_llm_providers", args: {} }]);
    expect(Object.keys((await getLlmProviders(runner)).providers[0])).not.toContain("apiKey");
    expect(JSON.stringify(mappedState)).not.toContain("sk-");
  });

  test("maps an empty provider list with a null active id", async () => {
    const runner: SettingsCommandRunner = async () => ({
      source: "managed",
      active_id: null,
      providers: [],
    });

    await expect(getLlmProviders(runner)).resolves.toEqual({
      source: "managed",
      activeId: null,
      providers: [],
    });
  });

  test("saves a new provider with Tauri's camelCase key argument", async () => {
    const { calls, runner } = capture();

    await expect(saveLlmProvider(draft, runner)).resolves.toEqual(mappedState);
    expect(calls).toEqual([
      {
        command: "save_llm_provider",
        args: { provider: providerEnvelope, apiKey: "sk-secret-value" },
      },
    ]);
    // Tauri renames top-level command arguments to camelCase; sending the raw
    // snake_case name silently arrives as null and breaks every save.
    expect(Object.keys(calls[0].args as Record<string, unknown>)).not.toContain(
      "api_key",
    );
  });

  test("edits a provider with its id and a null key to keep the stored secret", async () => {
    const { calls, runner } = capture();

    await saveLlmProvider({ ...draft, id: "provider-1", apiKey: null }, runner);
    expect(calls).toEqual([
      {
        command: "save_llm_provider",
        args: {
          provider: { id: "provider-1", ...providerEnvelope },
          apiKey: null,
        },
      },
    ]);
  });

  test("deletes a provider by id", async () => {
    const { calls, runner } = capture();

    await expect(deleteLlmProvider("provider-1", runner)).resolves.toEqual(mappedState);
    expect(calls).toEqual([
      { command: "delete_llm_provider", args: { id: "provider-1" } },
    ]);
  });

  test("sets the active provider by id", async () => {
    const { calls, runner } = capture();

    await expect(setActiveLlmProvider("provider-1", runner)).resolves.toEqual(mappedState);
    expect(calls).toEqual([
      { command: "set_active_llm_provider", args: { id: "provider-1" } },
    ]);
  });

  test.each(["managed", "byok"] as const)(
    "switches the LLM source to %s",
    async (source) => {
      const { calls, runner } = capture();

      await expect(setLlmSource(source, runner)).resolves.toEqual(mappedState);
      expect(calls).toEqual([{ command: "set_llm_source", args: { source } }]);
    },
  );

  test("probes a new connection and maps the failure result", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { ok: false, error_code: "LLM_PROBE_AUTH_FAILED", latency_ms: 812 };
    };

    await expect(testLlmConnection(draft, runner)).resolves.toEqual({
      ok: false,
      errorCode: "LLM_PROBE_AUTH_FAILED",
      latencyMs: 812,
    });
    expect(calls).toEqual([
      {
        command: "test_llm_connection",
        args: {
          config: {
            provider: "openai_compatible",
            base_url: "https://api.deepseek.com/v1",
            model: "deepseek-chat",
            timeout_seconds: 30,
          },
          apiKey: "sk-secret-value",
        },
      },
    ]);
  });

  test("probes an existing provider with its id and a null key", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { ok: true, error_code: null, latency_ms: 120 };
    };

    await expect(
      testLlmConnection({ ...draft, id: "provider-1", apiKey: null }, runner),
    ).resolves.toEqual({ ok: true, errorCode: null, latencyMs: 120 });
    expect(calls).toEqual([
      {
        command: "test_llm_connection",
        args: {
          config: {
            provider: "openai_compatible",
            base_url: "https://api.deepseek.com/v1",
            model: "deepseek-chat",
            timeout_seconds: 30,
          },
          apiKey: null,
          id: "provider-1",
        },
      },
    ]);
  });

  const invalidProvidersResponses: unknown[] = [
    null,
    {},
    { source: "unknown", active_id: null, providers: [] },
    { source: "managed", active_id: 42, providers: [] },
    { source: "managed", active_id: null, providers: "not-an-array" },
    { source: "managed", active_id: null, providers: [], extra: true },
    {
      source: "managed",
      active_id: null,
      providers: [{ ...providerWire, api_key: "sk-leak" }],
    },
    {
      source: "managed",
      active_id: null,
      providers: [{ ...providerWire, has_key: "true" }],
    },
    {
      source: "managed",
      active_id: null,
      providers: [{ ...providerWire, provider: "anthropic" }],
    },
    {
      source: "managed",
      active_id: null,
      providers: [{ ...providerWire, timeout_seconds: "30" }],
    },
    { source: "managed", active_id: null, providers: [{ id: "incomplete" }] },
  ];

  test.each(invalidProvidersResponses.map((payload) => [payload]))(
    "rejects malformed provider list response %#",
    async (payload) => {
      const runner: SettingsCommandRunner = async () => payload;
      await expect(getLlmProviders(runner)).rejects.toEqual(
        new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
      );
    },
  );

  test("shares the strict parser across provider mutation commands", async () => {
    const runner: SettingsCommandRunner = async () => ({
      source: "byok",
      active_id: null,
      providers: [{ ...providerWire, api_key: "sk-leak" }],
    });

    await expect(saveLlmProvider(draft, runner)).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
    await expect(deleteLlmProvider("provider-1", runner)).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
    await expect(setActiveLlmProvider("provider-1", runner)).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
    await expect(setLlmSource("byok", runner)).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
  });

  test.each(
    [
      null,
      {},
      { ok: "true", error_code: null, latency_ms: 1 },
      { ok: true, error_code: 5, latency_ms: 1 },
      { ok: true, error_code: null, latency_ms: -1 },
      { ok: true, error_code: null, latency_ms: 1, extra: true },
    ].map((payload) => [payload]),
  )("rejects malformed probe response %#", async (payload) => {
    const runner: SettingsCommandRunner = async () => payload;
    await expect(testLlmConnection(draft, runner)).rejects.toEqual(
      new IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID"),
    );
  });

  test("surfaces Tauri command errors without echoing payloads", async () => {
    const runner: SettingsCommandRunner = async () => {
      throw new Error("keyring unavailable");
    };

    await expect(getLlmProviders(runner)).rejects.toThrow("keyring unavailable");
  });
});
