import { type FormEvent, useCallback, useRef, useState } from "react";

import type { AccountStatus } from "../../accountState";
import { canGenerateAiWithAccount, canProcessWithAccount } from "../../accountState";
import { historyItemToWorkerResult, type HistoryItem } from "../../historyClient";
import type { SaveTranscriptEditResponse } from "../../transcriptDetailClient";
import {
  canSubmitUrl,
  confirmProcessingCancellation,
  createInitialWorkflow,
  finishInsightRetry,
  getToolbarNewTaskButtonState,
  isProcessingStage,
  mergeProgressEvent,
  normalizeSubmitUrl,
  requestProcessingCancellation,
  restoreProcessingAfterCancellationFailure,
  startInsightRetry,
  startProcessing,
  summarizeWorkerResult,
  type InsightRetryTarget,
} from "../../workflow";
import { cancelProcess, processVideo, retryInsights } from "../../workerClient";
import type { PreferenceSnapshot } from "../../insightPreferences";

type OpenAccountPanel = (notice?: string) => void;

export const HISTORY_RESTORE_UNAVAILABLE_MESSAGE =
  "当前任务仍在处理中，完成或取消确认后才能恢复历史任务。";

type UseTaskProcessingControllerOptions = {
  onResetTaskUi: () => void;
  onRetryStarted: () => void;
  processBlockerMessage: (account: AccountStatus, actionLabel: string) => string;
  aiBlockerMessage: (account: AccountStatus, actionLabel: string) => string;
};

export function useTaskProcessingController({
  onResetTaskUi,
  onRetryStarted,
  processBlockerMessage,
  aiBlockerMessage,
}: UseTaskProcessingControllerOptions) {
  const [workflow, setWorkflow] = useState(createInitialWorkflow);
  const operationIdRef = useRef(0);
  const cancellationOperationIdRef = useRef<number | null>(null);

  const canSubmit = canSubmitUrl(workflow.url);
  const toolbarNewTaskButtonState = getToolbarNewTaskButtonState(workflow.stage);
  const canRestoreHistory = !isProcessingStage(workflow.stage);

  const updateUrlDraft = useCallback((url: string) => {
    setWorkflow((current) =>
      current.stage === "waiting_input"
        ? {
            ...current,
            url,
          }
        : current,
    );
  }, []);

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
          artifacts: {
            ...current.artifacts,
            ...saved.artifacts,
          },
        };
      });
    },
    [],
  );

  const resetWorkflow = useCallback(() => {
    operationIdRef.current += 1;
    cancellationOperationIdRef.current = null;
    onResetTaskUi();
    setWorkflow(createInitialWorkflow());
  }, [onResetTaskUi]);

  const startNewTaskFromToolbar = useCallback(() => {
    if (toolbarNewTaskButtonState.disabled) {
      return;
    }

    resetWorkflow();
  }, [resetWorkflow, toolbarNewTaskButtonState.disabled]);

  const restoreHistoryItem = useCallback(
    (item: HistoryItem): boolean => {
      if (isProcessingStage(workflow.stage)) {
        return false;
      }

      operationIdRef.current += 1;
      cancellationOperationIdRef.current = null;
      onResetTaskUi();
      setWorkflow({
        ...summarizeWorkerResult(historyItemToWorkerResult(item)),
        url: item.url,
        submittedUrl: item.url,
      });
      return true;
    },
    [onResetTaskUi, workflow.stage],
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

  const submitUrl = useCallback(
    async (
      event: FormEvent<HTMLFormElement>,
      account: AccountStatus,
      openAccountPanel: OpenAccountPanel,
    ) => {
      event.preventDefault();
      if (!canSubmit) {
        return;
      }
      if (!canProcessWithAccount(account)) {
        openAccountPanel(processBlockerMessage(account, "开始新任务"));
        return;
      }
      const submittedUrl = normalizeSubmitUrl(workflow.url);
      if (!submittedUrl) {
        return;
      }
      const operationId = operationIdRef.current + 1;
      operationIdRef.current = operationId;
      setWorkflow((current) => startProcessing(current, submittedUrl));
      const result = await processVideo(submittedUrl, undefined, (event) => {
        if (operationIdRef.current === operationId) {
          setWorkflow((current) => mergeProgressEvent(current, event));
        }
      });
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
        ...summarizeWorkerResult(result),
        url: submittedUrl,
        submittedUrl: current.submittedUrl || submittedUrl,
      }));
    },
    [canSubmit, onResetTaskUi, processBlockerMessage, workflow.url],
  );

  const cancelCurrentProcessing = useCallback(async () => {
    const operationId = operationIdRef.current;
    if (cancellationOperationIdRef.current === operationId) {
      return;
    }

    cancellationOperationIdRef.current = operationId;
    setWorkflow((current) => requestProcessingCancellation(current));
    const result = await cancelProcess();
    if (operationIdRef.current !== operationId) {
      return;
    }
    if (result.status === "failed") {
      cancellationOperationIdRef.current = null;
      setWorkflow((current) =>
        restoreProcessingAfterCancellationFailure(
          current,
          result.error || "无法终止当前进程树。",
        ),
      );
    }
  }, []);

  const retryInsightGeneration = useCallback(
    async (
      target: InsightRetryTarget,
      preferenceSnapshot: PreferenceSnapshot | null,
      account: AccountStatus,
      openAccountPanel: OpenAccountPanel,
      onRetryCompleted?: () => void,
      insightId?: number,
      // User-selected draft platform id (9-id vocabulary). Forwarded only for
      // target="draft"; absent for summary/insights (worker rejects it there).
      platform?: string,
    ) => {
      if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
        return;
      }
      if (!canGenerateAiWithAccount(account)) {
        openAccountPanel(
          aiBlockerMessage(
            account,
            target === "summary"
              ? "生成要点总结"
              : target === "draft"
                ? "生成文字稿"
                : "生成启发灵感",
          ),
        );
        return;
      }

      const taskId = workflow.taskId;
      const operationId = operationIdRef.current + 1;
      operationIdRef.current = operationId;
      onRetryStarted();
      setWorkflow((current) => startInsightRetry(current, target));

      const result = await retryInsights(
        taskId,
        target,
        preferenceSnapshot,
        undefined,
        insightId,
        platform,
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
          },
          target,
        ),
        url: current.url,
        submittedUrl: current.submittedUrl,
      }));
      onRetryCompleted?.();
    },
    [
      aiBlockerMessage,
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

  return {
    workflow,
    canSubmit,
    canRestoreHistory,
    historyRestoreUnavailableMessage: HISTORY_RESTORE_UNAVAILABLE_MESSAGE,
    toolbarNewTaskButtonState,
    cancelCurrentProcessing,
    resetWorkflow,
    updateUrlDraft,
    applyTranscriptSave,
    completeHistoryTaskDeletion,
    restoreHistoryItem,
    retryInsightGeneration,
    setDraftSeedInsightId,
    startNewTaskFromToolbar,
    submitUrl,
  };
}
