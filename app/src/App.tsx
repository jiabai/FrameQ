import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  Download,
  History as HistoryIcon,
  ListChecks,
  LoaderCircle,
  Play,
  RotateCcw,
  Settings,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  getExportPath,
  isProcessingStage,
  type TaskArtifactKey,
  type WorkflowState,
} from "./workflow";
import { createTaskWorkspaceViewModel } from "./taskWorkspaceViewModel";
import type { HistoryItem } from "./historyClient";
import type { UpdateState } from "./updateState";
import {
  canProcessWithAccount,
  type AccountStatus,
} from "./accountState";
import { AccountSheet } from "./features/account/AccountSheet";
import { useAccountController } from "./features/account/useAccountController";
import { ModelGuideSheet } from "./features/asrModel/ModelGuideSheet";
import { useAsrModelDownload } from "./features/asrModel/useAsrModelDownload";
import { HistorySheet } from "./features/history/HistorySheet";
import { useHistoryController } from "./features/history/useHistoryController";
import { InsightPreferenceFlow } from "./features/insightPreferences/InsightPreferenceFlow";
import { useInsightGenerationController } from "./features/insightPreferences/useInsightGenerationController";
import { AiGenerationWorkspace } from "./features/results/AiGenerationWorkspace";
import { AiResultDetailSheet } from "./features/results/AiResultDetailSheet";
import { TaskStatusBanner } from "./features/results/TaskStatusBanner";
import { SettingsSheet } from "./features/settings/SettingsSheet";
import { useSettingsController } from "./features/settings/useSettingsController";
import { LocalTranscriptWorkspace } from "./features/transcript/LocalTranscriptWorkspace";
import { useTranscriptDetailController } from "./features/transcript/useTranscriptDetailController";
import { useWindowChromeController } from "./features/window/useWindowChromeController";
import { useTaskProcessingController } from "./features/workflow/useTaskProcessingController";
import { useAppUpdateController } from "./features/updates/useAppUpdateController";

const stageCopy: Record<WorkflowState["stage"], { title: string; body: string }> = {
  waiting_input: {
    title: "等待输入",
    body: "等待用户提交视频链接。",
  },
  cancelling: {
    title: "正在取消",
    body: "正在终止当前任务及其子进程，请等待最终结果。",
  },
  video_extracting: {
    title: "视频提取中",
    body: "正在下载视频并提取音频，请保持网络连接。",
  },
  video_transcribing: {
    title: "视频转译中",
    body: "正在使用本地 ASR 模型缓存识别语音内容。",
  },
  insights_generating: {
    title: "AI 整理中",
    body: "正在使用云端 LLM 生成所选 AI 结果。",
  },
  completed: {
    title: "文字稿完成",
    body: "视频、音频和文字稿已准备好；启发灵感可单独确认生成。",
  },
  partial_completed: {
    title: "部分完成",
    body: "文字稿已生成，失败的 AI 结果稍后可以重试。",
  },
  failed: {
    title: "失败",
    body: "处理失败，请检查链接或稍后重试。",
  },
};

const asrModelLabels: Record<string, string> = {
  "Qwen/Qwen3-ASR-0.6B": "Qwen3-ASR 0.6B",
  "iic/SenseVoiceSmall": "SenseVoice Small",
};

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatProgressPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function asrModelSourceLabel(source: string): string {
  return source === "custom_url" ? "自定义下载源" : "ModelScope";
}

function accountProcessBlockerMessage(account: AccountStatus, actionLabel: string): string {
  if (!account.authenticated) {
    return `请先登录 FrameQ 账号后再${actionLabel}。`;
  }

  if (account.entitlementStatus !== "active") {
    return `请先输入激活码激活 FrameQ 后再${actionLabel}。`;
  }

  return account.serverError
    ? `当前账号状态暂不可用：${account.serverError}`
    : `当前账号暂不能${actionLabel}，请刷新账号状态后重试。`;
}

