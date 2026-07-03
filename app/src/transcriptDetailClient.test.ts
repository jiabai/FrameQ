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
        text: "transcript",
        segments: [],
        audio_path: "D:\\FrameQ\\work\\demo.wav",
        has_original_backup: false,
      };
    };

    const detail = await loadTranscriptDetail(
      "D:\\FrameQ\\outputs\\demo_transcript.txt",
      "D:\\FrameQ\\work\\demo.wav",
      runner,
    );

    expect(detail.text).toBe("transcript");
    expect(calls).toEqual([
      {
        command: "load_transcript_detail",
        args: {
          request: {
            transcript_path: "D:\\FrameQ\\outputs\\demo_transcript.txt",
            audio_path: "D:\\FrameQ\\work\\demo.wav",
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
        text: "updated",
        transcript_path: "D:\\FrameQ\\outputs\\demo_transcript.txt",
        segments_path: "D:\\FrameQ\\outputs\\demo_transcript_segments.json",
        has_original_backup: true,
      };
    };

    await saveTranscriptEdit(
      "D:\\FrameQ\\outputs\\demo_transcript.txt",
      "updated",
      [{ id: "seg-0001", start_ms: 0, end_ms: 1200, text: "updated" }],
      runner,
    );

    expect(calls).toEqual([
      {
        command: "save_transcript_edit",
        args: {
          request: {
            transcript_path: "D:\\FrameQ\\outputs\\demo_transcript.txt",
            text: "updated",
            segments: [{ id: "seg-0001", start_ms: 0, end_ms: 1200, text: "updated" }],
          },
        },
      },
    ]);
  });
});
