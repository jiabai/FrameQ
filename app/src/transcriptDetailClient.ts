import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type { TaskArtifacts } from "./workflow";

export type TranscriptSegment = {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker?: string | null;
};

export type TranscriptDetailResponse = {
  task_id: string;
  text: string;
  segments: TranscriptSegment[];
  audio_path: string | null;
  has_original_backup: boolean;
};

export type SaveTranscriptEditResponse = {
  task_id: string;
  text: string;
  artifacts: TaskArtifacts;
  has_original_backup: boolean;
};

export type TranscriptDetailCommandRunner<T> = (
  command: string,
  args: InvokeArgs,
) => Promise<T>;

const defaultDetailRunner = <T>(command: string, args: InvokeArgs) =>
  invoke<T>(command, args);

export async function loadTranscriptDetail(
  taskId: string,
  runner: TranscriptDetailCommandRunner<TranscriptDetailResponse> = defaultDetailRunner,
): Promise<TranscriptDetailResponse> {
  return runner("load_transcript_detail", {
    request: {
      task_id: taskId,
    },
  });
}

export async function saveTranscriptEdit(
  taskId: string,
  text: string,
  segments: TranscriptSegment[],
  runner: TranscriptDetailCommandRunner<SaveTranscriptEditResponse> = defaultDetailRunner,
): Promise<SaveTranscriptEditResponse> {
  return runner("save_transcript_edit", {
    request: {
      task_id: taskId,
      text,
      segments,
    },
  });
}
