import { useCallback, useRef, useState } from "react";

import type { AccountStatus } from "../../accountState";
import { canGenerateAiWithAccount, canProcessWithAccount } from "../../accountState";
import { historyItemToWorkerResult, type HistoryItem } from "../../historyClient";
import type { SaveTranscriptEditResponse } from "../../transcriptDetailClient";
import { clearLocalMediaSelection } from "../../localMediaClient";
import type { LocalMediaSelectionView } from "../../localMediaContract";
import {
  canSubmitUrl,
  confirmProcessingCancellation,
  createInitialWorkflow,
  editDraft,
  finishInsightRetry,
  finishNoteTitleGeneration,
  getToolbarNewTaskButtonState,
  isProcessingStage,
  mergeProgressEvent,
  normalizeSubmitUrl,
  requestProcessingCancellation,
  restoreProcessingAfterCancellationFailure,
  startInsightRetry,
  startProcessing,
  startNoteTitleGeneration,
  summarizeWorkerResult,
  type InsightRetryTarget,
  type TaskArtifacts,
  type TaskComposerSource,
  type TaskSourceSummary,
  type TaskSubmission,
} from "../../workflow";
import {
  cancelProcess,
  processLocalMedia,
  processVideo,
  retryInsights,
  recordNoteTitleCancellation,
  type RetryInsightsInput,
} from "../../workerClient";
import type { PreferenceSnapshot } from "../../insightPreferences";
import type { SupportedLocale } from "../../i18n/locale";
import { uiMessage, type UiMessage } from "../../i18n/uiMessage";
import { bindNoteTitleResult, completedNoteResult, finishCancelledTitleAttempt, shouldGenerateNoteTitle } from "./noteTitleSubmission";
import { getNoteInfo } from "../../noteActionsClient";
import type { NoteMetadata } from "../../noteMetadata";
import { normalizeWebPageInput, hasSourceText, closedWebOperationError } from "../../webPageProtocol";
import { processWebPage, cancelWebPage, WebOperationCancelledError } from "../../webPageClient";
import { IpcProtocolError } from "../../tauriIpcProtocol";

type OpenAccountPanel = (notice?: UiMessage) => void;

export const HISTORY_RESTORE_UNAVAILABLE_MESSAGE =
  uiMessage("history.disabled.selectionWhileProcessing");

const LOCAL_MEDIA_RESELECTION_ERROR_CODES = new Set([
  "LOCAL_MEDIA_SELECTION_INVALID",
  "LOCAL_MEDIA_SELECTION_CHANGED",
  "LOCAL_MEDIA_UNSUPPORTED_FORMAT",
  "LOCAL_MEDIA_UNAVAILABLE",
  "LOCAL_MEDIA_LINKED",
  "LOCAL_MEDIA_VALIDATION_FAILED",
  "LOCAL_MEDIA_KIND_MISMATCH",
  "LOCAL_VIDEO_STREAM_MISSING",
  "LOCAL_VIDEO_AUDIO_STREAM_MISSING",
  "LOCAL_AUDIO_STREAM_MISSING",
]);

type UseTaskProcessingControllerOptions = {
  onResetTaskUi: () => void;
  onRetryStarted: () => void;
  ensureAsrModelReady?: () => Promise<"iic/SenseVoiceSmall" | "iic/SenseVoiceSmall-onnx" | null>;
  modelDownloadActive?: boolean;
  processBlockerMessage: (account: AccountStatus) => UiMessage;
  aiBlockerMessage: (account: AccountStatus) => UiMessage;
  outputLanguage?: SupportedLocale;
  onTitleFinished?: () => void;
  isActive?: () => boolean;
  getLifetimeSignal?: () => AbortSignal;
};

