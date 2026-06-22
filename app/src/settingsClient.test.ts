import { describe, expect, test } from "vitest";
import {
  ASR_MODEL_DOWNLOAD_PROGRESS_EVENT,
  cancelAsrModelDownload,
  checkFirstRun,
  downloadAsrModel,
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
        user_data_dir: "C:\\Users\\demo\\AppData\\Local\\FrameQ",
        default_output_dir: "C:\\Users\\demo\\AppData\\Local\\FrameQ\\outputs",
        asr_model: "iic/SenseVoiceSmall",
        asr_model_dir: "C:\\Users\\demo\\AppData\\Local\\FrameQ\\models",
        asr_model_available: false,
        asr_model_source: "modelscope",
      };
    };

    const status = await checkFirstRun(runner);

    expect(calls).toEqual([{ command: "check_first_run", args: {} }]);
    expect(status).toEqual({
      userDataDir: "C:\\Users\\demo\\AppData\\Local\\FrameQ",
      defaultOutputDir: "C:\\Users\\demo\\AppData\\Local\\FrameQ\\outputs",
      asrModel: "iic/SenseVoiceSmall",
      asrModelDir: "C:\\Users\\demo\\AppData\\Local\\FrameQ\\models",
      asrModelAvailable: false,
      asrModelSource: "modelscope",
    });
  });

  test("starts and cancels ASR model download through Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "download_asr_model") {
        return { started: true };
      }
      return { cancelled: true, error: null };
    };

    await expect(downloadAsrModel(runner)).resolves.toEqual({ started: true });
    await expect(cancelAsrModelDownload(runner)).resolves.toEqual({
      cancelled: true,
      error: null,
    });

    expect(calls).toEqual([
      { command: "download_asr_model", args: {} },
      { command: "cancel_asr_model_download", args: {} },
    ]);
    expect(ASR_MODEL_DOWNLOAD_PROGRESS_EVENT).toBe("asr-model-download-progress");
  });

  test("loads app settings without LLM config from Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        output_dir: "D:\\FrameQ\\outputs",
        asr_model: "iic/SenseVoiceSmall",
        supported_asr_models: ["iic/SenseVoiceSmall"],
      };
    };

    const config = await getLlmConfig(runner);

    expect(calls).toEqual([{ command: "get_llm_config", args: {} }]);
    expect(config).toEqual({
      outputDir: "D:\\FrameQ\\outputs",
      asrModel: "iic/SenseVoiceSmall",
      supportedAsrModels: ["iic/SenseVoiceSmall"],
    });
  });

  test("saves app settings without LLM fields through Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: SettingsCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        output_dir: "D:\\FrameQ\\outputs",
        asr_model: "Qwen/Qwen3-ASR-0.6B",
        supported_asr_models: ["iic/SenseVoiceSmall"],
      };
    };

    const config = await saveLlmConfig(
      {
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
            output_dir: "D:\\FrameQ\\outputs",
            asr_model: "Qwen/Qwen3-ASR-0.6B",
          },
        },
      },
    ]);
    expect(config).toMatchObject({ outputDir: "D:\\FrameQ\\outputs" });
  });

  test("maps Tauri errors to settings errors", async () => {
    const runner: SettingsCommandRunner = async () => {
      throw new Error("Unsupported ASR model");
    };

    await expect(saveLlmConfig({ outputDir: "", asrModel: "iic/SenseVoiceSmall" }, runner)).rejects.toThrow(
      "Unsupported ASR model",
    );
  });
});
