import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { frameqI18n, initializeI18n } from "../../i18n/i18n";
import type { SupportedLocale } from "../../i18n/locale";
import { uiMessage } from "../../i18n/uiMessage";
import { createInitialUpdateState } from "../../updateState";
import type { UpdateState } from "../../updateState";
import { SettingsSheet } from "./SettingsSheet";
import type { SettingsCategory, SettingsController } from "./useSettingsController";

vi.mock("./LanguagePreferenceField", () => ({
  LanguagePreferenceField: () => null,
}));

function controller(
  category: SettingsCategory,
  overrides: Partial<SettingsController> = {},
): SettingsController {
  return {
    settingsOpen: true,
    settingsCategory: category,
    settingsDraft: { asrModel: "iic/SenseVoiceSmall", outputDir: "D:/FrameQ/output" },
    settingsSupportedAsrModels: ["iic/SenseVoiceSmall"],
    settingsConfigPath: "D:/FrameQ/app-data/.env",
    audioReviewCacheUsage: {
      sizeBytes: 2048,
      cachePath: "D:/FrameQ/cache/.frameq-audio-review",
    },
    settingsInsightPreferences: null,
    settingsNotice: null,
    settingsLoading: false,
    settingsSaving: false,
    exportDiagnostics: vi.fn(),
    diagnosticExportBusy: false,
    diagnosticExportNotice: null,
    closeSettings: vi.fn(),
    submitSettings: vi.fn(),
    setSettingsCategory: vi.fn(),
    updateSettingsDraft: vi.fn(),
    clearAudioReviewCacheFromSettings: vi.fn(),
    clearProfileFromSettings: vi.fn(),
    locateSettingsConfigFile: vi.fn(),
    ...overrides,
  } as unknown as SettingsController;
}

function renderSettings(
  locale: SupportedLocale,
  category: SettingsCategory = "basic",
  options: {
    controller?: Partial<SettingsController>;
    updateState?: UpdateState;
  } = {},
) {
  return renderToStaticMarkup(
    <SettingsSheet
      controller={controller(category, options.controller)}
      asrModelStatus={{
        available: true,
        modelDir: "D:/FrameQ/models/SenseVoiceSmall",
      } as never}
      asrModelLabels={{ "iic/SenseVoiceSmall": "SenseVoice Small" }}
      modelDownloadActive={false}
      updateState={options.updateState ?? createInitialUpdateState()}
      updateBusy={false}
      updateInstallBlocked={false}
      inAppUpdates
      formatProgressPercent={(value) => `${value}%`}
      onOpenProfileEditorFromSettings={vi.fn()}
      onCheckForUpdates={vi.fn()}
      onInstallUpdate={vi.fn()}
      onPostponeUpdateReminder={vi.fn()}
      onRestartForUpdate={vi.fn()}
      onOpenReleases={vi.fn()}
      locale={locale}
    />,
  );
}

describe("settings localization", () => {
  test.each([
    ["zh-CN", "应用设置", "基础", "模型与输出", "输出目录"],
    ["zh-TW", "應用程式設定", "基本", "模型與輸出", "輸出目錄"],
    ["en-US", "App Settings", "Basic", "Model and Output", "Output directory"],
  ] as const)("renders basic settings in %s", async (locale, title, nav, heading, output) => {
    await initializeI18n(locale as SupportedLocale);
    const markup = renderSettings(locale as SupportedLocale);

    expect(markup).toContain(`>${title}</h2>`);
    expect(markup).toContain(`>${nav}</span>`);
    expect(markup).toContain(`>${heading}</h3>`);
    expect(markup).toContain(`>${output}</span>`);
    expect(markup).toContain("SenseVoice Small");
    expect(markup).toContain("D:/FrameQ/output");
  });

  test.each([
    ["storage", "Storage and Cache"],
    ["updates", "App Updates"],
    ["advanced", "Local Configuration File"],
  ] as const)("localizes the English %s section", async (category, heading) => {
    await initializeI18n("en-US");
    expect(renderSettings("en-US", category)).toContain(`>${heading}</h3>`);
  });

  test.each(["zh-CN", "zh-TW", "en-US"] as const)(
    "exposes localized update download progress semantics in %s",
    async (locale) => {
      await initializeI18n(locale);
      const updateState: UpdateState = {
        ...createInitialUpdateState(),
        status: "downloading",
        progress: 42,
        message: uiMessage("updates.state.downloading"),
      };

      const markup = renderSettings(locale, "updates", { updateState });
      const progressLabel = frameqI18n.getFixedT(locale, "updates")(
        "section.downloadProgressAria",
      );

      expect(markup).toContain('role="progressbar"');
      expect(markup).toContain(`aria-label="${progressLabel}"`);
      expect(markup).toContain('aria-valuenow="42"');
      expect(markup).toContain('aria-valuemin="0"');
      expect(markup).toContain('aria-valuemax="100"');
    },
  );

  test("announces asynchronous settings notices without interrupting the user", async () => {
    await initializeI18n("en-US");

    const markup = renderSettings("en-US", "basic", {
      controller: { settingsNotice: uiMessage("settings.notice.saved") },
    });

    expect(markup).toContain('class="action-notice inline-notice" role="status"');
    expect(markup).toContain('aria-live="polite"');
  });

  test.each([
    ["zh-CN", "诊断信息", "导出诊断信息", ["最近 7 天", "媒体", "文字稿", "密钥", "模型文件", "重新下载模型", "测试或探测网络"]],
    ["zh-TW", "診斷資訊", "匯出診斷資訊", ["最近 7 天", "媒體", "文字稿", "金鑰", "模型檔案", "重新下載模型", "測試或探測網路"]],
    ["en-US", "Diagnostics", "Export diagnostics", ["last 7 days", "media", "transcripts", "keys", "model files", "download the model again", "test or probe the network"]],
  ] as const)(
    "renders the permanent localized diagnostics action in Advanced for %s",
    async (locale, heading, action, privacyTokens) => {
      await initializeI18n(locale);
      const markup = renderSettings(locale, "advanced");

      expect(markup).toContain(heading);
      expect(markup).toContain(action);
      for (const privacyToken of privacyTokens) {
        expect(markup).toContain(privacyToken);
      }
      expect(markup).toContain('type="button"');
      expect(markup).not.toContain("Open logs directory");
    },
  );

  test("keeps diagnostics export separate from settings submit while busy", async () => {
    await initializeI18n("en-US");
    const markup = renderSettings("en-US", "advanced", {
      controller: { diagnosticExportBusy: true },
    });

    expect(markup).toContain('type="button" class="secondary-button" disabled="" aria-busy="true"');
    expect(markup).toContain("Exporting diagnostics");
    expect(markup).not.toContain('type="submit" form="settings-form"><span>Export diagnostics');
    expect(markup).toContain('id="settings-form"');
  });

  test("renders only the safe shared diagnostic notice", async () => {
    await initializeI18n("en-US");
    const markup = renderSettings("en-US", "advanced", {
      controller: {
        diagnosticExportNotice: { messageCode: "diagnostics.notice.exportFailed" },
      },
    });

    expect(markup).toContain("The diagnostic package could not be exported");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("C:/Users/private");
  });
});