function accountAiBlockerMessage(account: AccountStatus, actionLabel: string): string {
  if (!account.authenticated) {
    return `请先登录 FrameQ 账号后再${actionLabel}。`;
  }

  if (account.entitlementStatus !== "active") {
    return `请先输入激活码激活 FrameQ 后再${actionLabel}。`;
  }

  if (!account.llmConfigured) {
    return "AI 结果 LLM 尚未由管理员配置完成，请稍后再试。";
  }

  if (account.llmQuotaRemaining <= 0) {
    return "LLM API 调用额度已用完，请联系管理员补充额度或兑换新的激活码。";
  }

  return account.serverError
    ? `当前账号状态暂不可用：${account.serverError}`
    : `当前账号暂不能${actionLabel}，请刷新账号状态后重试。`;
}

function updateToolbarLabel(state: UpdateState): string {
  if (state.status === "ready_to_restart") {
    return "重启更新";
  }

  if (state.status === "downloading") {
    return `${formatProgressPercent(state.progress)}`;
  }

  if (state.status === "installing") {
    return "安装中";
  }

  return state.availableVersion ? `新版本 ${state.availableVersion}` : "有更新";
}

function App() {
  const [actionNotice, setActionNotice] = useState("");
  const settingsController = useSettingsController();
  const { settingsOpen, closeSettings, openSettings } = settingsController;
  const closeDetailForTaskRef = useRef<() => void>(() => {});
  const resetInsightGenerationUiRef = useRef<() => void>(() => {});
  const {
    modelGuideOpen,
    setModelGuideOpen,
    openModelGuide,
    asrModelStatus,
    modelDownloadProgress,
    modelDownloadNotice,
    modelDownloadStalled,
    modelDownloadActive,
    refreshAsrModelStatus,
    startAsrModelDownload,
    cancelCurrentAsrModelDownload,
  } = useAsrModelDownload();
  const resetTaskUi = useCallback(() => {
    closeDetailForTaskRef.current();
    resetInsightGenerationUiRef.current();
    setActionNotice("");
  }, []);
  const prepareInsightRetryUi = useCallback(() => {
    closeDetailForTaskRef.current();
    setActionNotice("");
  }, []);
  const {
    workflow,
    canSubmit,
    canRestoreHistory,
    historyRestoreUnavailableMessage,
    toolbarNewTaskButtonState,
    cancelCurrentProcessing,
    resetWorkflow,
    updateUrlDraft,
    applyTranscriptSave,
    restoreHistoryItem,
    retryInsightGeneration,
    startNewTaskFromToolbar,
    submitUrl,
  } = useTaskProcessingController({
    onResetTaskUi: resetTaskUi,
    onRetryStarted: prepareInsightRetryUi,
    processBlockerMessage: accountProcessBlockerMessage,
    aiBlockerMessage: accountAiBlockerMessage,
  });
  const transcriptDetailController = useTranscriptDetailController({
    workflow,
    applyTranscriptSave,
    setActionNotice,
  });
  const {
    detailTab,
    openDetailTab,
    closeDetail,
    currentTranscriptPath,
  } = transcriptDetailController;
  closeDetailForTaskRef.current = closeDetail;
  const {
    account,
    accountOpen,
    accountNotice,
    accountLoading,
    activationCodeDraft,
    activationRedeeming,
    accountChipLabel,
    accountStatusText,
    closeAccountPanel,
    handleAuthCallback,
    openAccountPanel,
    redeemActivationCodeFromInput,
    refreshAccountStatus,
    setActivationCodeDraft,
    signOutAccount,
    startLoginFlow,
  } = useAccountController({
    formatHistoryDate,
    onSignedOut: () => {
      if (isProcessingStage(workflow.stage)) {
        void cancelCurrentProcessing();
        return;
      }
      resetWorkflow();
    },
  });
  const taskWorkspaceModel = useMemo(
    () => createTaskWorkspaceViewModel(workflow, account),
    [account, workflow],
  );
  const {
    aiActionNotice,
    summaryConfirmOpen,
    insightPreferenceFlow,
    insightPreferenceBusy,
    setInsightPreferenceFlow,
    closeSummaryConfirmation,
    closeInsightPreferenceFlow,
    resetInsightGenerationUi,
    openInsightPreferenceFlow,
    openSummaryConfirmation,
    confirmSummaryGeneration,
    openProfileEditorFromSettings,
    openDirectionEditorFromDetail,
    skipCurrentProfileSetup,
    saveCurrentProfile,
    confirmInsightPreferences,
  } = useInsightGenerationController({
    workflow,
    account,
    setActionNotice,
    closeSettings,
    closeDetail,
    openAccountPanel,
    refreshAccountStatus,
    retryInsightGeneration,
    aiBlockerMessage: accountAiBlockerMessage,
  });
  resetInsightGenerationUiRef.current = resetInsightGenerationUi;
  const handleHistoryItemSelected = useCallback(
    (item: HistoryItem) => {
      restoreHistoryItem(item);
    },
    [restoreHistoryItem],
  );
  const historyController = useHistoryController({
    onHistoryItemSelected: handleHistoryItemSelected,
  });
  const { historyOpen, closeHistory, openHistory } = historyController;
  const {
    handleToolbarMouseDown,
    closeWindow,
    minimizeWindow,
    toggleMaximizeWindow,
  } = useWindowChromeController();
  const {
    updateState,
    updateBusy,
    updateInstallBlocked,
    updateToolbarVisible,
    updateSpinnerVisible,
    inAppUpdates,
    checkForUpdates,
    installUpdate,
    postponeUpdateReminder,
    restartForUpdate,
    openReleases,
  } = useAppUpdateController({
    processingActive: isProcessingStage(workflow.stage),
    modelDownloadActive,
  });

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (detailTab) {
        closeDetail();
        return;
      }

      if (historyOpen) {
        closeHistory();
        return;
      }

      if (summaryConfirmOpen) {
        closeSummaryConfirmation();
        return;
      }

      if (insightPreferenceFlow) {
        closeInsightPreferenceFlow();
        return;
      }

      if (settingsOpen) {
        closeSettings();
        return;
      }

      if (modelGuideOpen && !modelDownloadActive) {
        setModelGuideOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [
    detailTab,
    closeDetail,
    historyOpen,
    closeHistory,
    summaryConfirmOpen,
    closeSummaryConfirmation,
    insightPreferenceFlow,
    closeInsightPreferenceFlow,
    settingsOpen,
    closeSettings,
    modelGuideOpen,
    modelDownloadActive,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function openFirstRunSettingsIfNeeded() {
      try {
        const firstRun = await refreshAsrModelStatus();
        if (cancelled) {
          return;
        }

        if (!firstRun.asrModelAvailable) {
          openModelGuide(
            `首次使用前需要下载 ASR 模型。模型会保存到：${firstRun.asrModelDir}`,
          );
          return;
        }

        return;
      } catch {
        // Browser-only development and tests do not always provide Tauri commands.
      }
    }

    void openFirstRunSettingsIfNeeded();
    return () => {
      cancelled = true;
    };
  }, [openModelGuide, refreshAsrModelStatus]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    async function registerDeepLinkListeners() {
      try {
        const currentUrls = await getCurrent();
        if (!cancelled && currentUrls) {
          for (const url of currentUrls) {
            void handleAuthCallback(url);
          }
        }
        unlisten = await onOpenUrl((urls) => {
          for (const url of urls) {
            void handleAuthCallback(url);
          }
        });
      } catch {
        // Browser-only tests and Vite preview do not provide the Tauri deep-link plugin.
      }
    }

    void registerDeepLinkListeners();
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleAuthCallback]);

  async function locateArtifact(artifact: Extract<TaskArtifactKey, "video" | "audio">) {
    const artifactPath = getExportPath(artifact, workflow);
    if (!artifactPath) {
      setActionNotice("暂无可定位的文件。");
      return;
    }

    try {
      await revealItemInDir(artifactPath);
      setActionNotice("已在文件管理器中定位文件。");
    } catch {
      setActionNotice(`无法定位文件：${artifactPath}`);
    }
  }

  const activeCopy = stageCopy[workflow.stage];

  return (
    <main className="app-shell">
      <section className="desktop-window" aria-label="FrameQ 桌面窗口">
        <header className="app-toolbar topbar" data-tauri-drag-region="" onMouseDown={handleToolbarMouseDown}>
          <div className="traffic-lights" role="group" aria-label="窗口操作">
            <button
              className="traffic-light close"
              type="button"
              aria-label="关闭窗口"
              onClick={closeWindow}
            />
            <button
              className="traffic-light minimize"
              type="button"
              aria-label="最小化窗口"
              onClick={minimizeWindow}
            />
            <button
              className="traffic-light zoom"
              type="button"
              aria-label="最大化或还原窗口"
              onClick={toggleMaximizeWindow}
            />
          </div>

          <div className="toolbar-title" data-tauri-drag-region="">
            <span className="app-mark" data-tauri-drag-region="">FQ</span>
            <div data-tauri-drag-region="">
              <h1 data-tauri-drag-region="">FrameQ</h1>
            </div>
          </div>

          <div className="topbar-actions toolbar-actions">
            <button
              className={`account-chip ${canProcessWithAccount(account) ? "active" : ""}`}
              type="button"
              onClick={() => openAccountPanel()}
              aria-label="账号与授权"
            >
              <UserRound size={15} />
              <span>{accountChipLabel}</span>
            </button>
            {updateToolbarVisible ? (
              <button
                className={`update-chip ${updateState.status}`}
                type="button"
                onClick={installUpdate}
                aria-label="应用更新"
                disabled={updateBusy}
              >
                {updateSpinnerVisible ? <LoaderCircle size={15} /> : <Download size={15} />}
                <span>{updateToolbarLabel(updateState)}</span>
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={openHistory} aria-label="查看历史">
              <HistoryIcon size={17} />
            </button>
            <button className="icon-button" type="button" onClick={openSettings} aria-label="应用设置">
              <Settings size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={startNewTaskFromToolbar}
              aria-label={toolbarNewTaskButtonState.ariaLabel}
              title={toolbarNewTaskButtonState.title}
              disabled={toolbarNewTaskButtonState.disabled}
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </header>

        <section
          className={`workspace ${workflow.showUrlInput ? "waiting-layout" : "active-layout"}`}
          aria-label="视频处理工作区"
        >
          {workflow.showUrlInput ? (
            <div className="workflow-column">
              <form
                className="command-panel input-pane"
                onSubmit={(event) => submitUrl(event, account, openAccountPanel)}
              >
                <div className="panel-heading">
                  <div>
                    <p className="section-label">New task</p>
                    <h2>粘贴视频链接</h2>
                  </div>
                </div>

                <div className="url-row command-row">
                  <input
                    id="video-url"
                    aria-label="视频 URL"
                    value={workflow.url}
                    onChange={(event) => {
                      const url = event.currentTarget.value;
                      updateUrlDraft(url);
                    }}
                    placeholder="粘贴抖音或小红书视频链接"
                  />
                  <button className="primary-button" type="submit" disabled={!canSubmit}>
                    <Play size={17} />
                    <span>确认</span>
                  </button>
                </div>
                <p className="status-line">{activeCopy.body}</p>
              </form>
            </div>
          ) : (
            <>
              <TaskStatusBanner model={taskWorkspaceModel.banner} />
              <div className="task-workspace-layout">
                <LocalTranscriptWorkspace
                  workflow={workflow}
                  model={taskWorkspaceModel.local}
                  controller={transcriptDetailController}
                  actionNotice={aiActionNotice ? "" : actionNotice}
                  onLocateArtifact={(artifact) => void locateArtifact(artifact)}
                  onCancel={() => void cancelCurrentProcessing()}
                />
                <AiGenerationWorkspace
                  workflow={workflow}
                  model={taskWorkspaceModel.ai}
                  quotaRemaining={account.llmQuotaRemaining}
                  notice={aiActionNotice}
                  onSummaryAction={openSummaryConfirmation}
                  onInsightsAction={() => void openInsightPreferenceFlow()}
                  onViewTarget={(target) => {
                    setActionNotice("");
                    openDetailTab(target);
                  }}
                  onCancel={() => void cancelCurrentProcessing()}
                />
              </div>
            </>
          )}
        </section>
      </section>

      <AccountSheet
        open={accountOpen}
        account={account}
        accountStatusText={accountStatusText}
        accountNotice={accountNotice}
        accountLoading={accountLoading}
        activationCodeDraft={activationCodeDraft}
        activationRedeeming={activationRedeeming}
        formatHistoryDate={formatHistoryDate}
        onClose={closeAccountPanel}
        onActivationCodeChange={setActivationCodeDraft}
        onRedeemActivationCode={redeemActivationCodeFromInput}
        onSignOut={signOutAccount}
        onStartLogin={startLoginFlow}
      />

      <ModelGuideSheet
        open={modelGuideOpen}
        modelDownloadActive={modelDownloadActive}
        asrModelStatus={asrModelStatus}
        asrModelLabels={asrModelLabels}
        modelDownloadProgress={modelDownloadProgress}
        modelDownloadNotice={modelDownloadNotice}
        modelDownloadStalled={modelDownloadStalled}
        formatProgressPercent={formatProgressPercent}
        asrModelSourceLabel={asrModelSourceLabel}
        onClose={() => setModelGuideOpen(false)}
        onStartDownload={startAsrModelDownload}
        onCancelDownload={cancelCurrentAsrModelDownload}
      />

      {summaryConfirmOpen ? (
        <div
          className="modal-backdrop sheet-backdrop"
          role="presentation"
          onClick={closeSummaryConfirmation}
        >
          <section
            className="sheet-panel detail-modal preference-flow-sheet"
            aria-label="确认要点总结"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">Summary</p>
                <h2>确认要点总结</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={closeSummaryConfirmation}
                aria-label="关闭要点总结确认"
              >
                <X size={18} />
              </button>
            </header>
            <div className="preference-flow-content">
              <p className="settings-warning privacy-callout">
                <ShieldCheck size={16} />
                <span>
                  确认后会把文字稿片段发送到管理员配置的云端 LLM，用于生成要点总结和本地 Mermaid mindmap。
                </span>
              </p>
              <div className="confirm-summary preference-confirm-grid">
                <div>
                  <span className="account-status-label">当前文字稿</span>
                  <strong>
                    {workflow.text.length > 0
                      ? `${workflow.text.length.toLocaleString("zh-CN")} 字`
                      : "等待文字稿"}
                  </strong>
                  <small>{currentTranscriptPath || "文字稿文件生成后才能继续。"}</small>
                </div>
                <div>
                  <span className="account-status-label">账号额度</span>
                  <strong>{account.llmQuotaRemaining} 次可用</strong>
                  <small>1 次额度 = 1 次云端 LLM API 调用尝试；本次会按实际调用次数扣除。</small>
                </div>
              </div>
              <div className="settings-actions sheet-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeSummaryConfirmation}
                  disabled={isProcessingStage(workflow.stage)}
                >
                  <span>取消</span>
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={confirmSummaryGeneration}
                  disabled={isProcessingStage(workflow.stage)}
                >
                  <ListChecks size={16} />
                  <span>确认</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {insightPreferenceFlow ? (
        <InsightPreferenceFlow
          flow={insightPreferenceFlow}
          busy={insightPreferenceBusy || isProcessingStage(workflow.stage)}
          accountQuotaRemaining={account.llmQuotaRemaining}
          transcriptLength={workflow.text.length}
          transcriptPath={currentTranscriptPath}
          onFlowChange={setInsightPreferenceFlow}
          onSkipProfile={skipCurrentProfileSetup}
          onSaveProfile={saveCurrentProfile}
          onConfirm={confirmInsightPreferences}
          onCancel={closeInsightPreferenceFlow}
        />
      ) : null}

      <AiResultDetailSheet
        actionNotice={actionNotice}
        controller={transcriptDetailController}
        workflow={workflow}
        onOpenDirectionEditor={openDirectionEditorFromDetail}
      />

      <HistorySheet
        controller={historyController}
        formatHistoryDate={formatHistoryDate}
        selectionDisabled={!canRestoreHistory}
        selectionDisabledReason={historyRestoreUnavailableMessage}
      />

      <SettingsSheet
        controller={settingsController}
        asrModelStatus={asrModelStatus}
        asrModelLabels={asrModelLabels}
        modelDownloadActive={modelDownloadActive}
        updateState={updateState}
        updateBusy={updateBusy}
        updateInstallBlocked={updateInstallBlocked}
        inAppUpdates={inAppUpdates}
        formatProgressPercent={formatProgressPercent}
        onStartAsrModelDownload={startAsrModelDownload}
        onOpenProfileEditorFromSettings={openProfileEditorFromSettings}
        onCheckForUpdates={checkForUpdates}
        onInstallUpdate={installUpdate}
        onPostponeUpdateReminder={postponeUpdateReminder}
        onRestartForUpdate={restartForUpdate}
        onOpenReleases={openReleases}
      />
    </main>
  );
}

export default App;