export function useTaskProcessingController({
  onResetTaskUi,
  onRetryStarted,
  ensureAsrModelReady,
  modelDownloadActive = false,
  processBlockerMessage,
  aiBlockerMessage,
  outputLanguage = "en-US",
  onTitleFinished,
  isActive = controllerIsActive,
  getLifetimeSignal,
}: UseTaskProcessingControllerOptions) {
  const [workflow, setWorkflow] = useState(createInitialWorkflow);
  const [submissionPending, setSubmissionPending] = useState(false);
  const submissionClaimRef = useRef<object | null>(null);
  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;
  const operationIdRef = useRef(0);
  const webOperationRef = useRef<string | null>(null);
  const webAbortRef = useRef<AbortController | null>(null);
  const cancellationOperationIdRef = useRef<number | null>(null);
  const titleFinishedRef = useRef(onTitleFinished);
  titleFinishedRef.current = onTitleFinished;

  const canSubmit =
    !submissionPending &&
    !isProcessingStage(workflow.stage) &&
    !modelDownloadActive &&
    (workflow.composerSource.kind === "local_media" ||
      canSubmitUrl(workflow.composerSource.urlDraft) || Boolean(normalizeWebPageInput(workflow.composerSource.urlDraft)));
  const toolbarNewTaskButtonState = getToolbarNewTaskButtonState(workflow.stage);
  const canRestoreHistory = !submissionPending && !isProcessingStage(workflow.stage);

  const updateUrlDraft = useCallback((url: string) => {
    setWorkflow((current) =>
      !isProcessingStage(current.stage) &&
      !modelDownloadActive &&
      submissionClaimRef.current === null &&
      current.composerSource.kind === "url"
        ? {
            ...current,
            composerSource: {
              kind: "url",
              urlDraft: url,
            },
          }
        : current,
    );
  }, [modelDownloadActive]);

  const setLocalMediaSelection = useCallback(
    (selection: LocalMediaSelectionView) => {
      setWorkflow((current) => {
        if (isProcessingStage(current.stage) || modelDownloadActive || submissionClaimRef.current !== null) {
          return current;
        }
        const retainedUrlDraft =
          current.composerSource.kind === "url"
            ? current.composerSource.urlDraft
            : current.composerSource.retainedUrlDraft;
        return {
          ...current,
          composerSource: {
            kind: "local_media",
            selection,
            retainedUrlDraft,
          },
        };
      });
    },
    [modelDownloadActive],
  );

  const removeLocalMediaSelection = useCallback(async (): Promise<boolean> => {
    if (workflow.composerSource.kind !== "local_media") {
      return false;
    }
    const { selectionToken } = workflow.composerSource.selection;
    try {
      await clearLocalMediaSelection(selectionToken);
    } catch {
      return false;
    }
    setWorkflow((current) =>
      current.composerSource.kind === "local_media" &&
      current.composerSource.selection.selectionToken === selectionToken
        ? {
            ...current,
            composerSource: {
              kind: "url",
              urlDraft: current.composerSource.retainedUrlDraft,
            },
          }
        : current,
    );
    return true;
  }, [workflow.composerSource]);

  const applyTranscriptSave = useCallback(
    (expectedTaskId: string | null, saved: SaveTranscriptEditResponse) => {
      setWorkflow((current) => {
        if (
          !expectedTaskId ||
          current.taskId !== expectedTaskId ||
          saved.task_id !== expectedTaskId
        ) {
          return current;
        }

        return {
          ...current,
          text: saved.text,
          dissectionStale:
            current.dissection !== null && saved.text !== current.text
              ? true
              : current.dissectionStale,
          artifacts: {
            ...current.artifacts,
            ...saved.artifacts,
          },
        };
      });
    },
    [],
  );

  const applyDraftSave = useCallback(
    (markdown: string, artifacts: TaskArtifacts, expectedTaskId: string) => {
      setWorkflow((current) => current.taskId !== expectedTaskId ? current : {
        ...editDraft(current, markdown),
        artifacts: { ...current.artifacts, ...artifacts },
      });
    },
    [],
  );

  const resetWorkflow = useCallback(() => {
    submissionClaimRef.current = null;
    setSubmissionPending(false);
    clearComposerSelectionBestEffort(workflow.composerSource);
    operationIdRef.current += 1;
    cancellationOperationIdRef.current = null;
    onResetTaskUi();
    setWorkflow(createInitialWorkflow());
  }, [onResetTaskUi, workflow.composerSource]);

  const startNewTaskFromToolbar = useCallback(() => {
    if (toolbarNewTaskButtonState.disabled) {
      return;
    }

    resetWorkflow();
  }, [resetWorkflow, toolbarNewTaskButtonState.disabled]);

  const restoreHistoryItem = useCallback(
    (item: HistoryItem): boolean => {
      if (submissionClaimRef.current !== null || isProcessingStage(workflow.stage)) {
        return false;
      }

      operationIdRef.current += 1;
      cancellationOperationIdRef.current = null;
      submissionClaimRef.current = null;
      setSubmissionPending(false);
      clearComposerSelectionBestEffort(workflow.composerSource);
      onResetTaskUi();
      const composerSource: TaskComposerSource =
        item.source.kind === "url" || item.source.kind === "web_page"
          ? { kind: "url", urlDraft: item.source.url }
          : { kind: "url", urlDraft: "" };
      setWorkflow({
        ...summarizeWorkerResult(historyItemToWorkerResult(item)),
        dissectionStale: item.dissectionStale,
        composerSource,
        taskSource: item.source,
        noteMetadata: item.noteMetadata ?? null,
      });
      return true;
    },
    [onResetTaskUi, workflow.composerSource, workflow.stage],
  );

  const completeHistoryTaskDeletion = useCallback(
    (deletedTaskId: string): boolean => {
      if (
        isProcessingStage(workflow.stage) ||
        !workflow.taskId ||
        workflow.taskId !== deletedTaskId
      ) {
        return false;
      }
      resetWorkflow();
      return true;
    },
    [resetWorkflow, workflow.stage, workflow.taskId],
  );

  const submitTask = useCallback(
    async (
      submission: TaskSubmission,
      account: AccountStatus,
      openAccountPanel: OpenAccountPanel,
    ) => {
      if (
        !isActive() ||
        modelDownloadActive ||
        isProcessingStage(workflowRef.current.stage) ||
        submissionClaimRef.current !== null
      ) {
        return;
      }
      const composerSource = workflowRef.current.composerSource;
      const prepared = prepareTaskSubmission(composerSource, submission);
      if (!prepared) {
        return;
      }
      if (!canProcessWithAccount(account)) {
        openAccountPanel(processBlockerMessage(account));
        return;
      }
      const claim = {};
      submissionClaimRef.current = claim;
      setSubmissionPending(true);
      const previousOperationId = operationIdRef.current;
      const isWeb = prepared.submission.kind === "url" && !normalizeSubmitUrl(prepared.submission.url);
      let detachLifetimeAbort: (() => void) | undefined;
      try {
        const asrModel = isWeb ? "iic/SenseVoiceSmall-onnx" : ensureAsrModelReady
          ? await ensureAsrModelReady()
          : "iic/SenseVoiceSmall-onnx";
        if (
          !isActive() ||
          !asrModel ||
          operationIdRef.current !== previousOperationId ||
          submissionClaimRef.current !== claim
        ) {
          return;
        }
        const operationId = previousOperationId + 1;
        operationIdRef.current = operationId;
        onResetTaskUi();
        setWorkflow((current) =>
          startProcessing(
            {
              ...current,
              composerSource: prepared.submission.kind === "url"
                ? { kind: "url", urlDraft: prepared.submission.url }
                : composerSource,
            },
            prepared.taskSource,
            isWeb,
          ),
        );
        const onProgress = (event: Parameters<typeof mergeProgressEvent>[1]) => {
          if (isActive() && operationIdRef.current === operationId) {
            setWorkflow((current) => mergeProgressEvent(current, event));
          }
        };
        const webOperationId = isWeb ? crypto.randomUUID() : null;
        webOperationRef.current = webOperationId;
        const webAbort = isWeb ? new AbortController() : null;
        webAbortRef.current = webAbort;
        if (webAbort && getLifetimeSignal) {
          const lifetimeSignal = getLifetimeSignal();
          const abort = () => webAbort.abort();
          lifetimeSignal.addEventListener("abort", abort, { once: true });
          if (lifetimeSignal.aborted) abort();
          detachLifetimeAbort = () => lifetimeSignal.removeEventListener("abort", abort);
        }
        const result =
          webOperationId && prepared.submission.kind === "url"
            ? await processWebPage(prepared.submission.url, webOperationId, onProgress, webAbort?.signal,
                () => isActive() && operationIdRef.current === operationId && submissionClaimRef.current === claim && cancellationOperationIdRef.current !== operationId)
            : prepared.submission.kind === "url"
            ? await processVideo(
                prepared.submission.url,
                asrModel,
                undefined,
                onProgress,
              )
            : await processLocalMedia(
                { selectionToken: prepared.submission.selectionToken, asrModel },
                undefined,
                onProgress,
              );
        if (operationIdRef.current !== operationId || !isActive()) {
          if (shouldGenerateNoteTitle(result) && result.task_id) {
            await recordNoteTitleCancellation({
              taskId: result.task_id, outputLanguage, expectedNoteTitle: result.note_title ?? null,
            });
          }
          return;
        }
        const cancellationRequested = cancellationOperationIdRef.current === operationId;
        if (result.error?.code === "WORKER_CANCELLED" || result.error?.code === "WEB_CANCELLED") {
          operationIdRef.current += 1;
          onResetTaskUi();
          setWorkflow((current) => confirmProcessingCancellation(current));
          return;
        }
        const localSelectionToken = prepared.submission.kind === "local_media"
          ? prepared.submission.selectionToken
          : null;
        const current = workflowRef.current;
        const releaseLocalSelection =
          localSelectionToken !== null &&
          (result.status !== "failed" ||
            (result.error && LOCAL_MEDIA_RESELECTION_ERROR_CODES.has(result.error.code)));
        const retainedSource =
          releaseLocalSelection &&
          current.composerSource.kind === "local_media" &&
          current.composerSource.selection.selectionToken === localSelectionToken
            ? { kind: "url" as const, urlDraft: current.composerSource.retainedUrlDraft }
            : current.composerSource;
        const transcribed = {
          ...summarizeWorkerResult(result),
          composerSource: retainedSource,
          taskSource: result.source ?? current.taskSource ?? prepared.taskSource,
        };
        workflowRef.current = transcribed;
        setWorkflow(transcribed);
        if (result.task_id && result.task_created === false) {
          try {
            const info = await getNoteInfo(result.task_id);
            if (!isActive() || operationIdRef.current !== operationId) return;
            transcribed.noteMetadata = info.noteMetadata;
            if (info.noteMetadataError) transcribed.statusMessage = uiMessage("noteActions.notice.metadataLoadFailed");
          } catch {
            if (!isActive() || operationIdRef.current !== operationId) return;
            transcribed.statusMessage = uiMessage("noteActions.notice.metadataLoadFailed");
          }
          setWorkflow({ ...transcribed });
        }
        if (!shouldGenerateNoteTitle(result) || !result.task_id) {
          cancellationOperationIdRef.current = null;
          return result;
        }
        const titling = startNoteTitleGeneration(transcribed, outputLanguage);
        const titleTaskId = result.task_id;
        workflowRef.current = titling;
        setWorkflow(titling);
        if (cancellationRequested) {
          const cancellation = await recordNoteTitleCancellation({
            taskId: result.task_id, outputLanguage, expectedNoteTitle: result.note_title ?? null,
          });
          if (operationIdRef.current !== operationId || !isActive()) return;
          const cancelled = finishCancelledTitleAttempt(titling, cancellation);
          workflowRef.current = cancelled;
          setWorkflow(cancelled);
          cancellationOperationIdRef.current = null;
          return completedNoteResult(result, cancelled);
        }
        let cancelledBeforeStart = false;
        const titled = await retryInsights(
          { taskId: titleTaskId, target: "title", outputLanguage },
          undefined,
          onProgress,
          undefined,
          undefined,
          () => isActive() && operationIdRef.current === operationId && cancellationOperationIdRef.current !== operationId,
          () => {
            cancelledBeforeStart = true;
            return recordNoteTitleCancellation({ taskId: titleTaskId, outputLanguage, expectedNoteTitle: result.note_title ?? null });
          },
        );
        if (operationIdRef.current !== operationId || !isActive()) return;
        const completed = cancelledBeforeStart
          ? finishCancelledTitleAttempt(workflowRef.current, titled)
          : finishNoteTitleGeneration(workflowRef.current, bindNoteTitleResult(titled, titleTaskId));
        workflowRef.current = completed;
        setWorkflow(completed);
        cancellationOperationIdRef.current = null;
        titleFinishedRef.current?.();
        return completedNoteResult(result, completed);
      } catch (error) {
        if (!isWeb) throw error;
        const code = error instanceof WebOperationCancelledError ? "WEB_CANCELLED" : closedWebOperationError(error);
        if (operationIdRef.current === previousOperationId + 1 && isActive()) {
          if (code === "WEB_CANCELLED") {
            operationIdRef.current += 1;
            onResetTaskUi();
            setWorkflow((current) => confirmProcessingCancellation(current));
          } else {
            setWorkflow((current) => ({ ...current, stage: "failed", cancellingFromStage: null, progressMessage: null,
              error: { code: error instanceof IpcProtocolError ? error.code : code ?? "WEB_PAGE_PROCESS_FAILED", message: "", stage: current.stage === "web_saving" ? "web_saving" : current.stage === "web_extracting" ? "web_extracting" : "web_loading" } }));
          }
        }
        if (!code || error instanceof IpcProtocolError) throw error;
      } finally {
        detachLifetimeAbort?.();
        webOperationRef.current = null;
        webAbortRef.current = null;
        if (submissionClaimRef.current === claim) {
          submissionClaimRef.current = null;
          setSubmissionPending(false);
        }
      }
    },
    [
      onResetTaskUi,
      processBlockerMessage,
      ensureAsrModelReady,
      modelDownloadActive,
      outputLanguage,
      isActive,
      getLifetimeSignal,
    ],
  );

  const retryNoteTitle = useCallback(async (
    account: AccountStatus,
    openAccountPanel: OpenAccountPanel,
  ) => {
    const current = workflowRef.current;
    if (!isActive() || !current.taskId || !current.artifacts.transcript_txt ||
      submissionClaimRef.current !== null || isProcessingStage(current.stage) || modelDownloadActive) return;
    if (!canGenerateAiWithAccount(account)) {
      openAccountPanel(aiBlockerMessage(account));
      return;
    }
    const claim = {};
    submissionClaimRef.current = claim;
    setSubmissionPending(true);
    const operationId = ++operationIdRef.current;
    cancellationOperationIdRef.current = null;
    const language = current.noteTitle?.output_language ?? outputLanguage;
    const taskId = current.taskId;
    const titling = startNoteTitleGeneration(current, language);
    workflowRef.current = titling;
    setWorkflow(titling);
    let cancelledBeforeStart = false;
    try {
      const result = await retryInsights(
        { taskId, target: "title", outputLanguage: language },
        undefined,
        (event) => {
          if (isActive() && operationIdRef.current === operationId) setWorkflow((state) => mergeProgressEvent(state, event));
        },
        undefined,
        undefined,
        () => isActive() && operationIdRef.current === operationId && cancellationOperationIdRef.current !== operationId,
        () => {
          cancelledBeforeStart = true;
          return recordNoteTitleCancellation({ taskId, outputLanguage: language, expectedNoteTitle: current.noteTitle });
        },
      );
      if (operationIdRef.current !== operationId || !isActive()) return;
      const completed = cancelledBeforeStart
        ? finishCancelledTitleAttempt(workflowRef.current, result)
        : finishNoteTitleGeneration(workflowRef.current, bindNoteTitleResult(result, taskId));
      workflowRef.current = completed;
      setWorkflow(completed);
      cancellationOperationIdRef.current = null;
      titleFinishedRef.current?.();
    } finally {
      if (submissionClaimRef.current === claim) {
        submissionClaimRef.current = null;
        setSubmissionPending(false);
      }
    }
  }, [aiBlockerMessage, isActive, modelDownloadActive, outputLanguage]);

  const cancelCurrentProcessing = useCallback(async () => {
    const operationId = operationIdRef.current;
    if (cancellationOperationIdRef.current === operationId) {
      return;
    }

    cancellationOperationIdRef.current = operationId;
    webAbortRef.current?.abort();
    setWorkflow((current) => requestProcessingCancellation(current));
    const result = webOperationRef.current ? await cancelWebPage(webOperationRef.current) : await cancelProcess();
    if (operationIdRef.current !== operationId) {
      return;
    }
    if (result.status === "failed") {
      cancellationOperationIdRef.current = null;
      setWorkflow((current) =>
        restoreProcessingAfterCancellationFailure(current),
      );
    }
  }, []);

  const retryInsightGeneration = useCallback(
    async (
      target: InsightRetryTarget,
      outputLanguage: SupportedLocale,
      preferenceSnapshot: PreferenceSnapshot | null,
      account: AccountStatus,
      openAccountPanel: OpenAccountPanel,
      onRetryCompleted?: () => void,
      insightId?: number,
      // User-selected draft platform id (9-id vocabulary). Forwarded only for
      // target="draft"; absent for summary/insights (worker rejects it there).
      platform?: string,
    ) => {
      const current = workflowRef.current;
      if (!isActive() || submissionClaimRef.current !== null || modelDownloadActive ||
        isProcessingStage(current.stage) || !hasSourceText(current)) {
        return;
      }
      if (!canGenerateAiWithAccount(account)) {
        openAccountPanel(aiBlockerMessage(account));
        return;
      }

      const taskId = current.taskId!;
      // Draft requires the seed insight id and the user-selected platform;
      // confirmDraftGeneration always supplies both (the card is only
      // available once a seed is selected). Guard defensively anyway.
      const retryInput: RetryInsightsInput | null =
        target === "draft"
          ? insightId !== undefined && platform !== undefined
            ? { taskId, target, outputLanguage, insightId, platform }
            : null
          : target === "insights" && preferenceSnapshot
            ? { taskId, target, outputLanguage, preferenceSnapshot }
            : { taskId, target, outputLanguage };
      if (retryInput === null) {
        return;
      }
      const operationId = operationIdRef.current + 1;
      operationIdRef.current = operationId;
      onRetryStarted();
      const retrying = startInsightRetry(current, target);
      workflowRef.current = retrying;
      setWorkflow(retrying);

      const onProgress = (event: Parameters<typeof mergeProgressEvent>[1]) => {
        if (operationIdRef.current === operationId) {
          setWorkflow((current) => mergeProgressEvent(current, event));
        }
      };

      const result = await retryInsights(
        retryInput,
        undefined,
        onProgress,
      );
      if (operationIdRef.current !== operationId) {
        return;
      }
      cancellationOperationIdRef.current = null;
      if (result.error?.code === "WORKER_CANCELLED") {
        operationIdRef.current += 1;
        onResetTaskUi();
        setWorkflow((current) => confirmProcessingCancellation(current));
        return;
      }
      setWorkflow((current) => ({
        ...finishInsightRetry(
          current,
          {
            ...result,
            task_id: result.task_id ?? current.taskId,
            task_dir: result.task_dir ?? current.taskDir,
            artifacts: {
              ...current.artifacts,
              ...(result.artifacts ?? {}),
            },
            text: result.text || current.text,
            summary: result.summary || current.summary,
            insights: result.insights.length > 0 ? result.insights : current.insights,
            transcript: result.transcript ?? current.transcript,
            dissection: result.dissection ?? current.dissection,
          },
          target,
        ),
      }));
      onRetryCompleted?.();
    },
    [
      aiBlockerMessage,
      isActive,
      modelDownloadActive,
      onResetTaskUi,
      onRetryStarted,
      workflow.artifacts.transcript_txt,
      workflow.taskId,
    ],
  );

  // Select/clear the single draft seed insight. Pass null to clear.
  const setDraftSeedInsightId = useCallback((insightId: number | null) => {
    setWorkflow((current) => ({ ...current, draftSeedInsightId: insightId }));
  }, []);

  const applyNoteMetadata = useCallback((taskId: string, noteMetadata: NoteMetadata) => {
    setWorkflow((current) => current.taskId === taskId ? { ...current, noteMetadata } : current);
  }, []);

  return {
    workflow,
    submissionPending,
    canSubmit,
    canRestoreHistory,
    historyRestoreUnavailableMessage: HISTORY_RESTORE_UNAVAILABLE_MESSAGE,
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
  };
}

