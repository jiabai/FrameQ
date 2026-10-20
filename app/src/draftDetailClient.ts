import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type { TaskArtifacts } from "./workflow";

export type DraftDetailResponse = {
  task_id: string;
  markdown: string;
  has_original_backup: boolean;
  draft_seed_insight_id: number | null;
};

export type SaveDraftEditResponse = {
  task_id: string;
  markdown: string;
  artifacts: TaskArtifacts;
  has_original_backup: boolean;
};

export type DraftDetailCommandRunner<T> = (
  command: string,
  args: InvokeArgs,
) => Promise<T>;

const defaultDraftRunner = <T>(command: string, args: InvokeArgs) =>
  invoke<T>(command, args);

export async function loadDraftDetail(
  taskId: string,
  runner: DraftDetailCommandRunner<DraftDetailResponse> = defaultDraftRunner,
): Promise<DraftDetailResponse> {
  return runner("load_draft_detail", { request: { task_id: taskId } });
}

export async function saveDraftEdit(
  taskId: string,
  markdown: string,
  runner: DraftDetailCommandRunner<SaveDraftEditResponse> = defaultDraftRunner,
): Promise<SaveDraftEditResponse> {
  return runner("save_draft_edit", { request: { task_id: taskId, markdown } });
}
