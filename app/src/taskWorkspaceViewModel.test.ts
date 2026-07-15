import { describe, expect, test } from "vitest";

import { createGuestAccountStatus, type AccountStatus } from "./accountState";
import {
  createInitialWorkflow,
  finishInsightRetry,
  requestProcessingCancellation,
  startInsightRetry,
  startProcessing,
  summarizeWorkerResult,
  type WorkerResult,
} from "./workflow";
import { createTaskWorkspaceViewModel } from "./taskWorkspaceViewModel";

const TASK_ID = "20260711-120000-youtube-demo";

function entitledAccount(overrides: Partial<AccountStatus> = {}): AccountStatus {
  return {
    ...createGuestAccountStatus(),
    authenticated: true,
    entitlementStatus: "active",
    llmConfigured: true,
    llmQuotaLimit: 20,
    llmQuotaUsed: 1,
    llmQuotaRemaining: 19,
    canProcess: true,
    canGenerateAi: true,
    ...overrides,
  };
}

function transcriptResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    status: "completed",
    task_id: TASK_ID,
    task_dir: `outputs/tasks/${TASK_ID}`,
    artifacts: {
      video: "media/video.mp4",
      audio: "media/audio.wav",
      transcript_txt: "transcript/transcript.txt",
      transcript_md: "transcript/transcript.md",
    },
    text: "已保存的正式文字稿",
    summary: "",
    insights: [],
    transcript: { source: "asr", language: "zh", engine: "SenseVoice" },
    draft: "",
    error: null,
    ...overrides,
  };
}

