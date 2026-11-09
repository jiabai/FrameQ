// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { createGuestAccountStatus } from "../../accountState";
import { initializeI18n } from "../../i18n/i18n";
import { createTaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import {
  createInitialWorkflow,
  mergeProgressEvent,
  requestProcessingCancellation,
  startNoteTitleGeneration,
  startProcessing,
  summarizeWorkerResult,
  type WorkflowState,
} from "../../workflow";
import { TaskStatusBanner } from "./TaskStatusBanner";

afterEach(cleanup);

function savedTranscript(): WorkflowState {
  return summarizeWorkerResult({
    status: "completed", task_id: "saved-note", task_dir: "D:/Locus/outputs/tasks/saved-note",
    artifacts: { audio: "media/audio.wav", transcript_txt: "transcript/transcript.txt" },
    text: "Saved transcript", summary: "", insights: [], transcript: null,
    dissection: null, dissection_source_status: null, draft: "", error: null,
  });
}

function banner(workflow: WorkflowState) {
  return createTaskWorkspaceViewModel(workflow, createGuestAccountStatus()).banner;
}

test.each(["zh-CN", "zh-TW", "en-US"] as const)(
  "removes the completion element after processing and on a fresh saved-note render in %s",
  async (locale) => {
    await initializeI18n(locale);
    const processing = startProcessing(createInitialWorkflow(), { kind: "url", url: "https://example.invalid/video" });
    const view = render(<TaskStatusBanner model={banner(processing)} />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");

    view.rerender(<TaskStatusBanner model={banner(savedTranscript())} />);
    expect(view.container.childElementCount).toBe(0);
    view.unmount();

    const restored = render(<TaskStatusBanner model={banner(savedTranscript())} />);
    expect(restored.container.childElementCount).toBe(0);
  },
);

test("keeps local progress, cancellation, failure, and title-generation status visible", async () => {
  await initializeI18n("zh-CN");
  const processing = startProcessing(createInitialWorkflow(), { kind: "url", url: "https://example.invalid/video" });
  const transcribing = mergeProgressEvent(processing, {
    stage: "video_transcribing", progress: 60,
    message: { messageCode: "asr.transcribe.running", args: {} },
  });
  const failed: WorkflowState = {
    ...processing, stage: "failed",
    error: { code: "VIDEO_DOWNLOAD_FAILED", message: "", stage: "video_extracting" },
  };
  const title = startNoteTitleGeneration(savedTranscript(), "zh-CN");
  const view = render(<TaskStatusBanner model={banner(processing)} />);
  for (const state of [transcribing, requestProcessingCancellation(processing), failed, title, requestProcessingCancellation(title)]) {
    view.rerender(<TaskStatusBanner model={banner(state)} />);
    expect(screen.getByRole("status").textContent).toBeTruthy();
    expect(screen.getByRole("status").className).not.toContain("local_complete");
  }
});

test("omits the redundant success banner without changing partial-completion recovery state", () => {
  const partial: WorkflowState = {
    ...savedTranscript(), stage: "partial_completed",
    aiTargetErrors: { summary: { code: "AI_EMPTY_SUMMARY", message: "", stage: "insights_generating" } },
  };
  const before = structuredClone(partial);
  const model = createTaskWorkspaceViewModel(partial, createGuestAccountStatus());
  const view = render(<TaskStatusBanner model={model.banner} />);
  expect(view.container.childElementCount).toBe(0);
  expect(model.ai.summary.status).toBe("failed");
  expect(model.ai.summary.errorCode).toBe("AI_EMPTY_SUMMARY");
  expect(model.local.canReview).toBe(true);
  expect(partial).toEqual(before);
});
