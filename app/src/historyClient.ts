import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { parseNoteTitleMetadata, type NoteTitleMetadata } from "./noteTitle";
import { parseNoteMetadataProjection, type NoteMetadataProjection } from "./noteMetadata";
import type { Insight } from "./insightPreferences";
import {
  IpcProtocolError,
  readIpcDataArray,
  readIpcDataObject,
} from "./tauriIpcProtocol";
import type {
  TaskArtifacts,
  TaskArtifactKey,
  TranscriptMetadata,
  TaskSourceSummary,
  WorkerErrorResult,
  WorkerResult,
  WorkflowStage,
} from "./workflow";
import { parseTaskSourceSummary } from "./workflow";
import {
  TASK_ARTIFACT_KEYS,
  TASK_INSIGHT_FIELDS,
  TASK_ERROR_STAGES,
  parseDissection,
} from "./workerResultProtocol";

export type HistoryErrorResponse = {
  code: string;
  message: string;
  stage: WorkflowStage;
};

export type HistoryItemResponse = Partial<NoteMetadataProjection> & {
  note_title?: NoteTitleMetadata | null;
  task_id: string;
  id: string;
  created_at: string;
  source: TaskSourceSummary;
  status: WorkerResult["status"];
  task_dir: string;
  output_dir: string;
  artifacts: TaskArtifacts;
  error: { code: string } | null;
  text_preview: string;
  insights_count: number;
};

export type HistoryDetailResponse = Partial<NoteMetadataProjection> & {
  note_title?: NoteTitleMetadata | null;
  task_id: string;
  source: TaskSourceSummary;
  status: WorkerResult["status"];
  task_dir: string;
  artifacts: TaskArtifacts;
  error: HistoryErrorResponse | null;
  text: string;
  markdown?: string;
  summary: string;
  transcript: TranscriptMetadata | null;
  insights: Insight[];
  dissection: WorkerResult["dissection"];
  dissection_source_status: "current" | "stale" | null;
};

export type HistoryListItem = Partial<NoteMetadataProjection> & {
  noteTitle?: NoteTitleMetadata | null;
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
  status: "completed" | "cleanup_pending";
  error_code: string | null;
};

export type HistoryDeleteResult = {
  taskId: string;
  status: "completed" | "cleanup_pending";
  errorCode: string | null;
};

export type HistoryCleanupResult = {
  taskId: string | null; status: "idle" | "completed" | "cleanup_pending"; errorCode: string | null;
};

export type HistoryItem = Partial<NoteMetadataProjection> & {
  markdown?: string;
  noteTitle?: NoteTitleMetadata | null;
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
  dissection: WorkerResult["dissection"];
  dissectionStale: boolean;
};

export type HistoryCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;

const defaultHistoryRunner: HistoryCommandRunner = (command, args) => invoke(command, args);
const HISTORY_IPC_RESPONSE_INVALID = "HISTORY_IPC_RESPONSE_INVALID" as const;
const HISTORY_STATUSES = [
  "completed",
  "partial_completed",
  "failed",
] as const;
const TRANSCRIPT_SOURCES = ["asr", "subtitle"] as const;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export async function getHistory(
  runner: HistoryCommandRunner = defaultHistoryRunner,
): Promise<HistoryListItem[]> {
  const response = parseHistoryListResponse(
    await runner("get_history", {}),
  );
  return response.map(mapHistoryItemResponse);
}

export async function getHistoryDetail(
  taskId: string,
  runner: HistoryCommandRunner = defaultHistoryRunner,
): Promise<HistoryItem> {
  const response = parseHistoryDetailResponse(
    await runner("get_history_detail", {
      request: { task_id: taskId },
    }),
    taskId,
  );
  return mapHistoryDetailResponse(response);
}

export async function deleteHistoryTask(
  taskId: string,
  runner: HistoryCommandRunner = defaultHistoryRunner,
): Promise<HistoryDeleteResult> {
  const response = parseHistoryDeleteResponse(
    await runner("delete_history_task", {
      request: { task_id: taskId },
    }),
    taskId,
  );
  return { taskId: response.task_id, status: response.status, errorCode: response.error_code };
}

export async function resumeNoteDeletionCleanup(runner: HistoryCommandRunner = defaultHistoryRunner): Promise<HistoryCleanupResult> {
  return parseHistoryCleanupResponse(await runner("resume_note_deletion_cleanup", {}));
}

