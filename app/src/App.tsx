import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import "./App.css";
import "./features/shell/sidebar.css";
import "./features/shell/shell.css";
import "./features/notes/notes.css";
import "./features/modal/sheets.css";
import type { DraftPlatformId } from "./insightPreferences";
import {
  getExportPath,
  isProcessingStage,
  type TaskArtifactKey,
  type TaskSubmission,
} from "./workflow";
import { createTaskWorkspaceViewModel } from "./taskWorkspaceViewModel";
import type { HistoryItem, HistoryListItem } from "./historyClient";
import type { AccountStatus } from "./accountState";
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
import { StudioWorkspace } from "./features/results/StudioWorkspace";
import { AiResultDetailSheet } from "./features/results/AiResultDetailSheet";
import { DraftConfirmationSheet } from "./features/results/DraftConfirmationSheet";
import { DraftResultSheet } from "./features/results/DraftResultSheet";
import { SummaryConfirmationSheet } from "./features/results/SummaryConfirmationSheet";
import { useDraftRegeneration } from "./features/results/regenerateDraft";
import { ConfirmDialog } from "./features/modal/ConfirmDialog";
import { TaskStatusBanner } from "./features/results/TaskStatusBanner";
import { ProcessingWorkspace } from "./features/results/ProcessingWorkspace";
import { createProcessingWorkspaceModel, getProcessingRetrySubmission } from "./features/results/processingWorkspaceModel";
import { TaskWorkspaceLayout } from "./features/results/TaskWorkspaceLayout";
import { SettingsSheet } from "./features/settings/SettingsSheet";
import { useSettingsController } from "./features/settings/useSettingsController";
import { LocalTranscriptWorkspace } from "./features/transcript/LocalTranscriptWorkspace";
import { ArticleWorkspace } from "./features/articles/ArticleWorkspace";
import { getTaskArtifactPath } from "./taskArtifacts";
import { isArticleTaskSource } from "./webPageProtocol";
import { useTranscriptDetailController } from "./features/transcript/useTranscriptDetailController";
import { useTranscriptPolishController } from "./features/transcript/useTranscriptPolishController";
import { DesktopSidebar } from "./features/shell/DesktopSidebar";
import { SidebarNoteMenu } from "./features/shell/SidebarNoteMenu";
import type { SidebarNoteSection } from "./features/shell/SidebarNoteRow";
import { useNoteActionsController } from "./features/notes/useNoteActionsController";
import { NoteRenameSheet } from "./features/notes/NoteRenameSheet";
import { NoteCollectionsSheet } from "./features/notes/NoteCollectionsSheet";
import { NoteInfoSheet } from "./features/notes/NoteInfoSheet";
import { HomeGreeting } from "./features/shell/HomeGreeting";
import { ShellLibrary } from "./features/shell/ShellLibrary";
import { ShellToolbar } from "./features/shell/ShellToolbar";
import { CollectionsWorkspace } from "./features/collections/CollectionsWorkspace";
import { useCollectionsController } from "./features/collections/useCollectionsController";
import { useCollectionNoteCreation } from "./features/collections/useCollectionNoteCreation";
import { canNavigateShell, createShellNavigation, getHistoryTitle, getShellCollectionId, getShellPage, getShellTaskId, pruneUnavailableShellTasks, removeShellCollection, removeShellTask, shellNavigationReducer, type ShellPage, type ShellNavigationAction } from "./features/shell/shellNavigation";
import { TaskComposer } from "./features/workflow/TaskComposer";
import { useTaskProcessingController } from "./features/workflow/useTaskProcessingController";
import { NoteTitleNotice } from "./features/workflow/NoteTitleNotice";
import { useAppUpdateController } from "./features/updates/useAppUpdateController";
import { useUiLocale } from "./i18n/LocaleProvider";
import { formatProgressPercent } from "./i18n/formatters";
import { renderUiMessage, uiMessage, type UiMessage } from "./i18n/uiMessage";
import { UI_MOTION_TRANSITION } from "./uiMotion";
import { revealPath } from "./features/common/revealPath";
import { useEscapeKey } from "./features/common/useEscapeKey";
import { useDataStorage, useStorageEditor, useStoragePreparation } from "./features/dataStorage/useDataStorageController";

type NoteMenuTarget = { item: HistoryListItem; anchor: HTMLButtonElement; section: SidebarNoteSection };

