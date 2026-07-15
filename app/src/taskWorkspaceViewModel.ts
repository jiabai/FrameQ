import {
  canGenerateAiWithAccount,
  type AccountStatus,
} from "./accountState";
import { uiMessage, type UiMessage } from "./i18n/uiMessage";
import type {
  InsightRetryTarget,
  ProgressMessageDescriptor,
  ProgressStep,
  WorkflowState,
  WorkflowStage,
} from "./workflowState";

export type WorkspaceCancellationOwner = "local" | "ai" | null;
export type LocalWorkspacePhase = "waiting" | "processing" | "ready" | "failed";
export type AiWorkspacePhase = "waiting_transcript" | "ready" | "generating";
export type AiAvailability = "available" | "unavailable" | "quota_exhausted";
export type AiTargetStatus =
  | "locked"
  | "available"
  | "generating"
  | "cancelling"
  | "ready"
  | "failed";

export type AiTargetViewModel = {
  target: InsightRetryTarget;
  status: AiTargetStatus;
  errorCode: string | null;
};

const LOCAL_PROGRESS_STEPS: Array<Pick<ProgressStep, "id">> = [
  { id: "video_extracting" },
  { id: "video_transcribing" },
];

export type TaskStatusBannerViewModel = {
  kind: "local_complete" | "local_failed" | "local_processing" | "idle";
  stage: WorkflowStage;
  message: UiMessage | null;
  progressMessage: ProgressMessageDescriptor | null;
};

function hasSavedTranscript(workflow: WorkflowState): boolean {
  return Boolean(
    workflow.taskId &&
      workflow.taskDir &&
      workflow.artifacts.transcript_txt &&
      workflow.text,
  );
}

function isAiCancellation(workflow: WorkflowState): boolean {
  return (
    workflow.stage === "cancelling" &&
    workflow.cancellingFromStage === "insights_generating"
  );
}

function localProgressSteps(workflow: WorkflowState): ProgressStep[] {
  const stage =
    workflow.stage === "cancelling" ? workflow.cancellingFromStage : workflow.stage;
  const activeIndex = LOCAL_PROGRESS_STEPS.findIndex((step) => step.id === stage);

  return LOCAL_PROGRESS_STEPS.map((step, index) => ({
    ...step,
    state:
      activeIndex === -1
        ? hasSavedTranscript(workflow)
          ? "complete"
          : "pending"
        : index < activeIndex
          ? "complete"
          : index === activeIndex
            ? "active"
            : "pending",
  }));
}

function aiAvailability(account: AccountStatus): AiAvailability {
  if (account.llmQuotaRemaining <= 0 && account.authenticated) {
    return "quota_exhausted";
  }
  return canGenerateAiWithAccount(account) ? "available" : "unavailable";
}

function aiTargetStatus(
  workflow: WorkflowState,
  target: InsightRetryTarget,
  transcriptReady: boolean,
): AiTargetViewModel {
  if (!transcriptReady) {
    return { target, status: "locked", errorCode: null };
  }

  if (workflow.activeAiTarget === target) {
    return {
      target,
      status: isAiCancellation(workflow) ? "cancelling" : "generating",
      errorCode: null,
    };
  }

  const targetError = workflow.aiTargetErrors[target];
  if (targetError) {
    return { target, status: "failed", errorCode: targetError.code };
  }

  const ready =
    target === "summary"
      ? Boolean(workflow.summary || workflow.artifacts.summary)
      : Boolean(workflow.insights.length || workflow.artifacts.insights || workflow.artifacts.insights_md);

  return { target, status: ready ? "ready" : "available", errorCode: null };
}

function cancellationOwner(workflow: WorkflowState): WorkspaceCancellationOwner {
  const stage =
    workflow.stage === "cancelling" ? workflow.cancellingFromStage : workflow.stage;
  if (stage === "insights_generating") {
    return "ai";
  }
  if (stage === "video_extracting" || stage === "video_transcribing") {
    return "local";
  }
  return null;
}

export function createTaskWorkspaceViewModel(
  workflow: WorkflowState,
  account: AccountStatus,
) {
  const transcriptReady = hasSavedTranscript(workflow);
  const aiActive = workflow.activeAiTarget !== null;
  const localProcessing =
    workflow.stage === "video_extracting" ||
    workflow.stage === "video_transcribing" ||
    (workflow.stage === "cancelling" && !isAiCancellation(workflow));
  const localPhase: LocalWorkspacePhase = transcriptReady
    ? "ready"
    : localProcessing
      ? "processing"
      : workflow.stage === "failed"
        ? "failed"
        : "waiting";
  const readOnly = transcriptReady && (aiActive || isAiCancellation(workflow));
  const summary = aiTargetStatus(workflow, "summary", transcriptReady);
  const insights = aiTargetStatus(workflow, "insights", transcriptReady);
  const aiPhase: AiWorkspacePhase = !transcriptReady
    ? "waiting_transcript"
    : aiActive || isAiCancellation(workflow)
      ? "generating"
      : "ready";

  return {
    banner: {
      ...(transcriptReady
        ? {
            kind: "local_complete" as const,
            message: uiMessage("workflow.banner.localCompleteMessage"),
            progressMessage: null,
          }
        : localPhase === "failed"
          ? {
              kind: "local_failed" as const,
              message: workflow.error?.code
                ? uiMessage("workflow.banner.localFailedWithCode", {
                    code: workflow.error.code,
                  })
                : uiMessage("workflow.banner.localFailedMessage"),
              progressMessage: null,
            }
          : {
              kind: localProcessing ? ("local_processing" as const) : ("idle" as const),
              message: workflow.progressMessage === null ? workflow.statusMessage : null,
              progressMessage: workflow.progressMessage,
            }),
      stage: workflow.stage,
    } satisfies TaskStatusBannerViewModel,
    cancellationOwner: cancellationOwner(workflow),
    local: {
      taskId: workflow.taskId,
      phase: localPhase,
      progressSteps: localProgressSteps(workflow),
      canReview: transcriptReady,
      canEdit: transcriptReady && !readOnly,
      readOnly,
      error: !transcriptReady && workflow.error?.stage !== "insights_generating"
        ? workflow.error
        : null,
    },
    ai: {
      taskId: workflow.taskId,
      phase: aiPhase,
      availability: aiAvailability(account),
      activeTarget: workflow.activeAiTarget,
      summary,
      insights,
    },
  };
}

export type TaskWorkspaceViewModel = ReturnType<typeof createTaskWorkspaceViewModel>;
