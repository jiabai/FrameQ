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
import type { WorkerResult } from "./workflow";

const TASK_ID = "20260705-153012-douyin-demo";
const TASK_DIR = "outputs/tasks/20260705-153012-douyin-demo";

function completedResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  const { artifacts, ...rest } = overrides;
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
    insights: ["为什么流程编排可能比单点模型能力更关键？"],
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
            generate_insights: false,
            insightflow_mode: "embedded",
          },
        },
      },
    ]);
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

  test("invokes the Tauri retry_insights command with a task id", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: WorkerCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return completedResult({
        text: "已经完成的文字稿。",
        summary: "# 要点总结",
        insights: ["为什么重试应该只重新生成话题点？"],
      });
    };

    const result = await retryInsights(TASK_ID, runner);

    expect(calls).toEqual([
      {
        command: "retry_insights",
        args: {
          request: {
            task_id: TASK_ID,
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

    const result = await retryInsights(TASK_ID, runner);

    expect(result).toEqual({
      status: "partial_completed",
      task_id: TASK_ID,
      task_dir: null,
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
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
      return { cancelled: true };
    };

    const result = await cancelProcess(runner);

    expect(calls).toEqual([{ command: "cancel_process", args: {} }]);
    expect(result).toEqual({ cancelled: true });
  });

  test("maps cancel command errors to a non-cancelled result", async () => {
    const runner: CancelCommandRunner = async () => {
      throw new Error("worker process could not be terminated");
    };

    const result = await cancelProcess(runner);

    expect(result).toEqual({
      cancelled: false,
      error: "worker process could not be terminated",
    });
  });
});
