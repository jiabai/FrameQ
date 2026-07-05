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
          task_id: "task-1",
          id: "task-1",
          created_at: "2026-06-17T10:00:00Z",
          url: "https://www.douyin.com/video/7646789377271647540",
          status: "completed",
          task_dir: "D:\\FrameQ\\outputs\\tasks\\task-1",
          output_dir: "D:\\FrameQ\\outputs",
          artifacts: {
            video: "media/video.mp4",
            audio: "media/audio.wav",
            transcript_txt: "transcript/transcript.txt",
            transcript_md: "transcript/transcript.md",
            summary: "ai/summary.md",
            mindmap: "ai/mindmap.mmd",
            insights: "ai/insights.json",
          },
          error: null,
          text_preview: "这是一段转写预览",
          insights_count: 2,
          text: "这是一段完整文字稿",
          summary: "# 要点总结\n\n- 历史总结",
          insights: ["第一个话题点", "第二个话题点"],
        },
      ];
    };

    const history = await getHistory(runner);

    expect(calls).toEqual([{ command: "get_history", args: {} }]);
    expect(history).toEqual([
      {
        taskId: "task-1",
        id: "task-1",
        createdAt: "2026-06-17T10:00:00Z",
        url: "https://www.douyin.com/video/7646789377271647540",
        status: "completed",
        taskDir: "D:\\FrameQ\\outputs\\tasks\\task-1",
        outputDir: "D:\\FrameQ\\outputs",
        artifacts: {
          video: "media/video.mp4",
          audio: "media/audio.wav",
          transcript_txt: "transcript/transcript.txt",
          transcript_md: "transcript/transcript.md",
          summary: "ai/summary.md",
          mindmap: "ai/mindmap.mmd",
          insights: "ai/insights.json",
        },
        error: null,
        textPreview: "这是一段转写预览",
        insightsCount: 2,
        text: "这是一段完整文字稿",
        summary: "# 要点总结\n\n- 历史总结",
        insights: ["第一个话题点", "第二个话题点"],
      },
    ]);
  });

  test("converts a history item into a workflow worker result", () => {
    const result = historyItemToWorkerResult({
      taskId: "task-2",
      id: "task-2",
      createdAt: "2026-06-17T11:00:00Z",
      url: "https://www.douyin.com/video/7646789377271647540",
      status: "partial_completed",
      taskDir: "D:\\FrameQ\\outputs\\tasks\\task-2",
      outputDir: "D:\\FrameQ\\outputs",
      artifacts: {
        transcript_txt: "transcript/transcript.txt",
        transcript_md: "transcript/transcript.md",
        summary: "ai/summary.md",
        mindmap: "ai/mindmap.mmd",
      },
      error: {
        code: "INSIGHTFLOW_CONFIG_MISSING",
        message: "LLM configuration is missing.",
        stage: "insights_generating",
      },
      textPreview: "已经完成的文字稿",
      insightsCount: 0,
      text: "已经完成的文字稿",
      summary: "# 要点总结",
      insights: [],
    });

    expect(result).toEqual({
      status: "partial_completed",
      task_id: "task-2",
      task_dir: "D:\\FrameQ\\outputs\\tasks\\task-2",
      artifacts: {
        transcript_txt: "transcript/transcript.txt",
        transcript_md: "transcript/transcript.md",
        summary: "ai/summary.md",
        mindmap: "ai/mindmap.mmd",
      },
      text: "已经完成的文字稿",
      summary: "# 要点总结",
      insights: [],
      error: {
        code: "INSIGHTFLOW_CONFIG_MISSING",
        message: "LLM configuration is missing.",
        stage: "insights_generating",
      },
    });
  });
});
