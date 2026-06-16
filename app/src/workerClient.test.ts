import { describe, expect, test } from "vitest";
import { processVideo, type WorkerCommandRunner } from "./workerClient";

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
});