export function parseHistoryCleanupResponse(value: unknown): HistoryCleanupResult {
  const data = readIpcDataObject(value, ["task_id", "status", "error_code"], [], HISTORY_IPC_RESPONSE_INVALID);
  if (data.status === "idle" && data.task_id === null && data.error_code === null) return { taskId: null, status: "idle", errorCode: null };
  if (typeof data.task_id !== "string") throwInvalidHistoryResponse();
  const result = parseHistoryDeleteResponse(data, data.task_id);
  return { taskId: result.task_id, status: result.status, errorCode: result.error_code };
}

export function parseHistoryListResponse(value: unknown): HistoryItemResponse[] {
  return readIpcDataArray(value, HISTORY_IPC_RESPONSE_INVALID).map(
    parseHistoryListItemResponse,
  );
}

function parseHistoryListItemResponse(value: unknown): HistoryItemResponse {
  const response = readIpcDataObject(
    value,
    [
      "task_id",
      "id",
      "created_at",
      "source",
      "status",
      "task_dir",
      "output_dir",
      "artifacts",
      "error",
      "text_preview",
      "insights_count",
    ],
    ["note_title", "note_metadata", "note_metadata_error"],
    HISTORY_IPC_RESPONSE_INVALID,
  );
  const status = parseHistoryStatus(response.status);
  const error = parseHistoryListError(response.error);
  const source = parseHistorySource(response.source);
  if (
    typeof response.task_id !== "string" ||
    response.id !== response.task_id ||
    typeof response.created_at !== "string" ||
    typeof response.task_dir !== "string" ||
    typeof response.output_dir !== "string" ||
    typeof response.text_preview !== "string" ||
    !isSafeUnsignedInteger(response.insights_count) ||
    !isCoherentHistoryError(status, error)
  ) {
    throwInvalidHistoryResponse();
  }
  return {
    task_id: response.task_id,
    id: response.id,
    created_at: response.created_at,
    source,
    status,
    task_dir: response.task_dir,
    output_dir: response.output_dir,
    artifacts: parseSourceArtifacts(response.artifacts, source),
    error,
    text_preview: response.text_preview,
    insights_count: response.insights_count,
    note_title: Object.prototype.hasOwnProperty.call(response, "note_title") ? parseNoteTitleMetadata(response.note_title) : null,
    ...parseNoteMetadataProjection(response),
  };
}

export function parseHistoryDetailResponse(
  value: unknown,
  expectedTaskId: string,
): HistoryDetailResponse {
  const response = readIpcDataObject(
    value,
    [
      "task_id",
      "source",
      "status",
      "task_dir",
      "artifacts",
      "error",
      "text",
      "summary",
      "transcript",
      "insights",
      "dissection",
      "dissection_source_status",
    ],
    ["note_title", "note_metadata", "note_metadata_error", "markdown"],
    HISTORY_IPC_RESPONSE_INVALID,
  );
  const status = parseHistoryStatus(response.status);
  const error = parseHistoryDetailError(response.error);
  const dissection = parseDissection(response.dissection);
  const source = parseHistorySource(response.source);
  if (
    response.task_id !== expectedTaskId ||
    typeof response.task_dir !== "string" ||
    typeof response.text !== "string" ||
    typeof response.summary !== "string" ||
    (response.markdown !== undefined && typeof response.markdown !== "string") ||
    (source.kind === "web_page" && (typeof response.markdown !== "string" || response.transcript !== null || dissection?.schemaVersion === 1)) ||
    (source.kind !== "web_page" && dissection?.schemaVersion === 2) ||
    !isCoherentHistoryError(status, error)
    || dissection === undefined
    || (response.dissection_source_status !== null
      && response.dissection_source_status !== "current"
      && response.dissection_source_status !== "stale")
    || (dissection === null) !== (response.dissection_source_status === null)
  ) {
    throwInvalidHistoryResponse();
  }
  return {
    task_id: expectedTaskId,
    source,
    status,
    task_dir: response.task_dir,
    artifacts: parseSourceArtifacts(response.artifacts, source),
    error,
    text: response.text,
    ...(source.kind === "web_page" ? { markdown: response.markdown as string } : {}),
    summary: response.summary,
    transcript: parseHistoryTranscript(response.transcript),
    insights: parseHistoryInsights(response.insights),
    dissection,
    dissection_source_status: response.dissection_source_status,
    note_title: Object.prototype.hasOwnProperty.call(response, "note_title") ? parseNoteTitleMetadata(response.note_title) : null,
    ...parseNoteMetadataProjection(response),
  };
}

