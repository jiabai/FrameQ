import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Event } from "@tauri-apps/api/event";
import type { WorkerProgressEvent, WorkerResult, WorkflowStage } from "./workflow";

export type WorkerCommandRunner = (command: string, args: InvokeArgs) => Promise<WorkerResult>;
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

const defaultRunner: WorkerCommandRunner = (command, args) => invoke(command, args);

export async function processVideo(
  url: string,
  runner: WorkerCommandRunner = defaultRunner,
  onProgress?: WorkerProgressHandler,
  progressListener: WorkerProgressListener = listen,
): Promise<WorkerResult> {
  const request: ProcessVideoRequest = {
    url,
    language: "Chinese",
    output_formats: ["txt", "md"],
    model: "Qwen/Qwen3-ASR-0.6B",
    generate_insights: true,
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
    text: "",
    insights: [],
    transcript_path: null,
    insights_path: null,
    error: {
      code,
      message,
      stage,
    },
  };
}
