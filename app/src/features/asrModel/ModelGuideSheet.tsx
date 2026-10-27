import { Download, ShieldCheck, X } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { formatPercent } from "../../i18n/formatters";
import { UI_MOTION_TRANSITION } from "../../uiMotion";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { renderAsrModelDownloadMessage } from "../../i18n/progressMessages";
import { renderUiMessage, type UiMessage } from "../../i18n/uiMessage";
import type { AsrModelDownloadProgress } from "../../settingsClient";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import { StatusLine } from "../common/StatusLine";
import type { DiagnosticExportController } from "../diagnostics/useDiagnosticExport";
import type { AsrModelStatus } from "./types";
import { asrModelLabel } from "./asrModelLabels";

const DEFAULT_MODEL_DIRECTORY = "app-local data/models";
const TERMINAL_FAILURE_NOTICE_CODES = new Set([
  "asrModel.notice.incomplete",
  "asrModel.notice.downloadFailed",
  "asrModel.notice.idleTimeout",
  "asrModel.notice.executionTimeout",
]);

type ModelGuideSheetProps = {
  open: boolean;
  modelDownloadActive: boolean;
  asrModelStatus: AsrModelStatus;
  modelDownloadProgress: AsrModelDownloadProgress;
  modelDownloadNotice: UiMessage | null;
  modelDownloadStalled: boolean;
  diagnosticExportController: DiagnosticExportController;
  onClose: () => void;
  onStartDownload: () => void;
  onCancelDownload: () => void;
  onDownloadRuntimeComponent: () => void;
  runtimeComponentDownloading: boolean;
};

