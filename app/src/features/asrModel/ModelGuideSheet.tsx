import { Download, ShieldCheck, X } from "lucide-react";

import type { AsrModelDownloadProgress } from "../../settingsClient";
import type { AsrModelStatus } from "./types";

type ModelGuideSheetProps = {
  open: boolean;
  modelDownloadActive: boolean;
  asrModelStatus: AsrModelStatus;
  asrModelLabels: Record<string, string>;
  modelDownloadProgress: AsrModelDownloadProgress;
  modelDownloadNotice: string;
  modelDownloadStalled: boolean;
  formatProgressPercent: (value: number) => string;
  asrModelSourceLabel: (source: string) => string;
  onClose: () => void;
  onStartDownload: () => void;
  onCancelDownload: () => void;
};

export function ModelGuideSheet({
  open,
  modelDownloadActive,
  asrModelStatus,
  asrModelLabels,
  modelDownloadProgress,
  modelDownloadNotice,
  modelDownloadStalled,
  formatProgressPercent,
  asrModelSourceLabel,
  onClose,
  onStartDownload,
  onCancelDownload,
}: ModelGuideSheetProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop sheet-backdrop"
      role="presentation"
      onClick={() => {
        if (!modelDownloadActive) {
          onClose();
        }
      }}
    >
      <section
        className="sheet-panel detail-modal model-guide-modal model-guide-sheet"
        aria-label="ASR 模型下载"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">ASR model</p>
            <h2>下载 ASR 模型</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭 ASR 模型下载"
            disabled={modelDownloadActive}
          >
            <X size={18} />
          </button>
        </header>
        <div className="model-guide-content">
          <p className="settings-warning privacy-callout">
            <ShieldCheck size={16} />
            <span>ASR 在本机运行，首次使用前需要下载 ASR 模型缓存。下载完成后可离线转写。</span>
          </p>
          <div className="model-status-card">
            <div>
              <span className={`model-status-badge ${asrModelStatus.available ? "ready" : "missing"}`}>
                {asrModelStatus.available ? "已就绪" : "需要下载"}
              </span>
              <strong>{asrModelLabels[asrModelStatus.model] ?? asrModelStatus.model}</strong>
              <small>来源：{asrModelSourceLabel(asrModelStatus.source)}</small>
              <small>保存位置：{asrModelStatus.modelDir || "app-local data/models"}</small>
            </div>
          </div>
          <div className="model-download-progress">
            <div className="progress-summary compact">
              <div>
                <span className="progress-value">
                  {formatProgressPercent(modelDownloadProgress.progress)}
                </span>
                <p>{modelDownloadProgress.message || "等待开始下载。"}</p>
              </div>
              <div className="progress-track">
                <span
                  className="progress-fill video_transcribing"
                  style={{ width: `${modelDownloadProgress.progress}%` }}
                />
              </div>
            </div>
            {modelDownloadProgress.currentFile ? (
              <small className="model-current-file">{modelDownloadProgress.currentFile}</small>
            ) : null}
          </div>
          {modelDownloadNotice ? (
            <p className="action-notice inline-notice">{modelDownloadNotice}</p>
          ) : null}
          {!modelDownloadNotice && modelDownloadStalled ? (
            <p className="action-notice inline-notice">
              下载进度暂时没有变化，可能是 ModelScope 网络较慢。可以继续等待，或取消后稍后重试。
            </p>
          ) : null}
        </div>
        <div className="settings-actions sheet-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={modelDownloadActive}
          >
            <span>稍后下载</span>
          </button>
          {modelDownloadActive ? (
            <button type="button" className="secondary-button danger-soft" onClick={onCancelDownload}>
              <X size={16} />
              <span>取消下载</span>
            </button>
          ) : (
            <button
              className="primary-button"
              type="button"
              onClick={onStartDownload}
              disabled={asrModelStatus.available}
            >
              <Download size={16} />
              <span>{asrModelStatus.available ? "已下载" : "下载 ASR 模型"}</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
