import { describe, expect, test } from "vitest";
import {
  checkFirstRun,
  getLlmConfig,
  saveLlmConfig,
  type SettingsCommandRunner,
} from "./settingsClient";

describe("settings client", () => {
  test("loads first-run status from Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        missing_llm_config: true,
        user_data_dir: "C:\\Users\\demo\\AppData\\Local\\FrameQ",
        default_output_dir: "C:\\Users\\demo\\AppData\\Local\\FrameQ\\outputs",
        bundled_model: "iic/SenseVoiceSmall",
        bundled_model_available: true,
      };
    };

    const status = await checkFirstRun(runner);

    expect(calls).toEqual([{ command: "check_first_run", args: {} }]);
    expect(status).toEqual({
      missingLlmConfig: true,
      userDataDir: "C:\\Users\\demo\\AppData\\Local\\FrameQ",
      defaultOutputDir: "C:\\Users\\demo\\AppData\\Local\\FrameQ\\outputs",
      bundledModel: "iic/SenseVoiceSmall",
      bundledModelAvailable: true,
    });
  });

  test("loads sanitized LLM config from Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        provider: "openai_compatible",
        base_url: "https://llm.example/v1",
        model: "demo-model",
        timeout_seconds: "30",
        output_dir: "D:\\FrameQ\\outputs",
        asr_model: "iic/SenseVoiceSmall",
        supported_asr_models: ["iic/SenseVoiceSmall"],
        has_api_key: true,
      };
    };

    const config = await getLlmConfig(runner);

    expect(calls).toEqual([{ command: "get_llm_config", args: {} }]);
    expect(config).toEqual({
      provider: "openai_compatible",
      baseUrl: "https://llm.example/v1",
      model: "demo-model",
      timeoutSeconds: "30",
      outputDir: "D:\\FrameQ\\outputs",
      asrModel: "iic/SenseVoiceSmall",
      supportedAsrModels: ["iic/SenseVoiceSmall"],
      hasApiKey: true,
    });
  });

  test("saves LLM config through Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        provider: "openai_compatible",
        base_url: "https://llm.example/v1",
        model: "demo-model",
        timeout_seconds: "30",
        output_dir: "D:\\FrameQ\\outputs",
        asr_model: "Qwen/Qwen3-ASR-0.6B",
        supported_asr_models: ["iic/SenseVoiceSmall"],
        has_api_key: true,
      };
    };

    const config = await saveLlmConfig(
      {
        baseUrl: "https://llm.example/v1",
        apiKey: "secret",
        model: "demo-model",
        timeoutSeconds: "30",
        outputDir: "D:\\FrameQ\\outputs",
        asrModel: "Qwen/Qwen3-ASR-0.6B",
      },
      runner,
    );

    expect(calls).toEqual([
      {
        command: "save_llm_config",
        args: {
          config: {
            base_url: "https://llm.example/v1",
            api_key: "secret",
            model: "demo-model",
            timeout_seconds: "30",
            output_dir: "D:\\FrameQ\\outputs",
            asr_model: "Qwen/Qwen3-ASR-0.6B",
          },
        },
      },
    ]);
    expect(config.hasApiKey).toBe(true);
  });

  test("maps Tauri errors to settings errors", async () => {
    const runner: SettingsCommandRunner = async () => {
      throw new Error("LLM API key is required");
    };

    await expect(
      saveLlmConfig(
        {
          baseUrl: "https://llm.example/v1",
          apiKey: "",
          model: "demo-model",
          timeoutSeconds: "30",
          outputDir: "",
          asrModel: "iic/SenseVoiceSmall",
        },
        runner,
      ),
    ).rejects.toThrow("LLM API key is required");
  });
});
