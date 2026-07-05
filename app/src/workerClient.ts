import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Event } from "@tauri-apps/api/event";
import type { WorkerProgressEvent, WorkerResult, WorkflowStage } from "./workflow";

export type CancelProcessResult = {
  cancelled: boolean;
  error?: string | null;
};

export type WorkerCommandRunner = (command: string, args: InvokeArgs) => Promise<WorkerResult>;
export type CancelCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<CancelProcessResult>;
export type WorkerProgressListener = (
  eventName: string,
  handler: (event: Event<unknown>) => void,
) => Promise<() => void | Promise<void>>;
export type WorkerProgressHandler = (event: WorkerProgressEvent) => void;

export const WORKER_PROGRESS_EVENT = "worker-progress";

export type ProcessVideoRequest = {
  url: string;
  language: string;
  output_formats: string[];
  model: string;
  generate_insights: boolean;
  insightflow_mode: string;
};

export type RetryInsightsRequest = {
  task_id: string;
};

const defaultWorkerRunner: WorkerCommandRunner = (command, args) => invoke(command, args);
const defaultCancelRunner: CancelCommandRunner = (command, args) => invoke(command, args);

export async function processVideo(
  url: string,
  runner: WorkerCommandRunner = defaultWorkerRunner,
  onProgress?: WorkerProgressHandler,
  progressListener: WorkerProgressListener = listen,
): Promise<WorkerResult> {
  const request: ProcessVideoRequest = {
    url,
    language: "Chinese",
    output_formats: ["txt", "md"],
    model: "iic/SenseVoiceSmall",
    generate_insights: false,
    insightflow_mode: "embedded",
  };

  const unlisten = onProgress
    ? await progressListener(WORKER_PROGRESS_EVENT, (event) => {
        const progressEvent = parseProgressEvent(event.payload);
        if (progressEvent) {
          onProgress(progressEvent);
        }
      })
    : null;

  try {
    return await runner("process_video", { request });
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
  taskId: string,
  runner: WorkerCommandRunner = defaultWorkerRunner,
): Promise<WorkerResult> {
  const request: RetryInsightsRequest = {
    task_id: taskId,
  };

  try {
    return await runner("retry_insights", { request });
  } catch (error) {
    return {
      status: "partial_completed",
      task_id: taskId,
      task_dir: null,
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
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
    return await runner("cancel_process", {});
  } catch (error) {
    return {
      cancelled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseProgressEvent(payload: unknown): WorkerProgressEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const event = payload as Partial<WorkerProgressEvent>;
  if (
    typeof event.stage !== "string" ||
    typeof event.message !== "string" ||
    typeof event.progress !== "number"
  ) {
    return null;
  }

  return {
    stage: event.stage as WorkflowStage,
    message: event.message,
    progress: event.progress,
  };
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
    error: {
      code,
      message,
      stage,
    },
  };
}