function restoreNoteMenuFocus(target: NoteMenuTarget | null): void {
  if (!target) return;
  const visible = (element: HTMLElement | null): element is HTMLElement => Boolean(element?.isConnected && !element.closest("[hidden], [inert], .is-collapsed"));
  const ordinary = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-note-menu-task]")).find((element) => element.dataset.noteMenuTask === target.item.taskId && element.dataset.noteMenuSection === "notes");
  const header = document.querySelector<HTMLButtonElement>(".shell-notes-group .shell-history-heading button");
  const destination = document.querySelector<HTMLButtonElement>("[data-shell-destination='notes']");
  (visible(target.anchor) ? target.anchor : visible(ordinary ?? null) ? ordinary : visible(header) ? header : visible(destination) ? destination : null)?.focus({ preventScroll: true });
}

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
  const dataStorage = useDataStorage();
  const dataStorageRef = useRef(dataStorage);
  dataStorageRef.current = dataStorage;
  const resolvedLocale = useUiLocale();
  const { t: tCommon } = useTranslation("common");
  const { t: tWorkflow } = useTranslation("workflow");
  const { t: tUpdates } = useTranslation("updates");
  const { t: tStudio } = useTranslation("studio");
  const { t: tShell } = useTranslation("shell");
  const { t: tNotes } = useTranslation("noteActions");
  const [navigation, setNavigation] = useState(createShellNavigation);
  const collectionsController = useCollectionsController();
  const { load: loadCollections } = collectionsController;
  const [collectionDirty, setCollectionDirty] = useState(false);
  const [createCollectionRequest, setCreateCollectionRequest] = useState(0);
  const [noteMenu, setNoteMenu] = useState<NoteMenuTarget | null>(null);
  const noteActionTargetRef = useRef<NoteMenuTarget | null>(null);
  const noteMutationAllowedRef = useRef(false);
  const canMutateNote = useCallback(() => noteMutationAllowedRef.current || dataStorageRef.current?.isResolvingEditor("note") === true, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
  );
  const shellCanNavigateRef = useRef(true);
  const invalidateHistoryRef = useRef<() => void>(() => {});
  const clearCollectionNoteRef = useRef<() => void>(() => {});
  const refreshAccountAfterTitleRef = useRef<() => void>(() => {});
  const appActiveRef = useRef(true);
  const appLifetimeAbortRef = useRef(new AbortController());
  const appIsActive = useCallback(() => appActiveRef.current, []);
  const appLifetimeSignal = useCallback(() => appLifetimeAbortRef.current.signal, []);
  useEffect(() => {
    appActiveRef.current = true;
    appLifetimeAbortRef.current = new AbortController();
    return () => { appActiveRef.current = false; appLifetimeAbortRef.current.abort(); };
  }, []);
  const pendingNavigationRef = useRef<ShellNavigationAction | null>(null);
  const page = getShellPage(navigation);
  const selectedCollectionId = getShellCollectionId(navigation);
  const [actionNotice, setActionNotice] = useState<UiMessage | null>(null);
  const [animateNewTaskEntry, setAnimateNewTaskEntry] = useState(false);
  const diagnosticExportController = useDiagnosticExport();
  const settingsController = useSettingsController(diagnosticExportController);
  // Draft confirmation + draft viewer sheet state. The
  // confirmation sheet is opened by the draft card's generate action; the
  // viewer is opened by the draft card's view action (`onViewTool("draft")`).
  const [draftConfirmOpen, setDraftConfirmOpen] = useState(false);
  const [draftResultOpen, setDraftResultOpen] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
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
  const [articleChunks, setArticleChunks] = useState<number[]>([]);
  const clearArticleChunks = useCallback(() => setArticleChunks([]), []);
  const prepareInsightRetryUi = useCallback(() => {
    closeDetailForTaskRef.current();
    setActionNotice(null);
  }, []);
  const {
    workflow,
    submissionPending,
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
    applyNoteMetadata,
    completeHistoryTaskDeletion,
    restoreHistoryItem,
    retryInsightGeneration,
    retryNoteTitle,
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
    outputLanguage: resolvedLocale,
    onTitleFinished: () => refreshAccountAfterTitleRef.current(),
    isActive: appIsActive,
    getLifetimeSignal: appLifetimeSignal,
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
  useEffect(() => {
    if (!dataStorage?.frozen) return;
    transcriptDetailController.transcriptAudioRef.current?.pause();
    transcriptDetailController.endTranscriptSegmentEdit();
  }, [dataStorage?.frozen, transcriptDetailController.transcriptAudioRef, transcriptDetailController.endTranscriptSegmentEdit]);
  const {
    account,
    accountOpen,
    accountNotice,
    accountLoading,
    activationCodeRequest,
    activationCodeDraft,
    activationRedeeming,
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
      invalidateHistoryRef.current();
      clearCollectionNoteRef.current();
      pendingNavigationRef.current = null;
      if (isProcessingStage(workflow.stage)) {
        void cancelCurrentProcessing();
        return;
      }
      setNavigation(createShellNavigation());
      resetWorkflow();
    },
  });
  refreshAccountAfterTitleRef.current = () => { void refreshAccountStatus(); };
  const submitNoteTask = useCallback(
    (submission: TaskSubmission) => submitTask(submission, account, openAccountPanel),
    [account, openAccountPanel, submitTask],
  );
  const collectionNoteCreation = useCollectionNoteCreation({
    submitTask: submitNoteTask,
    setMembership: collectionsController.setMembership,
  });
  clearCollectionNoteRef.current = collectionNoteCreation.clear;
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
    if (workflow.taskSource?.kind === "web_page") { setArticleChunks(chunkIds); return; }
    transcriptDetailController.locateTranscriptByteRange(chunk.startByte, chunk.endByte);
  }, [closeDetail, transcriptDetailController, workflow.dissection, workflow.dissectionStale, workflow.taskSource]);
  useEffect(() => { setArticleChunks([]); }, [workflow.taskId]);
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

  const draftRegeneration = useDraftRegeneration({
    taskId: workflow.taskId,
    draftEdited: workflow.draftEdited,
    resultOpen: draftResultOpen,
    saving: draftSaving,
    setDraftResultOpen,
    setDraftConfirmOpen,
    setDraftSeedInsightId,
  });

  const handleHistoryItemSelected = useCallback(
    (item: HistoryItem) => {
      if (!shellCanNavigateRef.current || !restoreHistoryItem(item)) return;
      clearCollectionNoteRef.current();
      const pending = pendingNavigationRef.current;
      pendingNavigationRef.current = null;
      setNavigation((current) => shellNavigationReducer(current, pending ?? {
        type: "navigate", page: "task", taskId: item.taskId, canNavigate: true,
      }));
    },
    [restoreHistoryItem],
  );
  const handleHistoryItemDeleted = useCallback(
    (taskId: string) => {
      collectionNoteCreation.taskDeleted(taskId);
      completeHistoryTaskDeletion(taskId);
      pendingNavigationRef.current = null;
      setNavigation((current) => removeShellTask(current, taskId));
      void loadCollections();
      requestAnimationFrame(() => restoreNoteMenuFocus(noteActionTargetRef.current));
    },
    [collectionNoteCreation.taskDeleted, completeHistoryTaskDeletion, loadCollections],
  );
  const historyController = useHistoryController({
    onHistoryItemSelected: handleHistoryItemSelected,
    onHistoryItemDeleted: handleHistoryItemDeleted,
    onPrepareHistoryItemDeletion: prepareTranscriptForTaskDeletion,
    canDelete: canMutateNote,
  });
  const historyDeleteUnavailableMessage = transcriptSaving
    ? uiMessage("history.disabled.deletionWhileTranscriptSaving")
    : uiMessage("noteActions.notice.blocked");
  const { historyOpen, closeHistory, openHistory, refreshHistory } = historyController;
  const noteActions = useNoteActionsController({
    items: historyController.historyItems,
    canMutate: canMutateNote,
    onCommitted: (result) => {
      historyController.applyCommittedNoteMetadata(result.taskId, result.noteMetadata);
      applyNoteMetadata(result.taskId, result.noteMetadata);
      void refreshHistory();
      requestAnimationFrame(() => restoreNoteMenuFocus(noteActionTargetRef.current));
    },
    onDelete: historyController.requestHistoryItemDeletion,
    loadCollections,
  });
  const { resumeHistoryCleanup } = historyController;
  const cleanupAttemptedRef = useRef(false);
  useEffect(() => {
    if (cleanupAttemptedRef.current) return;
    cleanupAttemptedRef.current = true;
    void resumeHistoryCleanup();
  }, [resumeHistoryCleanup]);
  invalidateHistoryRef.current = closeHistory;
  const {
    updateState,
    installedAwaitingRestart,
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
    processingActive: submissionPending || isProcessingStage(workflow.stage) || collectionNoteCreation.attaching,
    modelDownloadActive: modelDownloadActive || runtimeComponentDownloading,
    maintenanceActive: Boolean(dataStorage?.state && dataStorage.state.dataAccess !== "ready"),
    preparationActive: dataStorage?.preparing ?? false,
  });
  useStoragePreparation({
    busy: submissionPending || isProcessingStage(workflow.stage) || collectionNoteCreation.attaching || modelDownloadActive || runtimeComponentDownloading || transcriptPolish.polishingTranscript || transcriptSaving || draftSaving || settingsController.settingsSaving || insightPreferenceBusy || collectionsController.mutating || noteActions.busy || historyController.historyDeleting || updateBusy || diagnosticExportController.diagnosticExportBusy,
    updateRestartRequired: installedAwaitingRestart,
    restartUpdate: restartForUpdate,
  });
  useStorageEditor({ id: "settings", dirty: settingsController.settingsDirty, saving: settingsController.settingsSaving, save: settingsController.saveSettings, discard: settingsController.discardSettings });
  useStorageEditor({ id: "transcript", dirty: transcriptDetailController.transcriptDirty, saving: transcriptSaving, save: transcriptDetailController.saveTranscriptDraft,
    discard: () => { transcriptDetailController.discardTranscriptDraft(); transcriptDetailController.endTranscriptSegmentEdit(); } });

  useEscapeKey([
    [Boolean(detailTab), closeDetail],
    [historyOpen, closeHistory],
    [summaryConfirmOpen, closeSummaryConfirmation],
    [draftConfirmOpen, () => setDraftConfirmOpen(false)],
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

  const updateToolbarText = (() => {
    if (updateState.status === "ready_to_restart") return tUpdates("toolbar.restart");
    if (updateState.status === "downloading") return formatProgressPercent(updateState.progress);
    if (updateState.status === "installing") return tUpdates("toolbar.installing");
    return updateState.availableVersion
      ? tUpdates("toolbar.version", { version: updateState.availableVersion })
      : tUpdates("toolbar.available");
  })();
  const canNavigateWorkflow = canNavigateShell({
    submissionPending,
    processing: isProcessingStage(workflow.stage) || transcriptPolish.polishingTranscript || collectionNoteCreation.attaching,
    modelDownloadActive,
    transcriptSaving,
    transcriptDirty: transcriptDetailController.transcriptDirty,
    draftSaving: draftResultOpen || draftSaving,
  }) && !historyController.historyDeleting && !dataStorage?.frozen;
  const canMutateNotes = canNavigateWorkflow && !collectionDirty && !collectionsController.mutating && !noteActions.busy;
  noteMutationAllowedRef.current = canMutateNotes;
  const canDeleteHistory = canMutateNotes && !noteActions.sheet;
  const canNavigate = canMutateNotes && !noteActions.sheet && !historyController.historyDeleteCandidate;
  shellCanNavigateRef.current = canNavigate;
  const navigationReason = tShell(transcriptDetailController.transcriptDirty || collectionDirty || noteActions.dirty
    ? "toolbar.guardDirty" : "toolbar.guardBusy");
  const sidebarNotice = historyController.historyNotice &&
    historyController.historyNotice.messageCode !== "history.notice.empty" &&
    historyController.historyNotice.messageCode !== "history.notice.loading"
      ? renderUiMessage(resolvedLocale, historyController.historyNotice)
      : null;
  const currentHistoryItem = historyController.historyItems.find((item) => item.taskId === workflow.taskId);
  const selectedCollection = collectionsController.collections.find((collection) => collection.id === selectedCollectionId);
  const noteDestination = collectionsController.collections.find((collection) =>
    collection.id === collectionNoteCreation.destinationCollectionId,
  );
  const collectionNotice = collectionsController.errorCode
    ? tShell(`collections.errors.${collectionsController.errorCode}`)
    : null;
  const pageTitle = page === "task"
    ? workflow.noteMetadata?.displayTitle ?? currentHistoryItem?.noteMetadata?.displayTitle ?? (workflow.taskSource?.kind === "web_page" ? workflow.taskSource.title : workflow.noteTitle?.text) ?? (currentHistoryItem ? getHistoryTitle(currentHistoryItem) : tShell("toolbar.currentTask"))
    : page === "collections" && selectedCollection ? selectedCollection.name
      : page === "home" && noteDestination && !collectionNoteCreation.failure ? tShell("collections.noteDestination", { name: noteDestination.name })
        : tShell(`nav.${page}`);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const handleChange = () => { if (query.matches) setSidebarCollapsed(true); };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (workflow.stage !== "waiting_input" && !isProcessingStage(workflow.stage)) {
      void refreshHistory();
      void loadCollections();
    }
  }, [workflow.stage, workflow.taskId, workflow.artifacts, workflow.noteTitle, refreshHistory, loadCollections]);

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  useEffect(() => { void loadCollections(); }, [loadCollections]);

  useEffect(() => {
    if (sidebarCollapsed || (noteMenu && !historyController.historyItems.some((item) => item.taskId === noteMenu.item.taskId))) setNoteMenu(null);
  }, [sidebarCollapsed, noteMenu, historyController.historyItems]);

  useEffect(() => {
    if (workflow.stage === "waiting_input") {
      setNavigation((current) => {
        if (getShellPage(current) !== "task") return current;
        if (current.entries[current.index - 1]?.page === "home") {
          return {
            entries: current.entries.filter((_, index) => index !== current.index),
            index: current.index - 1,
          };
        }
        return shellNavigationReducer(current, {
          type: "replace", page: "home", canNavigate: true,
        });
      });
      return;
    }
    setNavigation((current) => shellNavigationReducer(current, {
      type: getShellPage(current) === "task" && !getShellTaskId(current) ? "replace" : "navigate",
      page: "task", taskId: workflow.taskId, canNavigate: true,
    }));
  }, [workflow.stage, workflow.taskId]);

  const navigateTo = (destination: ShellPage) => {
    if (!canNavigate) return;
    closeHistory();
    pendingNavigationRef.current = null;
    setNavigation((current) => shellNavigationReducer(current, {
      type: "navigate", page: destination, canNavigate: true,
    }));
    void refreshHistory();
    if (destination === "collections") void loadCollections();
  };

  const openCollection = (collectionId: string | null) => {
    if (!canNavigate) return;
    closeHistory();
    pendingNavigationRef.current = null;
    setNavigation((current) => shellNavigationReducer(current, {
      type: "navigate", page: "collections", collectionId, canNavigate: true,
    }));
    void refreshHistory();
    void loadCollections();
  };

  const requestCollectionCreation = () => {
    if (!canNavigate) return;
    openCollection(null);
    setCreateCollectionRequest((request) => request + 1);
  };

  const consumeCollectionCreationRequest = useCallback(() => setCreateCollectionRequest(0), []);

  const deleteCollection = async (collectionId: string): Promise<boolean> => {
    if (!canNavigateWorkflow || collectionDirty) return false;
    const removed = await collectionsController.remove(collectionId);
    if (removed) {
      if (collectionNoteCreation.destinationCollectionId === collectionId) collectionNoteCreation.clear();
      setNavigation((current) => removeShellCollection(current, collectionId));
    }
    return removed;
  };

  const openShellTask = (item: HistoryListItem) => {
    if (!canNavigate) return;
    pendingNavigationRef.current = null;
    void historyController.openHistoryItem(item);
  };

  const moveNavigation = (type: "back" | "forward") => {
    if (!canNavigate) return;
    const action = { type, canNavigate: true } as const;
    const availableIds = new Set(historyController.historyItems.map((item) => item.taskId));
    if (workflow.taskId) availableIds.add(workflow.taskId);
    const availableNavigation = pruneUnavailableShellTasks(navigation, availableIds);
    if (availableNavigation !== navigation) setNavigation(availableNavigation);
    const next = shellNavigationReducer(availableNavigation, action);
    if (next === availableNavigation) return;
    const destination = getShellPage(next);
    const taskId = getShellTaskId(next);
    closeHistory();
    pendingNavigationRef.current = null;
    if (destination === "task" && taskId && taskId !== workflow.taskId) {
      const item = historyController.historyItems.find((candidate) => candidate.taskId === taskId);
      if (!item) return;
      pendingNavigationRef.current = action;
      void historyController.openHistoryItem(item);
      return;
    }
    setNavigation(next);
    void refreshHistory();
    if (destination === "collections") void loadCollections();
  };

  const handleNewTaskFromToolbar = useCallback(() => {
    if (toolbarNewTaskButtonState.disabled || !shellCanNavigateRef.current) {
      return;
    }

    setAnimateNewTaskEntry(true);
    clearCollectionNoteRef.current();
    startNewTaskFromToolbar();
    closeHistory();
    pendingNavigationRef.current = null;
    setNavigation((current) => shellNavigationReducer(current, {
      type: "navigate", page: "home", canNavigate: true,
    }));
  }, [closeHistory, startNewTaskFromToolbar, toolbarNewTaskButtonState.disabled]);

  const handleNewNoteFromCollection = () => {
    if (!selectedCollection || !canNavigate || toolbarNewTaskButtonState.disabled) return;
    handleNewTaskFromToolbar();
    collectionNoteCreation.begin(selectedCollection.id);
  };

  const processingWorkspaceModel = createProcessingWorkspaceModel(workflow);
  const processingRetrySubmission = getProcessingRetrySubmission(workflow);

  return (
    <main className="app-shell">
      <section className={`desktop-window sidebar-layout${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`} aria-label={tCommon("window.ariaLabel")}>
        <div id="app-sidebar" className="shell-sidebar-region">
          <DesktopSidebar
            page={page}
            collapsed={sidebarCollapsed}
            historyItems={historyController.historyItems}
            historyLoading={historyController.historyLoading}
            historyNotice={sidebarNotice}
            currentTaskId={workflow.taskId}
            navigationDisabled={!canNavigate}
            disabledReason={navigationReason}
            newTaskDisabled={!canNavigate || toolbarNewTaskButtonState.disabled}
            account={account}
            collections={collectionsController.collections}
            collectionsLoading={collectionsController.loading}
            collectionsNotice={collectionNotice}
            selectedCollectionId={selectedCollectionId}
            onOpenCollection={openCollection}
            onCreateCollection={requestCollectionCreation}
            onNavigate={navigateTo}
            onOpenTask={openShellTask}
            onNewTask={handleNewTaskFromToolbar}
            onOpenSettings={openSettings}
            onOpenAccount={() => openAccountPanel()}
            onRefresh={() => void refreshHistory()}
            onOpenNoteMenu={(item, anchor, section) => {
              if (noteActions.isBusy() || noteActions.sheet || historyController.historyDeleteCandidate) return;
              setNoteMenu({ item, anchor, section });
            }}
            activeNoteMenu={noteMenu ? { taskId: noteMenu.item.taskId, section: noteMenu.section } : null}
          />
        </div>
        <ShellToolbar
          collapsed={sidebarCollapsed}
          title={page === "task" ? "" : pageTitle}
          canBack={canNavigate && navigation.index > 0}
          canForward={canNavigate && navigation.index < navigation.entries.length - 1}
          disabledReason={!canNavigate ? navigationReason : ""}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          onBack={() => moveNavigation("back")}
          onForward={() => moveNavigation("forward")}
          update={{
            visible: updateToolbarVisible,
            status: updateState.status,
            text: updateToolbarText,
            busy: updateBusy,
            spinnerVisible: updateSpinnerVisible,
          }}
          onInstallUpdate={installUpdate}
        />

        <section
          className={`workspace shell-content ${page === "home" ? "waiting-layout" : page === "task" ? "active-layout" : "library-layout"}`}
          aria-label={tWorkflow("input.workspaceAria")}
        >
          {page === "home" ? (
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
              <HomeGreeting email={account.authenticated ? account.email : null} />
              <TaskComposer
                source={workflow.composerSource}
                canSubmit={canSubmit && canNavigate}
                statusBody=""
                onUrlDraftChange={updateUrlDraft}
                onLocalMediaSelected={setLocalMediaSelection}
                onRemoveLocalMedia={removeLocalMediaSelection}
                onSubmit={(submission) => {
                  void collectionNoteCreation.submit(submission);
                }}
              />
            </motion.div>
          ) : page === "collections" ? (
            <CollectionsWorkspace
              collections={collectionsController.collections}
              selectedCollectionId={selectedCollectionId}
              items={historyController.historyItems}
              loading={collectionsController.loading || historyController.historyLoading}
              mutating={collectionsController.mutating}
              notice={collectionNotice ?? sidebarNotice}
              disabled={!canNavigateWorkflow}
              disabledReason={navigationReason}
              onSelectCollection={openCollection}
              onCreate={collectionsController.create}
              onRename={collectionsController.rename}
              onDelete={deleteCollection}
              onSetMembership={collectionsController.setMembership}
              onNewNote={handleNewNoteFromCollection}
              onOpenTask={openShellTask}
              onRefresh={() => { void refreshHistory(); void loadCollections(); }}
              createRequested={createCollectionRequest}
              onCreateRequestHandled={consumeCollectionCreationRequest}
              onDirtyChange={setCollectionDirty}
            />
          ) : page === "notes" || page === "artifacts" ? (
            <ShellLibrary
              view={page}
              items={historyController.historyItems}
              loading={historyController.historyLoading}
              notice={sidebarNotice}
              selectionDisabled={!canNavigate}
              disabledReason={navigationReason}
              onOpenTask={openShellTask}
              onRefresh={() => void refreshHistory()}
              onManageHistory={() => void openHistory()}
            />
          ) : (
            <ProcessingWorkspace
              workflow={workflow}
              onCancel={() => void cancelCurrentProcessing()}
              onRetry={() => {
                if (processingRetrySubmission) void collectionNoteCreation.submit(processingRetrySubmission);
              }}
              onEditSource={handleNewTaskFromToolbar}
              retryDisabled={!processingRetrySubmission || !canSubmit || !canNavigateWorkflow || submissionPending}
              notice={renderUiMessage(resolvedLocale, actionNotice)}
            >
              {!processingWorkspaceModel && <TaskStatusBanner model={taskWorkspaceModel.banner} />}
              {!processingWorkspaceModel && <NoteTitleNotice
                workflow={workflow}
                retryDisabled={!canNavigateWorkflow}
                onRetry={() => { void retryNoteTitle(account, openAccountPanel); }}
                onCancel={() => { void cancelCurrentProcessing(); }}
              />}
              {collectionNoteCreation.failure?.taskId === workflow.taskId && (
                <div className="collection-note-notice" role="alert">
                  <span>{tShell("collections.noteSavedMembershipFailed")}</span>
                  <button
                    type="button"
                    disabled={!canNavigateWorkflow || collectionsController.mutating}
                    onClick={() => { void collectionNoteCreation.retry(); }}
                  >
                    {tShell("collections.retryAddNote")}
                  </button>
                </div>
              )}
              <TaskWorkspaceLayout
                title={pageTitle}
                local={isArticleTaskSource(workflow.taskSource) || workflow.stage.startsWith("web_") || workflow.cancellingFromStage?.startsWith("web_") ? <ArticleWorkspace workflow={workflow} model={taskWorkspaceModel.local} selectedChunks={articleChunks} onClearSelection={clearArticleChunks} onCancel={() => void cancelCurrentProcessing()} /> : <LocalTranscriptWorkspace
                  model={taskWorkspaceModel.local}
                  controller={transcriptDetailController}
                  actionNotice={aiActionNotice ? null : actionNotice}
                  polishingTranscript={transcriptPolish.polishingTranscript}
                  onPolishTranscript={() => void transcriptPolish.polishTranscript()}
                  onLocateArtifact={(artifact) => void locateArtifact(artifact)}
                  onCancel={() => void cancelCurrentProcessing()}
                />}
                ai={<StudioWorkspace
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
                  onViewTool={(target) => {
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
                />}
              />
            </ProcessingWorkspace>
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
        sourceKind={workflow.taskSource?.kind === "web_page" ? "article" : "media"}
        open={summaryConfirmOpen}
        locale={resolvedLocale}
        transcriptText={workflow.text}
        transcriptPath={workflow.taskSource?.kind === "web_page" ? getTaskArtifactPath(workflow, "article_txt") : currentTranscriptPath}
        quotaRemaining={account.llmQuotaRemaining}
        busy={isProcessingStage(workflow.stage)}
        onConfirm={confirmSummaryGeneration}
        onCancel={closeSummaryConfirmation}
      />

      <InsightPreferenceFlow
        sourceKind={workflow.taskSource?.kind === "web_page" ? "article" : "media"}
        flow={insightPreferenceFlow}
        busy={insightPreferenceBusy || isProcessingStage(workflow.stage)}
        accountQuotaRemaining={account.llmQuotaRemaining}
        transcriptText={workflow.text}
        transcriptPath={workflow.taskSource?.kind === "web_page" ? getTaskArtifactPath(workflow, "article_txt") : currentTranscriptPath}
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
        transcriptPath={workflow.taskSource?.kind === "web_page" ? getTaskArtifactPath(workflow, "article_txt") : currentTranscriptPath}
        onConfirm={confirmDraftGeneration}
        onCancel={() => setDraftConfirmOpen(false)}
      />

      <DraftResultSheet
        open={draftResultOpen}
        workflow={workflow}
        onSaved={applyDraftSave}
        onBusyChange={setDraftSaving}
        onRegenerate={draftRegeneration.request}
        onClose={() => { if (!draftSaving) setDraftResultOpen(false); }}
      />

      <ConfirmDialog
        open={draftRegeneration.candidate !== null}
        title={tStudio("draftResult.regenerateTitle")}
        message={tStudio("draftResult.regenerateConfirm")}
        cancelLabel={tStudio("draftResult.keepDraft")}
        confirmLabel={tStudio("draftResult.continueRegeneration")}
        onCancel={draftRegeneration.cancel}
        onConfirm={draftRegeneration.confirm}
      />

      <HistorySheet
        controller={historyController}
        selectionDisabled={!canNavigate}
        selectionDisabledReason={canRestoreHistory ? uiMessage("noteActions.notice.blocked") : historyRestoreUnavailableMessage}
        deletionDisabled={!canDeleteHistory}
        deletionDisabledReason={historyDeleteUnavailableMessage}
      />

      {noteMenu && <SidebarNoteMenu
        item={historyController.historyItems.find((item) => item.taskId === noteMenu.item.taskId) ?? noteMenu.item}
        anchor={noteMenu.anchor} mutationDisabled={!canMutateNotes} disabledReason={navigationReason}
        onClose={(restore) => { setNoteMenu(null); if (restore) restoreNoteMenuFocus(noteMenu); }}
        onAction={(action) => { if (noteActions.isBusy()) return; noteActionTargetRef.current = noteMenu; void noteActions.perform(noteMenu.item, action); }}
      />}
      <NoteRenameSheet item={noteActions.sheet?.kind === "rename" ? noteActions.sheet.item : null}
        busy={noteActions.busy} notice={renderUiMessage(resolvedLocale, noteActions.notice)}
        disabled={!canNavigateWorkflow || collectionDirty || collectionsController.mutating}
        disabledReason={navigationReason} onSave={noteActions.saveName} onClose={noteActions.close} onDirtyChange={noteActions.setDirty} />
      <NoteCollectionsSheet item={noteActions.sheet?.kind === "collection" ? noteActions.sheet.item : null}
        collections={collectionsController.collections} loading={noteActions.loading || collectionsController.loading}
        mutating={collectionsController.mutating} notice={collectionNotice ?? renderUiMessage(resolvedLocale, noteActions.notice)}
        disabled={!canNavigateWorkflow || collectionDirty || noteActions.busy || Boolean(collectionsController.errorCode) || Boolean(noteActions.notice)} disabledReason={navigationReason}
        onSetMembership={async (collectionId, taskId, included) => {
          if (!noteMutationAllowedRef.current || !noteActions.available(taskId)) return false;
          return collectionsController.setMembership(collectionId, taskId, included);
        }} onRefresh={() => void noteActions.refreshCollections()} onClose={noteActions.close} />
      <NoteInfoSheet item={noteActions.sheet?.kind === "info" ? noteActions.sheet.item : null}
        info={noteActions.info} collections={collectionsController.collections} loading={noteActions.loading || collectionsController.loading}
        notice={collectionNotice ?? renderUiMessage(resolvedLocale, noteActions.notice)}
        onRefresh={() => { if (noteActions.sheet) void noteActions.refreshInfo(noteActions.sheet.item.taskId); void loadCollections(); }} onClose={noteActions.close} />
      {historyController.cleanupPending && <div className="note-cleanup-notice" role="status">
        <span>{tNotes(historyController.cleanupFailed ? "notice.cleanupFailed" : "notice.cleanupPending")}</span>
        <button type="button" className="secondary-button" disabled={!canMutateNotes || Boolean(noteActions.sheet)} onClick={() => void resumeHistoryCleanup()}>{tNotes("actions.retryCleanup")}</button>
      </div>}
      {!noteActions.sheet && noteActions.notice && <div className="note-action-notice" role="status">{renderUiMessage(resolvedLocale, noteActions.notice)}</div>}

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