export function parseHistoryDeleteResponse(
  value: unknown,
  expectedTaskId: string,
): HistoryDeleteResponse {
  const response = readIpcDataObject(
    value,
    ["task_id", "status", "error_code"],
    [],
    HISTORY_IPC_RESPONSE_INVALID,
  );
  if (response.task_id !== expectedTaskId || !/^[A-Za-z0-9_-]{1,240}$/.test(expectedTaskId) ||
    (response.status !== "completed" && response.status !== "cleanup_pending") ||
    (response.status === "completed" ? response.error_code !== null :
      typeof response.error_code !== "string" || !SAFE_ERROR_CODE.test(response.error_code))) {
    throwInvalidHistoryResponse();
  }
  return { task_id: expectedTaskId, status: response.status, error_code: response.error_code as string | null };
}

function parseHistorySource(value: unknown): TaskSourceSummary {
  const source = readIpcDataObject(
    value,
    ["kind"],
    ["url", "displayName", "mediaKind", "title", "extractedAt"],
    HISTORY_IPC_RESPONSE_INVALID,
  );
  const parsed = parseTaskSourceSummary(source);
  if (!parsed) {
    throwInvalidHistoryResponse();
  }
  return parsed;
}

function parseHistoryArtifacts(value: unknown): TaskArtifacts {
  const response = readIpcDataObject(
    value,
    [],
    TASK_ARTIFACT_KEYS,
    HISTORY_IPC_RESPONSE_INVALID,
  );
  const artifacts: TaskArtifacts = {};
  for (const [key, artifact] of Object.entries(response)) {
    if (
      !isOneOf(key, TASK_ARTIFACT_KEYS) ||
      typeof artifact !== "string"
    ) {
      throwInvalidHistoryResponse();
    }
    artifacts[key as TaskArtifactKey] = artifact;
  }
  return artifacts;
}

function parseSourceArtifacts(value: unknown, source: TaskSourceSummary): TaskArtifacts {
  const artifacts = parseHistoryArtifacts(value);
  if (source.kind === "web_page") {
    if (artifacts.article_txt !== "article/article.txt" || artifacts.article_md !== "article/article.md" ||
      ["video", "audio", "transcript_txt", "transcript_md", "segments"].some((key) => key in artifacts)) throwInvalidHistoryResponse();
  } else if (artifacts.article_txt !== undefined || artifacts.article_md !== undefined) throwInvalidHistoryResponse();
  return artifacts;
}

function parseHistoryListError(
  value: unknown,
): HistoryItemResponse["error"] {
  if (value === null) {
    return null;
  }
  const response = readIpcDataObject(
    value,
    ["code"],
    [],
    HISTORY_IPC_RESPONSE_INVALID,
  );
  if (
    typeof response.code !== "string" ||
    !SAFE_ERROR_CODE.test(response.code)
  ) {
    throwInvalidHistoryResponse();
  }
  return { code: response.code };
}

function parseHistoryDetailError(
  value: unknown,
): HistoryErrorResponse | null {
  if (value === null) {
    return null;
  }
  const response = readIpcDataObject(
    value,
    ["code", "message", "stage"],
    [],
    HISTORY_IPC_RESPONSE_INVALID,
  );
  if (
    typeof response.code !== "string" ||
    !SAFE_ERROR_CODE.test(response.code) ||
    typeof response.message !== "string" ||
    !isOneOf(response.stage, TASK_ERROR_STAGES)
  ) {
    throwInvalidHistoryResponse();
  }
  return {
    code: response.code,
    message: response.message,
    stage: response.stage,
  };
}

function parseHistoryTranscript(value: unknown): TranscriptMetadata | null {
  if (value === null) {
    return null;
  }
  const response = readIpcDataObject(
    value,
    ["source", "language", "engine"],
    [],
    HISTORY_IPC_RESPONSE_INVALID,
  );
  if (
    !isOneOf(response.source, TRANSCRIPT_SOURCES) ||
    !isNullableString(response.language) ||
    !isNullableString(response.engine)
  ) {
    throwInvalidHistoryResponse();
  }
  return {
    source: response.source,
    language: response.language,
    engine: response.engine,
  };
}

