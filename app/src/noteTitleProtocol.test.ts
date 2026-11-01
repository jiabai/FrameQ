import { describe, expect, test } from "vitest";
import { parseRetryInsightsInput, parseWorkerProgressEvent } from "./desktopWorkerProtocol";
import { parseHistoryDetailResponse, parseHistoryListResponse } from "./historyClient";
import { recordNoteTitleCancellation, retryInsights } from "./workerClient";
import { parseNoteTitleCancellationRequest } from "./noteTitle";
import { parseWorkerResult } from "./workerResultProtocol";
import type { NoteTitleMetadata, WorkerResult } from "./workflow";

const metadata: NoteTitleMetadata = {
  text: "How local-first notes preserve context", status: "completed", output_language: "en-US", error_code: null,
};
const result: WorkerResult = {
  status: "completed", task_id: "saved-note", task_dir: "outputs/tasks/saved-note",
  artifacts: { transcript_txt: "transcript/transcript.txt" }, text: "saved transcript",
  summary: "", insights: [], transcript: null, dissection: null, dissection_source_status: null,
  draft: "", error: null,
};

describe("note title protocol", () => {
  test("accepts only a closed title request with a captured supported locale", () => {
    const input = { taskId: "saved-note", target: "title", outputLanguage: "zh-TW" };
    expect(parseRetryInsightsInput(input)).toEqual({ kind: "valid", request: {
      task_id: "saved-note", target: "title", output_language: "zh-TW",
    } });
    for (const invalid of [{ ...input, outputLanguage: "fr-FR" }, { ...input, preferenceSnapshot: {} }, { ...input, platform: "x" }]) {
      expect(parseRetryInsightsInput(invalid).kind).toBe("invalid");
    }
    expect(parseWorkerProgressEvent({ stage: "title_generating", progress: 95, message_code: "title.generation.running" }).kind).toBe("known");
    expect(parseWorkerProgressEvent({ stage: "title_generating", progress: 100, message_code: "title.generation.completed", message_args: { total: 2 } }).kind).toBe("invalid");
  });

  test("decodes validated title metadata and the authoritative new-task flag", () => {
    expect(parseWorkerResult({ ...result, note_title: metadata, task_created: true }))
      .toMatchObject({ note_title: metadata, task_created: true });
    expect(parseWorkerResult(result)).toMatchObject({ note_title: null, task_created: false });
    for (const invalid of [
      { ...result, task_created: 1 }, { ...result, task_created: undefined },
      { ...result, task_created: true, task_id: null },
      { ...result, task_created: true, artifacts: {} },
      { ...result, task_id: null, note_title: metadata },
      { ...result, task_dir: null, note_title: metadata },
      { ...result, artifacts: {}, note_title: metadata },
      { ...result, note_title: undefined }, { ...result, note_title: { ...metadata, text: "two\nlines" } },
    ]) expect(parseWorkerResult(invalid)).toBeNull();
  });

  test("history list and detail accept optional legacy metadata and reject malformed title shapes", () => {
    const listItem = {
      task_id: "saved-note", id: "saved-note", created_at: "2026-10-31T00:00:00Z",
      source: { kind: "url", url: "https://example.com/video" }, status: "completed",
      task_dir: "outputs/tasks/saved-note", output_dir: "outputs", artifacts: result.artifacts,
      error: null, text_preview: "separate transcript preview", insights_count: 0,
    };
    expect(parseHistoryListResponse([listItem])[0].note_title).toBeNull();
    expect(parseHistoryListResponse([{ ...listItem, note_title: metadata }])[0].note_title).toEqual(metadata);
    const detail = { ...result, source: listItem.source } as Record<string, unknown>;
    delete detail.draft;
    expect(parseHistoryDetailResponse({ ...detail, note_title: metadata }, "saved-note").note_title).toEqual(metadata);
    expect(() => parseHistoryListResponse([{ ...listItem, note_title: { ...metadata, extra: "private" } }]))
      .toThrow("HISTORY_IPC_RESPONSE_INVALID");
    expect(() => parseHistoryDetailResponse({ ...detail, note_title: { ...metadata, text: "" } }, "saved-note"))
      .toThrow("HISTORY_IPC_RESPONSE_INVALID");
  });

  test("withdrawn authorization after listener setup starts no command and removes the listener", async () => {
    let allowed = true;
    let commands = 0;
    let removed = 0;
    const cancelled = await retryInsights(
      { taskId: "saved-note", target: "title", outputLanguage: "en-US" },
      async () => { commands += 1; throw new Error("Command must not start"); },
      () => {},
      async () => { allowed = false; return () => { removed += 1; }; },
      () => {},
      () => allowed,
    );
    expect(commands).toBe(0);
    expect(removed).toBe(1);
    expect(cancelled.error).toEqual({ code: "WORKER_CANCELLED", message: "", stage: "title_generating" });
    expect(cancelled.task_id).toBe("saved-note");
  });

  test("listener setup failure becomes a sanitized title transport error without starting a command", async () => {
    let commands = 0;
    const failure = await retryInsights(
      { taskId: "saved-note", target: "title", outputLanguage: "en-US" },
      async () => { commands += 1; throw new Error("Command must not start"); },
      () => {},
      async () => { throw new Error("private supplier response and transcript"); },
    );
    expect(commands).toBe(0);
    expect(failure.task_id).toBe("saved-note");
    expect(failure.error).toEqual({ code: "TAURI_COMMAND_FAILED", message: "", stage: "title_generating" });
    expect(JSON.stringify(failure)).not.toContain("private supplier");
  });

  test("cleanup failure records only a safe diagnostic and preserves the authoritative cancellation result", async () => {
    const diagnostics: string[] = [];
    let commands = 0;
    const cancelled = await retryInsights(
      { taskId: "saved-note", target: "title", outputLanguage: "en-US" },
      async () => { commands += 1; throw new Error("Command must not start"); },
      () => {},
      async () => () => { throw new Error("private cleanup detail"); },
      (code) => { diagnostics.push(code); },
      () => false,
    );
    expect(commands).toBe(0);
    expect(cancelled.error?.code).toBe("WORKER_CANCELLED");
    expect(diagnostics).toEqual(["WORKER_PROGRESS_UNSUBSCRIBE_FAILED"]);
    expect(JSON.stringify(cancelled)).not.toContain("private cleanup");
  });

  test("serializes a closed cancellation compare-and-set snapshot without altering committed metadata", () => {
    expect(parseNoteTitleCancellationRequest({ taskId: "saved-note", outputLanguage: "zh-TW", expectedNoteTitle: metadata }))
      .toEqual({ kind: "valid", request: { task_id: "saved-note", output_language: "zh-TW", expected_note_title: metadata } });
    expect(parseNoteTitleCancellationRequest({ taskId: "saved-note", outputLanguage: "en-US", expectedNoteTitle: null }).kind).toBe("valid");
    for (const invalid of [
      { taskId: "../private", outputLanguage: "en-US", expectedNoteTitle: null },
      { taskId: " saved-note ", outputLanguage: "en-US", expectedNoteTitle: null },
      { taskId: "saved-note", outputLanguage: "fr-FR", expectedNoteTitle: null },
      { taskId: "saved-note", outputLanguage: "en-US", expectedNoteTitle: undefined },
      { taskId: "saved-note", outputLanguage: "en-US", expectedNoteTitle: metadata, extra: true },
    ]) expect(parseNoteTitleCancellationRequest(invalid).kind).toBe("invalid");
  });

  test("runs the native cancellation-recording callback instead of starting a title worker", async () => {
    let commands = 0;
    let cancellations = 0;
    const failure = await retryInsights(
      { taskId: "saved-note", target: "title", outputLanguage: "en-US" },
      async () => { commands += 1; throw new Error("Command must not start"); },
      undefined, undefined, undefined, () => false,
      async () => {
        cancellations += 1;
        return recordNoteTitleCancellation({ taskId: "saved-note", outputLanguage: "en-US", expectedNoteTitle: { ...metadata, text: "" } });
      },
    );
    expect(commands).toBe(0);
    expect(cancellations).toBe(1);
    expect(failure.task_id).toBe("saved-note");
    expect(failure.error).toEqual({ code: "INVALID_RETRY_PAYLOAD", message: "", stage: "title_generating" });
  });

  test("cancellation-recording callback failure returns a sanitized task-bound title error", async () => {
    const failure = await retryInsights(
      { taskId: "saved-note", target: "title", outputLanguage: "en-US" },
      async () => { throw new Error("Command must not start"); },
      undefined, undefined, undefined, () => false,
      async () => { throw new Error("private cancellation failure"); },
    );
    expect(failure.task_id).toBe("saved-note");
    expect(failure.error).toEqual({ code: "TAURI_COMMAND_FAILED", message: "", stage: "title_generating" });
    expect(JSON.stringify(failure)).not.toContain("private cancellation");
  });
});
