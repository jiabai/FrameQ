import type { Insight } from "./insightPreferences";
import { uiMessage, type UiMessage } from "./i18n/uiMessage";
import type {
  ProgressMessageDescriptor,
  WorkerProgressEvent,
  WorkflowStage,
} from "./desktopWorkerProtocol";

export type {
  ProgressMessageDescriptor,
  WorkerProgressEvent,
  WorkflowStage,
} from "./desktopWorkerProtocol";

export type ProgressStepState = "pending" | "active" | "complete";

export type ProgressStep = {
  id: WorkflowStage;
  state: ProgressStepState;
};
export type TaskArtifactKey =
  | "video"
  | "audio"
  | "transcript_txt"
  | "transcript_md"
  | "segments"
  | "summary"
  | "mindmap"
  | "insights"
  | "insights_md"
  | "preference_snapshot";

export type TaskArtifacts = Partial<Record<TaskArtifactKey, string>>;

export type TranscriptMetadata = {
  source: "asr" | "subtitle";
  language: string | null;
  engine: string | null;
};

export type WorkerResult = {
  status: "completed" | "partial_completed" | "failed";
  task_id: string | null;
  task_dir: string | null;
  artifacts: TaskArtifacts;
  text: string;
  summary: string;
  insights: Insight[];
  transcript: TranscriptMetadata | null;
  error: WorkerErrorResult | null;
};

export type WorkerErrorResult = {
  code: string;
  message: string;
  stage: WorkflowStage;
};

export type InsightRetryTarget = "summary" | "insights";

export type ToolbarNewTaskButtonState = {
  disabled: boolean;
  ariaLabel: UiMessage;
  title: UiMessage;
};

export type WorkflowState = {
  stage: WorkflowStage;
  cancellingFromStage: Exclude<WorkflowStage, "waiting_input" | "cancelling" | "completed" | "partial_completed" | "failed"> | null;
  activeAiTarget: InsightRetryTarget | null;
  aiErrorTarget: InsightRetryTarget | null;
  aiTargetErrors: Partial<Record<InsightRetryTarget, WorkerErrorResult>>;
  url: string;
  submittedUrl: string;
  showUrlInput: boolean;
  statusMessage: UiMessage | null;
  progressMessage: ProgressMessageDescriptor | null;
  progressPercent: number;
  text: string;
  summary: string;
  insights: Insight[];
  taskId: string | null;
  taskDir: string | null;
  artifacts: TaskArtifacts;
  transcript: TranscriptMetadata | null;
  error: WorkerErrorResult | null;
};
export function createInitialWorkflow(): WorkflowState {
  return {
    stage: "waiting_input",
    cancellingFromStage: null,
    activeAiTarget: null,
    aiErrorTarget: null,
    aiTargetErrors: {},
    url: "",
    submittedUrl: "",
    showUrlInput: true,
    statusMessage: null,
    progressMessage: null,
    progressPercent: 0,
    text: "",
    summary: "",
    insights: [],
    taskId: null,
    taskDir: null,
    artifacts: {},
    transcript: null,
    error: null,
  };
}
export function startProcessing(state: WorkflowState, url: string): WorkflowState {
  return {
    ...state,
    stage: "video_extracting",
    cancellingFromStage: null,
    activeAiTarget: null,
    aiErrorTarget: null,
    aiTargetErrors: {},
    url,
    submittedUrl: url,
    showUrlInput: false,
    statusMessage: null,
    progressMessage: { messageCode: "video.download.preparing", args: {} },
    progressPercent: 12,
    text: "",
    summary: "",
    insights: [],
    taskId: null,
    taskDir: null,
    artifacts: {},
    error: null,
  };
}

export function startInsightRetry(state: WorkflowState, target: InsightRetryTarget): WorkflowState {
  const aiTargetErrors = { ...state.aiTargetErrors };
  delete aiTargetErrors[target];
  return {
    ...state,
    stage: "insights_generating",
    cancellingFromStage: null,
    activeAiTarget: target,
    aiErrorTarget: state.aiErrorTarget === target ? null : state.aiErrorTarget,
    aiTargetErrors,
    showUrlInput: false,
    statusMessage: null,
    progressMessage: {
      messageCode:
        target === "summary"
          ? "insights.summary.generating"
          : "insights.topics.generating",
      args: {},
    },
    progressPercent: 88,
    error: null,
  };
}

