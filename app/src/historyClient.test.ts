import { describe, expect, test } from "vitest";
import {
  getHistory,
  historyItemToWorkerResult,
  type HistoryCommandRunner,
} from "./historyClient";

describe("history client", () => {
  test("loads task history from Tauri and maps result fields", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: HistoryCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return [
        {
          id: "task-1",
          created_at: "2026-06-17T10:00:00Z",
          url: "https://www.douyin.com/video/7646789377271647540",
          status: "completed",
          output_dir: "D:\\FrameQ\\outputs",
          video_path: "D:\\FrameQ\\outputs\\task-1.mp4",
          audio_path: "D:\\FrameQ\\outputs\\task-1.wav",
          transcript_path: "D:\\FrameQ\\outputs\\task-1_transcript.txt",
          insights_path: "D:\\FrameQ\\outputs\\task-1_insights.json",
          error: null,
          text_preview: "这是一段转写预览",
          insights_count: 2,
          text: "这是一段完整文字稿",
          insights: ["第一个话题点", "第二个话题点"],
        },
      ];
    };

    const history = await getHistory(runner);

    expect(calls).toEqual([{ command: "get_history", args: {} }]);
    expect(history).toEqual([
      {
        id: "task-1",
        createdAt: "2026-06-17T10:00:00Z",
        url: "https://www.douyin.com/video/7646789377271647540",
        status: "completed",
        outputDir: "D:\\FrameQ\\outputs",
        videoPath: "D:\\FrameQ\\outputs\\task-1.mp4",
        audioPath: "D:\\FrameQ\\outputs\\task-1.wav",
        transcriptPath: "D:\\FrameQ\\outputs\\task-1_transcript.txt",
        insightsPath: "D:\\FrameQ\\outputs\\task-1_insights.json",
        error: null,
        textPreview: "这是一段转写预览",
        insightsCount: 2,
        text: "这是一段完整文字稿",
        insights: ["第一个话题点", "第二个话题点"],
      },
    ]);
  });

  test("converts a history item into a workflow worker result", () => {
    const result = historyItemToWorkerResult({
      id: "task-2",
      createdAt: "2026-06-17T11:00:00Z",
      url: "https://www.douyin.com/video/7646789377271647540",
      status: "partial_completed",
      outputDir: "D:\\FrameQ\\outputs",
      videoPath: null,
      audioPath: null,
      transcriptPath: "D:\\FrameQ\\outputs\\task-2_transcript.txt",
      insightsPath: null,
      error: {
        code: "INSIGHTFLOW_CONFIG_MISSING",
        message: "LLM configuration is missing.",
        stage: "insights_generating",
      },
      textPreview: "已经完成的文字稿",
      insightsCount: 0,
      text: "已经完成的文字稿",
      insights: [],
    });

    expect(result).toEqual({
      status: "partial_completed",
      video_path: null,
      audio_path: null,
      text: "已经完成的文字稿",
      insights: [],
      transcript_path: "D:\\FrameQ\\outputs\\task-2_transcript.txt",
      insights_path: null,
      error: {
        code: "INSIGHTFLOW_CONFIG_MISSING",
        message: "LLM configuration is missing.",
        stage: "insights_generating",
      },
    });
  });
});
