import { describe, expect, test } from "vitest";

import {
  cancelNoteTitleGeneration, createInitialWorkflow, finishInsightRetry,
  finishNoteTitleGeneration, startNoteTitleGeneration, type WorkerResult,
  startProcessing, summarizeWorkerResult,
} from "./workflowState";
import { getHistoryTitle } from "./features/shell/shellNavigation";

const metadata = { pinned: true, displayTitle: "用户手动标题" };
const saved = {
  ...createInitialWorkflow(), taskId: "note-1", text: "Saved transcript", noteMetadata: metadata,
  artifacts: { transcript_txt: "transcript/transcript.txt" },
};
const completed: WorkerResult = {
  status: "completed", task_id: "note-1", task_dir: "saved-task",
  artifacts: saved.artifacts, text: saved.text, summary: "Saved summary", insights: [],
  transcript: null, dissection: null, dissection_source_status: null, draft: "", error: null,
  note_title: { text: "生成标题", status: "completed", output_language: "zh-CN", error_code: null },
};

describe("manual note settings survive processing state transitions", () => {
  test("keeps the manual title and pin through title generation and cancellation", () => {
    const generating = startNoteTitleGeneration(saved, "zh-CN");
    expect(generating.noteMetadata).toEqual(metadata);
    expect(finishNoteTitleGeneration(generating, completed).noteMetadata).toEqual(metadata);
    expect(cancelNoteTitleGeneration(generating).noteMetadata).toEqual(metadata);
  });

  test("keeps manual settings when title generation fails", () => {
    const generating = startNoteTitleGeneration(saved, "zh-CN");
    const failed: WorkerResult = { ...completed, status: "partial_completed", note_title: null,
      error: { code: "TITLE_OUTPUT_INVALID", message: "", stage: "title_generating" } };
    expect(finishNoteTitleGeneration(generating, failed).noteMetadata).toEqual(metadata);
  });

  test.each(["summary", "insights", "draft", "dissection"] as const)
    ("retains native settings after the %s result", (target) => {
      expect(finishInsightRetry(saved, completed, target).noteMetadata).toEqual(metadata);
      expect(saved.noteMetadata).toEqual(metadata);
    });

  test("manual titles take priority across shared note projections", () => {
    const item = { taskId: "note-1", source: { kind: "local_file", displayName: "Interview.wav", mediaKind: "audio" } as const,
      textPreview: "Transcript preview", noteTitle: completed.note_title, noteMetadata: metadata };
    expect(getHistoryTitle(item)).toBe(metadata.displayTitle);
    expect(getHistoryTitle({ ...item, noteMetadata: { pinned: false, displayTitle: null } })).toBe("生成标题");
    expect(getHistoryTitle({ ...item, noteTitle: null, noteMetadata: null })).toBe("Transcript preview");
  });

  test("a newly submitted task clears the earlier note settings", () => {
    expect(startProcessing(saved, { kind: "url", url: "https://www.youtube.com/watch?v=abcDEF_123-" }).noteMetadata).toBeNull();
    expect(summarizeWorkerResult(completed).noteMetadata).toBeNull();
  });
});
