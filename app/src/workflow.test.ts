import { describe, expect, test } from "vitest";
import {
  cancelProcessing,
  canSubmitUrl,
  createInitialWorkflow,
  formatWorkerError,
  getDetailText,
  getExportPath,
  getProgressSteps,
  getResultCards,
  isProcessingStage,
  mergeProgressEvent,
  startProcessing,
  startInsightRetry,
  summarizeWorkerResult,
} from "./workflow";

describe("workflow state model", () => {
  test("allows only a single douyin video url to be submitted", () => {
    expect(canSubmitUrl("")).toBe(false);
    expect(canSubmitUrl("https://example.com/video/1")).toBe(false);
    expect(canSubmitUrl("https://www.douyin.com/video/7524373044106677544")).toBe(true);
  });

  test("starts processing by hiding input and entering video extraction", () => {
    const state = startProcessing(
      createInitialWorkflow(),
      "https://www.douyin.com/video/7524373044106677544",
    );

    expect(state.stage).toBe("video_extracting");
    expect(state.submittedUrl).toBe("https://www.douyin.com/video/7524373044106677544");
    expect(state.showUrlInput).toBe(false);
    expect(getProgressSteps(state).map((step) => step.label)).toEqual([
      "视频提取中",
      "视频转译中",
      "话题点生成中",
    ]);
  });

  test("completed worker result exposes both result cards", () => {
    const state = summarizeWorkerResult({
      status: "completed",
      text: "完整文字稿",
      insights: ["为什么流程编排可能比单点模型能力更关键？"],
      transcript_path: "outputs/demo_transcript.txt",
      insights_path: "outputs/demo_insights.json",
      error: null,
    });

    expect(state.stage).toBe("completed");
    expect(getResultCards(state).map((card) => card.id)).toEqual(["insights", "transcript"]);
  });

  test("partial worker result keeps transcript and marks insights retryable", () => {
    const state = summarizeWorkerResult({
      status: "partial_completed",
      text: "已经完成的文字稿",
      insights: [],
      transcript_path: "outputs/demo_transcript.txt",
      insights_path: null,
      error: {
        code: "INSIGHTFLOW_CONFIG_MISSING",
        message: "InsightFlow LLM configuration is missing.",
        stage: "insights_generating",
      },
    });

    expect(state.stage).toBe("partial_completed");
    expect(getResultCards(state)).toEqual([
      {
        id: "transcript",
        title: "完整文字稿",
        status: "ready",
        action: "open",
      },
      {
        id: "insights",
        title: "启发话题点",
        status: "failed",
        action: "retry",
      },
    ]);
  });

  test("cancel controls are only shown for active processing stages", () => {
    expect(isProcessingStage("video_extracting")).toBe(true);
    expect(isProcessingStage("video_transcribing")).toBe(true);
    expect(isProcessingStage("insights_generating")).toBe(true);
    expect(isProcessingStage("failed")).toBe(false);
    expect(isProcessingStage("completed")).toBe(false);
    expect(isProcessingStage("partial_completed")).toBe(false);
    expect(isProcessingStage("waiting_input")).toBe(false);
  });

  test("formats ASR readiness errors with actionable local setup guidance", () => {
    expect(
      formatWorkerError({
        code: "ASR_MODEL_NOT_READY",
        message: "Real ASR is disabled until model cache handling is configured.",
        stage: "video_transcribing",
      }),
    ).toBe(
      "真实 ASR 尚未启用。请用 FRAMEQ_ALLOW_REAL_ASR=1 启动应用，并确认 models/ 模型缓存目录可写。",
    );

    expect(
      formatWorkerError({
        code: "ASR_MODEL_CACHE_UNAVAILABLE",
        message: "Model cache directory is not writable.",
        stage: "video_transcribing",
      }),
    ).toBe("模型缓存目录不可写。请检查 FRAMEQ_MODEL_DIR 或项目 models/ 目录权限。");
  });

  test("formats missing ASR model download errors with a download hint", () => {
    expect(
      formatWorkerError({
        code: "ASR_MODEL_NOT_DOWNLOADED",
        message: "SenseVoice Small model is not downloaded yet.",
        stage: "video_transcribing",
      }),
    ).toBe("SenseVoice Small 尚未下载。请先在首启引导或设置中下载 ASR 模型，然后重新转写。");
  });

  test("formats detail text for clipboard copying", () => {
    const state = summarizeWorkerResult({
      status: "completed",
      text: "完整文字稿",
      insights: ["第一个话题点", "第二个话题点"],
      transcript_path: "outputs/demo_transcript.txt",
      insights_path: "outputs/demo_insights.json",
      error: null,
    });

    expect(getDetailText("transcript", state)).toBe("完整文字稿");
    expect(getDetailText("insights", state)).toBe("1. 第一个话题点\n2. 第二个话题点");
  });

  test("selects generated export path for each detail tab", () => {
    const state = summarizeWorkerResult({
      status: "completed",
      text: "完整文字稿",
      insights: ["第一个话题点"],
      transcript_path: "outputs/demo_transcript.txt",
      insights_path: "outputs/demo_insights.md",
      error: null,
    });

    expect(getExportPath("transcript", state)).toBe("outputs/demo_transcript.txt");
    expect(getExportPath("insights", state)).toBe("outputs/demo_insights.md");
    expect(getExportPath("insights", createInitialWorkflow())).toBeNull();
  });

  test("merges worker progress events into the visible workflow state", () => {
    const state = startProcessing(
      createInitialWorkflow(),
      "https://www.douyin.com/video/7524373044106677544",
    );

    const updated = mergeProgressEvent(state, {
      stage: "video_transcribing",
      message: "正在加载模型并开始转写。",
      progress: 68,
    });

    expect(updated.stage).toBe("video_transcribing");
    expect(updated.statusMessage).toBe("正在加载模型并开始转写。");
    expect(updated.progressPercent).toBe(68);
    expect(updated.showUrlInput).toBe(false);
  });

  test("starts an insight retry without discarding the existing transcript", () => {
    const state = summarizeWorkerResult({
      status: "partial_completed",
      text: "已经完成的文字稿。",
      insights: [],
      transcript_path: "outputs/demo_transcript.txt",
      insights_path: null,
      error: {
        code: "INSIGHTFLOW_CONFIG_MISSING",
        message: "InsightFlow LLM client is not configured.",
        stage: "insights_generating",
      },
    });

    const retrying = startInsightRetry(state);

    expect(retrying.stage).toBe("insights_generating");
    expect(retrying.statusMessage).toBe(
      "正在重新生成启发话题点；如已配置云端 LLM，文字稿会发送到该服务。",
    );
    expect(retrying.progressPercent).toBe(88);
    expect(retrying.text).toBe("已经完成的文字稿。");
    expect(retrying.transcriptPath).toBe("outputs/demo_transcript.txt");
    expect(retrying.error).toBeNull();
  });

  test("cancels active processing and returns to input with the submitted url", () => {
    const state = startProcessing(
      createInitialWorkflow(),
      "https://www.douyin.com/video/7524373044106677544",
    );

    const cancelled = cancelProcessing(state);

    expect(cancelled.stage).toBe("waiting_input");
    expect(cancelled.showUrlInput).toBe(true);
    expect(cancelled.url).toBe("https://www.douyin.com/video/7524373044106677544");
    expect(cancelled.submittedUrl).toBe("");
    expect(cancelled.statusMessage).toBe("");
    expect(cancelled.error).toBeNull();
  });
});
