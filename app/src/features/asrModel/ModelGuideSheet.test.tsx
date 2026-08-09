import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { initializeI18n } from "../../i18n/i18n";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { SupportedLocale } from "../../i18n/locale";
import { uiMessage } from "../../i18n/uiMessage";
import type { AsrModelDownloadProgress } from "../../settingsClient";
import { ModelGuideSheet } from "./ModelGuideSheet";

const progress: AsrModelDownloadProgress = {
  phase: "running",
  wireStatus: "downloading",
  message: { messageCode: "model.file.downloading", args: {} },
  progress: 42,
  currentFile: "model.pt",
};

async function renderModelGuide(
  locale: SupportedLocale,
  options: {
    notice?: ReturnType<typeof uiMessage> | null;
    stalled?: boolean;
    diagnosticExportNotice?: ReturnType<typeof uiMessage>;
    diagnosticExportBusy?: boolean;
    modelDownloadActive?: boolean;
    modelDownloadPhase?: AsrModelDownloadProgress["phase"];
  } = {},
): Promise<string> {
  await initializeI18n(locale);
  return renderToStaticMarkup(
    <LocaleProvider
      initialOutcome={{
        preference: locale,
        resolvedLocale: locale,
        persistedAnchor: locale,
        notice: null,
      }}
    >
      <ModelGuideSheet
        open
        modelDownloadActive={options.modelDownloadActive ?? true}
        asrModelStatus={{
          model: "iic/SenseVoiceSmall",
          modelDir: "D:/FrameQ/models",
          available: false,
          source: "modelscope",
        }}
        asrModelLabels={{ "iic/SenseVoiceSmall": "SenseVoice Small" }}
        modelDownloadProgress={{
          ...progress,
          phase: options.modelDownloadPhase ?? progress.phase,
        }}
        modelDownloadNotice={options.notice ?? null}
        modelDownloadStalled={options.stalled ?? false}
        diagnosticExportController={{
          exportDiagnostics: vi.fn(),
          diagnosticExportBusy: options.diagnosticExportBusy ?? false,
          diagnosticExportNotice: options.diagnosticExportNotice ?? null,
        }}
        onClose={vi.fn()}
        onStartDownload={vi.fn()}
        onCancelDownload={vi.fn()}
      />
    </LocaleProvider>,
  );
}

describe("ModelGuideSheet localization", () => {
  test.each([
    ["zh-CN", "正在为本任务准备模型", "取消下载", "42%"],
    ["zh-TW", "正在為本任務準備模型", "取消下載", "42%"],
    ["en-US", "Preparing Model for This Task", "Cancel Download", "42%"],
  ] as const)(
    "renders model guidance, controls, and locale-aware progress in %s",
    async (locale, title, cancelLabel, percent) => {
      const markup = await renderModelGuide(locale);

      expect(markup).toContain(title);
      expect(markup).toContain(cancelLabel);
      expect(markup).toContain(percent);
      expect(markup).toContain("SenseVoice Small");
      expect(markup).toContain("ModelScope");
      expect(markup).toContain("D:/FrameQ/models");
      expect(markup).toContain('role="progressbar"');
      expect(markup).toContain('aria-valuenow="42"');
      expect(markup).toContain('aria-valuemin="0"');
      expect(markup).toContain('aria-valuemax="100"');
    },
  );

  test("renders the same semantic notice in the current locale without exposing raw errors", async () => {
    const notice = uiMessage("asrModel.notice.cancelFailed");

    const simplified = await renderModelGuide("zh-CN", { notice });
    const traditional = await renderModelGuide("zh-TW", { notice });
    const english = await renderModelGuide("en-US", { notice });

    expect(simplified).toContain("无法取消模型下载");
    expect(traditional).toContain("無法取消模型下載");
    expect(english).toContain("could not be cancelled");
    expect(english).toContain('role="status"');
    expect(english).toContain('aria-live="polite"');
    expect(`${simplified}${traditional}${english}`).not.toContain("super-secret");
  });

  test("localizes the stalled download guidance", async () => {
    const markup = await renderModelGuide("en-US", { stalled: true });

    expect(markup).toContain("ModelScope may be responding slowly");
    expect(markup).toContain("wait or cancel the download and try again later");
  });

  test.each([
    ["zh-CN", "导出诊断信息", "重试", "最近 7 天", ["媒体", "文字稿", "密钥", "模型文件", "网络"]],
    ["zh-TW", "匯出診斷資訊", "重試", "最近 7 天", ["媒體", "文字稿", "金鑰", "模型檔案", "網路"]],
    ["en-US", "Export diagnostics", "Retry", "last 7 days", ["media", "transcript", "key", "model file", "network"]],
  ] as const)(
    "shows the localized failure export action and privacy boundary in %s",
    async (locale, exportLabel, retryLabel, retentionCopy, privacyTokens) => {
      const markup = await renderModelGuide(locale, {
        modelDownloadActive: false,
        modelDownloadPhase: "failed",
        notice: uiMessage("asrModel.notice.downloadFailed"),
      });

      expect(markup).toContain(exportLabel);
      expect(markup).toContain(retryLabel);
      expect(markup).toContain(retentionCopy);
      for (const privacyToken of privacyTokens) {
        expect(markup).toContain(privacyToken);
      }
      expect(markup).toContain('type="button"');
    },
  );

  test.each([
    ["running", true, null],
    ["cancelling", true, null],
    ["completed", false, uiMessage("asrModel.notice.available")],
    ["idle", false, null],
  ] as const)(
    "does not show the failure export action for %s or ordinary missing state",
    async (phase, active, notice) => {
      const markup = await renderModelGuide("en-US", {
        modelDownloadActive: active,
        modelDownloadPhase: phase,
        notice,
      });

      expect(markup).not.toContain("Export diagnostics");
    },
  );

  test("keeps the export action disabled while the shared export is busy", async () => {
    const markup = await renderModelGuide("en-US", {
      modelDownloadActive: false,
      modelDownloadPhase: "failed",
      notice: uiMessage("asrModel.notice.idleTimeout"),
      diagnosticExportBusy: true,
    });

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('class="secondary-button diagnostic-export-button" disabled="" aria-busy="true"');
    expect(markup).toContain("Exporting diagnostics");
  });

  test("renders the shared diagnostic notice without exposing raw failure text", async () => {
    const markup = await renderModelGuide("en-US", {
      modelDownloadActive: false,
      modelDownloadPhase: "failed",
      notice: uiMessage("asrModel.notice.downloadFailed"),
      diagnosticExportNotice: uiMessage("diagnostics.notice.exported"),
    });

    expect(markup).toContain("The diagnostic package was saved");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("C:/Users/private");
  });
});
