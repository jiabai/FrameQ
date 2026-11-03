import { invoke } from "@tauri-apps/api/core";
import type { HistoryCommandRunner } from "./historyClient";
import { parseNoteMetadata, parseNoteMetadataProjection, type NoteMetadata, type NoteMetadataProjection } from "./noteMetadata";
import { isValidNoteTitleText, parseNoteTitleMetadata, type NoteTitleMetadata } from "./noteTitle";
import { IpcProtocolError, readIpcDataArray, readIpcDataObject } from "./tauriIpcProtocol";
import { parseTaskSourceSummary, type TaskArtifactKey, type TaskSourceSummary, type TranscriptMetadata, type WorkerResult } from "./workflow";
import { parseWebPageSource } from "./webPageProtocol";

const INVALID = "HISTORY_IPC_RESPONSE_INVALID";
const defaultRunner: HistoryCommandRunner = (command, args) => invoke(command, args);
const ARTIFACTS: readonly TaskArtifactKey[] = ["video", "audio", "transcript_txt", "transcript_md", "article_txt", "article_md", "summary", "mindmap", "insights", "insights_md", "dissection", "dissection_md", "draft"];
export type NoteMutation = { taskId: string; noteMetadata: NoteMetadata };
export type NoteInfo = NoteMetadataProjection & {
  taskId: string; source: TaskSourceSummary; createdAt: string; status: WorkerResult["status"];
  noteTitle: NoteTitleMetadata | null; transcript: TranscriptMetadata | null;
  artifactTypes: TaskArtifactKey[]; textPreview: string;
};

function requireTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9_-]{1,240}$/.test(taskId)) throw new Error("NOTE_REQUEST_INVALID");
}

export function parseNoteMutation(value: unknown, taskId: string): NoteMutation {
  const data = readIpcDataObject(value, ["task_id", "note_metadata"], [], INVALID);
  const noteMetadata = parseNoteMetadata(data.note_metadata);
  if (data.task_id !== taskId || !noteMetadata) throw new IpcProtocolError(INVALID);
  return { taskId, noteMetadata };
}

export async function setNotePinned(taskId: string, pinned: boolean, runner = defaultRunner): Promise<NoteMutation> {
  requireTaskId(taskId);
  return parseNoteMutation(await runner("set_note_pinned", { request: { task_id: taskId, pinned } }), taskId);
}

export async function renameNote(taskId: string, title: string, runner = defaultRunner): Promise<NoteMutation> {
  requireTaskId(taskId);
  const trimmed = title.trim();
  if (/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(title) || !isValidNoteTitleText(trimmed)) throw new Error("NOTE_TITLE_INVALID");
  return parseNoteMutation(await runner("rename_note", { request: { task_id: taskId, title: trimmed } }), taskId);
}

export function safeNoteSource(source: TaskSourceSummary): string | null {
  if (source.kind === "web_page") return parseWebPageSource(source)?.url ?? null;
  if (source.kind !== "url" || !URL.canParse(source.url)) return null;
  const url = new URL(source.url);
  if (source.url !== url.href || source.url.length > 2048 || /[%\p{Cc}\p{Cf}\p{Cs}]/u.test(source.url) || url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  const pairs = Array.from(url.searchParams);
  if (url.hostname === "www.youtube.com" && url.pathname === "/watch" && pairs.length === 1 && pairs[0][0] === "v" && /^[\w-]{11}$/.test(pairs[0][1])) return source.url;
  if (url.hostname === "www.bilibili.com" && /^\/video\/(?:BV[A-Za-z0-9]{10}|av\d{1,20})$/.test(url.pathname) &&
    (!url.search || (pairs.length === 1 && pairs[0][0] === "p" && /^[1-9]\d*$/.test(pairs[0][1]) && Number(pairs[0][1]) > 1 && Number(pairs[0][1]) <= 100000))) return source.url;
  if (url.hostname === "www.douyin.com" && /^\/video\/\d{15,24}$/.test(url.pathname) && !url.search) return source.url;
  if (url.hostname === "www.xiaohongshu.com" && /^\/explore\/[a-f0-9]{24}$/.test(url.pathname) && !url.search) return source.url;
  return null;
}

export function parseNoteInfo(value: unknown, taskId: string): NoteInfo {
  const data = readIpcDataObject(value, ["task_id", "source", "created_at", "status", "note_title", "note_metadata", "note_metadata_error", "transcript", "artifact_types", "text_preview"], [], INVALID);
  const sourceData = readIpcDataObject(data.source, ["kind"], ["url", "displayName", "mediaKind", "title", "extractedAt"], INVALID);
  const source = parseTaskSourceSummary(sourceData);
  if (data.task_id !== taskId || !source || typeof data.created_at !== "string" ||
    !["completed", "partial_completed", "failed"].includes(data.status as string) || typeof data.text_preview !== "string") throw new IpcProtocolError(INVALID);
  if (source.kind === "url" && !safeNoteSource(source)) throw new IpcProtocolError(INVALID);
  let transcript: TranscriptMetadata | null = null;
  if (data.transcript !== null) {
    const fields = readIpcDataObject(data.transcript, ["source", "language", "engine"], [], INVALID);
    if ((fields.source !== "asr" && fields.source !== "subtitle") ||
      (fields.language !== null && typeof fields.language !== "string") ||
      (fields.engine !== null && typeof fields.engine !== "string")) throw new IpcProtocolError(INVALID);
    transcript = fields as TranscriptMetadata;
  }
  const artifactTypes = readIpcDataArray(data.artifact_types, INVALID);
  if (artifactTypes.some((key) => !ARTIFACTS.includes(key as TaskArtifactKey)) || new Set(artifactTypes).size !== artifactTypes.length) throw new IpcProtocolError(INVALID);
  if (source.kind === "web_page" && (transcript !== null || data.note_title !== null ||
    !artifactTypes.includes("article_txt") || !artifactTypes.includes("article_md") ||
    artifactTypes.some((key) => ["video", "audio", "transcript_txt", "transcript_md"].includes(key as string)))) throw new IpcProtocolError(INVALID);
  return {
    taskId, source, createdAt: data.created_at, status: data.status as WorkerResult["status"],
    noteTitle: parseNoteTitleMetadata(data.note_title), ...parseNoteMetadataProjection(data), transcript,
    artifactTypes: artifactTypes as TaskArtifactKey[], textPreview: data.text_preview,
  };
}

export async function getNoteInfo(taskId: string, runner = defaultRunner): Promise<NoteInfo> {
  requireTaskId(taskId);
  return parseNoteInfo(await runner("get_note_info", { request: { task_id: taskId } }), taskId);
}

export async function openNoteSource(taskId: string, runner = defaultRunner): Promise<void> {
  requireTaskId(taskId);
  const data = readIpcDataObject(await runner("open_note_source", { request: { task_id: taskId } }), ["task_id", "opened"], [], INVALID);
  if (data.task_id !== taskId || data.opened !== true) throw new IpcProtocolError(INVALID);
}