type PreparedTaskSubmission = {
  submission: TaskSubmission;
  taskSource: TaskSourceSummary;
};

function prepareTaskSubmission(
  composerSource: TaskComposerSource,
  submission: TaskSubmission,
): PreparedTaskSubmission | null {
  switch (submission.kind) {
    case "url": {
      const mediaUrl = normalizeSubmitUrl(submission.url);
      const url = mediaUrl ?? normalizeWebPageInput(submission.url);
      const composerUrl =
        composerSource.kind === "url"
          ? normalizeSubmitUrl(composerSource.urlDraft) ?? normalizeWebPageInput(composerSource.urlDraft)
          : null;
      if (!url || composerUrl !== url) {
        return null;
      }
      return {
        submission: { kind: "url", url },
        taskSource: { kind: "url", url },
      };
    }
    case "local_media":
      if (
        composerSource.kind !== "local_media" ||
        composerSource.selection.selectionToken !== submission.selectionToken
      ) {
        return null;
      }
      return {
        submission,
        taskSource: {
          kind: "local_file",
          displayName: composerSource.selection.displayName,
          mediaKind: composerSource.selection.mediaKind,
        },
      };
  }
}

function clearComposerSelectionBestEffort(
  composerSource: TaskComposerSource,
): void {
  if (composerSource.kind === "local_media") {
    void clearLocalMediaSelection(composerSource.selection.selectionToken).catch(
      () => undefined,
    );
  }
}

function controllerIsActive(): boolean { return true; }
