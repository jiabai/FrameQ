import { describe, expect, test } from "vitest";
import { createInitialWorkflow, mergeProgressEvent, requestProcessingCancellation, startNoteTitleGeneration, startProcessing, summarizeWorkerResult, type WorkflowState } from "../../workflow";
import { createProcessingWorkspaceModel, getProcessingRetrySubmission } from "./processingWorkspaceModel";

const processing = () => startProcessing(createInitialWorkflow(), { kind: "url", url: "https://user:secret@www.bilibili.com/video/BV123?token=private#secret" });
const saved = () => summarizeWorkerResult({ status: "completed", task_id: "saved-note", task_dir: "D:/notes/saved-note", artifacts: { transcript_txt: "transcript/transcript.txt" }, text: "Saved transcript", summary: "", insights: [], transcript: null, dissection: null, dissection_source_status: null, draft: "", error: null });

describe("processing workspace projection", () => {
  test("keeps safe source identity and real workflow progress", () => {
    const state = mergeProgressEvent(processing(), { stage: "video_transcribing", progress: 68, message: { messageCode: "asr.transcribe.running", args: {} } });
    const before = structuredClone(state);
    const model = createProcessingWorkspaceModel(state)!;
    expect(model.phase).toBe("transcribing");
    expect(model.percent).toBe(68);
    expect(model.source).toEqual({ kind: "url", label: "www.bilibili.com", host: "www.bilibili.com", platform: "bilibili" });
    expect(model.steps.map(step => step.state)).toEqual(["complete", "active", "pending"]);
    expect(JSON.stringify(model)).not.toMatch(/secret|token|private|BV123/u);
    expect(state).toEqual(before);
  });

  test("handles bare Xiaohongshu identifiers without treating them as URLs", () => {
    const model = createProcessingWorkspaceModel(startProcessing(createInitialWorkflow(), { kind: "url", url: "a".repeat(24) }))!;
    expect(model.source.platform).toBe("xiaohongshu");
    expect(model.source.host).toBe("");
  });

  test("preserves local audio and webpage stages", () => {
    const audio = createProcessingWorkspaceModel(startProcessing(createInitialWorkflow(), { kind: "local_file", displayName: "访谈.wav", mediaKind: "audio" }))!;
    expect(audio.source.kind).toBe("audio");
    expect(audio.steps[0].label).toBe("audio");
    const web = startProcessing(createInitialWorkflow(), { kind: "url", url: "https://example.com/article?private=value" }, true);
    const model = createProcessingWorkspaceModel(web)!;
    expect(model.isWeb).toBe(true);
    expect(model.steps.map(step => step.label)).toEqual(["web_loading", "web_extracting", "web_saving"]);
    expect(model.source.host).toBe("example.com");
  });

  test("waits for native cancellation and projects the original active stage", () => {
    const cancelling = requestProcessingCancellation(processing());
    const model = createProcessingWorkspaceModel(cancelling)!;
    expect(model.phase).toBe("cancelling");
    expect(model.activeIndex).toBe(0);
    expect(model.percent).toBeNull();
    expect(model.cancelling).toBe(true);
    expect(createProcessingWorkspaceModel({ ...cancelling, stage: "waiting_input", cancellingFromStage: null })).toBeNull();
  });

  test("keeps title processing distinct and saved text available", () => {
    const title = startNoteTitleGeneration(saved(), "zh-CN");
    const model = createProcessingWorkspaceModel(title)!;
    expect(model.phase).toBe("titling");
    expect(model.cloud).toBe(true);
    expect(model.hasSavedText).toBe(true);
    expect(model.steps.map(step => step.state)).toEqual(["complete", "complete", "active"]);
    const cancelling = createProcessingWorkspaceModel(requestProcessingCancellation(title))!;
    expect(cancelling.cloud).toBe(true);
    expect(cancelling.phase).toBe("cancelling");
    expect(createProcessingWorkspaceModel(saved())).toBeNull();
    expect(createProcessingWorkspaceModel({ ...saved(), stage: "failed" })).toBeNull();
  });

  test("local failure keeps its failed stage without manufacturing partial progress", () => {
    const failure: WorkflowState = { ...processing(), stage: "failed", error: { code: "VIDEO_DOWNLOAD_FAILED", message: "raw private worker message", stage: "video_extracting" } };
    const model = createProcessingWorkspaceModel(failure)!;
    expect(model.phase).toBe("failed");
    expect(model.percent).toBeNull();
    expect(model.steps[0].state).toBe("failed");
    expect(createProcessingWorkspaceModel({ ...failure, error: { ...failure.error!, stage: "insights_generating" } })).toBeNull();
  });

  test("a released local selection cannot retry the previously retained URL", () => {
    const url = "https://www.youtube.com/watch?v=abcdefghijk";
    const selection = { selectionToken: "12345678-1234-4234-9234-123456789abc", displayName: "interview.wav", mediaKind: "audio" as const, extension: "wav", sizeBytes: 1024 };
    const local = startProcessing({ ...createInitialWorkflow(), composerSource: { kind: "local_media", selection, retainedUrlDraft: url } }, { kind: "local_file", displayName: selection.displayName, mediaKind: "audio" });
    const failed: WorkflowState = { ...local, stage: "failed", error: { stage: "video_extracting", code: "LOCAL_MEDIA_FILE_CHANGED", message: "" } };
    expect(getProcessingRetrySubmission(failed)).toEqual({ kind: "local_media", selectionToken: selection.selectionToken });
    expect(getProcessingRetrySubmission({ ...failed, composerSource: { kind: "url", urlDraft: url } })).toBeNull();
    const media = { ...failed, taskSource: { kind: "url" as const, url }, composerSource: { kind: "url" as const, urlDraft: url } };
    expect(getProcessingRetrySubmission(media)).toEqual({ kind: "url", url });
    expect(getProcessingRetrySubmission({ ...media, composerSource: { kind: "url", urlDraft: "https://www.youtube.com/watch?v=zyxwvutsrqp" } })).toBeNull();
  });
});
