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
import type { WorkerResult } from "./workflow";

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

export type RetryInsightTarget = "summary" | "insights";

export type ProcessVideoIpcRequest = {
  url: string;
};

export type RetryInsightsRequest = RetryInsightsWireRequest;

const defaultWorkerRunner: WorkerCommandRunner = (command, args) => invoke(command, args);
const defaultCancelRunner: CancelCommandRunner = (command, args) => invoke(command, args);
const defaultProgressDiagnosticRecorder: ProgressDiagnosticRecorder = (safeCode) => {
  console.warn(`Dropped invalid worker progress event: ${safeCode}`);
};

export async function processVideo(
  url: string,
  runner: WorkerCommandRunner = defaultWorkerRunner,
  onProgress?: WorkerProgressHandler,
  progressListener: WorkerProgressListener = listen,
  recordInvalidProgress: ProgressDiagnosticRecorder = defaultProgressDiagnosticRecorder,
): Promise<WorkerResult> {
  const request: ProcessVideoIpcRequest = {
    url,
  };

  const unlisten = onProgress
      ? await progressListener(WORKER_PROGRESS_EVENT, (event) => {
        const parsed = parseWorkerProgressEvent(event.payload);
        if (parsed.kind === "invalid") {
          recordInvalidProgress(parsed.diagnosticCode);
        } else {
          if (parsed.kind === "unknown") {
            recordInvalidProgress(parsed.diagnosticCode);
          }
          onProgress(parsed.event);
        }
      })
    : null;

  try {
    return (
      parseWorkerResult(await runner("process_video", { request })) ??
      protocolViolationResult(null, "failed", "video_extracting")
    );
  } catch (error) {
    return failedResult(
      "TAURI_COMMAND_FAILED",
      error instanceof Error ? error.message : String(error),
      "video_extracting",
    );
  } finally {
    if (unlisten) {
      await unlisten();
    }
  }
}

export async function retryInsights(
  input: RetryInsightsInput,
  runner: WorkerCommandRunner = defaultWorkerRunner,
): Promise<WorkerResult> {
  const parsed = parseRetryInsightsInput(input);
  if (parsed.kind === "invalid") {
    return invalidRetryPayloadResult(parsed.taskId);
  }

  try {
    return (
      parseWorkerResult(await runner("retry_insights", { request: parsed.request })) ??
      protocolViolationResult(
        parsed.request.task_id,
        "partial_completed",
        "insights_generating",
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
      error: {
        code: "TAURI_COMMAND_FAILED",
        message: error instanceof Error ? error.message : String(error),
        stage: "insights_generating",
      },
    };
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
    error: {
      code: "WORKER_PROTOCOL_VIOLATION",
      message: "",
      stage,
    },
  };
}
