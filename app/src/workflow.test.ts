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
  getVisibleWorkflowError,
  isProcessingStage,
  mergeProgressEvent,
  startProcessing,
  startInsightRetry,
  summarizeWorkerResult,
} from "./workflow";

describe("workflow state model", () => {
  test("allows supported Douyin and Xiaohongshu video urls to be submitted", () => {
    expect(canSubmitUrl("")).toBe(false);
    expect(canSubmitUrl("https://example.com/video/1")).toBe(false);
    expect(canSubmitUrl("https://notdouyin.com/video/7524373044106677544")).toBe(false);
    expect(canSubmitUrl("https://evil-douyin.com/video/7524373044106677544")).toBe(false);
    expect(canSubmitUrl("https://www.douyin.com/video/7524373044106677544")).toBe(true);
    expect(canSubmitUrl("https://v.douyin.com/LllWTdm3-Dg/")).toBe(true);
    expect(canSubmitUrl("https://v.douyin.com/")).toBe(false);
    expect(canSubmitUrl("http://xhslink.com/o/jQzXcxNapU")).toBe(true);
    expect(canSubmitUrl("https://xhslink.com/o/jQzXcxNapU")).toBe(true);
    expect(canSubmitUrl("http://xhslink.com/o/")).toBe(false);
    expect(canSubmitUrl("https://evil-xhslink.com/o/jQzXcxNapU")).toBe(false);
    expect(canSubmitUrl("https://xhslink.com.evil/o/jQzXcxNapU")).toBe(false);
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
      "AI 整理中",
    ]);
  });

  test("completed worker result exposes both result cards", () => {
    const state = summarizeWorkerResult({
      status: "completed",
      video_path: "outputs/demo.mp4",
      audio_path: "work/demo.wav",
      text: "完整文字稿",
      summary: "# 要点总结\n\n## 总览\n这是总结。",
      insights: ["为什么流程编排可能比单点模型能力更关键？"],
      transcript_path: "outputs/demo_transcript.txt",
      summary_path: "outputs/demo_summary.md",
      mindmap_path: "outputs/demo_mindmap.mmd",
      insights_path: "outputs/demo_insights.json",
      error: null,
    });

    expect(state.stage).toBe("completed");
    expect(getResultCards(state).map((card) => card.id)).toEqual([
      "video",
      "audio",
      "transcript",
      "summary",
      "insights",
    ]);
  });

  test("completed transcript-only worker result marks insights pending", () => {
    const state = summarizeWorkerResult({
      status: "completed",
      video_path: "outputs/demo.mp4",
      audio_path: "work/demo.wav",
      text: "已经完成的文字稿",
      summary: "",
      insights: [],
      transcript_path: "outputs/demo_transcript.txt",
      summary_path: null,
      mindmap_path: null,
      insights_path: null,
      error: null,
    });

    expect(getResultCards(state)).toEqual([
      {
        id: "video",
        title: "视频文件",
        status: "ready",
        action: "locate",
      },
      {
        id: "audio",
        title: "音频文件",
        status: "ready",
        action: "locate",
      },
      {
        id: "transcript",
        title: "完整文字稿",
        status: "ready",
        action: "open",
      },
      {
        id: "summary",
        title: "要点总结",
        status: "pending",
        action: "confirm",
      },
      {
        id: "insights",
        title: "启发话题点",
        status: "pending",
        action: "confirm",
      },
    ]);
  });

  test("partial worker result keeps artifacts and marks insights retryable", () => {
    const state = summarizeWorkerResult({
      status: "partial_completed",
      video_path: "outputs/demo.mp4",
      audio_path: "work/demo.wav",
      text: "已经完成的文字稿",
      summary: "# 要点总结\n\n## 总览\n已生成总结。",
      insights: [],
      transcript_path: "outputs/demo_transcript.txt",
      summary_path: "outputs/demo_summary.md",
      mindmap_path: "outputs/demo_mindmap.mmd",
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
        id: "video",
        title: "视频文件",
        status: "ready",
        action: "locate",
      },
      {
        id: "audio",
        title: "音频文件",
        status: "ready",
        action: "locate",
      },
      {
        id: "transcript",
        title: "完整文字稿",
        status: "ready",
        action: "open",
      },
      {
        id: "summary",
        title: "要点总结",
        status: "ready",
        action: "open",
      },
      {
        id: "insights",
        title: "启发话题点",
        status: "failed",
        action: "confirm",
      },
    ]);
  });

  test("partial insight failure exposes a visible workflow error", () => {
    const state = summarizeWorkerResult({
      status: "partial_completed",
      video_path: "outputs/demo.mp4",
      audio_path: "work/demo.wav",
      text: "已经完成的文字稿",
      summary: "# 要点总结\n\n## 总览\n已生成总结。",
      insights: [],
      transcript_path: "outputs/demo_transcript.txt",
      summary_path: "outputs/demo_summary.md",
      mindmap_path: "outputs/demo_mindmap.mmd",
      insights_path: null,
      error: {
        code: "INSIGHTFLOW_LLM_REQUEST_FAILED",
        message: "LLM request failed with HTTP 400.",
        stage: "insights_generating",
      },
    });

    expect(getVisibleWorkflowError(state)).toEqual({
      code: "INSIGHTFLOW_LLM_REQUEST_FAILED",
      message: "LLM request failed with HTTP 400.",
      stage: "insights_generating",
    });
    expect(getVisibleWorkflowError(createInitialWorkflow())).toBeNull();
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
    ).toBe("ASR 模型尚未下载。请先在首启引导或设置中下载 ASR 模型，然后重新转写。");
  });

  test("formats video download failures with actionable recovery guidance", () => {
    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "ERROR: Unsupported URL: https://www.douyin.com/",
        stage: "video_extracting",
      }),
    ).toBe(
      "链接可能已过期或无效，请重新复制视频分享链接后再试。原始错误：ERROR: Unsupported URL: https://www.douyin.com/",
    );

    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "ERROR: Sign in to confirm you are not a bot. Use --cookies or solve captcha.",
        stage: "video_extracting",
      }),
    ).toBe(
      "平台要求登录或验证，当前无法直接下载，请换公开视频链接或稍后重试。原始错误：ERROR: Sign in to confirm you are not a bot. Use --cookies or solve captcha.",
    );

    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "ERROR: network connection timeout",
        stage: "video_extracting",
      }),
    ).toBe("网络连接失败，请检查网络后重试。原始错误：ERROR: network connection timeout");

    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "ERROR: extractor failed",
        stage: "video_extracting",
      }),
    ).toBe("视频下载失败，请确认链接可公开访问后重试。原始错误：ERROR: extractor failed");

    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "DOUYIN_NO_PLAYABLE_STREAM: public share page returned no playable streams.",
        stage: "video_extracting",
      }),
    ).toBe(
      "抖音公开视频分享页暂时没有返回可播放的视频流，请确认链接公开可访问后重试。原始错误：DOUYIN_NO_PLAYABLE_STREAM: public share page returned no playable streams.",
    );
  });

  test("formats insight generation failures with actionable recovery guidance", () => {
    expect(
      formatWorkerError({
        code: "INSIGHTFLOW_LLM_REQUEST_FAILED",
        message: "LLM request failed with HTTP 400.",
        stage: "insights_generating",
      }),
    ).toBe(
      "云端 LLM 请求失败，请检查管理员配置的服务地址、API key、模型权限或服务状态后重试。原始错误：LLM request failed with HTTP 400.",
    );

    expect(
      formatWorkerError({
        code: "INSIGHTFLOW_LLM_QUOTA_UNAVAILABLE",
        message: "No insight-generation uses are available for this account.",
        stage: "insights_generating",
      }),
    ).toBe("话题点额度不足，请续费或请管理员调整额度后重试。");

    expect(
      formatWorkerError({
        code: "INSIGHTFLOW_LLM_CONTENT_BLOCKED",
        message:
          "LLM provider blocked the request with its content safety policy. Provider detail: content_policy_violation.",
        stage: "insights_generating",
      }),
    ).toBe(
      "文字稿可能触发了云端 LLM 的内容安全策略，当前服务拒绝生成话题点。请确认视频内容可被该模型处理，或请管理员更换模型/供应商后重试。原始错误：LLM provider blocked the request with its content safety policy. Provider detail: content_policy_violation.",
    );

    expect(
      formatWorkerError({
        code: "INSIGHTFLOW_EMPTY_RESULT",
        message: "InsightFlow returned no insights.",
        stage: "insights_generating",
      }),
    ).toBe(
      "云端 LLM 没有返回可用的话题点，请稍后重试或更换模型配置。原始错误：InsightFlow returned no insights.",
    );

    expect(
      formatWorkerError({
        code: "INSIGHTFLOW_EMPTY_SUMMARY",
        message: "InsightFlow returned an empty summary.",
        stage: "insights_generating",
      }),
    ).toBe(
      "云端 LLM 没有返回可用的要点总结，请稍后重试或更换模型配置。原始错误：InsightFlow returned an empty summary.",
    );

    expect(
      formatWorkerError({
        code: "INSIGHTFLOW_INVALID_MINDMAP",
        message: "InsightFlow returned an invalid Mermaid mindmap.",
        stage: "insights_generating",
      }),
    ).toBe(
      "云端 LLM 返回的 Mermaid 思维导图格式不可用，请稍后重试或更换模型配置。原始错误：InsightFlow returned an invalid Mermaid mindmap.",
    );
  });

  test("formats detail text for clipboard copying", () => {
    const state = summarizeWorkerResult({
      status: "completed",
      video_path: "outputs/demo.mp4",
      audio_path: "work/demo.wav",
      text: "完整文字稿",
      summary: "# 要点总结\n\n- 第一个要点",
      insights: ["第一个话题点", "第二个话题点"],
      transcript_path: "outputs/demo_transcript.txt",
      summary_path: "outputs/demo_summary.md",
      mindmap_path: "outputs/demo_mindmap.mmd",
      insights_path: "outputs/demo_insights.json",
      error: null,
    });

    expect(getDetailText("transcript", state)).toBe("完整文字稿");
    expect(getDetailText("summary", state)).toBe("# 要点总结\n\n- 第一个要点");
    expect(getDetailText("insights", state)).toBe("1. 第一个话题点\n2. 第二个话题点");
  });

  test("selects generated export path for each detail tab", () => {
    const state = summarizeWorkerResult({
      status: "completed",
      video_path: "outputs/demo.mp4",
      audio_path: "work/demo.wav",
      text: "完整文字稿",
      summary: "# 要点总结",
      insights: ["第一个话题点"],
      transcript_path: "outputs/demo_transcript.txt",
      summary_path: "outputs/demo_summary.md",
      mindmap_path: "outputs/demo_mindmap.mmd",
      insights_path: "outputs/demo_insights.md",
      error: null,
    });

    expect(getExportPath("video", state)).toBe("outputs/demo.mp4");
    expect(getExportPath("audio", state)).toBe("work/demo.wav");
    expect(getExportPath("transcript", state)).toBe("outputs/demo_transcript.txt");
    expect(getExportPath("summary", state)).toBe("outputs/demo_summary.md");
    expect(getExportPath("insights", state)).toBe("outputs/demo_insights.md");
    expect(getExportPath("insights", createInitialWorkflow())).toBeNull();
    expect(getExportPath("summary", createInitialWorkflow())).toBeNull();
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
      video_path: "outputs/demo.mp4",
      audio_path: "work/demo.wav",
      text: "已经完成的文字稿。",
      summary: "# 要点总结\n\n## 总览\n旧总结会保留。",
      insights: [],
      transcript_path: "outputs/demo_transcript.txt",
      summary_path: "outputs/demo_summary.md",
      mindmap_path: "outputs/demo_mindmap.mmd",
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
      "正在生成要点总结和启发话题点；如已配置云端 LLM，文字稿会发送到该服务。",
    );
    expect(retrying.progressPercent).toBe(88);
    expect(retrying.text).toBe("已经完成的文字稿。");
    expect(retrying.summary).toBe("# 要点总结\n\n## 总览\n旧总结会保留。");
    expect(retrying.videoPath).toBe("outputs/demo.mp4");
    expect(retrying.audioPath).toBe("work/demo.wav");
    expect(retrying.transcriptPath).toBe("outputs/demo_transcript.txt");
    expect(retrying.summaryPath).toBe("outputs/demo_summary.md");
    expect(retrying.mindmapPath).toBe("outputs/demo_mindmap.mmd");
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
