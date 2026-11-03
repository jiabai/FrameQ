import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Event } from "@tauri-apps/api/event";
import {
  WORKER_PROGRESS_EVENT,
  parseRetryInsightsInput,
  parseWorkerProgressEvent,
  type RetryInsightsInput,
  type RetryInsightsWireRequest,
  type WorkerProgressEvent,
  type WorkflowStage,
} from "./desktopWorkerProtocol";
import {
  parseCancelProcessResult,
  parseWorkerResult,
  type CancelProcessResult,
} from "./workerResultProtocol";
import {
  parseProcessLocalMediaRequest,
  type ProcessLocalMediaRequest,
} from "./localMediaContract";
import type { WorkerResult } from "./workflow";
import { parseNoteTitleCancellationRequest, type NoteTitleCancellationInput } from "./noteTitle";

export { WORKER_PROGRESS_EVENT } from "./desktopWorkerProtocol";
export type { RetryInsightsInput } from "./desktopWorkerProtocol";
export type { CancelProcessResult } from "./workerResultProtocol";

export type WorkerCommandRunner = (command: string, args: InvokeArgs) => Promise<unknown>;
export type CancelCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;
export type WorkerProgressListener = (
  eventName: string,
  handler: (event: Event<unknown>) => void,
) => Promise<() => void | Promise<void>>;
export type WorkerProgressHandler = (event: WorkerProgressEvent) => void;
export type ProgressDiagnosticRecorder = (safeCode: string) => void;

export type RetryInsightTarget = "summary" | "insights" | "dissection" | "draft";

export type ProcessVideoIpcRequest = {
  url: string;
  asrModel: "iic/SenseVoiceSmall" | "iic/SenseVoiceSmall-onnx";
};

export type RetryInsightsRequest = RetryInsightsWireRequest;

const defaultWorkerRunner: WorkerCommandRunner = (command, args) => invoke(command, args);
const defaultCancelRunner: CancelCommandRunner = (command, args) => invoke(command, args);
const defaultProgressDiagnosticRecorder: ProgressDiagnosticRecorder = (safeCode) => {
  console.warn(`Dropped invalid worker progress event: ${safeCode}`);
};

export function processVideo(
  url: string,
  runner?: WorkerCommandRunner,
  onProgress?: WorkerProgressHandler,
  progressListener?: WorkerProgressListener,
  recordInvalidProgress?: ProgressDiagnosticRecorder,
): Promise<WorkerResult>;
export function processVideo(
  url: string,
  asrModel: ProcessVideoIpcRequest["asrModel"],
  runner?: WorkerCommandRunner,
  onProgress?: WorkerProgressHandler,
  progressListener?: WorkerProgressListener,
  recordInvalidProgress?: ProgressDiagnosticRecorder,
): Promise<WorkerResult>;
export async function processVideo(
  url: string,
  asrModelOrRunner:
    | ProcessVideoIpcRequest["asrModel"]
    | WorkerCommandRunner = "iic/SenseVoiceSmall-onnx",
  runnerOrOnProgress?: WorkerCommandRunner | WorkerProgressHandler,
  onProgressOrListener?: WorkerProgressHandler | WorkerProgressListener,
  progressListenerOrRecorder?: WorkerProgressListener | ProgressDiagnosticRecorder,
  recordInvalidProgress?: ProgressDiagnosticRecorder,
): Promise<WorkerResult> {
  const legacyInvocation = typeof asrModelOrRunner === "function";
  const asrModel = legacyInvocation ? "iic/SenseVoiceSmall-onnx" : asrModelOrRunner;
  const resolvedRunner = legacyInvocation
    ? asrModelOrRunner
    : (runnerOrOnProgress as WorkerCommandRunner | undefined) ?? defaultWorkerRunner;
  const resolvedOnProgress = legacyInvocation
    ? (runnerOrOnProgress as WorkerProgressHandler | undefined)
    : (onProgressOrListener as WorkerProgressHandler | undefined);
  const resolvedProgressListener = legacyInvocation
    ? (onProgressOrListener as WorkerProgressListener | undefined) ?? listen
    : (progressListenerOrRecorder as WorkerProgressListener | undefined) ?? listen;
  const resolvedDiagnosticRecorder = legacyInvocation
    ? (progressListenerOrRecorder as ProgressDiagnosticRecorder | undefined) ??
      defaultProgressDiagnosticRecorder
    : recordInvalidProgress ?? defaultProgressDiagnosticRecorder;
  return runTaskCommand(
    "process_video",
    { url, asrModel } satisfies ProcessVideoIpcRequest,
    resolvedRunner,
    resolvedOnProgress,
    resolvedProgressListener,
    resolvedDiagnosticRecorder,
  );
}

