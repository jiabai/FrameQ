import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  AudioReviewCacheUsage,
  LlmConfig,
  LlmConfigDraft,
} from "../../settingsClient";
import type { InsightPreferenceState } from "../../insightPreferencesClient";
import type { SettingsController } from "./useSettingsController";

type StateUpdater<T> = T | ((current: T) => T);

type HookHarness = {
  resetRender: () => void;
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => T;
  useState: <T>(initialValue: T | (() => T)) => [T, (next: StateUpdater<T>) => void];
};

const mocks = vi.hoisted(() => ({
  clearAudioReviewCache: vi.fn<() => Promise<AudioReviewCacheUsage>>(),
  clearInspirationProfile: vi.fn<() => Promise<InsightPreferenceState>>(),
  getAudioReviewCacheUsage: vi.fn<() => Promise<AudioReviewCacheUsage>>(),
  getInsightPreferences: vi.fn<() => Promise<InsightPreferenceState>>(),
  getLlmConfig: vi.fn<() => Promise<LlmConfig>>(),
  revealItemInDir: vi.fn<(path: string) => Promise<void>>(),
  saveLlmConfig: vi.fn<(draft: LlmConfigDraft) => Promise<LlmConfig>>(),
}));

vi.mock("../../settingsClient", () => ({
  clearAudioReviewCache: mocks.clearAudioReviewCache,
  getAudioReviewCacheUsage: mocks.getAudioReviewCacheUsage,
  getLlmConfig: mocks.getLlmConfig,
  saveLlmConfig: mocks.saveLlmConfig,
}));

vi.mock("../../insightPreferencesClient", () => ({
  clearInspirationProfile: mocks.clearInspirationProfile,
  getInsightPreferences: mocks.getInsightPreferences,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: mocks.revealItemInDir,
}));

function createHookHarness(): HookHarness {
  const states: unknown[] = [];
  let cursor = 0;

  return {
    resetRender: () => {
      cursor = 0;
    },
    useCallback: (callback) => callback,
    useState: <T,>(initialValue: T | (() => T)) => {
      const stateIndex = cursor;
      cursor += 1;
      if (states.length <= stateIndex) {
        states[stateIndex] =
          typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }
      const setState = (next: StateUpdater<T>) => {
        states[stateIndex] =
          typeof next === "function"
            ? (next as (current: T) => T)(states[stateIndex] as T)
            : next;
      };
      return [states[stateIndex] as T, setState];
    },
  };
}

function createLlmConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    outputDir: "D:/FrameQ/outputs",
    asrModel: "iic/SenseVoiceSmall",
    supportedAsrModels: ["iic/SenseVoiceSmall", "Qwen/Qwen3-ASR-0.6B"],
    configPath: "D:/FrameQ/app-data/frameq-settings.json",
    ...overrides,
  };
}

function createAudioCacheUsage(
  overrides: Partial<AudioReviewCacheUsage> = {},
): AudioReviewCacheUsage {
  return {
    sizeBytes: 4096,
    cachePath: "D:/FrameQ/app-cache/.frameq-audio-review",
    ...overrides,
  };
}

function createInsightPreferences(
  overrides: Partial<InsightPreferenceState> = {},
): InsightPreferenceState {
  return {
    profile: null,
    profileSkipped: false,
    profileStatus: "missing",
    profileError: null,
    defaultGenerationPreferences: null,
    preferencesPath: "D:/FrameQ/app-data/insight-preferences.json",
    ...overrides,
  };
}

function mockSettingsLoad(options: {
  config?: LlmConfig;
  audioCacheUsage?: AudioReviewCacheUsage;
  insightPreferences?: InsightPreferenceState;
  insightPreferenceError?: Error;
} = {}) {
  const config = options.config ?? createLlmConfig();
  const audioCacheUsage = options.audioCacheUsage ?? createAudioCacheUsage();
  const insightPreferences = options.insightPreferences ?? createInsightPreferences();

  mocks.getLlmConfig.mockResolvedValueOnce(config);
  mocks.getAudioReviewCacheUsage.mockResolvedValueOnce(audioCacheUsage);
  if (options.insightPreferenceError) {
    mocks.getInsightPreferences.mockRejectedValueOnce(options.insightPreferenceError);
  } else {
    mocks.getInsightPreferences.mockResolvedValueOnce(insightPreferences);
  }

  return { audioCacheUsage, config, insightPreferences };
}

async function createController(): Promise<{
  render: () => SettingsController;
}> {
  const harness = createHookHarness();
  vi.doMock("react", () => ({
    useCallback: harness.useCallback,
    useState: harness.useState,
  }));
  const { useSettingsController } = await import("./useSettingsController");

  return {
    render: () => {
      harness.resetRender();
      return useSettingsController();
    },
  };
}

function createSubmitEvent(): Parameters<SettingsController["submitSettings"]>[0] {
  return {
    preventDefault: vi.fn(),
  } as unknown as Parameters<SettingsController["submitSettings"]>[0];
}

