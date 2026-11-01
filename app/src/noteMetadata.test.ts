import { describe, expect, test } from "vitest";

import { parseHistoryDetailResponse, parseHistoryListResponse } from "./historyClient";
import { parseNoteMetadata, parseNoteMetadataProjection } from "./noteMetadata";
import { IpcProtocolError } from "./tauriIpcProtocol";

const invalid = new IpcProtocolError("HISTORY_IPC_RESPONSE_INVALID");

describe("native note settings protocol", () => {
  test("preserves committed manual names and pin state", () => {
    expect(parseNoteMetadata({ pinned: true, display_title: "我的笔记 🎬" }))
      .toEqual({ pinned: true, displayTitle: "我的笔记 🎬" });
    expect(parseNoteMetadata({ pinned: false, display_title: null }))
      .toEqual({ pinned: false, displayTitle: null });
    expect(parseNoteMetadata({ pinned: false, display_title: "🎬".repeat(60) })?.displayTitle)
      .toHaveLength(120);
    expect(parseNoteMetadata(null)).toBeNull();
  });

  test.each([
    undefined, [], "settings", {}, { pinned: true }, { display_title: null },
    { pinned: 1, display_title: null }, { pinned: false, display_title: 7 },
    { pinned: false, display_title: null, path: "private/settings.json" },
    ...["", " leading", "trailing ", "two\nlines", "\tTitle", "Title\r", "x\u200by", "x\u2028y", "x\u2029y", "\ud800", "🎬".repeat(61)]
      .map((display_title) => ({ pinned: false, display_title })),
  ])("rejects malformed settings %#", (value) => {
    expect(() => parseNoteMetadata(value)).toThrowError(invalid);
  });

  test("distinguishes legacy absence, valid defaults, and explicit settings failure", () => {
    expect(parseNoteMetadataProjection({})).toEqual({ noteMetadata: null, noteMetadataError: null });
    expect(parseNoteMetadataProjection({ note_metadata: { pinned: false, display_title: null }, note_metadata_error: null }))
      .toEqual({ noteMetadata: { pinned: false, displayTitle: null }, noteMetadataError: null });
    expect(parseNoteMetadataProjection({ note_metadata: null, note_metadata_error: "NOTE_UNSAFE_STORAGE" }))
      .toEqual({ noteMetadata: null, noteMetadataError: "NOTE_UNSAFE_STORAGE" });
  });

  test.each([
    { note_metadata: null }, { note_metadata_error: null },
    { note_metadata: null, note_metadata_error: null },
    { note_metadata: { pinned: true, display_title: null }, note_metadata_error: "NOTE_METADATA_INVALID" },
    { note_metadata: null, note_metadata_error: "raw private failure" },
    { note_metadata: null, note_metadata_error: "WORKER_CANCELLED" },
    { note_metadata: null, note_metadata_error: "NOTE_" },
    { note_metadata: null, note_metadata_error: `NOTE_${"X".repeat(60)}` },
    { note_metadata: null, note_metadata_error: false },
  ])("rejects incoherent settings projection %#", (projection) => {
    expect(() => parseNoteMetadataProjection(projection)).toThrowError(invalid);
  });

  test("does not evaluate sidecar field accessors", () => {
    let reads = 0;
    const value = Object.defineProperty({ pinned: false }, "display_title", {
      enumerable: true,
      get() { reads += 1; return "private title"; },
    });
    expect(() => parseNoteMetadata(value)).toThrowError(invalid);
    expect(reads).toBe(0);
  });
});

describe("history note settings projection", () => {
  const list = {
    task_id: "note-1", id: "note-1", created_at: "2026-10-31T10:00:00Z",
    source: { kind: "url", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    status: "completed", task_dir: "saved-task", output_dir: "saved-output", artifacts: {},
    error: null, text_preview: "Saved transcript", insights_count: 0,
  };
  const detail = {
    task_id: "note-1", source: list.source, status: "completed", task_dir: "saved-task",
    artifacts: {}, error: null, text: "Saved transcript", summary: "", transcript: null,
    insights: [], dissection: null, dissection_source_status: null,
  };

  test("keeps saved notes readable when settings are malformed on disk", () => {
    const projection = { note_metadata: null, note_metadata_error: "NOTE_METADATA_INVALID" };
    expect(parseHistoryListResponse([{ ...list, ...projection }])[0])
      .toMatchObject({ task_id: "note-1", status: "completed", noteMetadata: null, noteMetadataError: "NOTE_METADATA_INVALID" });
    expect(parseHistoryDetailResponse({ ...detail, ...projection }, "note-1"))
      .toMatchObject({ text: "Saved transcript", noteMetadata: null, noteMetadataError: "NOTE_METADATA_INVALID" });
  });

  test("projects committed settings consistently in list and detail", () => {
    const projection = { note_metadata: { pinned: true, display_title: "Current manual title" }, note_metadata_error: null };
    const expected = { noteMetadata: { pinned: true, displayTitle: "Current manual title" }, noteMetadataError: null };
    expect(parseHistoryListResponse([{ ...list, ...projection }])[0]).toMatchObject(expected);
    expect(parseHistoryDetailResponse({ ...detail, ...projection }, "note-1")).toMatchObject(expected);
  });

  test("accepts legacy history while rejecting one-sided metadata fields", () => {
    expect(parseHistoryListResponse([list])[0]).toMatchObject({ noteMetadata: null, noteMetadataError: null });
    expect(parseHistoryDetailResponse(detail, "note-1")).toMatchObject({ noteMetadata: null, noteMetadataError: null });
    expect(() => parseHistoryListResponse([{ ...list, note_metadata: null }])).toThrowError(invalid);
    expect(() => parseHistoryDetailResponse({ ...detail, note_metadata_error: null }, "note-1")).toThrowError(invalid);
  });
});
