import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import "./App.css";
import type { DraftPlatformId } from "./insightPreferences";
import {
  getExportPath,
  isProcessingStage,
  type TaskArtifactKey,
} from "./workflow";
import { createTaskWorkspaceViewModel } from "./taskWorkspaceViewModel";
import type { HistoryItem } from "./historyClient";
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
import { TranscriptDissectionConfirmationSheet } from "./features/dissection/TranscriptDissectionConfirmationSheet";
import { useTranscriptDissectionController } from "./features/dissection/useTranscriptDissectionController";
import { useDiagnosticExport } from "./features/diagnostics/useDiagnosticExport";
import { AiGenerationWorkspace } from "./features/results/AiGenerationWorkspace";
import { AiResultDetailSheet } from "./features/results/AiResultDetailSheet";
import { DraftConfirmationSheet } from "./features/results/DraftConfirmationSheet";
import { DraftResultSheet } from "./features/results/DraftResultSheet";
import { SummaryConfirmationSheet } from "./features/results/SummaryConfirmationSheet";
import { handleRegenerateDraft } from "./features/results/regenerateDraft";
import { TaskStatusBanner } from "./features/results/TaskStatusBanner";
import { SettingsSheet } from "./features/settings/SettingsSheet";
import { useSettingsController } from "./features/settings/useSettingsController";
import { LocalTranscriptWorkspace } from "./features/transcript/LocalTranscriptWorkspace";
import { useTranscriptDetailController } from "./features/transcript/useTranscriptDetailController";
import { useTranscriptPolishController } from "./features/transcript/useTranscriptPolishController";
import { AppToolbar } from "./features/window/AppToolbar";
import { TaskComposer } from "./features/workflow/TaskComposer";
import { useTaskProcessingController } from "./features/workflow/useTaskProcessingController";
import { useAppUpdateController } from "./features/updates/useAppUpdateController";
import { useUiLocale } from "./i18n/LocaleProvider";
import { formatProgressPercent } from "./i18n/formatters";
import { renderUiMessage, uiMessage, type UiMessage } from "./i18n/uiMessage";
import { UI_MOTION_TRANSITION } from "./uiMotion";
import { revealPath } from "./features/common/revealPath";
import { useEscapeKey } from "./features/common/useEscapeKey";

function accountBaseBlocker(account: AccountStatus): UiMessage | null {
  if (!account.authenticated) {
    return uiMessage("account.notice.signInRequired");
  }

  if (account.entitlementStatus !== "active") {
    return uiMessage("account.notice.activationRequiredForAction");
  }

  return null;
}

function accountProcessBlockerMessage(account: AccountStatus): UiMessage {
  return (
    accountBaseBlocker(account) ??
    uiMessage(
      account.serverError
        ? "account.notice.accountUnavailable"
        : "account.notice.processingUnavailable",
    )
  );
}

function accountAiBlockerMessage(account: AccountStatus): UiMessage {
  const baseBlocker = accountBaseBlocker(account);
  if (baseBlocker) {
    return baseBlocker;
  }

  if (!account.llmConfigured) {
    return uiMessage("account.notice.llmConfigurationRequired");
  }

  if (account.llmQuotaRemaining <= 0) {
    return uiMessage("account.notice.creditsExhausted");
  }

  return uiMessage(
    account.serverError
      ? "account.notice.accountUnavailable"
      : "account.notice.aiUnavailable",
  );
}