describe("task workspace view model", () => {
  test("local processing has only download and transcription progress while AI waits", () => {
    const workflow = startProcessing(
      createInitialWorkflow(),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(model.local.phase).toBe("processing");
    expect(model.local.progressSteps.map((step) => step.id)).toEqual([
      "video_extracting",
      "video_transcribing",
    ]);
    expect(model.ai.phase).toBe("waiting_transcript");
    expect(model.ai.summary.status).toBe("locked");
    expect(model.ai.insights.status).toBe("locked");
    expect(model.cancellationOwner).toBe("local");
  });

  test("a saved local transcript unlocks both independent AI targets for the same task", () => {
    const workflow = summarizeWorkerResult(transcriptResult());

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(model.banner.kind).toBe("local_complete");
    expect(model.banner.message).toContain("视频、音频和文字稿已保存在本机");
    expect(model.local.phase).toBe("ready");
    expect(model.local.taskId).toBe(TASK_ID);
    expect(model.local.readOnlyReason).toBeNull();
    expect(model.ai.phase).toBe("ready");
    expect(model.ai.taskId).toBe(TASK_ID);
    expect(model.ai.summary.status).toBe("available");
    expect(model.ai.insights.status).toBe("available");
  });

  test.each([
    {
      label: "summary only",
      result: transcriptResult({
        summary: "# 已生成总结",
        artifacts: {
          ...transcriptResult().artifacts,
          summary: "ai/summary.md",
          mindmap: "ai/mindmap.mmd",
        },
      }),
      summaryStatus: "ready",
      insightsStatus: "available",
    },
    {
      label: "insights only",
      result: transcriptResult({
        insights: [
          {
            id: 1,
            topic: "独立灵感",
            matchReason: "匹配当前任务",
            followUpQuestions: ["下一步是什么？"],
            suitableUse: "复盘",
            sourceChunkId: null,
          },
        ],
        artifacts: {
          ...transcriptResult().artifacts,
          insights: "ai/insights.json",
          insights_md: "ai/insights.md",
        },
      }),
      summaryStatus: "available",
      insightsStatus: "ready",
    },
  ])(
    "projects $label without manufacturing the other AI target",
    ({ result, summaryStatus, insightsStatus }) => {
      const model = createTaskWorkspaceViewModel(
        summarizeWorkerResult(result),
        entitledAccount(),
      );

      expect(model.local.phase).toBe("ready");
      expect(model.ai.summary.status).toBe(summaryStatus);
      expect(model.ai.insights.status).toBe(insightsStatus);
      expect(model.local.taskId).toBe(model.ai.taskId);
    },
  );

  test("typed AI target keeps local results ready and read-only while generation runs", () => {
    const workflow = startInsightRetry(
      summarizeWorkerResult(transcriptResult()),
      "summary",
    );

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(workflow.activeAiTarget).toBe("summary");
    expect(model.local.phase).toBe("ready");
    expect(model.local.canReview).toBe(true);
    expect(model.local.canEdit).toBe(false);
    expect(model.local.readOnlyReason).toBe("AI 正在使用已保存版本");
    expect(model.ai.summary.status).toBe("generating");
    expect(model.ai.insights.status).toBe("available");
    expect(model.cancellationOwner).toBe("ai");
  });

  test("AI cancellation remains owned by the active target during Cancelling", () => {
    const running = startInsightRetry(
      summarizeWorkerResult(transcriptResult()),
      "insights",
    );
    const cancelling = requestProcessingCancellation(running);

    const model = createTaskWorkspaceViewModel(cancelling, entitledAccount());

    expect(cancelling.activeAiTarget).toBe("insights");
    expect(model.local.phase).toBe("ready");
    expect(model.local.canEdit).toBe(false);
    expect(model.ai.insights.status).toBe("cancelling");
    expect(model.cancellationOwner).toBe("ai");
  });

  test("a failed target does not turn the usable local transcript or other target into an error", () => {
    const state = summarizeWorkerResult(
      transcriptResult({
        status: "partial_completed",
        summary: "# 已有总结",
        artifacts: {
          ...transcriptResult().artifacts,
          summary: "ai/summary.md",
          mindmap: "ai/mindmap.mmd",
        },
        error: {
          code: "INSIGHTFLOW_EMPTY_RESULT",
          message: "No insights returned.",
          stage: "insights_generating",
        },
      }),
      "insights",
    );

    const model = createTaskWorkspaceViewModel(state, entitledAccount());

    expect(state.aiErrorTarget).toBe("insights");
    expect(model.local.phase).toBe("ready");
    expect(model.local.error).toBeNull();
    expect(model.ai.summary.status).toBe("ready");
    expect(model.ai.insights.status).toBe("failed");
    expect(model.ai.insights.errorCode).toBe("INSIGHTFLOW_EMPTY_RESULT");
  });

  test("summary and inspiration retain independent failure states across retries", () => {
    const ready = summarizeWorkerResult(transcriptResult());
    const summaryFailed = finishInsightRetry(
      startInsightRetry(ready, "summary"),
      transcriptResult({
        status: "partial_completed",
        error: {
          code: "INSIGHTFLOW_EMPTY_SUMMARY",
          message: "No summary returned.",
          stage: "insights_generating",
        },
      }),
      "summary",
    );
    const bothFailed = finishInsightRetry(
      startInsightRetry(summaryFailed, "insights"),
      transcriptResult({
        status: "partial_completed",
        error: {
          code: "INSIGHTFLOW_EMPTY_RESULT",
          message: "No insights returned.",
          stage: "insights_generating",
        },
      }),
      "insights",
    );

    const model = createTaskWorkspaceViewModel(bothFailed, entitledAccount());

    expect(model.ai.summary.status).toBe("failed");
    expect(model.ai.summary.errorCode).toBe("INSIGHTFLOW_EMPTY_SUMMARY");
    expect(model.ai.insights.status).toBe("failed");
    expect(model.ai.insights.errorCode).toBe("INSIGHTFLOW_EMPTY_RESULT");
  });

  test("AI availability distinguishes service unavailability from exhausted quota", () => {
    const workflow = summarizeWorkerResult(transcriptResult());

    expect(
      createTaskWorkspaceViewModel(
        workflow,
        entitledAccount({ llmConfigured: false, canGenerateAi: false }),
      ).ai.availability,
    ).toBe("unavailable");
    expect(
      createTaskWorkspaceViewModel(
        workflow,
        entitledAccount({ llmQuotaRemaining: 0, canGenerateAi: false }),
      ).ai.availability,
    ).toBe("quota_exhausted");
  });

  test("a local failure has an explicit failed banner instead of a loading banner", () => {
    const state = summarizeWorkerResult(
      transcriptResult({
        status: "failed",
        task_id: null,
        task_dir: null,
        artifacts: {},
        text: "",
        error: {
          code: "VIDEO_DOWNLOAD_FAILED",
          message: "download failed",
          stage: "video_extracting",
        },
      }),
    );

    const model = createTaskWorkspaceViewModel(state, entitledAccount());

    expect(model.banner.kind).toBe("local_failed");
    expect(model.banner.message).toContain("VIDEO_DOWNLOAD_FAILED");
    expect(model.local.phase).toBe("failed");
  });

  test("projects the draft target independently from summary and insights", () => {
    // With a saved transcript, generated insights, and a selected seed, the
    // draft card is available and independent of the other two targets.
    const workflow = summarizeWorkerResult(
      transcriptResult({
        insights: [
          {
            id: 1,
            topic: "独立灵感",
            matchReason: "匹配当前任务",
            followUpQuestions: ["下一步是什么？"],
            suitableUse: "复盘",
            sourceChunkId: null,
          },
        ],
        artifacts: {
          ...transcriptResult().artifacts,
          insights: "ai/insights.json",
          insights_md: "ai/insights.md",
        },
      }),
    );
    workflow.draftSeedInsightId = 1;

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(model.ai.draft.target).toBe("draft");
    expect(model.ai.draft.status).toBe("available");
    expect(model.ai.summary.status).toBe("available");
    expect(model.ai.insights.status).toBe("ready");
  });

  test("marks the draft target ready when draft content exists", () => {
    const workflow = summarizeWorkerResult(
      transcriptResult({
        draft: "# 草稿正文",
        insights: [
          {
            id: 1,
            topic: "灵感",
            matchReason: "理由",
            followUpQuestions: ["问题"],
            suitableUse: "复盘",
            sourceChunkId: null,
          },
        ],
      }),
    );

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(model.ai.draft.status).toBe("ready");
  });

  test("marks the draft target generating while a draft retry is active", () => {
    const workflow = startInsightRetry(
      summarizeWorkerResult(transcriptResult()),
      "draft",
    );

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(workflow.activeAiTarget).toBe("draft");
    expect(model.ai.draft.status).toBe("generating");
    // Other targets are not generating.
    expect(model.ai.summary.status).not.toBe("generating");
    expect(model.ai.insights.status).not.toBe("generating");
  });

  test("marks the draft target failed from a draft_generating error without inferring target from copy", () => {
    const state = finishInsightRetry(
      startInsightRetry(summarizeWorkerResult(transcriptResult()), "draft"),
      transcriptResult({
        status: "partial_completed",
        error: {
          code: "DRAFT_SEED_INVALID",
          message: "Seed insight 7 is not in insights.json.",
          stage: "draft_generating",
        },
      }),
      "draft",
    );

    const model = createTaskWorkspaceViewModel(state, entitledAccount());

    expect(state.aiErrorTarget).toBe("draft");
    expect(model.ai.draft.status).toBe("failed");
    expect(model.ai.draft.errorCode).toBe("DRAFT_SEED_INVALID");
    // Summary and insights are untouched by the draft failure.
    expect(model.ai.summary.status).not.toBe("failed");
    expect(model.ai.insights.status).not.toBe("failed");
  });

  test("keeps the draft card locked when insights are ready but no seed is selected", () => {
    // The draft target card is quietly disabled until a seed insight is
    // picked. Insights exist, but without a seed the draft card stays locked
    // (no LLM entry, no quota consumption).
    const workflow = summarizeWorkerResult(
      transcriptResult({
        insights: [
          {
            id: 1,
            topic: "灵感",
            matchReason: "理由",
            followUpQuestions: ["问题"],
            suitableUse: "复盘",
            sourceChunkId: null,
          },
        ],
      }),
    );

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(model.ai.draft.status).toBe("locked");
  });

  test("marks the draft card available when a seed insight is selected", () => {
    const workflow = summarizeWorkerResult(
      transcriptResult({
        insights: [
          {
            id: 1,
            topic: "灵感",
            matchReason: "理由",
            followUpQuestions: ["问题"],
            suitableUse: "复盘",
            sourceChunkId: null,
          },
        ],
      }),
    );
    workflow.draftSeedInsightId = 1;

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(model.ai.draft.status).toBe("available");
  });

  test("re-locks the draft card after 启发灵感 regen clears the seed (6.5)", () => {
    // 6.5 visual half: finishInsightRetry("insights") clears draftSeedInsightId
    // (the insight ids change). The viewModel must re-project the draft card
    // back to "locked" so the generate action quietly re-disables.
    const workflow = summarizeWorkerResult(
      transcriptResult({
        insights: [
          {
            id: 1,
            topic: "灵感",
            matchReason: "理由",
            followUpQuestions: ["问题"],
            suitableUse: "复盘",
            sourceChunkId: null,
          },
        ],
      }),
    );
    workflow.draftSeedInsightId = 1;
    expect(createTaskWorkspaceViewModel(workflow, entitledAccount()).ai.draft.status).toBe(
      "available",
    );

    // Simulate the post-regen state: insights refreshed, seed cleared.
    workflow.draftSeedInsightId = null;

    expect(createTaskWorkspaceViewModel(workflow, entitledAccount()).ai.draft.status).toBe(
      "locked",
    );
  });

  test("keeps the draft card locked when insights are not ready even with a stale seed", () => {
    // If insights were never generated, the draft card stays locked regardless
    // of any seed value (defensive: the seed could not be valid without insights).
    const workflow = summarizeWorkerResult(transcriptResult());
    workflow.draftSeedInsightId = 1;

    const model = createTaskWorkspaceViewModel(workflow, entitledAccount());

    expect(model.ai.draft.status).toBe("locked");
  });
});
