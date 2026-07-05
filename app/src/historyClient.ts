import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type { TaskArtifacts, WorkerErrorResult, WorkerResult, WorkflowStage } from "./workflow";

export type HistoryErrorResponse = {
  code: string;
  message: string;
  stage: WorkflowStage;
};

export type HistoryItemResponse = {
  task_id: string;
  id: string;
  created_at: string;
  url: string;
  source_url?: string;
  status: WorkerResult["status"];
  task_dir: string;
  output_dir: string;
  artifacts: TaskArtifacts;
  error: HistoryErrorResponse | null;
  text_preview: string;
  insights_count: number;
  text: string;
  summary?: string;
  insights: string[];
};

export type HistoryItem = {
  taskId: string;
  id: string;
  createdAt: string;
  url: string;
  status: WorkerResult["status"];
  taskDir: string;
  outputDir: string;
  artifacts: TaskArtifacts;
  error: WorkerErrorResult | null;
  textPreview: string;
  insightsCount: number;
  text: string;
  summary: string;
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
    task_id: item.taskId,
    task_dir: item.taskDir,
    artifacts: item.artifacts,
    text: item.text,
    summary: item.summary,
    insights: item.insights,
    error: item.error,
  };
}

function mapHistoryItemResponse(response: HistoryItemResponse): HistoryItem {
  return {
    taskId: response.task_id,
    id: response.id,
    createdAt: response.created_at,
    url: response.url,
    status: response.status,
    taskDir: response.task_dir,
    outputDir: response.output_dir,
    artifacts: response.artifacts ?? {},
    error: response.error,
    textPreview: response.text_preview,
    insightsCount: response.insights_count,
    text: response.text,
    summary: response.summary ?? "",
    insights: response.insights,
  };
}