function App() {
  const resolvedLocale = useUiLocale();
  const { t: tCommon } = useTranslation("common");
  const { t: tWorkflow } = useTranslation("workflow");
  const { t: tUpdates } = useTranslation("updates");
  const { t: tSynthesis } = useTranslation("synthesis");
  const [actionNotice, setActionNotice] = useState<UiMessage | null>(null);
  const [animateNewTaskEntry, setAnimateNewTaskEntry] = useState(false);
  const diagnosticExportController = useDiagnosticExport();
  const settingsController = useSettingsController(diagnosticExportController);
  // Draft confirmation + draft viewer sheet state. The
  // confirmation sheet is opened by the draft card's generate action; the
  // viewer is opened by the draft card's view action (`onViewTarget("draft")`).
  const [draftConfirmOpen, setDraftConfirmOpen] = useState(false);
  const [draftResultOpen, setDraftResultOpen] = useState(false);
  const { settingsOpen, closeSettings, openSettings } = settingsController;
  const closeDetailForTaskRef = useRef<() => void>(() => {});
  const resetInsightGenerationUiRef = useRef<() => void>(() => {});
  const {
    modelGuideOpen,
    setModelGuideOpen,
    asrModelStatus,
    modelDownloadProgress,
    modelDownloadNotice,
    modelDownloadStalled,
    modelDownloadActive,
    refreshAsrModelStatus,
    startAsrModelDownload,
    startRuntimeComponentDownload,
    runtimeComponentDownloading,
    ensureAsrModelReady,
    cancelCurrentAsrModelDownload,
  } = useAsrModelDownload();

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    void refreshAsrModelStatus(settingsController.settingsDraft.asrModel).catch(() => undefined);
  }, [
    refreshAsrModelStatus,
    settingsController.settingsDraft.asrModel,
    settingsOpen,
  ]);

  const resetTaskUi = useCallback(() => {
    closeDetailForTaskRef.current();
    resetInsightGenerationUiRef.current();
    setActionNotice(null);
  }, []);
  const prepareInsightRetryUi = useCallback(() => {
    closeDetailForTaskRef.current();
    setActionNotice(null);
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
    setLocalMediaSelection,
    removeLocalMediaSelection,
    applyTranscriptSave,
    applyDraftSave,
    completeHistoryTaskDeletion,
    restoreHistoryItem,
    retryInsightGeneration,
    setDraftSeedInsightId,
    startNewTaskFromToolbar,
    submitTask,
  } = useTaskProcessingController({
    onResetTaskUi: resetTaskUi,
    onRetryStarted: prepareInsightRetryUi,
    ensureAsrModelReady,
    modelDownloadActive,
    processBlockerMessage: accountProcessBlockerMessage,
    aiBlockerMessage: accountAiBlockerMessage,
  });
  const transcriptDetailController = useTranscriptDetailController({
    workflow,
    applyTranscriptSave,
    setActionNotice,
    locale: resolvedLocale,
  });
  const {
    detailTab,
    openDetailTab,
    closeDetail,
    currentTranscriptPath,
    prepareTranscriptForTaskDeletion,
    transcriptSaving,
  } = transcriptDetailController;
  useEffect(() => {
    closeDetailForTaskRef.current = closeDetail;
  }, [closeDetail]);
  const {
    account,
    accountOpen,
    accountNotice,
    accountLoading,
    activationCodeRequest,
    activationCodeDraft,
    activationRedeeming,
    accountChipLabel,
    accountStatusText,
    closeAccountPanel,
    handleAuthCallback,
    openAccountPanel,
    requestActivationCodeByEmail,
    redeemActivationCodeFromInput,
    refreshAccountStatus,
    setActivationCodeDraft,
    signOutAccount,
    startLoginFlow,
  } = useAccountController({
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
  const transcriptPolish = useTranscriptPolishController({
    workflow,
    outputLanguage: resolvedLocale,
    account,
    openAccountPanel,
    aiBlockerMessage: accountAiBlockerMessage,
    setActionNotice,
    refreshPolishedTranscript: transcriptDetailController.refreshPolishedTranscript,
  });
  const {
    aiActionNotice,
    summaryConfirmOpen,
    insightPreferenceFlow,
    insightPreferenceBusy,
    confirmedOutputLanguage,
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
    outputLanguage: resolvedLocale,
    retryInsightGeneration,
    aiBlockerMessage: accountAiBlockerMessage,
  });
  const dissectionController = useTranscriptDissectionController({
    workflow,
    account,
    openAccountPanel,
    outputLanguage: resolvedLocale,
    retryInsightGeneration,
  });
  const locateDissectionChunks = useCallback((chunkIds: number[]) => {
    if (!workflow.dissection || workflow.dissectionStale || transcriptDetailController.transcriptDirty) {
      return;
    }
    const chunk = workflow.dissection.sourceChunks.find((candidate) =>
      chunkIds.includes(candidate.id)
    );
    if (!chunk) {
      return;
    }
    closeDetail();
    transcriptDetailController.locateTranscriptByteRange(chunk.startByte, chunk.endByte);
  }, [closeDetail, transcriptDetailController, workflow.dissection, workflow.dissectionStale]);
  useEffect(() => {
    resetInsightGenerationUiRef.current = resetInsightGenerationUi;
  }, [resetInsightGenerationUi]);

  // Confirm draft generation — calls the draft retry path with the
  // selected seed insight id and the user-selected target platform. Cancel
  // (closeSheet) does NOT call the worker, so it costs no quota.
  // retryInsightGeneration handles the account/quota gate (opens the account
  // panel if blocked) and the insights_generating progress phase. The draft
  // viewer opens once the result arrives.
  const confirmDraftGeneration = useCallback(
    (platform: DraftPlatformId) => {
      setDraftConfirmOpen(false);
      void retryInsightGeneration(
        "draft",
        resolvedLocale,
        null,
        account,
        openAccountPanel,
        undefined,
        workflow.draftSeedInsightId ?? undefined,
        platform,
      );
    },
    [
      account,
      openAccountPanel,
      resolvedLocale,
      retryInsightGeneration,
      workflow.draftSeedInsightId,
    ],
  );

  // Regenerate draft — routes back to the first-generation confirmation path.
  // If the user has edited the draft, a browser confirm warns about discarding
  // edits. On cancel the function is a no-op (no quota consumed, sheets
  // unchanged). On confirm (or when not dirty), closes the result sheet, writes
  // the seed, and opens DraftConfirmationSheet.
  const regenerateDraft = useCallback(
    (seedInsightId: number | null) => {
      handleRegenerateDraft(
        workflow.draftEdited,
        seedInsightId,
        setDraftResultOpen,
        setDraftConfirmOpen,
        setDraftSeedInsightId,
        tSynthesis("draftResult.regenerateConfirm"),
      );
    },
    [tSynthesis, workflow.draftEdited],
  );

  const handleHistoryItemSelected = useCallback(
    (item: HistoryItem) => {
      restoreHistoryItem(item);
    },
    [restoreHistoryItem],
  );
  const handleHistoryItemDeleted = useCallback(
    (taskId: string) => {
      completeHistoryTaskDeletion(taskId);
    },
    [completeHistoryTaskDeletion],
  );
  const historyController = useHistoryController({
    onHistoryItemSelected: handleHistoryItemSelected,
    onHistoryItemDeleted: handleHistoryItemDeleted,
    onPrepareHistoryItemDeletion: prepareTranscriptForTaskDeletion,
  });
  const canDeleteHistory = canRestoreHistory && !transcriptSaving;
  const historyDeleteUnavailableMessage = transcriptSaving
    ? uiMessage("history.disabled.deletionWhileTranscriptSaving")
    : uiMessage("history.disabled.deletionWhileProcessing");
  const { historyOpen, closeHistory, openHistory } = historyController;
  const {
    updateState,
    updateBusy,
    updateInstallBlocked,
    updateToolbarVisible,
    updateSpinnerVisible,
    inAppUpdates,
    currentVersion,
    checkForUpdates,
    installUpdate,
    postponeUpdateReminder,
    restartForUpdate,
    openReleases,
  } = useAppUpdateController({
    processingActive: isProcessingStage(workflow.stage),
    modelDownloadActive,
  });

  useEscapeKey([
    [Boolean(detailTab), closeDetail],
    [historyOpen, closeHistory],
    [summaryConfirmOpen, closeSummaryConfirmation],
    [draftConfirmOpen, () => setDraftConfirmOpen(false)],
    [draftResultOpen, () => setDraftResultOpen(false)],
    [Boolean(insightPreferenceFlow), closeInsightPreferenceFlow],
    [settingsOpen, closeSettings],
    [modelGuideOpen && !modelDownloadActive, () => setModelGuideOpen(false)],
  ]);

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
      setActionNotice(uiMessage("transcript.notice.noExport"));
      return;
    }

    setActionNotice(
      uiMessage(
        (await revealPath(artifactPath))
          ? "transcript.notice.exportLocated"
          : "transcript.notice.exportLocateFailed",
      ),
    );
  }

  const activeStageBody = tWorkflow(`stage.${workflow.stage}.body`);
  const updateToolbarText = (() => {
    if (updateState.status === "ready_to_restart") return tUpdates("toolbar.restart");
    if (updateState.status === "downloading") return formatProgressPercent(updateState.progress);
    if (updateState.status === "installing") return tUpdates("toolbar.installing");
    return updateState.availableVersion
      ? tUpdates("toolbar.version", { version: updateState.availableVersion })
      : tUpdates("toolbar.available");
  })();
  const toolbarNewTaskAriaLabel = renderUiMessage(
    resolvedLocale,
    toolbarNewTaskButtonState.ariaLabel,
  );
  const toolbarNewTaskTitle = renderUiMessage(
    resolvedLocale,
    toolbarNewTaskButtonState.title,
  );
  const handleNewTaskFromToolbar = useCallback(() => {
    if (toolbarNewTaskButtonState.disabled) {
      return;
    }

    setAnimateNewTaskEntry(true);
    startNewTaskFromToolbar();
  }, [startNewTaskFromToolbar, toolbarNewTaskButtonState.disabled]);

  return (
    <main className="app-shell">
      <section className="desktop-window" aria-label={tCommon("window.ariaLabel")}>
        <AppToolbar
          accountChipLabel={accountChipLabel}
          accountActive={canProcessWithAccount(account)}
          update={{
            visible: updateToolbarVisible,
            status: updateState.status,
            text: updateToolbarText,
            busy: updateBusy,
            spinnerVisible: updateSpinnerVisible,
          }}
          newTask={{
            disabled: toolbarNewTaskButtonState.disabled,
            ariaLabel: toolbarNewTaskAriaLabel,
            title: toolbarNewTaskTitle,
          }}
          onOpenAccount={() => openAccountPanel()}
          onInstallUpdate={installUpdate}
          onOpenHistory={openHistory}
          onOpenSettings={openSettings}
          onNewTask={handleNewTaskFromToolbar}
        />

        <section
          className={`workspace ${workflow.stage === "waiting_input" ? "waiting-layout" : "active-layout"}`}
          aria-label={tWorkflow("input.workspaceAria")}
        >
          {workflow.stage === "waiting_input" ? (
            <motion.div
              className="workflow-column"
              data-motion="new-task-entry"
              initial={animateNewTaskEntry ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={UI_MOTION_TRANSITION}
              onAnimationComplete={() => {
                if (animateNewTaskEntry) {
                  setAnimateNewTaskEntry(false);
                }
              }}
            >
              <TaskComposer
                source={workflow.composerSource}
                canSubmit={canSubmit}
                statusBody={activeStageBody}
                onUrlDraftChange={updateUrlDraft}
                onLocalMediaSelected={setLocalMediaSelection}
                onRemoveLocalMedia={removeLocalMediaSelection}
                onSubmit={(submission) => {
                  void submitTask(submission, account, openAccountPanel);
                }}
              />
            </motion.div>
          ) : (
            <>
              <TaskStatusBanner model={taskWorkspaceModel.banner} />
              <div className="task-workspace-layout">
                <LocalTranscriptWorkspace
                  model={taskWorkspaceModel.local}
                  controller={transcriptDetailController}
                  actionNotice={aiActionNotice ? null : actionNotice}
                  polishingTranscript={transcriptPolish.polishingTranscript}
                  onPolishTranscript={() => void transcriptPolish.polishTranscript()}
                  onLocateArtifact={(artifact) => void locateArtifact(artifact)}
                  onCancel={() => void cancelCurrentProcessing()}
                />
                <AiGenerationWorkspace
                  model={taskWorkspaceModel.ai}
                  quotaRemaining={account.llmQuotaRemaining}
                  notice={aiActionNotice}
                  onSummaryAction={openSummaryConfirmation}
                  onInsightsAction={() => void openInsightPreferenceFlow()}
                  onDissectionAction={dissectionController.openConfirmation}
                  onDraftAction={() => {
                    // Open the draft confirmation sheet (does NOT start
                    // generation — that only happens on confirm, so cancel
                    // costs no quota).
                    setActionNotice(null);
                    setDraftConfirmOpen(true);
                  }}
                  onViewTarget={(target) => {
                    setActionNotice(null);
                    // Draft has its own viewer (separate from the shared
                    // summary/insights detail tab). Summary and insights still
                    // route through the shared AI detail sheet.
                    if (target === "draft") {
                      setDraftResultOpen(true);
                    } else {
                      openDetailTab(target);
                    }
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
        activationCodeRequest={activationCodeRequest}
        activationCodeDraft={activationCodeDraft}
        activationRedeeming={activationRedeeming}
        onClose={closeAccountPanel}
        onActivationCodeChange={setActivationCodeDraft}
        onRequestActivationCode={requestActivationCodeByEmail}
        onRedeemActivationCode={redeemActivationCodeFromInput}
        onSignOut={signOutAccount}
        onStartLogin={startLoginFlow}
      />

      <ModelGuideSheet
        open={modelGuideOpen}
        modelDownloadActive={modelDownloadActive}
        asrModelStatus={asrModelStatus}
        modelDownloadProgress={modelDownloadProgress}
        modelDownloadNotice={modelDownloadNotice}
        modelDownloadStalled={modelDownloadStalled}
        diagnosticExportController={diagnosticExportController}
        onClose={() => setModelGuideOpen(false)}
        onStartDownload={startAsrModelDownload}
        onCancelDownload={cancelCurrentAsrModelDownload}
        onDownloadRuntimeComponent={startRuntimeComponentDownload}
        runtimeComponentDownloading={runtimeComponentDownloading}
      />

      <SummaryConfirmationSheet
        open={summaryConfirmOpen}
        locale={resolvedLocale}
        transcriptText={workflow.text}
        transcriptPath={currentTranscriptPath}
        quotaRemaining={account.llmQuotaRemaining}
        busy={isProcessingStage(workflow.stage)}
        onConfirm={confirmSummaryGeneration}
        onCancel={closeSummaryConfirmation}
      />

      <InsightPreferenceFlow
        flow={insightPreferenceFlow}
        busy={insightPreferenceBusy || isProcessingStage(workflow.stage)}
        accountQuotaRemaining={account.llmQuotaRemaining}
        transcriptText={workflow.text}
        transcriptPath={currentTranscriptPath}
        locale={resolvedLocale}
        outputLanguage={confirmedOutputLanguage ?? resolvedLocale}
        onFlowChange={setInsightPreferenceFlow}
        onSkipProfile={skipCurrentProfileSetup}
        onSaveProfile={saveCurrentProfile}
        onConfirm={confirmInsightPreferences}
        onCancel={closeInsightPreferenceFlow}
      />

      <TranscriptDissectionConfirmationSheet
        preview={dissectionController.preview}
        onCancel={dissectionController.closeConfirmation}
        onConfirm={dissectionController.confirmGeneration}
      />

      <AiResultDetailSheet
        actionNotice={actionNotice}
        controller={transcriptDetailController}
        workflow={workflow}
        onOpenDirectionEditor={openDirectionEditorFromDetail}
        onOpenDissectionConfirmation={dissectionController.openConfirmation}
        onLocateDissectionChunks={locateDissectionChunks}
        onSelectDraftSeed={setDraftSeedInsightId}
        onClearDraftSeed={() => setDraftSeedInsightId(null)}
      />

      <DraftConfirmationSheet
        open={draftConfirmOpen}
        workflow={workflow}
        busy={isProcessingStage(workflow.stage)}
        quotaRemaining={account.llmQuotaRemaining}
        transcriptPath={currentTranscriptPath}
        onConfirm={confirmDraftGeneration}
        onCancel={() => setDraftConfirmOpen(false)}
      />

      <DraftResultSheet
        open={draftResultOpen}
        workflow={workflow}
        onSaved={applyDraftSave}
        onRegenerate={regenerateDraft}
        onClose={() => setDraftResultOpen(false)}
      />

      <HistorySheet
        controller={historyController}
        selectionDisabled={!canRestoreHistory}
        selectionDisabledReason={historyRestoreUnavailableMessage}
        deletionDisabled={!canDeleteHistory}
        deletionDisabledReason={historyDeleteUnavailableMessage}
      />

      <SettingsSheet
        locale={resolvedLocale}
        controller={settingsController}
        asrModelStatus={asrModelStatus}
        modelDownloadActive={modelDownloadActive}
        updateState={updateState}
        updateBusy={updateBusy}
        updateInstallBlocked={updateInstallBlocked}
        inAppUpdates={inAppUpdates}
        currentVersion={currentVersion}
        onAsrModelSelection={(model) => {
          void refreshAsrModelStatus(model).catch(() => undefined);
        }}
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
