import { isSupportedLocale, type SupportedLocale } from "./i18n/locale";
import { IpcProtocolError, readIpcDataObject } from "./tauriIpcProtocol";

export type NoteTitleMetadata = {
  text: string | null;
  status: "generating" | "completed" | "failed" | "cancelled";
  output_language: SupportedLocale;
  error_code: string | null;
};

export type NoteTitleCancellationInput = {
  taskId: string;
  outputLanguage: SupportedLocale;
  expectedNoteTitle: NoteTitleMetadata | null;
};

export type NoteTitleCancellationRequest = {
  task_id: string;
  output_language: SupportedLocale;
  expected_note_title: NoteTitleMetadata | null;
};

export function parseNoteTitleCancellationRequest(value: unknown):
  | { kind: "valid"; request: NoteTitleCancellationRequest }
  | { kind: "invalid"; taskId: string | null } {
  let taskId: string | null = null;
  try {
    const fields = readIpcDataObject(
      value, ["taskId", "outputLanguage", "expectedNoteTitle"], [], "HISTORY_IPC_RESPONSE_INVALID",
    );
    if (typeof fields.taskId === "string" && /^[0-9A-Za-z_-]+$/.test(fields.taskId)) taskId = fields.taskId;
    if (!taskId || !isSupportedLocale(fields.outputLanguage)) return { kind: "invalid", taskId };
    return { kind: "valid", request: {
      task_id: taskId,
      output_language: fields.outputLanguage,
      expected_note_title: parseNoteTitleMetadata(fields.expectedNoteTitle),
    } };
  } catch {
    return { kind: "invalid", taskId };
  }
}

const INVALID_TITLE_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export function isValidNoteTitleText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    Array.from(value).length <= 60 && !INVALID_TITLE_TEXT.test(value);
}

export function parseNoteTitleMetadata(value: unknown): NoteTitleMetadata | null {
  if (value === null) return null;
  const fields = readIpcDataObject(
    value, ["text", "status", "output_language", "error_code"], [], "HISTORY_IPC_RESPONSE_INVALID",
  );
  const status = fields.status;
  if (
    (fields.text !== null && !isValidNoteTitleText(fields.text)) ||
    !isSupportedLocale(fields.output_language) ||
    (status !== "generating" && status !== "completed" && status !== "failed" && status !== "cancelled") ||
    ((status === "generating" || status === "completed") && fields.error_code !== null) ||
    (status === "completed" && fields.text === null) ||
    ((status === "failed" || status === "cancelled") &&
      (typeof fields.error_code !== "string" || !SAFE_ERROR_CODE.test(fields.error_code)))
  ) throw new IpcProtocolError("HISTORY_IPC_RESPONSE_INVALID");
  return {
    text: fields.text as string | null,
    status,
    output_language: fields.output_language,
    error_code: fields.error_code as string | null,
  };
}
