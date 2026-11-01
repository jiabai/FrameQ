import { describe, expect, test } from "vitest";
import { createGuestAccountStatus } from "./accountState";
import { historyItemToWorkerResult, type HistoryItem } from "./historyClient";
import { createTaskWorkspaceViewModel } from "./taskWorkspaceViewModel";
import {
  cancelNoteTitleGeneration, confirmProcessingCancellation, createInitialWorkflow,
  finishInsightRetry, finishNoteTitleGeneration, isProcessingStage,
  requestProcessingCancellation, startNoteTitleGeneration, summarizeWorkerResult,
  type NoteTitleMetadata, type WorkerResult,
} from "./workflow";

const title: NoteTitleMetadata = {
  text: "保存在本机的笔记标题", status: "completed", output_language: "zh-CN", error_code: null,
};

function localResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    status: "completed", task_id: "saved-note", task_dir: "outputs/tasks/saved-note",
    artifacts: { transcript_txt: "transcript/transcript.txt", audio: "media/audio.wav" },
    text: "The authoritative transcript stays available.", summary: "Existing summary",
    insights: [], transcript: null, dissection: null, dissection_source_status: null,
    draft: "Existing draft", error: null, ...overrides,
  };
}

describe("note title workflow", () => {
  test("starts a visible cancellable title phase while preserving the saved transcript", () => {
    const saved = summarizeWorkerResult(localResult());
    const next = startNoteTitleGeneration(saved, "zh-TW");
    expect(next.stage).toBe("title_generating");
    expect(isProcessingStage(next.stage)).toBe(true);
    expect(next.text).toBe(saved.text);
    expect(next.artifacts).toBe(saved.artifacts);
    expect(next.noteTitle).toEqual({ text: null, status: "generating", output_language: "zh-TW", error_code: null });
    const view = createTaskWorkspaceViewModel(next, createGuestAccountStatus());
    expect(view.banner.kind).toBe("local_processing");
    expect(view.local.canReview).toBe(true);
    expect(view.local.canEdit).toBe(false);
    expect(view.cancellationOwner).toBe("ai");
    expect(view.ai.cancellation.visible).toBe(true);
    expect(startNoteTitleGeneration(createInitialWorkflow(), "en-US").stage).toBe("waiting_input");
  });

  test("successful title completion updates only title state on the originating task", () => {
    const saved = summarizeWorkerResult(localResult());
    const generating = startNoteTitleGeneration(saved, "zh-CN");
    const next = finishNoteTitleGeneration(generating, localResult({ note_title: title }));
    expect(next.noteTitle).toEqual(title);
    expect(next.stage).toBe("completed");
    expect(next.text).toBe(saved.text);
    expect(next.summary).toBe(saved.summary);
    expect(next.draft).toBe(saved.draft);
    expect(finishNoteTitleGeneration(generating, localResult({ task_id: "other-note", note_title: title }))).toBe(generating);
  });

  test("title cancellation preserves transcript, task identity and a previous committed title", () => {
    const saved = summarizeWorkerResult(localResult({ note_title: title }));
    const generating = startNoteTitleGeneration(saved, "en-US");
    const cancelling = requestProcessingCancellation(generating);
    expect(cancelling.cancellingFromStage).toBe("title_generating");
    const next = confirmProcessingCancellation(cancelling);
    expect(next).toEqual(cancelNoteTitleGeneration(cancelling));
    expect(next.taskId).toBe("saved-note");
    expect(next.artifacts).toBe(saved.artifacts);
    expect(next.text).toBe(saved.text);
    expect(next.noteTitle).toEqual({ ...title, output_language: "en-US", status: "cancelled", error_code: "WORKER_CANCELLED" });
    expect(next.stage).toBe("partial_completed");
  });

  test("quota or publication failure keeps saved content and a retryable title error", () => {
    const saved = summarizeWorkerResult(localResult({ note_title: title }));
    const next = finishNoteTitleGeneration(startNoteTitleGeneration(saved, "zh-CN"), localResult({
      status: "partial_completed", note_title: null,
      error: { code: "AI_LLM_QUOTA_UNAVAILABLE", message: "", stage: "title_generating" },
    }));
    expect(next.noteTitle).toEqual({ ...title, status: "failed", error_code: "AI_LLM_QUOTA_UNAVAILABLE" });
    expect(next.text).toBe(saved.text);
    expect(next.artifacts).toBe(saved.artifacts);
    expect(next.stage).toBe("partial_completed");
    expect(next.aiTargetErrors).toEqual({});
  });

  test("publication failure exposes retry even when disk still contains the prior completed title", () => {
    const saved = summarizeWorkerResult(localResult({ note_title: title }));
    const next = finishNoteTitleGeneration(startNoteTitleGeneration(saved, "en-US"), localResult({
      status: "partial_completed", note_title: title,
      error: { code: "TITLE_SAVE_FAILED", message: "", stage: "title_generating" },
    }));
    expect(next.noteTitle).toEqual({ ...title, output_language: "en-US", status: "failed", error_code: "TITLE_SAVE_FAILED" });
    expect(next.text).toBe(saved.text);
    expect(next.stage).toBe("partial_completed");
  });

  test("history restore never marks a title request as newly created and exposes interrupted state", () => {
    const item: HistoryItem = {
      taskId: "saved-note", taskDir: "outputs/tasks/saved-note", status: "completed",
      source: { kind: "url", url: "https://example.com/video" }, artifacts: { transcript_txt: "transcript/transcript.txt" },
      text: "saved transcript", summary: "", transcript: null, insights: [], dissection: null, dissectionStale: false,
      error: null, noteTitle: { ...title, status: "generating" },
    };
    const restored = historyItemToWorkerResult(item);
    expect(restored.task_created).toBe(false);
    const workflow = summarizeWorkerResult(restored);
    expect(workflow.stage).toBe("partial_completed");
    expect(workflow.noteTitle).toEqual(item.noteTitle);
    expect(workflow.text).toBe(item.text);
  });

  test("a completed title with the wrong request language fails closed and keeps the previous text", () => {
    const saved = summarizeWorkerResult(localResult({ note_title: title }));
    const next = finishNoteTitleGeneration(startNoteTitleGeneration(saved, "en-US"), localResult({
      note_title: { ...title, text: "Unexpected replacement" },
    }));
    expect(next.noteTitle).toEqual({ ...title, status: "failed", output_language: "en-US", error_code: "WORKER_PROTOCOL_VIOLATION" });
    expect(next.error?.code).toBe("WORKER_PROTOCOL_VIOLATION");
    expect(next.stage).toBe("partial_completed");
  });

  test("unrelated AI completion preserves saved title and title failure metadata", () => {
    const metadata: NoteTitleMetadata = { ...title, status: "failed", error_code: "TITLE_SAVE_FAILED" };
    const saved = summarizeWorkerResult(localResult({ note_title: metadata }));
    const next = finishInsightRetry(saved, localResult(), "summary");
    expect(next.noteTitle).toEqual(metadata);
    expect(next.stage).toBe("partial_completed");
  });
});
