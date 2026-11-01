import { describe, expect, test } from "vitest";

import { parseNoteInfo, parseNoteMutation, renameNote, safeNoteSource } from "./noteActionsClient";
import { IpcProtocolError } from "./tauriIpcProtocol";

const invalid = new IpcProtocolError("HISTORY_IPC_RESPONSE_INVALID");
const info = {
  task_id: "note-1", source: { kind: "url", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  created_at: "2026-10-31T10:00:00Z", status: "completed", note_title: null,
  note_metadata: { pinned: true, display_title: "Current manual title" }, note_metadata_error: null,
  transcript: { source: "asr", language: "zh", engine: "sensevoice_small" },
  artifact_types: ["audio", "transcript_txt", "summary"], text_preview: "Saved transcript",
};

describe("note mutation response protocol", () => {
  test("binds committed settings to the requested task", () => {
    expect(parseNoteMutation({ task_id: "note-1", note_metadata: info.note_metadata }, "note-1"))
      .toEqual({ taskId: "note-1", noteMetadata: { pinned: true, displayTitle: "Current manual title" } });
  });

  test.each([
    null, {}, { task_id: "different-task", note_metadata: info.note_metadata },
    { task_id: "note-1", note_metadata: null },
    { task_id: "note-1", note_metadata: info.note_metadata, path: "internal-file" },
    { task_id: "note-1", note_metadata: { pinned: "true", display_title: null } },
  ])("rejects stale or malformed committed settings %#", (value) => {
    expect(() => parseNoteMutation(value, "note-1")).toThrowError(invalid);
  });
});

describe("note information response protocol", () => {
  test("projects verified native fields without paths or invented statistics", () => {
    expect(parseNoteInfo(info, "note-1")).toEqual({
      taskId: "note-1", source: info.source, createdAt: info.created_at, status: "completed", noteTitle: null,
      noteMetadata: { pinned: true, displayTitle: "Current manual title" }, noteMetadataError: null,
      transcript: info.transcript, artifactTypes: info.artifact_types, textPreview: "Saved transcript",
    });
  });

  test("supports local notes and unknown transcript fields without manufacturing a URL", () => {
    const local = { kind: "local_file" as const, displayName: "Interview.wav", mediaKind: "audio" as const };
    const parsed = parseNoteInfo({ ...info, source: local, transcript: null, artifact_types: [] }, "note-1");
    expect(parsed.source).toEqual(local);
    expect(parsed.transcript).toBeNull();
    expect(parsed.artifactTypes).toEqual([]);
    expect(safeNoteSource(parsed.source)).toBeNull();
  });

  test("preserves generated title state and separate settings failures", () => {
    const note_title = { text: "Last generated title", status: "cancelled", output_language: "en-US", error_code: "WORKER_CANCELLED" };
    expect(parseNoteInfo({ ...info, status: "partial_completed", note_title,
      note_metadata: null, note_metadata_error: "NOTE_METADATA_READ_FAILED" }, "note-1"))
      .toMatchObject({ noteTitle: note_title, noteMetadata: null, noteMetadataError: "NOTE_METADATA_READ_FAILED" });
  });

  test.each([
    null, {}, { ...info, task_id: "different-task" }, { ...info, created_at: 1 },
    { ...info, status: "title_generating" }, { ...info, text_preview: null },
    { ...info, task_dir: "private-path" }, { ...info, duration: 123 },
    { ...info, source: { ...info.source, path: "private-path" } },
    { ...info, source: { kind: "local_file", displayName: "C:/private.wav", mediaKind: "audio" } },
    { ...info, transcript: { ...info.transcript, duration: 123 } },
    { ...info, transcript: { source: "generated", language: null, engine: null } },
    { ...info, transcript: { source: "asr", language: 1, engine: null } },
    { ...info, transcript: { source: "asr", language: null } },
    { ...info, note_title: { text: "Invalid incomplete title" } },
    { ...info, note_metadata: null },
    { ...info, artifact_types: ["segments"] }, { ...info, artifact_types: ["preference_snapshot"] },
    { ...info, artifact_types: ["frameq-note-metadata.json"] },
    { ...info, artifact_types: ["audio", "audio"] }, { ...info, artifact_types: [1] },
  ])("rejects malformed information %#", (value) => {
    expect(() => parseNoteInfo(value, "note-1")).toThrowError(invalid);
  });

  test("rejects every missing required field", () => {
    for (const key of Object.keys(info)) {
      const incomplete: Record<string, unknown> = { ...info };
      delete incomplete[key];
      expect(() => parseNoteInfo(incomplete, "note-1")).toThrowError(invalid);
    }
  });

  test("does not evaluate information field accessors", () => {
    let reads = 0;
    const value = Object.defineProperty({ ...info }, "source", {
      enumerable: true,
      get() { reads += 1; return info.source; },
    });
    expect(() => parseNoteInfo(value, "note-1")).toThrowError(invalid);
    expect(reads).toBe(0);
  });
});

describe("canonical note source validation", () => {
  test.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.bilibili.com/video/BV1234567890",
    "https://www.bilibili.com/video/BV1234567890?p=3",
    "https://www.bilibili.com/video/av123456?p=100000",
    "https://www.douyin.com/video/7645505408425004329",
    "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456",
  ])("preserves verified canonical identity parameters: %s", (url) => {
    const source = { kind: "url" as const, url };
    expect(safeNoteSource(source)).toBe(url);
    expect(parseNoteInfo({ ...info, source }, "note-1").source).toEqual(source);
  });

  test.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    " https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:443/watch?v=dQw4w9WgXcQ",
    "https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/unused/../watch?v=dQw4w9WgXcQ",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://user:password@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ#fragment",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=private",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgX%51",
    "https://www.bilibili.com/video/BV1234567890?p=1",
    "https://www.bilibili.com/video/BV1234567890?p=100001",
    "https://www.bilibili.com/video/BV1234567890?p=03",
    "https://www.bilibili.com/video/BV1234567890?p=3&token=private",
    "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?xsec_token=private",
    "https://www.xiaohongshu.com/explore/64A1B2C3D4E5F67890123456",
    "https://www.douyin.com/video/123",
    "file:///C:/private.wav",
    "javascript:alert(1)",
  ])("rejects noncanonical or sensitive source data: %s", (url) => {
    const source = { kind: "url" as const, url };
    expect(safeNoteSource(source)).toBeNull();
    expect(() => parseNoteInfo({ ...info, source }, "note-1")).toThrowError(invalid);
  });

  test.each(["\nValid title", "Valid title\r", "\tValid title", "x\u200by", "\ud800", "x\u2028y", "x\u2029y"])
    ("rejects invalid rename input before native admission %#", async (title) => {
      await expect(renameNote("note-1", title)).rejects.toThrow("NOTE_TITLE_INVALID");
    });
});