function parseHistoryInsights(value: unknown): Insight[] {
  return readIpcDataArray(value, HISTORY_IPC_RESPONSE_INVALID).map(
    (item): Insight => {
      const response = readIpcDataObject(
        item,
        TASK_INSIGHT_FIELDS,
        [],
        HISTORY_IPC_RESPONSE_INVALID,
      );
      const followUpQuestions = readIpcDataArray(
        response.followUpQuestions,
        HISTORY_IPC_RESPONSE_INVALID,
      );
      if (
        !isSafeUnsignedInteger(response.id) ||
        typeof response.topic !== "string" ||
        typeof response.matchReason !== "string" ||
        !followUpQuestions.every(
          (question) => typeof question === "string",
        ) ||
        typeof response.suitableUse !== "string" ||
        !isNullableSafeUnsignedInteger(response.sourceChunkId)
      ) {
        throwInvalidHistoryResponse();
      }
      return {
        id: response.id,
        topic: response.topic,
        matchReason: response.matchReason,
        followUpQuestions,
        suitableUse: response.suitableUse,
        sourceChunkId: response.sourceChunkId,
      };
    },
  );
}

function parseHistoryStatus(value: unknown): WorkerResult["status"] {
  if (!isOneOf(value, HISTORY_STATUSES)) {
    throwInvalidHistoryResponse();
  }
  return value;
}

function isCoherentHistoryError(
  status: WorkerResult["status"],
  error: { code: string } | null,
): boolean {
  return status === "completed" ? error === null : error !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSafeUnsignedInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isNullableSafeUnsignedInteger(
  value: unknown,
): value is number | null {
  return value === null || isSafeUnsignedInteger(value);
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return (
    typeof value === "string" &&
    values.includes(value as Values[number])
  );
}

function throwInvalidHistoryResponse(): never {
  throw new IpcProtocolError(HISTORY_IPC_RESPONSE_INVALID);
}

export function historyItemToWorkerResult(item: HistoryItem): WorkerResult {
  return {
    status: item.status,
    task_id: item.taskId,
    task_dir: item.taskDir,
    artifacts: item.artifacts,
    text: item.text,
    ...(item.source.kind === "web_page" ? { markdown: item.markdown ?? "", source: item.source } : {}),
    summary: item.summary,
    insights: item.insights,
    transcript: item.transcript,
    dissection: item.dissection,
    dissection_source_status: item.dissectionStale ? "stale" : null,
    // History restoration does not currently surface the draft text body; the
    // on-disk ai/draft.md artifact is reflected via item.artifacts.draft. Full
    // draft-body restoration from history is a follow-up (Task 6/7).
    draft: "",
    error: item.error,
    note_title: item.noteTitle ?? null,
    task_created: false,
  };
}

function mapHistoryItemResponse(response: HistoryItemResponse): HistoryListItem {
  return {
    taskId: response.task_id,
    id: response.id,
    createdAt: response.created_at,
    source: response.source,
    status: response.status,
    taskDir: response.task_dir,
    outputDir: response.output_dir,
    artifacts: response.artifacts,
    error: response.error ? { code: response.error.code } : null,
    textPreview: response.text_preview,
    insightsCount: response.insights_count,
    noteTitle: response.note_title ?? null,
    noteMetadata: response.noteMetadata ?? null,
    noteMetadataError: response.noteMetadataError ?? null,
  };
}

function mapHistoryDetailResponse(response: HistoryDetailResponse): HistoryItem {
  return {
    taskId: response.task_id,
    source: response.source,
    status: response.status,
    taskDir: response.task_dir,
    artifacts: response.artifacts,
    error: response.error,
    text: response.text,
    ...(response.source.kind === "web_page" ? { markdown: response.markdown ?? "" } : {}),
    summary: response.summary,
    transcript: response.transcript,
    insights: response.insights,
    dissection: response.dissection,
    dissectionStale: response.dissection_source_status === "stale",
    noteTitle: response.note_title ?? null,
    noteMetadata: response.noteMetadata ?? null,
    noteMetadataError: response.noteMetadataError ?? null,
  };
}
