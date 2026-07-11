import { describe, expect, test } from "vitest";
import {
  WORKER_PROGRESS_EVENT,
  cancelProcess,
  processVideo,
  retryInsights,
  type CancelCommandRunner,
  type WorkerCommandRunner,
  type WorkerProgressListener,
} from "./workerClient";
import { buildPreferenceSnapshot } from "./insightPreferences";
import type { PreferenceSnapshot } from "./insightPreferences";
import type { WorkerResult } from "./workflow";

const TASK_ID = "20260705-153012-douyin-demo";
const TASK_DIR = "outputs/tasks/20260705-153012-douyin-demo";
const DEFAULT_INSIGHT: WorkerResult["insights"][number] = {
  id: 1,
  topic: "为什么流程编排可能比单点模型能力更关键？",
  matchReason: "文字稿强调流程编排与业务价值相关。",
  followUpQuestions: ["团队应该先改造哪条流程？"],
  suitableUse: "内容选题",
  sourceChunkId: 1,
};
const PREFERENCE_SNAPSHOT: PreferenceSnapshot = buildPreferenceSnapshot({
  profile: {
    role: "content_creator",
    domain: "content_media",
    stage: "experienced_professional",
    cityContext: "new_tier1_city",
    genderPerspective: "neutral_perspective",
    platforms: ["douyin"],
    defaultStyles: ["grounded"],
    defaultAvoid: ["clickbait"],
  },
  profileSkipped: false,
  generationPreferences: {
    goal: "content_creation",
    scenario: "short_video",
    angles: ["topic_angle"],
    audience: "fans_readers",
    styles: ["grounded"],
    avoid: ["clickbait"],
  },
});

function completedResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  const { artifacts, transcript, ...rest } = overrides;
  return {
    status: "completed",
    task_id: TASK_ID,
    task_dir: TASK_DIR,
    artifacts: {
      video: "media/video.mp4",
      audio: "media/audio.wav",
      transcript_txt: "transcript/transcript.txt",
      transcript_md: "transcript/transcript.md",
      summary: "ai/summary.md",
      mindmap: "ai/mindmap.mmd",
      insights: "ai/insights.json",
      ...(artifacts ?? {}),
    },
    text: "完整文字稿",
    summary: "# 要点总结",
    insights: [DEFAULT_INSIGHT],
    transcript: transcript ?? null,
    error: null,
    ...rest,
  };
}

describe("worker client", () => {
  test("invokes the Tauri process_video command with the submitted url", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: WorkerCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return completedResult();
    };

    const result = await processVideo(
      "https://www.douyin.com/video/7524373044106677544",
      runner,
    );

    expect(calls).toEqual([
      {
        command: "process_video",
        args: {
          request: {
            url: "https://www.douyin.com/video/7524373044106677544",
            language: "Chinese",
            output_formats: ["txt", "md"],
            model: "iic/SenseVoiceSmall",
            insightflow_mode: "embedded",
          },
        },
      },
    ]);
    expect(calls[0]?.args).not.toHaveProperty("request.generate_insights");
    expect(calls[0]?.args).not.toHaveProperty("request.preference_snapshot");
    expect(result.status).toBe("completed");
  });

  test("maps thrown Tauri errors to structured failed worker result", async () => {
    const runner: WorkerCommandRunner = async () => {
      throw new Error("worker process could not start");
    };

    const result = await processVideo(
      "https://www.douyin.com/video/7524373044106677544",
      runner,
    );

    expect(result).toEqual({
      status: "failed",
      task_id: null,
      task_dir: null,
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
      transcript: null,
      error: {
        code: "TAURI_COMMAND_FAILED",
        message: "worker process could not start",
        stage: "video_extracting",
      },
    });
  });

  test("subscribes to worker progress and unregisters after completion", async () => {
    const progressEvents: unknown[] = [];
    const unlistenCalls: string[] = [];
    const listener: WorkerProgressListener = async (eventName, handler) => {
      handler({
        event: eventName,
        id: 1,
        payload: {
          stage: "video_transcribing",
          message: "正在加载模型并开始转写。",
          progress: 68,
        },
      });
      return async () => {
        unlistenCalls.push(eventName);
      };
    };
    const runner: WorkerCommandRunner = async () => completedResult({
      text: "完整文字稿",
      summary: "",
      insights: [],
      artifacts: {
        video: "media/video.mp4",
        audio: "media/audio.wav",
        transcript_txt: "transcript/transcript.txt",
        transcript_md: "transcript/transcript.md",
      },
    });

    await processVideo(
      "https://www.douyin.com/video/7524373044106677544",
      runner,
      (event) => progressEvents.push(event),
      listener,
    );

    expect(progressEvents).toEqual([
      {
        stage: "video_transcribing",
        message: "正在加载模型并开始转写。",
        progress: 68,
      },
    ]);
    expect(unlistenCalls).toEqual([WORKER_PROGRESS_EVENT]);
  });

  test("invokes the Tauri retry_insights command for summary generation", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: WorkerCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return completedResult({
        text: "已经完成的文字稿。",
        summary: "# 要点总结",
        insights: [
          {
            ...DEFAULT_INSIGHT,
            topic: "为什么重试应该只重新生成话题点？",
          },
        ],
      });
    };

    const result = await retryInsights(TASK_ID, "summary", null, runner);

    expect(calls).toEqual([
      {
        command: "retry_insights",
        args: {
          request: {
            task_id: TASK_ID,
            target: "summary",
          },
        },
      },
    ]);
    expect(result.status).toBe("completed");
  });

  test("invokes the retry command with an optional preference snapshot", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: WorkerCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return completedResult();
    };

    const result = await retryInsights(TASK_ID, "insights", PREFERENCE_SNAPSHOT, runner);

    expect(calls).toEqual([
      {
        command: "retry_insights",
        args: {
          request: {
            task_id: TASK_ID,
            target: "insights",
            preference_snapshot: PREFERENCE_SNAPSHOT,
          },
        },
      },
    ]);
    expect(result.status).toBe("completed");
  });

  test("preserves existing transcript when the retry command fails", async () => {
    const runner: WorkerCommandRunner = async () => {
      throw new Error("retry worker process could not start");
    };

    const result = await retryInsights(TASK_ID, "summary", null, runner);

    expect(result).toEqual({
      status: "partial_completed",
      task_id: TASK_ID,
      task_dir: null,
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
      transcript: null,
      error: {
        code: "TAURI_COMMAND_FAILED",
        message: "retry worker process could not start",
        stage: "insights_generating",
      },
    });
  });

  test("invokes the Tauri cancel_process command", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: CancelCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { status: "cancelling" };
    };

    const result = await cancelProcess(runner);

    expect(calls).toEqual([{ command: "cancel_process", args: {} }]);
    expect(result).toEqual({ status: "cancelling" });
  });

  test("maps cancel command errors to a structured failed result", async () => {
    const runner: CancelCommandRunner = async () => {
      throw new Error("worker process could not be terminated");
    };

    const result = await cancelProcess(runner);

    expect(result).toEqual({
      status: "failed",
      error: "worker process could not be terminated",
    });
  });
});
