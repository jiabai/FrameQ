import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { appI18n, initializeI18n } from "../../i18n/i18n";
import type { SupportedLocale } from "../../i18n/locale";
import { uiMessage } from "../../i18n/uiMessage";
import { createInitialUpdateState } from "../../updateState";
import type { UpdateState } from "../../updateState";
import { SettingsSheet } from "./SettingsSheet";
import type { SettingsCategory, SettingsController } from "./useSettingsController";
import type { LlmProvidersController } from "./useLlmProvidersController";

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

function llmProvidersMock(
  overrides: Partial<LlmProvidersController> = {},
): LlmProvidersController {
  return {
    source: "managed",
    activeId: null,
    providers: [],
    busy: false,
    probing: false,
    notice: null,
    error: null,
    dialogOpen: false,
    draft: null,
    probe: null,
    loadLlmProviders: vi.fn(),
    startAdd: vi.fn(),
    startEdit: vi.fn(),
    updateDraft: vi.fn(),
    closeDialog: vi.fn(),
    saveDraft: vi.fn(),
    removeProvider: vi.fn(),
    activateProvider: vi.fn(),
    changeSource: vi.fn(),
    probeConnection: vi.fn(),
    resetError: vi.fn(),
    clearNotice: vi.fn(),
    ...overrides,
  } as unknown as LlmProvidersController;
}

