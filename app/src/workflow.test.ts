import { describe, expect, test } from "vitest";
import {
  cancelProcessing,
  canSubmitUrl,
  confirmProcessingCancellation,
  createInitialWorkflow,
  formatWorkerError,
  getDetailText,
  getExportPath,
  getTranscriptSourceLabel,
  getToolbarNewTaskButtonState,
  getVisibleWorkflowError,
  isProcessingStage,
  mergeProgressEvent,
  normalizeSubmitUrl,
  requestProcessingCancellation,
  restoreProcessingAfterCancellationFailure,
  startProcessing,
  startInsightRetry,
  summarizeWorkerResult,
  type WorkerResult,
} from "./workflow";

const TASK_ID = "20260705-153012-douyin-demo";
const TASK_DIR = "outputs/tasks/20260705-153012-douyin-demo";
const DEFAULT_ARTIFACTS = {
  video: "media/video.mp4",
  audio: "media/audio.wav",
  transcript_txt: "transcript/transcript.txt",
  transcript_md: "transcript/transcript.md",
  summary: "ai/summary.md",
  mindmap: "ai/mindmap.mmd",
  insights: "ai/insights.json",
  insights_md: "ai/insights.md",
} satisfies WorkerResult["artifacts"];
const DEFAULT_INSIGHT: WorkerResult["insights"][number] = {
  id: 1,
  topic: "第一个话题点",
  matchReason: "匹配理由",
  followUpQuestions: ["第一个启发问题"],
  suitableUse: "内容选题",
  sourceChunkId: 1,
};
const SECOND_INSIGHT: WorkerResult["insights"][number] = {
  id: 2,
  topic: "第二个话题点",
  matchReason: "第二个匹配理由",
  followUpQuestions: ["第二个启发问题"],
  suitableUse: "团队分享",
  sourceChunkId: 2,
};

function workerResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  const { artifacts, ...rest } = overrides;
  return {
    status: "completed",
    task_id: TASK_ID,
    task_dir: TASK_DIR,
    artifacts: artifacts ?? DEFAULT_ARTIFACTS,
    text: "完整文字稿",
    summary: "# 要点总结",
    insights: [DEFAULT_INSIGHT],
    transcript: null,
    error: null,
    ...rest,
  };
}