export async function processLocalMedia(
  input: ProcessLocalMediaRequest,
  runner: WorkerCommandRunner = defaultWorkerRunner,
  onProgress?: WorkerProgressHandler,
  progressListener: WorkerProgressListener = listen,
  recordInvalidProgress: ProgressDiagnosticRecorder = defaultProgressDiagnosticRecorder,
): Promise<WorkerResult> {
  const parsed = parseProcessLocalMediaRequest(input);
  if (parsed.kind === "invalid") {
    return failedResult(
      "LOCAL_MEDIA_SELECTION_INVALID",
      "",
      "video_extracting",
    );
  }
  return runTaskCommand(
    "process_local_media",
    parsed.value,
    runner,
    onProgress,
    progressListener,
    recordInvalidProgress,
  );
}

async function runTaskCommand(
  command: "process_video" | "process_local_media",
  request: ProcessVideoIpcRequest | ProcessLocalMediaRequest,
  runner: WorkerCommandRunner,
  onProgress: WorkerProgressHandler | undefined,
  progressListener: WorkerProgressListener,
  recordInvalidProgress: ProgressDiagnosticRecorder,
): Promise<WorkerResult> {
  let unlisten: (() => void | Promise<void>) | null = null;
  try {
    if (onProgress) {
      unlisten = await progressListener(WORKER_PROGRESS_EVENT, (event) => {
        const parsed = parseWorkerProgressEvent(event.payload);
        if (parsed.kind === "invalid") {
          recordInvalidProgress(parsed.diagnosticCode);
        } else {
          if (parsed.kind === "unknown") {
            recordInvalidProgress(parsed.diagnosticCode);
          }
          onProgress(parsed.event);
        }
      });
    }
    return (
      parseMediaResult(await runner(command, { request })) ??
      protocolViolationResult(null, "failed", "video_extracting")
    );
  } catch (error) {
    return failedResult(
      "TAURI_COMMAND_FAILED",
      error instanceof Error ? error.message : String(error),
      "video_extracting",
    );
  } finally {
    await releaseWorkerProgress(unlisten, recordInvalidProgress);
  }
}

function parseMediaResult(value: unknown): WorkerResult | null {
  const result = parseWorkerResult(value);
  return result?.source?.kind === "web_page" ? null : result;
}

export async function retryInsights(
  input: RetryInsightsInput,
  runner: WorkerCommandRunner = defaultWorkerRunner,
  onProgress?: WorkerProgressHandler,
  progressListener: WorkerProgressListener = listen,
  recordInvalidProgress: ProgressDiagnosticRecorder = defaultProgressDiagnosticRecorder,
  shouldStart: () => boolean = () => true,
  cancellationBeforeStart?: () => Promise<WorkerResult>,
): Promise<WorkerResult> {
  const parsed = parseRetryInsightsInput(input);
  if (parsed.kind === "invalid") {
    return invalidRetryPayloadResult(parsed.taskId);
  }

  let unlisten: (() => void | Promise<void>) | null = null;
  try {
    if (onProgress) {
      unlisten = await progressListener(WORKER_PROGRESS_EVENT, (event) => {
          const progress = parseWorkerProgressEvent(event.payload);
          if (progress.kind === "invalid") {
            recordInvalidProgress(progress.diagnosticCode);
          } else {
            if (progress.kind === "unknown") {
              recordInvalidProgress(progress.diagnosticCode);
            }
            onProgress(progress.event);
          }
        });
    }
    if (!shouldStart()) {
      if (cancellationBeforeStart) return await cancellationBeforeStart();
      return {
        status: "partial_completed", task_id: parsed.request.task_id, task_dir: null,
        artifacts: {}, text: "", summary: "", insights: [], transcript: null,
        dissection: null, dissection_source_status: null, draft: "", task_created: false,
        note_title: parsed.request.target === "title" ? {
          text: null, status: "cancelled", output_language: parsed.request.output_language, error_code: "WORKER_CANCELLED",
        } : null,
        error: { code: "WORKER_CANCELLED", message: "", stage: parsed.request.target === "title" ? "title_generating" : "insights_generating" },
      };
    }
    return (
      parseWorkerResult(await runner("retry_insights", { request: parsed.request })) ??
      protocolViolationResult(
        parsed.request.task_id,
        "partial_completed",
        parsed.request.target === "title" ? "title_generating" : "insights_generating",
      )
    );
  } catch (error) {
    return {
      status: "partial_completed",
      task_id: parsed.request.task_id,
      task_dir: null,
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
      transcript: null,
      dissection: null,
      dissection_source_status: null,
      draft: "",
      error: {
        code: "TAURI_COMMAND_FAILED",
        message: parsed.request.target === "title" ? "" : error instanceof Error ? error.message : String(error),
        stage:
          parsed.request.target === "draft"
            ? "draft_generating"
            : parsed.request.target === "title"
              ? "title_generating"
            : "insights_generating",
      },
    };
  } finally {
    await releaseWorkerProgress(unlisten, recordInvalidProgress);
  }
}