function controller(
  category: SettingsCategory,
  overrides: Partial<SettingsController> = {},
): SettingsController {
  return {
    settingsOpen: true,
    settingsCategory: category,
    settingsDraft: { asrModel: "iic/SenseVoiceSmall", outputDir: "D:/Locus/output" },
    settingsSupportedAsrModels: ["iic/SenseVoiceSmall"],
    settingsConfigPath: "D:/Locus/app-data/.env",
    audioReviewCacheUsage: {
      sizeBytes: 2048,
      cachePath: "D:/Locus/cache/.app-audio-review",
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
    llmProviders: llmProvidersMock(),
    ...overrides,
  } as unknown as SettingsController;
}

function renderSettings(
  locale: SupportedLocale,
  category: SettingsCategory = "basic",
  options: {
    controller?: Partial<SettingsController>;
    updateState?: UpdateState;
    currentVersion?: string;
  } = {},
) {
  capturedButtons.length = 0;
  return renderToStaticMarkup(
    <SettingsSheet
      controller={controller(category, options.controller)}
      asrModelStatus={{
        available: true,
        modelDir: "D:/Locus/models/SenseVoiceSmall",
      } as never}
      modelDownloadActive={false}
      updateState={options.updateState ?? createInitialUpdateState()}
      updateBusy={false}
      updateInstallBlocked={false}
      inAppUpdates
      currentVersion={options.currentVersion ?? "0.3.7"}
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
    ["zh-CN", "应用设置", "基础", "模型与数据", "数据存储位置"],
    ["zh-TW", "應用程式設定", "基本", "模型與資料", "資料儲存位置"],
    ["en-US", "App Settings", "Basic", "Model and Data", "Data storage location"],
  ] as const)("renders basic settings in %s", async (locale, title, nav, heading, output) => {
    await initializeI18n(locale as SupportedLocale);
    const markup = renderSettings(locale as SupportedLocale);

    expect(markup).toContain('data-motion="sheet"');
    expect(markup).toContain(`>${title}</h2>`);
    expect(markup).toContain(`>${nav}</span>`);
    expect(markup).toContain(`>${heading}</h3>`);
    expect(markup).toContain(`>${output}</span>`);
    expect(markup).toContain("SenseVoice Small");
    expect(markup).toContain('class="data-storage-setting"');
    expect(markup).not.toContain('value="D:/Locus/output"');
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
      const progressLabel = appI18n.getFixedT(locale, "updates")(
        "section.downloadProgressAria",
      );

      expect(markup).toContain('role="progressbar"');
      expect(markup).toContain(`aria-label="${progressLabel}"`);
      expect(markup).toContain('aria-valuenow="42"');
      expect(markup).toContain('aria-valuemin="0"');
      expect(markup).toContain('aria-valuemax="100"');
    },
  );

  test.each([
    ["zh-CN", "当前版本 v0.3.7"],
    ["zh-TW", "目前版本 v0.3.7"],
    ["en-US", "Current version v0.3.7"],
  ] as const)("shows the running app version in Updates for %s", async (locale, expected) => {
    await initializeI18n(locale);
    const markup = renderSettings(locale, "updates");

    expect(markup).toContain(expected);
    expect(markup).toContain('data-current-version="0.3.7"');
  });

  test("hides the version line when the delivery response has no version yet", async () => {
    await initializeI18n("en-US");
    const markup = renderSettings("en-US", "updates", { currentVersion: "" });

    expect(markup).not.toContain("Current version");
    expect(markup).not.toContain("data-current-version");
  });

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

  test.each([
    ["zh-CN", "模型", "Locus 托管", "我自己的 API", "不扣 AI Credit", "仍需登录", "系统钥匙串", "添加模型", "还没有添加自定义模型"],
    ["zh-TW", "模型", "Locus 託管", "我自己的 API", "不扣 AI Credit", "仍需登入", "系統鑰匙圈", "新增模型", "還沒有新增自訂模型"],
    ["en-US", "Models", "Locus managed", "My own API", "No AI Credits", "still need sign-in", "system credential store", "Add model", "No custom models have been added yet"],
  ] as const)(
    "renders the localized model-service section in %s",
    async (locale, heading, managed, byok, byokNotice, draftNotice, securityNotice, addLabel, emptyLabel) => {
      await initializeI18n(locale);
      const markup = renderSettings(locale, "models");

      expect(markup).toContain(`>${heading}</h3>`);
      expect(markup).toContain(`>${managed}</span>`);
      expect(markup).toContain(`>${byok}</span>`);
      expect(markup).toContain('data-llm-source="managed"');
      expect(markup).toContain('data-llm-source="byok"');
      expect(markup).toContain(byokNotice);
      expect(markup).toContain(draftNotice);
      expect(markup).toContain(securityNotice);
      expect(markup).toContain(`>${addLabel}</button>`);
      expect(markup).toContain(emptyLabel);
    },
  );

  test.each([
    ["zh-CN", "名称", "供应商", "模型", "已启用", "编辑", "删除", "设为启用"],
    ["zh-TW", "名稱", "供應商", "模型", "已啟用", "編輯", "刪除", "設為啟用"],
    ["en-US", "Name", "Provider", "Model", "Active", "Edit", "Delete", "Set active"],
  ] as const)(
    "renders the localized provider list in %s",
    async (locale, nameLabel, providerLabel, modelLabel, activeLabel, editLabel, deleteLabel, activateLabel) => {
      await initializeI18n(locale);
      const markup = renderSettings(locale, "models", {
        controller: {
          llmProviders: llmProvidersMock({
            source: "byok",
            activeId: "provider-1",
            providers: [
              {
                id: "provider-1",
                label: "My DeepSeek",
                provider: "openai_compatible",
                baseUrl: "https://api.deepseek.com/v1",
                model: "deepseek-chat",
                timeoutSeconds: 30,
                hasKey: true,
              },
            ],
          }),
        },
      });

      expect(markup).toContain('data-llm-provider-id="provider-1"');
      expect(markup).toContain("My DeepSeek");
      expect(markup).toContain("deepseek-chat");
      expect(markup).toContain(nameLabel);
      expect(markup).toContain(providerLabel);
      expect(markup).toContain(modelLabel);
      expect(markup).toContain(activeLabel);
      expect(markup).toContain(`>${editLabel}</button>`);
      expect(markup).toContain(`>${deleteLabel}</button>`);
      expect(markup).toContain(`>${activateLabel}</button>`);
    },
  );

  test.each([
    ["zh-CN", "添加模型", "接口地址", "模型名称", "测试连接", "取消", "保存", "智谱", "极短请求"],
    ["zh-TW", "新增模型", "介面位址", "模型名稱", "測試連線", "取消", "儲存", "智譜", "極短請求"],
    ["en-US", "Add model", "Base URL", "Model", "Test connection", "Cancel", "Save", "Zhipu", "tiny request"],
  ] as const)(
    "renders the localized add-model dialog in %s",
    async (locale, title, baseUrlLabel, modelLabel, testLabel, cancelLabel, saveLabel, presetLabel, probeNotice) => {
      await initializeI18n(locale);
      const markup = renderSettings(locale, "models", {
        controller: {
          llmProviders: llmProvidersMock({
            dialogOpen: true,
            draft: {
              label: "My DeepSeek",
              provider: "openai_compatible",
              baseUrl: "https://api.deepseek.com/v1",
              model: "deepseek-chat",
              timeoutSeconds: 30,
              apiKey: null,
            },
          }),
        },
      });

      expect(markup).toContain(`>${title}</h2>`);
      expect(markup).toContain(baseUrlLabel);
      expect(markup).toContain("API Key");
      expect(markup).toContain(modelLabel);
      expect(markup).toContain(`>${testLabel}</button>`);
      expect(markup).toContain(`>${cancelLabel}</button>`);
      expect(markup).toContain(`>${saveLabel}</button>`);
      expect(markup).toContain(presetLabel);
      expect(markup).toContain(probeNotice);
      expect(markup).toContain("data-llm-test");
      expect(markup).not.toContain("sk-secret");
    },
  );

  test.each([
    ["zh-CN", "编辑模型", "耗时 180 ms"],
    ["zh-TW", "編輯模型", "耗時 180 ms"],
    ["en-US", "Edit model", "Latency: 180 ms"],
  ] as const)(
    "renders the edit dialog and a successful probe result in %s",
    async (locale, title, probeResult) => {
      await initializeI18n(locale);
      const markup = renderSettings(locale, "models", {
        controller: {
          llmProviders: llmProvidersMock({
            dialogOpen: true,
            draft: {
              id: "provider-1",
              label: "My DeepSeek",
              provider: "openai_compatible",
              baseUrl: "https://api.deepseek.com/v1",
              model: "deepseek-chat",
              timeoutSeconds: 30,
              apiKey: null,
            },
            probe: { ok: true, errorCode: null, latencyMs: 180 },
          }),
        },
      });

      expect(markup).toContain(`>${title}</h2>`);
      expect(markup).toContain(probeResult);
    },
  );

  test("wires the source switch and test-connection buttons to the controller", async () => {
    await initializeI18n("en-US");
    const changeSource = vi.fn();
    const probeConnection = vi.fn();
    renderSettings("en-US", "models", {
      controller: {
        llmProviders: llmProvidersMock({
          dialogOpen: true,
          draft: {
            label: "My DeepSeek",
            provider: "openai_compatible",
            baseUrl: "https://api.deepseek.com/v1",
            model: "deepseek-chat",
            timeoutSeconds: 30,
            apiKey: null,
          },
          changeSource,
          probeConnection,
        }),
      },
    });

    const byokButton = capturedButtons.find(
      ({ props }) => props["data-llm-source"] === "byok",
    );
    expect(byokButton).toBeDefined();
    await clickRenderedButton(byokButton as CapturedButton);
    expect(changeSource).toHaveBeenCalledWith("byok");

    const testButton = capturedButtons.find(
      ({ props }) => props["data-llm-test"] !== undefined,
    );
    expect(testButton).toBeDefined();
    await clickRenderedButton(testButton as CapturedButton);
    expect(probeConnection).toHaveBeenCalledTimes(1);
  });
});