export function ModelGuideSheet({
  open,
  modelDownloadActive,
  asrModelStatus,
  modelDownloadProgress,
  modelDownloadNotice,
  modelDownloadStalled,
  diagnosticExportController,
  onClose,
  onStartDownload,
  onCancelDownload,
  onDownloadRuntimeComponent,
  runtimeComponentDownloading,
}: ModelGuideSheetProps) {
  const { t } = useTranslation("asrModel");
  const resolvedLocale = useUiLocale();
  const progressMessage = renderAsrModelDownloadMessage(
    resolvedLocale,
    modelDownloadProgress,
  );
  const noticeText = renderUiMessage(resolvedLocale, modelDownloadNotice);
  const diagnosticNoticeText = renderUiMessage(
    resolvedLocale,
    diagnosticExportController.diagnosticExportNotice,
  );
  const source =
    asrModelStatus.source === "custom_url"
      ? t("source.customUrl")
      : asrModelStatus.source === "modelscope"
        ? t("source.modelScope")
        : asrModelStatus.source;
  const progressValue = Math.max(0, Math.min(100, modelDownloadProgress.progress));
  const progressPercent = formatPercent(progressValue / 100, resolvedLocale);
  const canExportDiagnostics =
    !modelDownloadActive &&
    !asrModelStatus.available &&
    modelDownloadProgress.phase === "failed" &&
    modelDownloadNotice !== null &&
    TERMINAL_FAILURE_NOTICE_CODES.has(modelDownloadNotice.messageCode);

  return (
    <AnimatedSheet
      open={open}
      ariaLabel={t("guide.ariaLabel")}
      className="model-guide-modal model-guide-sheet"
      onBackdropClick={() => {
        if (!modelDownloadActive) {
          onClose();
        }
      }}
    >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">{t("guide.eyebrow")}</p>
            <h2>{t("guide.title")}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={t("guide.close")}
            disabled={modelDownloadActive}
          >
            <X size={18} />
          </button>
        </header>
        <div className="model-guide-content">
          <p className="settings-warning privacy-callout">
            <ShieldCheck size={16} />
            <span>{t("guide.privacy")}</span>
          </p>
          <p className="action-notice inline-notice" role="note">
            {t("guide.defaultModelNotice")}
          </p>
          <div className="model-status-card">
            <div>
              <span
                className={`model-status-badge ${asrModelStatus.available ? "ready" : "missing"}`}
              >
                {asrModelStatus.available
                  ? t("guide.status.ready")
                  : t("guide.status.missing")}
              </span>
              <strong>
                {asrModelLabel(asrModelStatus.model)}
              </strong>
              <small>{t("guide.sourceLabel", { source })}</small>
              <small>
                {t("guide.storageLabel", {
                  modelDir:
                    asrModelStatus.modelDir || DEFAULT_MODEL_DIRECTORY,
                })}
              </small>
            </div>
          </div>
          <div
            className="model-download-progress"
            role="progressbar"
            aria-label={t("guide.downloadProgressAria")}
            aria-valuenow={progressValue}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-summary compact">
              <div>
                <span className="progress-value">{progressPercent}</span>
                <p>{progressMessage}</p>
              </div>
              <div className="progress-track">
                <motion.span
                  className="progress-fill video_transcribing"
                  data-motion="asr-progress"
                  animate={{ width: `${progressValue}%` }}
                  style={{ width: `${progressValue}%` }}
                  transition={UI_MOTION_TRANSITION}
                />
              </div>
            </div>
            {modelDownloadProgress.currentFile ? (
              <small className="model-current-file">
                {modelDownloadProgress.currentFile}
              </small>
            ) : null}
          </div>
          {noticeText ? (
            <StatusLine className="action-notice inline-notice">{noticeText}</StatusLine>
          ) : null}
          {!noticeText && modelDownloadStalled ? (
            <StatusLine className="action-notice inline-notice">{t("guide.stalled")}</StatusLine>
          ) : null}
          {canExportDiagnostics ? (
            <div className="model-guide-diagnostics privacy-callout">
              <ShieldCheck size={16} />
              <div>
                <strong>{t("guide.diagnostics.title")}</strong>
                <span>{t("guide.diagnostics.privacy")}</span>
              </div>
            </div>
          ) : null}
          {canExportDiagnostics && diagnosticNoticeText ? (
            <StatusLine className="action-notice inline-notice">
              {diagnosticNoticeText}
            </StatusLine>
          ) : null}
        </div>
        <div className="settings-actions sheet-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={modelDownloadActive}
          >
            <span>{t("guide.later")}</span>
          </button>
          {canExportDiagnostics ? (
            <button
              type="button"
              className="secondary-button diagnostic-export-button"
              onClick={() => void diagnosticExportController.exportDiagnostics()}
              disabled={diagnosticExportController.diagnosticExportBusy}
              aria-busy={diagnosticExportController.diagnosticExportBusy}
            >
              <ShieldCheck size={16} />
              <span>
                {diagnosticExportController.diagnosticExportBusy
                  ? t("guide.diagnostics.exporting")
                  : t("guide.diagnostics.export")}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            onClick={onDownloadRuntimeComponent}
            disabled={runtimeComponentDownloading || modelDownloadActive}
            aria-busy={runtimeComponentDownloading}
          >
            <Download size={16} />
            <span>
              {runtimeComponentDownloading
                ? t("guide.runtimeComponentDownloading")
                : t("guide.runtimeComponent")}
            </span>
          </button>
          {modelDownloadActive ? (
            <button
              type="button"
              className="secondary-button danger-soft"
              onClick={onCancelDownload}
            >
              <X size={16} />
              <span>{t("guide.cancel")}</span>
            </button>
          ) : (
            <button
              className="primary-button"
              type="button"
              onClick={onStartDownload}
              disabled={asrModelStatus.available}
            >
              <Download size={16} />
              <span>
                {asrModelStatus.available
                  ? t("guide.downloaded")
                  : modelDownloadProgress.phase === "failed" ||
                      modelDownloadProgress.phase === "start_failed"
                    ? t("guide.retry")
                    : t("guide.download")}
              </span>
            </button>
          )}
        </div>
    </AnimatedSheet>
  );
}
