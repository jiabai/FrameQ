import {
  Download,
  FolderOpen,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import type { AsrModelStatus } from "../asrModel/types";
import type { UpdateState } from "../../updateState";
import type { InsightPreferenceState } from "../../insightPreferencesClient";
import {
  summarizeGenerationPreferences,
  summarizeInspirationProfile,
} from "../../insightPreferences";
import type { SettingsCategory, SettingsController } from "./useSettingsController";

const settingsNavItems: Array<{
  id: SettingsCategory;
  label: string;
  description: string;
}> = [
  { id: "basic", label: "基础", description: "模型与输出" },
  { id: "inspiration", label: "灵感", description: "档案与偏好" },
  { id: "storage", label: "缓存", description: "本机临时区" },
  { id: "updates", label: "更新", description: "版本维护" },
  { id: "advanced", label: "高级", description: "配置文件" },
];

type SettingsSheetProps = {
  controller: SettingsController;
  asrModelStatus: AsrModelStatus;
  asrModelLabels: Record<string, string>;
  modelDownloadActive: boolean;
  updateState: UpdateState;
  updateBusy: boolean;
  updateInstallBlocked: boolean;
  inAppUpdates: boolean;
  formatProgressPercent: (value: number) => string;
  onStartAsrModelDownload: () => void | Promise<void>;
  onOpenProfileEditorFromSettings: () => void | Promise<void>;
  onCheckForUpdates: (options?: { silent?: boolean; isCancelled?: () => boolean }) => void | Promise<void>;
  onInstallUpdate: () => void | Promise<void>;
  onPostponeUpdateReminder: () => void | Promise<void>;
  onRestartForUpdate: () => void | Promise<void>;
  onOpenReleases: () => void | Promise<void>;
};

function formatByteSize(value: number): string {
  const bytes = Math.max(0, value);
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 10 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function updateStatusLabel(state: UpdateState): string {
  const labels: Record<UpdateState["status"], string> = {
    idle: "未检查",
    checking: "检查中",
    available: "可升级",
    downloading: "下载中",
    installing: "安装中",
    ready_to_restart: "待重启",
    up_to_date: "已是最新",
    failed: "检查失败",
    postponed: "稍后提醒",
  };

  return labels[state.status];
}

function settingsProfileStatusLabel(state: InsightPreferenceState | null, loading: boolean): string {
  if (!state) {
    return loading ? "读取中" : "暂不可用";
  }

  if (state.profileStatus === "valid") {
    return "已设置";
  }

  if (state.profileStatus === "skipped") {
    return "已跳过";
  }

  if (state.profileStatus === "invalid") {
    return "需要重设";
  }

  return "未设置";
}

function settingsProfileStatusTone(state: InsightPreferenceState | null): "ready" | "missing" {
  return state?.profileStatus === "valid" ? "ready" : "missing";
}

function settingsProfileSummaryLines(state: InsightPreferenceState | null, loading: boolean): string[] {
  if (!state) {
    return [loading ? "读取后显示灵感档案状态" : "灵感档案状态暂不可用"];
  }

  if (state.profileStatus === "invalid") {
    return [state.profileError || "灵感档案需要重新设置"];
  }

  if (state.profileStatus === "valid") {
    const summary = summarizeInspirationProfile(state.profile);
    if (summary.length > 3) {
      return [...summary.slice(0, 3), `还有 ${summary.length - 3} 项，编辑时可查看`];
    }
    return summary;
  }

  return ["未设置灵感档案"];
}

function settingsGenerationPreferenceLines(state: InsightPreferenceState | null, loading: boolean): string[] {
  if (!state) {
    return [loading ? "读取后显示默认生成偏好" : "默认生成偏好暂不可用"];
  }

  if (!state.defaultGenerationPreferences) {
    return ["尚未保存默认生成偏好"];
  }

  const summary = summarizeGenerationPreferences(state.defaultGenerationPreferences);
  return [`已保存默认生成偏好（${summary.length} 项）`];
}

export function SettingsSheet({
  controller,
  asrModelStatus,
  asrModelLabels,
  modelDownloadActive,
  updateState,
  updateBusy,
  updateInstallBlocked,
  inAppUpdates,
  formatProgressPercent,
  onStartAsrModelDownload,
  onOpenProfileEditorFromSettings,
  onCheckForUpdates,
  onInstallUpdate,
  onPostponeUpdateReminder,
  onRestartForUpdate,
  onOpenReleases,
}: SettingsSheetProps) {
  const {
    settingsOpen,
    settingsCategory,
    settingsDraft,
    settingsSupportedAsrModels,
    settingsConfigPath,
    audioReviewCacheUsage,
    settingsInsightPreferences,
    settingsNotice,
    settingsLoading,
    settingsSaving,
    closeSettings,
    submitSettings,
    setSettingsCategory,
    updateSettingsDraft,
    clearAudioReviewCacheFromSettings,
    clearProfileFromSettings,
    locateSettingsConfigFile,
  } = controller;

  if (!settingsOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={closeSettings}>
      <section
        className="sheet-panel detail-modal settings-modal settings-sheet"
        aria-label="应用设置"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">FrameQ</p>
            <h2>应用设置</h2>
          </div>
          <button className="icon-button" type="button" onClick={closeSettings} aria-label="关闭设置">
            <X size={18} />
          </button>
        </header>
        <form id="settings-form" className="settings-form" onSubmit={submitSettings}>
          <div className="settings-layout" data-active-settings-category={settingsCategory}>
            <nav className="settings-nav" aria-label="设置分类">
              {settingsNavItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`settings-nav-item ${settingsCategory === item.id ? "selected" : ""}`}
                  onClick={() => setSettingsCategory(item.id)}
                  aria-current={settingsCategory === item.id ? "page" : undefined}
                  data-settings-category={item.id}
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </button>
              ))}
            </nav>

            <div className="settings-sections">
              {settingsCategory === "basic" ? (
                <>
                  <p className="settings-basic-note">
                    <ShieldCheck size={15} />
                    <span>这里只管理本机 ASR 与输出目录；AI 配置由服务端统一管理。</span>
                  </p>
                  <section id="settings-basic" className="sheet-form-section">
                    <div className="form-section-heading">
                      <h3>模型与输出</h3>
                      <p>这些设置只影响后续任务。</p>
                    </div>
                    <label className="field-row">
                      <span>ASR 模型</span>
                      <select
                        value={settingsDraft.asrModel}
                        onChange={(event) => updateSettingsDraft("asrModel", event.currentTarget.value)}
                        disabled={settingsLoading || settingsSaving}
                      >
                        {settingsSupportedAsrModels.map((model) => (
                          <option value={model} key={model}>
                            {asrModelLabels[model] ?? model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="model-settings-row">
                      <div>
                        <span className={`model-status-badge ${asrModelStatus.available ? "ready" : "missing"}`}>
                          {asrModelStatus.available ? "ASR 模型已就绪" : "ASR 模型未下载"}
                        </span>
                        <small>{asrModelStatus.modelDir || "app-local data/models"}</small>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void onStartAsrModelDownload()}
                        disabled={asrModelStatus.available || modelDownloadActive}
                      >
                        <Download size={15} />
                        <span>{modelDownloadActive ? "下载中" : "下载 ASR 模型"}</span>
                      </button>
                    </div>
                    <label className="field-row">
                      <span>输出目录</span>
                      <input
                        value={settingsDraft.outputDir}
                        onChange={(event) => updateSettingsDraft("outputDir", event.currentTarget.value)}
                        placeholder="留空使用 outputs/"
                        disabled={settingsLoading || settingsSaving}
                      />
                    </label>
                  </section>
                </>
              ) : null}

              {settingsCategory === "inspiration" ? (
                <section id="settings-inspiration" className="sheet-form-section inspiration-settings-section">
                  <div className="form-section-heading">
                    <h3>灵感档案</h3>
                    <p>只保存在本机，用于后续启发灵感生成。</p>
                  </div>
                  <div className="settings-status-card inspiration-profile-card">
                    <div>
                      <span className={`model-status-badge ${settingsProfileStatusTone(settingsInsightPreferences)}`}>
                        {settingsProfileStatusLabel(settingsInsightPreferences, settingsLoading)}
                      </span>
                      <strong>我的灵感档案</strong>
                      <div className="settings-summary-list">
                        {settingsProfileSummaryLines(settingsInsightPreferences, settingsLoading).map((line, index) => (
                          <span key={`${line}-${index}`}>{line}</span>
                        ))}
                      </div>
                    </div>
                    <div className="inspiration-settings-actions">
                      <button
                        type="button"
                        className="secondary-button profile-edit-button"
                        onClick={() => void onOpenProfileEditorFromSettings()}
                        disabled={settingsLoading || settingsSaving}
                      >
                        <UserRound size={15} />
                        <span>编辑灵感档案</span>
                      </button>
                      <button
                        type="button"
                        className="secondary-button profile-clear-button"
                        onClick={() => void clearProfileFromSettings()}
                        disabled={settingsLoading || settingsSaving}
                      >
                        <X size={15} />
                        <span>清空档案</span>
                      </button>
                    </div>
                  </div>
                  <div className="settings-status-card quiet">
                    <div>
                      <strong>默认生成偏好</strong>
                      <div className="settings-summary-list">
                        {settingsGenerationPreferenceLines(
                          settingsInsightPreferences,
                          settingsLoading,
                        ).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {settingsCategory === "storage" ? (
                <section id="settings-storage" className="sheet-form-section audio-cache-settings-section">
                  <div className="form-section-heading">
                    <h3>存储与缓存</h3>
                    <p>临时播放缓存保存在 app-local cache/.frameq-audio-review；清理不会删除原始任务音频。</p>
                  </div>
                  <div className="config-file-row audio-cache-row">
                    <code title={audioReviewCacheUsage?.cachePath ?? ""}>
                      音频播放缓存：{formatByteSize(audioReviewCacheUsage?.sizeBytes ?? 0)}
                    </code>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void clearAudioReviewCacheFromSettings()}
                      disabled={settingsLoading || settingsSaving || !audioReviewCacheUsage}
                    >
                      <Trash2 size={15} />
                      <span>清理播放缓存</span>
                    </button>
                  </div>
                </section>
              ) : null}

              {settingsCategory === "updates" ? (
                <section id="settings-updates" className="sheet-form-section update-settings-section">
                  <div className="form-section-heading">
                    <h3>应用更新</h3>
                    <p>FrameQ 会升级桌面端和内置 worker；模型缓存和本机产物保持在 app-local data。</p>
                  </div>
                  <div className={`update-status-card ${updateState.status}`}>
                    <div>
                      <span className={`model-status-badge ${updateState.status === "failed" ? "missing" : "ready"}`}>
                        {inAppUpdates ? updateStatusLabel(updateState) : "手动更新"}
                      </span>
                      <strong>{updateState.availableVersion ? `FrameQ ${updateState.availableVersion}` : "FrameQ stable"}</strong>
                      <small>
                        {inAppUpdates
                          ? updateState.message ||
                            "启动后会自动静默检查更新，也可以在这里手动检查。"
                          : "macOS 版本通过发布页手动下载安装，暂未启用应用内自动更新。"}
                      </small>
                      {updateState.notes ? <small>{updateState.notes}</small> : null}
                      {updateInstallBlocked && updateState.status === "available" ? (
                        <small>当前任务或模型下载完成后才能安装更新。</small>
                      ) : null}
                    </div>
                    {updateState.status === "downloading" || updateState.status === "installing" ? (
                      <div className="update-progress">
                        <div className="progress-track">
                          <span
                            className="progress-fill video_transcribing"
                            style={{ width: `${updateState.progress}%` }}
                          />
                        </div>
                        <small>{formatProgressPercent(updateState.progress)}</small>
                      </div>
                    ) : null}
                  </div>
                  <div className="update-actions">
                    {inAppUpdates ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void onCheckForUpdates({ silent: false })}
                          disabled={updateBusy}
                        >
                          <RotateCcw size={15} />
                          <span>{updateState.status === "checking" ? "检查中" : "检查更新"}</span>
                        </button>
                        {updateState.status === "ready_to_restart" ? (
                          <button type="button" className="primary-button" onClick={() => void onRestartForUpdate()}>
                            <RotateCcw size={15} />
                            <span>重启完成更新</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => void onInstallUpdate()}
                            disabled={
                              updateBusy ||
                              updateInstallBlocked ||
                              !["available", "postponed"].includes(updateState.status)
                            }
                          >
                            <Download size={15} />
                            <span>一键升级</span>
                          </button>
                        )}
                        {["available", "postponed"].includes(updateState.status) ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void onPostponeUpdateReminder()}
                            disabled={updateBusy}
                          >
                            <span>稍后提醒</span>
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <button type="button" className="primary-button" onClick={() => void onOpenReleases()}>
                        <Download size={15} />
                        <span>前往下载页</span>
                      </button>
                    )}
                  </div>
                </section>
              ) : null}

              {settingsCategory === "advanced" ? (
                <section id="settings-advanced" className="sheet-form-section settings-config-file-section">
                  <div className="form-section-heading">
                    <h3>本机配置文件</h3>
                    <p>高级本机设置保存在 app-local data 的 .env 文件中，LLM 配置仍由服务端统一管理。</p>
                  </div>
                  <div className="config-file-row">
                    <code title={settingsConfigPath}>{settingsConfigPath || "读取后显示配置文件路径"}</code>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void locateSettingsConfigFile()}
                      disabled={settingsLoading || !settingsConfigPath}
                    >
                      <FolderOpen size={15} />
                      <span>定位文件</span>
                    </button>
                  </div>
                </section>
              ) : null}

              {settingsNotice ? <p className="action-notice inline-notice">{settingsNotice}</p> : null}
            </div>
          </div>
        </form>
        <div className="settings-actions sheet-footer">
          <button type="button" className="secondary-button" onClick={closeSettings}>
            <span>关闭</span>
          </button>
          <button
            className="primary-button"
            type="submit"
            form="settings-form"
            disabled={settingsLoading || settingsSaving}
          >
            <span>{settingsSaving ? "保存中" : "保存配置"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