export function cancelProcessing(state: WorkflowState): WorkflowState {
  return confirmProcessingCancellation(state);
}

export function requestProcessingCancellation(state: WorkflowState): WorkflowState {
  const cancellingFromStage = state.stage;
  if (
    cancellingFromStage !== "video_extracting" &&
    cancellingFromStage !== "video_transcribing" &&
    cancellingFromStage !== "insights_generating"
  ) {
    return state;
  }

  return {
    ...state,
    stage: "cancelling",
    cancellingFromStage,
    statusMessage: null,
    progressMessage: { messageCode: "task.cancel.requested", args: {} },
    error: null,
  };
}

export function restoreProcessingAfterCancellationFailure(
  state: WorkflowState,
): WorkflowState {
  const stage = state.cancellingFromStage ?? "video_extracting";
  return {
    ...state,
    stage,
    cancellingFromStage: null,
    statusMessage: uiMessage("workflow.cancellation.failed"),
    progressMessage: null,
  };
}

export function confirmProcessingCancellation(state: WorkflowState): WorkflowState {
  return {
    ...createInitialWorkflow(),
    url: state.submittedUrl || state.url,
  };
}

export function isProcessingStage(stage: WorkflowStage): boolean {
  return (
    stage === "video_extracting" ||
    stage === "video_transcribing" ||
    stage === "insights_generating" ||
    stage === "cancelling"
  );
}

export function getToolbarNewTaskButtonState(stage: WorkflowStage): ToolbarNewTaskButtonState {
  if (isProcessingStage(stage)) {
    return {
      disabled: true,
      ariaLabel: uiMessage("workflow.toolbar.newTaskUnavailable"),
      title: uiMessage("workflow.toolbar.newTaskUnavailable"),
    };
  }

  return {
    disabled: false,
    ariaLabel: uiMessage("workflow.toolbar.newTask"),
    title: uiMessage("workflow.toolbar.newTask"),
  };
}
export function getVisibleWorkflowError(state: WorkflowState): WorkerErrorResult | null {
  if (!state.error) {
    return null;
  }

  return state.stage === "failed" || state.stage === "partial_completed" ? state.error : null;
}

export function summarizeWorkerResult(
  result: WorkerResult,
  failedAiTarget: InsightRetryTarget | null = null,
): WorkflowState {
  return {
    ...createInitialWorkflow(),
    stage: result.status,
    showUrlInput: false,
    statusMessage: null,
    progressMessage: null,
    progressPercent: result.status === "failed" ? 35 : 100,
    text: result.text,
    summary: result.summary,
    insights: result.insights,
    taskId: result.task_id,
    taskDir: result.task_dir,
    artifacts: result.artifacts ?? {},
    transcript: result.transcript ?? null,
    error: result.error,
    aiErrorTarget:
      result.error?.stage === "insights_generating" ? failedAiTarget : null,
    aiTargetErrors:
      result.error?.stage === "insights_generating" && failedAiTarget
        ? { [failedAiTarget]: result.error }
        : {},
  };
}

export function finishInsightRetry(
  state: WorkflowState,
  result: WorkerResult,
  target: InsightRetryTarget,
): WorkflowState {
  const next = summarizeWorkerResult(result);
  const aiTargetErrors = { ...state.aiTargetErrors };
  if (result.error?.stage === "insights_generating") {
    aiTargetErrors[target] = result.error;
  } else {
    delete aiTargetErrors[target];
  }
  return {
    ...next,
    aiErrorTarget: result.error?.stage === "insights_generating" ? target : null,
    aiTargetErrors,
  };
}

export function getTranscriptSourceLabel(state: WorkflowState): UiMessage | null {
  if (!state.transcript) {
    return null;
  }
  if (state.transcript.source === "subtitle") {
    return state.transcript.language
      ? uiMessage("transcript.review.source.subtitleWithLanguage", {
          language: state.transcript.language,
        })
      : uiMessage("transcript.review.source.subtitle");
  }
  return uiMessage("transcript.review.source.asr");
}

export function mergeProgressEvent(
  state: WorkflowState,
  event: WorkerProgressEvent,
): WorkflowState {
  return {
    ...state,
    stage: event.stage,
    showUrlInput: false,
    progressMessage: event.message,
    progressPercent: event.progress,
  };
}