describe("workflow state model", () => {
  test("allows supported Douyin and Xiaohongshu video urls to be submitted", () => {
    expect(canSubmitUrl("")).toBe(false);
    expect(canSubmitUrl("https://example.com/video/1")).toBe(false);
    expect(canSubmitUrl("https://notdouyin.com/video/7524373044106677544")).toBe(false);
    expect(canSubmitUrl("https://evil-douyin.com/video/7524373044106677544")).toBe(false);
    expect(canSubmitUrl("https://www.douyin.com/video/7524373044106677544")).toBe(true);
    expect(canSubmitUrl("https://www.douyin.com/note/7653372612151692594")).toBe(true);
    expect(canSubmitUrl("https://www.douyin.com/share/slides/7653372612151692594")).toBe(true);
    expect(
      canSubmitUrl("https://www.douyin.com/note/123?modal_id=7653372612151692594"),
    ).toBe(true);
    expect(canSubmitUrl("https://www.douyin.com/?aweme_id=7653372612151692594")).toBe(true);
    expect(
      canSubmitUrl(
        "copy https://www.douyin.com/share/slides/7653372612151692594 more text",
      ),
    ).toBe(true);
    expect(canSubmitUrl("https://v.douyin.com/LllWTdm3-Dg/")).toBe(true);
    expect(canSubmitUrl("https://v.douyin.com/")).toBe(false);
    expect(canSubmitUrl("http://xhslink.com/o/jQzXcxNapU")).toBe(true);
    expect(canSubmitUrl("https://xhslink.com/o/jQzXcxNapU")).toBe(true);
    expect(canSubmitUrl("https://www.xhslink.com/demo")).toBe(true);
    expect(
      canSubmitUrl(
        "复制小红书笔记 https://www.xiaohongshu.com/explore/0123456789abcdef01234568?xsec_token=tok",
      ),
    ).toBe(true);
    expect(canSubmitUrl("0123456789abcdef01234568")).toBe(true);
    expect(canSubmitUrl("https://www.bilibili.com/video/BV1Aa411c7mD?p=2")).toBe(true);
    expect(canSubmitUrl("https://www.bilibili.com/video/av170001")).toBe(true);
    expect(canSubmitUrl("copy https://b23.tv/demo more text")).toBe(true);
    expect(canSubmitUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(canSubmitUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(canSubmitUrl("https://www.youtube.com/shorts/abcDEF_123-")).toBe(true);
    expect(
      canSubmitUrl(
        "copy https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123 more text",
      ),
    ).toBe(true);
    expect(canSubmitUrl("http://xhslink.com/o/")).toBe(false);
    expect(canSubmitUrl("https://evil-xhslink.com/o/jQzXcxNapU")).toBe(false);
    expect(canSubmitUrl("https://xhslink.com.evil/o/jQzXcxNapU")).toBe(false);
    expect(
      canSubmitUrl("https://xiaohongshu.com.evil/explore/0123456789abcdef01234568"),
    ).toBe(false);
    expect(canSubmitUrl("https://www.bilibili.com/bangumi/play/ep123456")).toBe(false);
    expect(canSubmitUrl("https://b23.tv/")).toBe(false);
    expect(canSubmitUrl("https://b23.tv.evil/demo")).toBe(false);
    expect(canSubmitUrl("https://www.youtube.com/playlist?list=PL123")).toBe(false);
    expect(canSubmitUrl("https://www.youtube.com/channel/UC123")).toBe(false);
    expect(canSubmitUrl("https://www.youtube.com/@frameq")).toBe(false);
    expect(canSubmitUrl("https://youtu.be/")).toBe(false);
    expect(canSubmitUrl("https://youtube.com.evil/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(canSubmitUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(canSubmitUrl("ftp://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });

  test("normalizes submitted share text to the supported url", () => {
    expect(
      normalizeSubmitUrl(
        "copy https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123 more text",
      ),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123");
    expect(normalizeSubmitUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://youtu.be/dQw4w9WgXcQ",
    );
    expect(normalizeSubmitUrl("0123456789abcdef01234568")).toBe(
      "0123456789abcdef01234568",
    );
    expect(normalizeSubmitUrl("https://www.youtube.com/playlist?list=PL123")).toBeNull();
  });

  test("starts processing by hiding input and entering video extraction", () => {
    const state = startProcessing(
      createInitialWorkflow(),
      "https://www.douyin.com/video/7524373044106677544",
    );

    expect(state.stage).toBe("video_extracting");
    expect(state.submittedUrl).toBe("https://www.douyin.com/video/7524373044106677544");
    expect(state.showUrlInput).toBe(false);
  });

  test("summarizes transcript source metadata for platform subtitles", () => {
    const state = summarizeWorkerResult(workerResult({
      transcript: {
        source: "subtitle",
        language: "zh-Hans",
        engine: null,
      },
    }));

    expect(state.transcript).toEqual({
      source: "subtitle",
      language: "zh-Hans",
      engine: null,
    });
    expect(getTranscriptSourceLabel(state)).toBe("来源：平台字幕（zh-Hans）");
  });

  test("partial insight failure exposes a visible workflow error", () => {
    const state = summarizeWorkerResult(workerResult({
      status: "partial_completed",
      text: "已经完成的文字稿",
      summary: "# 要点总结\n\n## 总览\n已生成总结。",
      insights: [],
      artifacts: {
        video: DEFAULT_ARTIFACTS.video,
        audio: DEFAULT_ARTIFACTS.audio,
        transcript_txt: DEFAULT_ARTIFACTS.transcript_txt,
        transcript_md: DEFAULT_ARTIFACTS.transcript_md,
        summary: DEFAULT_ARTIFACTS.summary,
        mindmap: DEFAULT_ARTIFACTS.mindmap,
      },
      error: {
        code: "INSIGHTFLOW_LLM_REQUEST_FAILED",
        message: "LLM request failed with HTTP 400.",
        stage: "insights_generating",
      },
    }));

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

  test("toolbar new-task action is disabled only while processing", () => {
    for (const stage of ["video_extracting", "video_transcribing", "insights_generating"] as const) {
      expect(getToolbarNewTaskButtonState(stage)).toEqual({
        disabled: true,
        ariaLabel: "处理中不可开始新任务，请先取消或等待完成",
        title: "处理中不可开始新任务，请先取消或等待完成",
      });
    }

    for (const stage of ["waiting_input", "completed", "partial_completed", "failed"] as const) {
      expect(getToolbarNewTaskButtonState(stage)).toEqual({
        disabled: false,
        ariaLabel: "开始新任务",
        title: "开始新任务",
      });
    }
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

    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "XHS_IMAGE_ONLY: Xiaohongshu note is image-only.",
        stage: "video_extracting",
      }),
    ).toBe(
      "小红书图文笔记暂不支持转写，请换公开视频笔记链接后重试。原始错误：XHS_IMAGE_ONLY: Xiaohongshu note is image-only.",
    );

    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "XHS_DOWNLOAD_STALLED: public media stream stopped sending data.",
        stage: "video_extracting",
      }),
    ).toBe(
      "小红书视频下载长时间没有进展，请检查网络后重试，或重新复制公开视频链接。原始错误：XHS_DOWNLOAD_STALLED: public media stream stopped sending data.",
    );

    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "BILIBILI_DRM_PROTECTED: selected DASH stream is DRM protected.",
        stage: "video_extracting",
      }),
    ).toBe(
      "该 Bilibili 视频包含 DRM 或受保护内容，FrameQ 当前不会尝试解密或绕过权限。原始错误：BILIBILI_DRM_PROTECTED: selected DASH stream is DRM protected.",
    );

    expect(
      formatWorkerError({
        code: "VIDEO_DOWNLOAD_FAILED",
        message: "BILIBILI_FFMPEG_MERGE_FAILED: ffmpeg exited with code 1.",
        stage: "video_extracting",
      }),
    ).toBe(
      "Bilibili 视频和音频已下载但合并失败，请确认 FFmpeg 可用后重试。原始错误：BILIBILI_FFMPEG_MERGE_FAILED: ffmpeg exited with code 1.",
    );

    const youtubeLoginMessage = formatWorkerError({
      code: "VIDEO_DOWNLOAD_FAILED",
      message: "YOUTUBE_LOGIN_REQUIRED: Sign in to confirm you are not a bot. Use --cookies.",
      stage: "video_extracting",
    });
    expect(youtubeLoginMessage).toContain("YouTube");
    expect(youtubeLoginMessage).toContain("公开视频");
    expect(youtubeLoginMessage).not.toContain("--cookies");

    const youtubeAgeMessage = formatWorkerError({
      code: "VIDEO_DOWNLOAD_FAILED",
      message: "YOUTUBE_AGE_RESTRICTED: This video is age restricted.",
      stage: "video_extracting",
    });
    expect(youtubeAgeMessage).toContain("YouTube");
    expect(youtubeAgeMessage).toContain("年龄");

    const youtubePrivateMessage = formatWorkerError({
      code: "VIDEO_DOWNLOAD_FAILED",
      message: "YOUTUBE_PRIVATE_OR_UNAVAILABLE: Video unavailable.",
      stage: "video_extracting",
    });
    expect(youtubePrivateMessage).toContain("YouTube");
    expect(youtubePrivateMessage).toContain("不可公开访问");

    const youtubeNoStreamMessage = formatWorkerError({
      code: "VIDEO_DOWNLOAD_FAILED",
      message: "YOUTUBE_NO_PLAYABLE_STREAM: No video formats found.",
      stage: "video_extracting",
    });
    expect(youtubeNoStreamMessage).toContain("YouTube");
    expect(youtubeNoStreamMessage).toContain("可下载");
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
        message: "No cloud LLM API-call uses are available for this account.",
        stage: "insights_generating",
      }),
    ).toBe("启发灵感额度不足，请续费或请管理员调整额度后重试。");

    expect(
      formatWorkerError({
        code: "INSIGHTFLOW_LLM_CONTENT_BLOCKED",
        message:
          "LLM provider blocked the request with its content safety policy. Provider detail: content_policy_violation.",
        stage: "insights_generating",
      }),
    ).toBe(
      "文字稿可能触发了云端 LLM 的内容安全策略，当前服务拒绝生成启发灵感。请确认视频内容可被该模型处理，或请管理员更换模型/供应商后重试。原始错误：LLM provider blocked the request with its content safety policy. Provider detail: content_policy_violation.",
    );

    expect(
      formatWorkerError({
        code: "INSIGHTFLOW_EMPTY_RESULT",
        message: "InsightFlow returned no insights.",
        stage: "insights_generating",
      }),
    ).toBe(
      "云端 LLM 没有返回可用的启发灵感，请稍后重试或更换模型配置。原始错误：InsightFlow returned no insights.",
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
    const state = summarizeWorkerResult(workerResult({
      text: "完整文字稿",
      summary: "# 要点总结\n\n- 第一个要点",
      insights: [DEFAULT_INSIGHT, SECOND_INSIGHT],
    }));

    expect(getDetailText("transcript", state)).toBe("完整文字稿");
    expect(getDetailText("summary", state)).toBe("# 要点总结\n\n- 第一个要点");
    expect(getDetailText("insights", state)).toBe(
      [
        "1. 第一个话题点",
        "匹配理由：匹配理由",
        "启发问题：第一个启发问题",
        "适合用途：内容选题",
        "来源片段：1",
        "",
        "2. 第二个话题点",
        "匹配理由：第二个匹配理由",
        "启发问题：第二个启发问题",
        "适合用途：团队分享",
        "来源片段：2",
      ].join("\n"),
    );
  });

  test("selects generated export path for each detail tab", () => {
    const state = summarizeWorkerResult(workerResult({
      text: "完整文字稿",
      summary: "# 要点总结",
      insights: [DEFAULT_INSIGHT],
    }));

    expect(getExportPath("video", state)).toBe(`${TASK_DIR}/media/video.mp4`);
    expect(getExportPath("audio", state)).toBe(`${TASK_DIR}/media/audio.wav`);
    expect(getExportPath("transcript", state)).toBe(`${TASK_DIR}/transcript/transcript.txt`);
    expect(getExportPath("summary", state)).toBe(`${TASK_DIR}/ai/summary.md`);
    expect(getExportPath("insights", state)).toBe(`${TASK_DIR}/ai/insights.md`);
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

  test("starts summary generation without discarding the existing transcript", () => {
    const state = summarizeWorkerResult(workerResult({
      status: "completed",
      text: "已经完成的文字稿。",
      summary: "",
      insights: [DEFAULT_INSIGHT],
      artifacts: {
        video: DEFAULT_ARTIFACTS.video,
        audio: DEFAULT_ARTIFACTS.audio,
        transcript_txt: DEFAULT_ARTIFACTS.transcript_txt,
        transcript_md: DEFAULT_ARTIFACTS.transcript_md,
        insights: DEFAULT_ARTIFACTS.insights,
        insights_md: DEFAULT_ARTIFACTS.insights_md,
      },
    }));

    const retrying = startInsightRetry(state, "summary");

    expect(retrying.stage).toBe("insights_generating");
    expect(retrying.statusMessage).toBe(
      "正在生成要点总结和 Mermaid mindmap；文字稿片段会发送到管理员配置的云端 LLM 服务。",
    );
    expect(retrying.progressPercent).toBe(88);
    expect(retrying.text).toBe("已经完成的文字稿。");
    expect(retrying.insights).toEqual([DEFAULT_INSIGHT]);
    expect(retrying.taskId).toBe(TASK_ID);
    expect(retrying.taskDir).toBe(TASK_DIR);
    expect(retrying.artifacts.insights).toBe("ai/insights.json");
    expect(retrying.error).toBeNull();
  });

  test("starts insight generation without discarding the existing transcript", () => {
    const state = summarizeWorkerResult(workerResult({
      status: "partial_completed",
      text: "已经完成的文字稿。",
      summary: "# 要点总结\n\n## 总览\n旧总结会保留。",
      insights: [],
      artifacts: {
        video: DEFAULT_ARTIFACTS.video,
        audio: DEFAULT_ARTIFACTS.audio,
        transcript_txt: DEFAULT_ARTIFACTS.transcript_txt,
        transcript_md: DEFAULT_ARTIFACTS.transcript_md,
        summary: DEFAULT_ARTIFACTS.summary,
        mindmap: DEFAULT_ARTIFACTS.mindmap,
      },
      error: {
        code: "INSIGHTFLOW_CONFIG_MISSING",
        message: "InsightFlow LLM client is not configured.",
        stage: "insights_generating",
      },
    }));

    const retrying = startInsightRetry(state, "insights");

    expect(retrying.stage).toBe("insights_generating");
    expect(retrying.statusMessage).toBe(
      "正在生成启发灵感；文字稿片段和本次偏好会发送到管理员配置的云端 LLM 服务。",
    );
    expect(retrying.progressPercent).toBe(88);
    expect(retrying.text).toBe("已经完成的文字稿。");
    expect(retrying.summary).toBe("# 要点总结\n\n## 总览\n旧总结会保留。");
    expect(retrying.taskId).toBe(TASK_ID);
    expect(retrying.taskDir).toBe(TASK_DIR);
    expect(retrying.artifacts.video).toBe("media/video.mp4");
    expect(retrying.artifacts.audio).toBe("media/audio.wav");
    expect(retrying.artifacts.transcript_txt).toBe("transcript/transcript.txt");
    expect(retrying.artifacts.summary).toBe("ai/summary.md");
    expect(retrying.artifacts.mindmap).toBe("ai/mindmap.mmd");
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

  test("keeps the workflow active while cancellation is pending and restores it when signalling fails", () => {
    const running = startProcessing(
      createInitialWorkflow(),
      "https://www.douyin.com/video/7524373044106677544",
    );

    const cancelling = requestProcessingCancellation(running);

    expect(cancelling.stage).toBe("cancelling");
    expect(cancelling.cancellingFromStage).toBe("video_extracting");
    expect(cancelling.showUrlInput).toBe(false);
    expect(cancelling.submittedUrl).toBe(running.submittedUrl);
    expect(isProcessingStage(cancelling.stage)).toBe(true);

    const restored = restoreProcessingAfterCancellationFailure(cancelling, "tree termination failed");
    expect(restored.stage).toBe("video_extracting");
    expect(restored.statusMessage).toContain("tree termination failed");
    expect(restored.submittedUrl).toBe(running.submittedUrl);
  });

  test("returns to input only after cancellation is confirmed", () => {
    const cancelling = requestProcessingCancellation(
      startProcessing(
        createInitialWorkflow(),
        "https://www.douyin.com/video/7524373044106677544",
      ),
    );

    const cancelled = confirmProcessingCancellation(cancelling);
    expect(cancelled.stage).toBe("waiting_input");
    expect(cancelled.showUrlInput).toBe(true);
    expect(cancelled.url).toBe("https://www.douyin.com/video/7524373044106677544");
  });
});
