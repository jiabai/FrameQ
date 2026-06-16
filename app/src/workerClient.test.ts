import { describe, expect, test } from "vitest";
import {
  WORKER_PROGRESS_EVENT,
  processVideo,
  retryInsights,
  type WorkerCommandRunner,
  type WorkerProgressListener,
} from "./workerClient";

describe("worker client", () => {
  test("invokes the Tauri process_video command with the submitted url", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: WorkerCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        status: "completed",
        text: "完整文字稿",
        insights: ["为什么流程编排可能比单点模型能力更关键？"],
        transcript_path: "outputs/demo_transcript.txt",
        insights_path: "outputs/demo_insights.json",
        error: null,
      };
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
            model: "Qwen/Qwen3-ASR-0.6B",
            generate_insights: true,
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
      text: "",
      insights: [],
      transcript_path: null,
      insights_path: null,
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
    const runner: WorkerCommandRunner = async () => ({
      status: "completed",
      text: "完整文字稿",
      insights: [],
      transcript_path: "outputs/demo_transcript.txt",
      insights_path: null,
      error: null,
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

  test("invokes the Tauri retry_insights command with existing transcript data", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: WorkerCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        status: "completed",
        text: "已经完成的文字稿。",
        insights: ["为什么重试应该只重新生成话题点？"],
        transcript_path: "outputs/demo_transcript.txt",
        insights_path: "outputs/demo_insights.json",
        error: null,
      };
    };

    const result = await retryInsights(
      "outputs/demo_transcript.txt",
      "已经完成的文字稿。",
      runner,
    );

    expect(calls).toEqual([
      {
        command: "retry_insights",
        args: {
          request: {
            transcript_path: "outputs/demo_transcript.txt",
            text: "已经完成的文字稿。",
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

    const result = await retryInsights(
      "outputs/demo_transcript.txt",
      "已经完成的文字稿。",
      runner,
    );

    expect(result).toEqual({
      status: "partial_completed",
      text: "已经完成的文字稿。",
      insights: [],
      transcript_path: "outputs/demo_transcript.txt",
      insights_path: null,
      error: {
        code: "TAURI_COMMAND_FAILED",
        message: "retry worker process could not start",
        stage: "insights_generating",
      },
    });
  });
});