describe("useSettingsController", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
  });

  test("opens settings and loads config, cache usage, and insight preferences", async () => {
    const { audioCacheUsage, config, insightPreferences } = mockSettingsLoad();
    const { render } = await createController();

    let controller = render();
    expect(controller.settingsOpen).toBe(false);
    expect(controller.settingsLoading).toBe(false);

    const load = controller.openSettings();
    controller = render();
    expect(controller.settingsOpen).toBe(true);
    expect(controller.settingsLoading).toBe(true);
    expect(controller.settingsNotice).not.toBe("");

    await load;
    controller = render();
    expect(mocks.getLlmConfig).toHaveBeenCalledTimes(1);
    expect(mocks.getAudioReviewCacheUsage).toHaveBeenCalledTimes(1);
    expect(mocks.getInsightPreferences).toHaveBeenCalledTimes(1);
    expect(controller.settingsOpen).toBe(true);
    expect(controller.settingsLoading).toBe(false);
    expect(controller.settingsDraft).toEqual({
      outputDir: config.outputDir,
      asrModel: config.asrModel,
    });
    expect(controller.settingsSupportedAsrModels).toEqual(config.supportedAsrModels);
    expect(controller.settingsConfigPath).toBe(config.configPath);
    expect(controller.audioReviewCacheUsage).toEqual(audioCacheUsage);
    expect(controller.settingsInsightPreferences).toEqual(insightPreferences);
    expect(controller.settingsNotice).toContain("灵感档案设置");
  });

  test("keeps base settings available when insight preferences fail to load", async () => {
    const { audioCacheUsage, config } = mockSettingsLoad({
      insightPreferenceError: new Error("preferences unavailable"),
    });
    const { render } = await createController();

    let controller = render();
    await controller.openSettings();
    controller = render();

    expect(controller.settingsLoading).toBe(false);
    expect(controller.settingsDraft).toEqual({
      outputDir: config.outputDir,
      asrModel: config.asrModel,
    });
    expect(controller.audioReviewCacheUsage).toEqual(audioCacheUsage);
    expect(controller.settingsInsightPreferences).toBeNull();
    expect(controller.settingsNotice).toContain("灵感档案状态暂不可用");
  });

  test("saves draft settings and refreshes saved config metadata", async () => {
    const savedConfig = createLlmConfig({
      outputDir: "D:/FrameQ/new-output",
      asrModel: "Qwen/Qwen3-ASR-0.6B",
      supportedAsrModels: ["Qwen/Qwen3-ASR-0.6B"],
      configPath: "D:/FrameQ/app-data/new-settings.json",
    });
    mocks.saveLlmConfig.mockResolvedValueOnce(savedConfig);
    const { render } = await createController();

    let controller = render();
    controller.updateSettingsDraft("outputDir", savedConfig.outputDir);
    controller.updateSettingsDraft("asrModel", savedConfig.asrModel);
    controller = render();
    const event = createSubmitEvent();

    await controller.submitSettings(event);
    controller = render();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.saveLlmConfig).toHaveBeenCalledWith({
      outputDir: savedConfig.outputDir,
      asrModel: savedConfig.asrModel,
    });
    expect(controller.settingsSaving).toBe(false);
    expect(controller.settingsDraft).toEqual({
      outputDir: savedConfig.outputDir,
      asrModel: savedConfig.asrModel,
    });
    expect(controller.settingsSupportedAsrModels).toEqual(savedConfig.supportedAsrModels);
    expect(controller.settingsConfigPath).toBe(savedConfig.configPath);
    expect(controller.settingsNotice).toContain("配置已保存");
  });

  test("clears audio review cache and refreshes cache usage", async () => {
    const clearedUsage = createAudioCacheUsage({ sizeBytes: 0 });
    mocks.clearAudioReviewCache.mockResolvedValueOnce(clearedUsage);
    const { render } = await createController();

    let controller = render();
    await controller.clearAudioReviewCacheFromSettings();
    controller = render();

    expect(mocks.clearAudioReviewCache).toHaveBeenCalledTimes(1);
    expect(controller.settingsSaving).toBe(false);
    expect(controller.audioReviewCacheUsage).toEqual(clearedUsage);
    expect(controller.settingsNotice).toContain("缓存已清理");
  });

  test("locates the settings config file when a path is loaded", async () => {
    const { config } = mockSettingsLoad();
    mocks.revealItemInDir.mockResolvedValueOnce();
    const { render } = await createController();

    let controller = render();
    await controller.locateSettingsConfigFile();
    controller = render();
    expect(mocks.revealItemInDir).not.toHaveBeenCalled();
    expect(controller.settingsNotice).toContain("配置文件路径");

    await controller.openSettings();
    controller = render();
    await controller.locateSettingsConfigFile();
    controller = render();

    expect(mocks.revealItemInDir).toHaveBeenCalledWith(config.configPath);
    expect(controller.settingsNotice).toContain("定位本机配置文件");
  });

  test("clears inspiration profile from settings and refreshes preference state", async () => {
    const clearedPreferences = createInsightPreferences({
      profileSkipped: false,
      profileStatus: "missing",
      preferencesPath: "D:/FrameQ/app-data/cleared-preferences.json",
    });
    mocks.clearInspirationProfile.mockResolvedValueOnce(clearedPreferences);
    const { render } = await createController();

    let controller = render();
    await controller.clearProfileFromSettings();
    controller = render();

    expect(mocks.clearInspirationProfile).toHaveBeenCalledTimes(1);
    expect(controller.settingsSaving).toBe(false);
    expect(controller.settingsInsightPreferences).toEqual(clearedPreferences);
    expect(controller.settingsNotice).toContain("已清空灵感档案");
  });
});
