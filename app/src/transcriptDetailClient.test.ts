import { describe, expect, test } from "vitest";
import {
  loadTranscriptDetail,
  saveTranscriptEdit,
  type TranscriptDetailCommandRunner,
  type TranscriptDetailResponse,
} from "./transcriptDetailClient";

describe("transcript detail client", () => {
  test("loads transcript detail through the Tauri command wire shape", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: TranscriptDetailCommandRunner<TranscriptDetailResponse> = async (
      command,
      args,
    ) => {
      calls.push({ command, args });
      return {
        task_id: "task-1",
        text: "transcript",
        segments: [],
        audio_path: "D:\\FrameQ\\outputs\\tasks\\task-1\\media\\audio.wav",
        has_original_backup: false,
      };
    };

    const detail = await loadTranscriptDetail("task-1", runner);

    expect(detail.task_id).toBe("task-1");
    expect(detail.text).toBe("transcript");
    expect(calls).toEqual([
      {
        command: "load_transcript_detail",
        args: {
          request: {
            task_id: "task-1",
          },
        },
      },
    ]);
  });

  test("saves transcript edits with segment payload", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner = async (command: string, args: unknown) => {
      calls.push({ command, args });
      return {
        task_id: "task-1",
        text: "updated",
        artifacts: {
          transcript_txt: "transcript/transcript.txt",
          transcript_md: "transcript/transcript.md",
          segments: "transcript/segments.json",
        },
        has_original_backup: true,
      };
    };

    await saveTranscriptEdit(
      "task-1",
      "updated",
      [{ id: "seg-0001", start_ms: 0, end_ms: 1200, text: "updated" }],
      runner,
    );

    expect(calls).toEqual([
      {
        command: "save_transcript_edit",
        args: {
          request: {
            task_id: "task-1",
            text: "updated",
            segments: [{ id: "seg-0001", start_ms: 0, end_ms: 1200, text: "updated" }],
          },
        },
      },
    ]);
  });
});
