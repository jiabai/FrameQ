import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type {
  Insight,
  TaskArtifacts,
  TranscriptMetadata,
  TaskSourceSummary,
  WorkerErrorResult,
  WorkerResult,
  WorkflowStage,
} from "./workflow";
import { parseTaskSourceSummary } from "./workflow";

export type HistoryErrorResponse = {
  code: string;
  message?: string;
  stage?: WorkflowStage;
};

export type HistoryItemResponse = {
  task_id: string;
  id: string;
  created_at: string;
  source: unknown;
  status: WorkerResult["status"];
  task_dir: string;
  output_dir: string;
  artifacts: TaskArtifacts;
  error: HistoryErrorResponse | null;
  text_preview: string;
  insights_count: number;
};

export type HistoryDetailResponse = {
  task_id: string;
  source: unknown;
  status: WorkerResult["status"];
  task_dir: string;
  artifacts: TaskArtifacts;
  error: HistoryErrorResponse | null;
  text: string;
  summary?: string;
  transcript?: TranscriptMetadata | null;
  insights: Insight[];
};

export type HistoryListItem = {
  taskId: string;
  id: string;
  createdAt: string;
  source: TaskSourceSummary;
  status: WorkerResult["status"];
  taskDir: string;
  outputDir: string;
  artifacts: TaskArtifacts;
  error: { code: string } | null;
  textPreview: string;
  insightsCount: number;
};

type HistoryDeleteResponse = {
  task_id: string;
  deleted: boolean;
};

export type HistoryDeleteResult = {
  taskId: string;
  deleted: true;
};

export type HistoryItem = {
  taskId: string;
  source: TaskSourceSummary;
  status: WorkerResult["status"];
  taskDir: string;
  artifacts: TaskArtifacts;
  error: WorkerErrorResult | null;
  text: string;
  summary: string;
  transcript: TranscriptMetadata | null;
  insights: Insight[];
};

export type HistoryCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;

const defaultHistoryRunner: HistoryCommandRunner = (command, args) => invoke(command, args);

export async function getHistory(
  runner: HistoryCommandRunner = defaultHistoryRunner,
): Promise<HistoryListItem[]> {
  const response = (await runner("get_history", {})) as HistoryItemResponse[];
  return response.map(mapHistoryItemResponse);
}

export async function getHistoryDetail(
  taskId: string,
  runner: HistoryCommandRunner = defaultHistoryRunner,
): Promise<HistoryItem> {
  const response = (await runner("get_history_detail", {
    request: { task_id: taskId },
  })) as HistoryDetailResponse;
  return mapHistoryDetailResponse(response);
}

export async function deleteHistoryTask(
  taskId: string,
  runner: HistoryCommandRunner = defaultHistoryRunner,
): Promise<HistoryDeleteResult> {
  const response = (await runner("delete_history_task", {
    request: { task_id: taskId },
  })) as HistoryDeleteResponse;
  if (response.task_id !== taskId || response.deleted !== true) {
    throw new Error("HISTORY_DELETE_FAILED");
  }
  return { taskId: response.task_id, deleted: true };
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
    transcript: item.transcript,
    error: item.error,
  };
}

function mapHistoryItemResponse(response: HistoryItemResponse): HistoryListItem {
  const source = requireTaskSource(response.source);
  return {
    taskId: response.task_id,
    id: response.id,
    createdAt: response.created_at,
    source,
    status: response.status,
    taskDir: response.task_dir,
    outputDir: response.output_dir,
    artifacts: response.artifacts ?? {},
    error: response.error ? { code: response.error.code } : null,
    textPreview: response.text_preview,
    insightsCount: response.insights_count,
  };
}

function mapHistoryDetailResponse(response: HistoryDetailResponse): HistoryItem {
  const source = requireTaskSource(response.source);
  const error = response.error
    ? {
        code: response.error.code,
        message: response.error.message ?? "",
        stage: response.error.stage ?? "waiting_input",
      }
    : null;
  return {
    taskId: response.task_id,
    source,
    status: response.status,
    taskDir: response.task_dir,
    artifacts: response.artifacts ?? {},
    error,
    text: response.text,
    summary: response.summary ?? "",
    transcript: response.transcript ?? null,
    insights: response.insights,
  };
}

function requireTaskSource(value: unknown): TaskSourceSummary {
  const source = parseTaskSourceSummary(value);
  if (!source) {
    throw new Error("HISTORY_SOURCE_INVALID");
  }
  return source;
}
