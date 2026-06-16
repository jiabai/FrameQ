import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type { WorkerResult, WorkflowStage } from "./workflow";

export type WorkerCommandRunner = (command: string, args: InvokeArgs) => Promise<WorkerResult>;

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
): Promise<WorkerResult> {
  const request: ProcessVideoRequest = {
    url,
    language: "Chinese",
    output_formats: ["txt", "md"],
    model: "Qwen/Qwen3-ASR-0.6B",
    generate_insights: true,
    insightflow_mode: "embedded",
  };

  try {
    return await runner("process_video", { request });
  } catch (error) {
    return failedResult(
      "TAURI_COMMAND_FAILED",
      error instanceof Error ? error.message : String(error),
      "video_extracting",
    );
  }
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
