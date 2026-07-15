import {
  canGenerateAiWithAccount,
  type AccountStatus,
} from "./accountState";
import type {
  InsightRetryTarget,
  ProgressStep,
  WorkflowState,
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

const LOCAL_PROGRESS_STEPS: Array<Pick<ProgressStep, "id" | "label">> = [
  { id: "video_extracting", label: "视频提取中" },
  { id: "video_transcribing", label: "文字稿转译中" },
];

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
      : target === "draft"
        ? Boolean(workflow.draft || workflow.artifacts.draft)
        : Boolean(workflow.insights.length || workflow.artifacts.insights || workflow.artifacts.insights_md);

  if (target === "draft") {
    // The draft card needs a selectable seed insight. It is quietly locked
    // until (a) insights are ready AND (b) the user has selected exactly one
    // seed (workflow.draftSeedInsightId). When locked it must NOT expose an LLM
    // entry or consume quota. This does NOT infer the draft target from status
    // copy — it is an availability projection from artifact + selection state.
    const insightsReady = Boolean(
      workflow.insights.length || workflow.artifacts.insights || workflow.artifacts.insights_md,
    );
    const seedSelected = workflow.draftSeedInsightId !== null;
    return {
      target,
      status: ready
        ? "ready"
        : insightsReady && seedSelected
          ? "available"
          : "locked",
      errorCode: null,
    };
  }

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
  const draft = aiTargetStatus(workflow, "draft", transcriptReady);
  const aiPhase: AiWorkspacePhase = !transcriptReady
    ? "waiting_transcript"
    : aiActive || isAiCancellation(workflow)
      ? "generating"
      : "ready";

  return {
    banner: transcriptReady
      ? {
          kind: "local_complete" as const,
          message: "视频、音频和文字稿已保存在本机。",
        }
      : localPhase === "failed"
        ? {
            kind: "local_failed" as const,
            message: workflow.error?.code
              ? `本地处理失败：${workflow.error.code}`
              : "本地处理失败。",
          }
        : {
            kind: localProcessing ? ("local_processing" as const) : ("idle" as const),
            message: workflow.statusMessage,
          },
    cancellationOwner: cancellationOwner(workflow),
    local: {
      taskId: workflow.taskId,
      phase: localPhase,
      progressSteps: localProgressSteps(workflow),
      canReview: transcriptReady,
      canEdit: transcriptReady && !readOnly,
      readOnlyReason: readOnly ? "AI 正在使用已保存版本" : null,
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
      draft,
    },
  };
}

export type TaskWorkspaceViewModel = ReturnType<typeof createTaskWorkspaceViewModel>;