export async function recordNoteTitleCancellation(input: NoteTitleCancellationInput): Promise<WorkerResult> {
  const parsed = parseNoteTitleCancellationRequest(input);
  if (parsed.kind === "invalid") return noteTitleCommandFailure(parsed.taskId, "INVALID_RETRY_PAYLOAD");
  try {
    const result = parseWorkerResult(await invoke("record_note_title_cancellation", { request: parsed.request }));
    return result && result.task_id === parsed.request.task_id
      ? result
      : noteTitleCommandFailure(parsed.request.task_id, "WORKER_PROTOCOL_VIOLATION");
  } catch {
    return noteTitleCommandFailure(parsed.request.task_id, "TAURI_COMMAND_FAILED");
  }
}

function noteTitleCommandFailure(taskId: string | null, code: string): WorkerResult {
  return {
    ...protocolViolationResult(taskId, "partial_completed", "title_generating"),
    error: { code, message: "", stage: "title_generating" },
  };
}

async function releaseWorkerProgress(
  unlisten: (() => void | Promise<void>) | null,
  recordInvalidProgress: ProgressDiagnosticRecorder,
): Promise<void> {
  if (!unlisten) return;
  try {
    await unlisten();
  } catch {
    recordInvalidProgress("WORKER_PROGRESS_UNSUBSCRIBE_FAILED");
  }
}

export async function cancelProcess(
  runner: CancelCommandRunner = defaultCancelRunner,
): Promise<CancelProcessResult> {
  try {
    return (
      parseCancelProcessResult(await runner("cancel_process", {})) ?? {
        status: "failed",
        error: "INVALID_CANCEL_PROCESS_RESPONSE",
      }
    );
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function failedResult(code: string, message: string, stage: WorkflowStage): WorkerResult {
  return {
    status: "failed",
    task_id: null,
    task_dir: null,
    artifacts: {},
    text: "",
    summary: "",
    insights: [],
    transcript: null,
    dissection: null,
    dissection_source_status: null,
    draft: "",
    error: {
      code,
      message,
      stage,
    },
  };
}

function invalidRetryPayloadResult(taskId: string | null): WorkerResult {
  return {
    status: "partial_completed",
    task_id: taskId,
    task_dir: null,
    artifacts: {},
    text: "",
    summary: "",
    insights: [],
    transcript: null,
    dissection: null,
    dissection_source_status: null,
    draft: "",
    error: {
      code: "INVALID_RETRY_PAYLOAD",
      message: "",
      stage: "insights_generating",
    },
  };
}

function protocolViolationResult(
  taskId: string | null,
  status: "failed" | "partial_completed",
  stage: WorkflowStage,
): WorkerResult {
  return {
    status,
    task_id: taskId,
    task_dir: null,
    artifacts: {},
    text: "",
    summary: "",
    insights: [],
    transcript: null,
    dissection: null,
    dissection_source_status: null,
    draft: "",
    error: {
      code: "WORKER_PROTOCOL_VIOLATION",
      message: "",
      stage,
    },
  };
}
