import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";

export type TranscriptSegment = {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker?: string | null;
};

export type TranscriptDetailResponse = {
  text: string;
  segments: TranscriptSegment[];
  audio_path: string | null;
  has_original_backup: boolean;
};

export type SaveTranscriptEditResponse = {
  text: string;
  transcript_path: string;
  segments_path: string | null;
  has_original_backup: boolean;
};

export type TranscriptDetailCommandRunner<T> = (
  command: string,
  args: InvokeArgs,
) => Promise<T>;

const defaultDetailRunner = <T>(command: string, args: InvokeArgs) =>
  invoke<T>(command, args);

export async function loadTranscriptDetail(
  transcriptPath: string,
  audioPath: string | null,
  runner: TranscriptDetailCommandRunner<TranscriptDetailResponse> = defaultDetailRunner,
): Promise<TranscriptDetailResponse> {
  return runner("load_transcript_detail", {
    request: {
      transcript_path: transcriptPath,
      audio_path: audioPath,
    },
  });
}

export async function saveTranscriptEdit(
  transcriptPath: string,
  text: string,
  segments: TranscriptSegment[],
  runner: TranscriptDetailCommandRunner<SaveTranscriptEditResponse> = defaultDetailRunner,
): Promise<SaveTranscriptEditResponse> {
  return runner("save_transcript_edit", {
    request: {
      transcript_path: transcriptPath,
      text,
      segments,
    },
  });
}
