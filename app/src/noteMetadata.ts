import { isValidNoteTitleText } from "./noteTitle";
import { IpcProtocolError, readIpcDataObject } from "./tauriIpcProtocol";

export type NoteMetadata = { pinned: boolean; displayTitle: string | null };
export type NoteMetadataProjection = {
  noteMetadata: NoteMetadata | null;
  noteMetadataError: string | null;
};

export function parseNoteMetadata(value: unknown): NoteMetadata | null {
  if (value === null) return null;
  const data = readIpcDataObject(value, ["pinned", "display_title"], [], "HISTORY_IPC_RESPONSE_INVALID");
  if (typeof data.pinned !== "boolean" || (data.display_title !== null && !isValidNoteTitleText(data.display_title))) {
    throw new IpcProtocolError("HISTORY_IPC_RESPONSE_INVALID");
  }
  return { pinned: data.pinned, displayTitle: data.display_title as string | null };
}

export function parseNoteMetadataProjection(data: Record<string, unknown>): NoteMetadataProjection {
  const present = Object.prototype.hasOwnProperty.call(data, "note_metadata");
  if (present !== Object.prototype.hasOwnProperty.call(data, "note_metadata_error")) throw new IpcProtocolError("HISTORY_IPC_RESPONSE_INVALID");
  if (!present) return { noteMetadata: null, noteMetadataError: null };
  const noteMetadata = parseNoteMetadata(data.note_metadata);
  const error = data.note_metadata_error;
  if ((error !== null && (typeof error !== "string" || !/^NOTE_[A-Z0-9_]{1,59}$/.test(error))) ||
    (noteMetadata === null) !== (error !== null)) throw new IpcProtocolError("HISTORY_IPC_RESPONSE_INVALID");
  return { noteMetadata, noteMetadataError: error as string | null };
}
