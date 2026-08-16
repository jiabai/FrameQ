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

type CapturedButton = { props: Record<string, unknown> };
type JsxDevArgs = [
  type: unknown,
  props: unknown,
  key?: unknown,
  isStaticChildren?: boolean,
  source?: unknown,
  self?: unknown,
];

const capturedButtons = vi.hoisted(() => [] as CapturedButton[]);

vi.mock("react/jsx-runtime", async () => {
  const actual = await vi.importActual<typeof import("react/jsx-runtime")>(
    "react/jsx-runtime",
  );

  const captureButton = (type: unknown, props: unknown) => {
    if (type === "button" && props && typeof props === "object") {
      capturedButtons.push({ props: props as Record<string, unknown> });
    }
  };

  return {
    ...actual,
    jsx: (
      type: Parameters<typeof actual.jsx>[0],
      props: Parameters<typeof actual.jsx>[1],
      key?: Parameters<typeof actual.jsx>[2],
    ) => {
      captureButton(type, props);
      return actual.jsx(type, props, key);
    },
    jsxs: (
      type: Parameters<typeof actual.jsxs>[0],
      props: Parameters<typeof actual.jsxs>[1],
      key?: Parameters<typeof actual.jsxs>[2],
    ) => {
      captureButton(type, props);
      return actual.jsxs(type, props, key);
    },
  };
});

vi.mock("react/jsx-dev-runtime", async () => {
  const actual = await vi.importActual<typeof import("react/jsx-dev-runtime")>(
    "react/jsx-dev-runtime",
  );
  const jsxDEV = (actual as typeof actual & { jsxDEV: (...args: JsxDevArgs) => unknown }).jsxDEV;

  return {
    ...actual,
    jsxDEV: (...args: JsxDevArgs) => {
      if (args[0] === "button" && args[1] && typeof args[1] === "object") {
        capturedButtons.push({ props: args[1] as Record<string, unknown> });
      }
      return jsxDEV(...args);
    },
  };
});

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
  capturedButtons.length = 0;
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

function getDiagnosticExportButton(): CapturedButton {
  const button = capturedButtons.find(({ props }) => "aria-busy" in props);
  expect(button).toBeDefined();
  return button as CapturedButton;
}

async function clickRenderedButton(button: CapturedButton): Promise<void> {
  expect(button.props.type).toBe("button");
  expect(button.props.onClick).toEqual(expect.any(Function));

  if (button.props.disabled === true) {
    return;
  }

  await (button.props.onClick as () => void | Promise<void>)();
}

describe("settings localization", () => {
  test.each([
    ["zh-CN", "应用设置", "基础", "模型与输出", "输出目录"],
    ["zh-TW", "應用程式設定", "基本", "模型與輸出", "輸出目錄"],
    ["en-US", "App Settings", "Basic", "Model and Output", "Output directory"],
  ] as const)("renders basic settings in %s", async (locale, title, nav, heading, output) => {
    await initializeI18n(locale as SupportedLocale);
    const markup = renderSettings(locale as SupportedLocale);

    expect(markup).toContain('data-motion="sheet"');
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

  test("calls diagnostics export when the Advanced action is clicked", async () => {
    await initializeI18n("en-US");
    const exportDiagnostics = vi.fn();
    const submitSettings = vi.fn();

    renderSettings("en-US", "advanced", {
      controller: { exportDiagnostics, submitSettings },
    });

    await clickRenderedButton(getDiagnosticExportButton());

    expect(exportDiagnostics).toHaveBeenCalledTimes(1);
    expect(submitSettings).not.toHaveBeenCalled();
  });

  test("does not dispatch duplicate clicks while diagnostics export is busy", async () => {
    await initializeI18n("en-US");
    const exportDiagnostics = vi.fn();

    renderSettings("en-US", "advanced", {
      controller: { diagnosticExportBusy: true, exportDiagnostics },
    });

    const button = getDiagnosticExportButton();
    expect(button.props.disabled).toBe(true);
    await clickRenderedButton(button);
    await clickRenderedButton(button);

    expect(exportDiagnostics).not.toHaveBeenCalled();
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
