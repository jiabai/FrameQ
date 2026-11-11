import {
  canGenerateAiWithAccount,
  type AccountStatus,
} from "./accountState";
import { uiMessage, type UiMessage } from "./i18n/uiMessage";
import type {
  StudioTool,
  ProgressMessageDescriptor,
  ProgressStep,
  WorkflowState,
  WorkflowStage,
} from "./workflowState";
import { hasSourceText, isArticleTaskSource } from "./webPageProtocol";

export type WorkspaceCancellationOwner = "local" | "ai" | null;
export type LocalWorkspacePhase = "waiting" | "processing" | "ready" | "failed";
export type AiWorkspacePhase = "waiting_transcript" | "ready" | "generating";
export type AiAvailability = "available" | "unavailable" | "quota_exhausted";
export type StudioToolStatus =
  | "locked"
  | "available"
  | "generating"
  | "cancelling"
  | "ready"
  | "failed";

export type StudioToolViewModel = {
  id: StudioTool;
  status: StudioToolStatus;
  errorCode: string | null;
  /** Optional explanation shown when a target is quietly locked (draft seed rules). */
  lockedHint?: UiMessage;
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

export type WorkspaceCancellationViewModel = {
  visible: boolean;
  enabled: boolean;
  inProgress: boolean;
};

export type ArtifactActionViewModel = {
  visible: boolean;
  enabled: boolean;
};

export type TranscriptSourceViewModel =
  | { kind: "asr" }
  | { kind: "subtitle"; language: string | null }
  | null;

function hasSavedTranscript(workflow: WorkflowState): boolean {
  return Boolean(workflow.taskDir && hasSourceText(workflow));
}

function isAiCancellation(workflow: WorkflowState): boolean {
  return (
    workflow.stage === "cancelling" &&
    (workflow.cancellingFromStage === "insights_generating" || workflow.cancellingFromStage === "title_generating")
  );
}

function localProgressSteps(workflow: WorkflowState): ProgressStep[] {
  const stage =
    workflow.stage === "cancelling" ? workflow.cancellingFromStage : workflow.stage;
  const steps = isArticleTaskSource(workflow.taskSource) || stage?.startsWith("web_")
    ? [{ id: "web_loading" as const }, { id: "web_extracting" as const }, { id: "web_saving" as const }] : LOCAL_PROGRESS_STEPS;
  const activeIndex = steps.findIndex((step) => step.id === stage);

  return steps.map((step, index) => ({
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

function studioToolStatus(
  workflow: WorkflowState,
  tool: StudioTool,
  transcriptReady: boolean,
): StudioToolViewModel {
  if (!transcriptReady) {
    return { id: tool, status: "locked", errorCode: null };
  }

  if (workflow.activeStudioTool === tool) {
    return {
      id: tool,
      status: isAiCancellation(workflow) ? "cancelling" : "generating",
      errorCode: null,
    };
  }

  const toolError = workflow.studioToolErrors[tool];
  if (toolError) {
    return { id: tool, status: "failed", errorCode: toolError.code };
  }

  const ready =
    tool === "summary"
      ? Boolean(workflow.summary || workflow.artifacts.summary)
      : tool === "insights"
        ? Boolean(workflow.insights.length || workflow.artifacts.insights || workflow.artifacts.insights_md)
        : tool === "draft"
          ? Boolean(workflow.draft || workflow.artifacts.draft)
          : Boolean(workflow.dissection || workflow.artifacts.dissection);

  if (tool === "draft") {
    // The draft card needs a selectable seed insight. It is quietly locked
    // until (a) insights are ready AND (b) the user has selected exactly one
    // seed (workflow.draftSeedInsightId). When locked it must NOT expose an LLM
    // entry or consume quota. This does NOT infer the draft tool from status
    // copy — it is an availability projection from artifact + selection state.
    const insightsReady = Boolean(
      workflow.insights.length || workflow.artifacts.insights || workflow.artifacts.insights_md,
    );
    const seedSelected = workflow.draftSeedInsightId !== null;
    if (ready) {
      return { id: tool, status: "ready", errorCode: null };
    }
    if (!insightsReady) {
      return {
        id: tool,
        status: "locked",
        errorCode: null,
        lockedHint: uiMessage("studio.tools.draft.hint.needInsights"),
      };
    }
    if (!seedSelected) {
      return {
        id: tool,
        status: "locked",
        errorCode: null,
        lockedHint: uiMessage("studio.tools.draft.hint.selectSeed"),
      };
    }
    return { id: tool, status: "available", errorCode: null };
  }

  return { id: tool, status: ready ? "ready" : "available", errorCode: null };
}

function cancellationOwner(workflow: WorkflowState): WorkspaceCancellationOwner {
  const stage =
    workflow.stage === "cancelling" ? workflow.cancellingFromStage : workflow.stage;
  if (stage === "insights_generating" || stage === "title_generating") {
    return "ai";
  }
  if (stage === "video_extracting" || stage === "video_transcribing" || stage?.startsWith("web_")) {
    return "local";
  }
  return null;
}

function workspaceCancellation(
  owner: WorkspaceCancellationOwner,
  workspace: Exclude<WorkspaceCancellationOwner, null>,
  workflow: WorkflowState,
): WorkspaceCancellationViewModel {
  const visible = owner === workspace;
  const inProgress = visible && workflow.stage === "cancelling";
  return {
    visible,
    enabled: visible && !inProgress,
    inProgress,
  };
}

function artifactAction(
  transcriptReady: boolean,
  artifactPath: string | undefined,
): ArtifactActionViewModel {
  const available = transcriptReady && Boolean(artifactPath);
  return { visible: available, enabled: available };
}

function transcriptSource(workflow: WorkflowState): TranscriptSourceViewModel {
  if (!workflow.transcript) {
    return null;
  }
  return workflow.transcript.source === "subtitle"
    ? { kind: "subtitle", language: workflow.transcript.language }
    : { kind: "asr" };
}

export function createTaskWorkspaceViewModel(
  workflow: WorkflowState,
  account: AccountStatus,
) {
  const transcriptReady = hasSavedTranscript(workflow);
  const titleActive = workflow.stage === "title_generating" ||
    (workflow.stage === "cancelling" && workflow.cancellingFromStage === "title_generating");
  const aiActive = workflow.activeStudioTool !== null || titleActive;
  const localProcessing =
    workflow.stage === "video_extracting" ||
    workflow.stage === "video_transcribing" ||
    workflow.stage.startsWith("web_") ||
    (workflow.stage === "cancelling" && !isAiCancellation(workflow));
  const localPhase: LocalWorkspacePhase = transcriptReady
    ? "ready"
    : localProcessing
      ? "processing"
      : workflow.stage === "failed"
        ? "failed"
        : "waiting";
  const readOnly = transcriptReady && (aiActive || isAiCancellation(workflow));
  const summary = studioToolStatus(workflow, "summary", transcriptReady);
  const insights = studioToolStatus(workflow, "insights", transcriptReady);
  const dissection = studioToolStatus(workflow, "dissection", transcriptReady);
  const draft = studioToolStatus(workflow, "draft", transcriptReady);
  const owner = cancellationOwner(workflow);
  const aiPhase: AiWorkspacePhase = !transcriptReady
    ? "waiting_transcript"
    : aiActive || isAiCancellation(workflow)
      ? "generating"
      : "ready";

  return {
    banner: {
      ...(titleActive ? {
        kind: "local_processing" as const,
        message: workflow.progressMessage === null ? workflow.statusMessage : null,
        progressMessage: workflow.progressMessage,
      } : transcriptReady
        ? {
            kind: "local_complete" as const,
            message: uiMessage(
              workflow.taskSource?.kind === "web_page" ? "webPage.complete" : workflow.taskSource?.kind === "local_file" &&
                workflow.taskSource.mediaKind === "audio"
                ? "workflow.banner.localAudioCompleteMessage"
                : "workflow.banner.localCompleteMessage",
            ),
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
    cancellationOwner: owner,
    local: {
      taskId: workflow.taskId,
      sourceMediaKind:
        workflow.taskSource?.kind === "local_file"
          ? workflow.taskSource.mediaKind
          : workflow.taskSource?.kind === "url"
            ? "video"
            : null,
      phase: localPhase,
      progressSteps: localProgressSteps(workflow),
      canReview: transcriptReady,
      canEdit: transcriptReady && !readOnly && !isArticleTaskSource(workflow.taskSource),
      readOnly,
      cancellation: workspaceCancellation(owner, "local", workflow),
      artifactActions: {
        locateVideo: artifactAction(
          transcriptReady,
          workflow.artifacts.video,
        ),
        locateAudio: artifactAction(
          transcriptReady,
          workflow.artifacts.audio,
        ),
        locateTranscript: artifactAction(
          transcriptReady,
          workflow.taskSource?.kind === "web_page" ? workflow.artifacts.article_md : workflow.artifacts.transcript_txt,
        ),
        copyTranscript: artifactAction(
          transcriptReady,
          workflow.taskSource?.kind === "web_page" ? workflow.artifacts.article_txt : workflow.artifacts.transcript_txt,
        ),
      },
      transcriptSource: transcriptSource(workflow),
      error: !transcriptReady && workflow.error?.stage !== "insights_generating"
        ? workflow.error
        : null,
    },
    ai: {
      sourceKind: isArticleTaskSource(workflow.taskSource) ? "article" as const : "media" as const,
      taskId: workflow.taskId,
      phase: aiPhase,
      availability: aiAvailability(account),
      activeTool: workflow.activeStudioTool,
      progressMessage:
        aiActive || isAiCancellation(workflow) ? workflow.progressMessage : null,
      cancellation: workspaceCancellation(owner, "ai", workflow),
      summary,
      insights,
      dissection,
      dissectionAvailable: workflow.dissection !== null,
      dissectionStale: workflow.dissectionStale,
      draft,
    },
  };
}

export type TaskWorkspaceViewModel = ReturnType<typeof createTaskWorkspaceViewModel>;
