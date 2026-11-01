import { describe, expect, test } from "vitest";

import { cancelNoteTitleGeneration, createInitialWorkflow, startNoteTitleGeneration, summarizeWorkerResult, type WorkerResult } from "../../workflow";
import { bindNoteTitleResult, completedNoteResult, finishCancelledTitleAttempt, shouldGenerateNoteTitle } from "./noteTitleSubmission";

const localResult: WorkerResult = {
  status: "completed", task_id: "saved-note", task_dir: "D:/FrameQ/outputs/tasks/saved-note",
  artifacts: { transcript_txt: "transcript/transcript.txt", audio: "media/audio.wav" },
  text: "A saved transcript", summary: "", insights: [], transcript: null,
  dissection: null, dissection_source_status: null, draft: "", error: null,
  note_title: null, task_created: true,
};

describe("automatic title admission", () => {
  test("requires native evidence that a note was newly created", () => {
    expect(shouldGenerateNoteTitle(localResult)).toBe(true);
    expect(shouldGenerateNoteTitle({ ...localResult, task_created: false })).toBe(false);
    expect(shouldGenerateNoteTitle({ ...localResult, task_created: undefined })).toBe(false);
  });

  test("does not regenerate an already committed title", () => {
    expect(shouldGenerateNoteTitle({
      ...localResult,
      note_title: { text: "A saved title", status: "completed", output_language: "en-US", error_code: null },
    })).toBe(false);
  });

  test("requires the saved authoritative transcript and a successful local result", () => {
    expect(shouldGenerateNoteTitle({ ...localResult, task_id: null })).toBe(false);
    expect(shouldGenerateNoteTitle({ ...localResult, artifacts: {} })).toBe(false);
    expect(shouldGenerateNoteTitle({ ...localResult, status: "failed" })).toBe(false);
    expect(shouldGenerateNoteTitle({ ...localResult, error: { code: "WORKER_CANCELLED", message: "", stage: "video_transcribing" } })).toBe(false);
  });

  test("binds malformed task completion to a visible failure without accepting its title", () => {
    const result = bindNoteTitleResult({
      ...localResult, task_id: "unrelated-note",
      note_title: { text: "Unrelated title", status: "completed", output_language: "en-US", error_code: null },
    }, "saved-note");
    expect(result.task_id).toBe("saved-note");
    expect(result.note_title).toBeNull();
    expect(result.error?.code).toBe("WORKER_PROTOCOL_VIOLATION");
  });

  test("title cancellation returns the saved note for Collection membership", () => {
    const state = startNoteTitleGeneration(summarizeWorkerResult(localResult), "zh-TW");
    const result = completedNoteResult(localResult, cancelNoteTitleGeneration(state));
    expect(result.status).toBe("partial_completed");
    expect(result.task_id).toBe(localResult.task_id);
    expect(result.text).toBe(localResult.text);
    expect(result.artifacts).toEqual(localResult.artifacts);
    expect(result.note_title?.output_language).toBe("zh-TW");
    expect(result.note_title?.status).toBe("cancelled");
    expect(result.error?.stage).toBe("title_generating");
  });

  test("empty workflows cannot publish a title operation", () => {
    const state = createInitialWorkflow();
    expect(startNoteTitleGeneration(state, "en-US")).toBe(state);
  });

  test("cancellation adopts a newer committed title without overwriting its language", () => {
    const titling = startNoteTitleGeneration(summarizeWorkerResult(localResult), "zh-CN");
    const committed = { text: "An already committed title", status: "completed" as const, output_language: "en-US" as const, error_code: null };
    const state = finishCancelledTitleAttempt(titling, { ...localResult, note_title: committed });
    expect(state.noteTitle).toEqual(committed);
    expect(state.error).toBeNull();
    expect(state.text).toBe(localResult.text);
  });
});
