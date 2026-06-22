import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type { WorkerErrorResult, WorkerResult, WorkflowStage } from "./workflow";

export type HistoryErrorResponse = {
  code: string;
  message: string;
  stage: WorkflowStage;
};

export type HistoryItemResponse = {
  id: string;
  created_at: string;
  url: string;
  status: WorkerResult["status"];
  output_dir: string;
  video_path: string | null;
  audio_path: string | null;
  transcript_path: string | null;
  insights_path: string | null;
  error: HistoryErrorResponse | null;
  text_preview: string;
  insights_count: number;
  text: string;
  insights: string[];
};

export type HistoryItem = {
  id: string;
  createdAt: string;
  url: string;
  status: WorkerResult["status"];
  outputDir: string;
  videoPath: string | null;
  audioPath: string | null;
  transcriptPath: string | null;
  insightsPath: string | null;
  error: WorkerErrorResult | null;
  textPreview: string;
  insightsCount: number;
  text: string;
  insights: string[];
};

export type HistoryCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<HistoryItemResponse[]>;

const defaultHistoryRunner: HistoryCommandRunner = (command, args) => invoke(command, args);

export async function getHistory(
  runner: HistoryCommandRunner = defaultHistoryRunner,
): Promise<HistoryItem[]> {
  const response = await runner("get_history", {});
  return response.map(mapHistoryItemResponse);
}

export function historyItemToWorkerResult(item: HistoryItem): WorkerResult {
  return {
    status: item.status,
    video_path: item.videoPath,
    audio_path: item.audioPath,
    text: item.text,
    insights: item.insights,
    transcript_path: item.transcriptPath,
    insights_path: item.insightsPath,
    error: item.error,
  };
}

function mapHistoryItemResponse(response: HistoryItemResponse): HistoryItem {
  return {
    id: response.id,
    createdAt: response.created_at,
    url: response.url,
    status: response.status,
    outputDir: response.output_dir,
    videoPath: response.video_path,
    audioPath: response.audio_path,
    transcriptPath: response.transcript_path,
    insightsPath: response.insights_path,
    error: response.error,
    textPreview: response.text_preview,
    insightsCount: response.insights_count,
    text: response.text,
    insights: response.insights,
  };
}
