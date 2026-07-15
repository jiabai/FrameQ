import type { Insight } from "./insightPreferences";

export type WorkflowStage =
  | "waiting_input"
  | "cancelling"
  | "video_extracting"
  | "video_transcribing"
  | "insights_generating"
  // draft_generating is an ERROR-only stage: draft generation reuses the
  // insights_generating PROGRESS phase, but a draft failure is reported
  // with error.stage = "draft_generating". It is never a live progress phase,
  // so isProcessingStage / cancellation logic (which use an allow-list) treat
  // it as a terminal state.
  | "draft_generating"
  | "completed"
  | "partial_completed"
  | "failed";

export type ProgressStepState = "pending" | "active" | "complete";

export type ProgressStep = {
  id: WorkflowStage;
  label: string;
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
  | "preference_snapshot"
  | "draft";

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
  draft: string;
  error: WorkerErrorResult | null;
};

export type WorkerErrorResult = {
  code: string;
  message: string;
  stage: WorkflowStage;
};

export type WorkerProgressEvent = {
  stage: WorkflowStage;
  message: string;
  progress: number;
};

export type InsightRetryTarget = "summary" | "insights" | "draft";

/**
 * The worker stages that represent an AI-target generation failure. Draft
 * generation reuses the `insights_generating` progress phase but reports
 * failures with `error.stage = "draft_generating"`. Any of these stages
 * on a retry result means the active AI target failed — attribution is done by
 * target identity (the `target` arg passed to finishInsightRetry), never by
 * inferring the target from the stage copy.
 */
const AI_FAILURE_STAGES: ReadonlySet<WorkflowStage> = new Set([
  "insights_generating",
  "draft_generating",
]);

function isAiTargetFailure(error: WorkerErrorResult | null): error is WorkerErrorResult {
  return Boolean(error && AI_FAILURE_STAGES.has(error.stage));
}

export type ToolbarNewTaskButtonState = {
  disabled: boolean;
  ariaLabel: string;
  title: string;
};

export type WorkflowState = {
  stage: WorkflowStage;
  // cancellingFromStage is one of the live processing phases the user can
  // cancel. draft_generating is an error-only stage, never a live phase,
  // so it is excluded — the draft progress phase is insights_generating.
  cancellingFromStage: Exclude<WorkflowStage, "waiting_input" | "cancelling" | "draft_generating" | "completed" | "partial_completed" | "failed"> | null;
  activeAiTarget: InsightRetryTarget | null;
  aiErrorTarget: InsightRetryTarget | null;
  aiTargetErrors: Partial<Record<InsightRetryTarget, WorkerErrorResult>>;
  url: string;
  submittedUrl: string;
  showUrlInput: boolean;
  statusMessage: string;
  progressPercent: number;
  text: string;
  summary: string;
  insights: Insight[];
  taskId: string | null;
  taskDir: string | null;
  artifacts: TaskArtifacts;
  transcript: TranscriptMetadata | null;
  draft: string;
  // The id of the Insight the user picked as the single draft seed.
  // In-session selection state; cleared on 启发灵感 regen (the insight ids
  // change) and on workflow reset. The on-disk manifest mirror
  // (draft_seed_insight_id) is written by the worker on draft generation
  // (Task 3); cross-session restore into this field is a Task 7 follow-up
  // (the history detail payload does not yet carry it).
  draftSeedInsightId: number | null;
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
    statusMessage: "",
    progressPercent: 0,
    text: "",
    summary: "",
    insights: [],
    taskId: null,
    taskDir: null,
    artifacts: {},
    transcript: null,
    draft: "",
    draftSeedInsightId: null,
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
    statusMessage: "正在下载视频并准备媒体文件。",
    progressPercent: 12,
    text: "",
    summary: "",
    insights: [],
    taskId: null,
    taskDir: null,
    artifacts: {},
    draft: "",
    draftSeedInsightId: null,
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
    statusMessage:
      target === "summary"
        ? "正在生成要点总结和 Mermaid mindmap；文字稿片段会发送到管理员配置的云端 LLM 服务。"
        : target === "draft"
          ? "正在基于灵感生成文字稿；文字稿片段会发送到管理员配置的云端 LLM 服务。"
          : "正在生成启发灵感；文字稿片段和本次偏好会发送到管理员配置的云端 LLM 服务。",
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
    statusMessage: "正在取消任务，请等待当前进程结束。",
    error: null,
  };
}

export function restoreProcessingAfterCancellationFailure(
  state: WorkflowState,
  message: string,
): WorkflowState {
  const stage = state.cancellingFromStage ?? "video_extracting";
  return {
    ...state,
    stage,
    cancellingFromStage: null,
    statusMessage: `取消失败：${message}`,
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
      ariaLabel: "处理中不可开始新任务，请先取消或等待完成",
      title: "处理中不可开始新任务，请先取消或等待完成",
    };
  }

  return {
    disabled: false,
    ariaLabel: "开始新任务",
    title: "开始新任务",
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
    statusMessage: "",
    progressPercent: result.status === "failed" ? 35 : 100,
    text: result.text,
    summary: result.summary,
    insights: result.insights,
    taskId: result.task_id,
    taskDir: result.task_dir,
    artifacts: result.artifacts ?? {},
    transcript: result.transcript ?? null,
    draft: result.draft ?? "",
    error: result.error,
    aiErrorTarget: isAiTargetFailure(result.error) ? failedAiTarget : null,
    aiTargetErrors:
      isAiTargetFailure(result.error) && failedAiTarget
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
  if (isAiTargetFailure(result.error)) {
    aiTargetErrors[target] = result.error;
  } else {
    delete aiTargetErrors[target];
  }
  // Regenerating 启发灵感 replaces the insight list, so the previously
  // selected seed id is no longer valid — clear it. Summary and draft regen do
  // not change the insight ids, so their seed selection is preserved.
  const draftSeedInsightId =
    target === "insights" ? null : state.draftSeedInsightId;
  return {
    ...next,
    aiErrorTarget: isAiTargetFailure(result.error) ? target : null,
    aiTargetErrors,
    draftSeedInsightId,
  };
}

export function getTranscriptSourceLabel(state: WorkflowState): string | null {
  if (!state.transcript) {
    return null;
  }
  if (state.transcript.source === "subtitle") {
    return `来源：平台字幕${state.transcript.language ? `（${state.transcript.language}）` : ""}`;
  }
  return "来源：本地 ASR";
}

export function mergeProgressEvent(
  state: WorkflowState,
  event: WorkerProgressEvent,
): WorkflowState {
  return {
    ...state,
    stage: event.stage,
    showUrlInput: false,
    statusMessage: event.message,
    progressPercent: Math.max(0, Math.min(100, event.progress)),
  };
}
