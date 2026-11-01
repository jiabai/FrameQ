import { finishNoteTitleGeneration, type WorkerResult, type WorkflowState } from "../../workflow";

export function shouldGenerateNoteTitle(result: WorkerResult): boolean {
  return result.task_created === true &&
    result.status !== "failed" &&
    Boolean(result.task_id && result.artifacts.transcript_txt) &&
    result.error?.code !== "WORKER_CANCELLED" &&
    result.note_title?.status !== "completed";
}

export function bindNoteTitleResult(result: WorkerResult, taskId: string): WorkerResult {
  if (result.task_id === null || result.task_id === taskId) return { ...result, task_id: taskId };
  return {
    ...result,
    task_id: taskId,
    status: "partial_completed",
    note_title: null,
    error: { code: "WORKER_PROTOCOL_VIOLATION", message: "", stage: "title_generating" },
  };
}

export function completedNoteResult(localResult: WorkerResult, state: WorkflowState): WorkerResult {
  return {
    ...localResult,
    status: state.stage === "completed" ? "completed" : "partial_completed",
    task_id: state.taskId,
    task_dir: state.taskDir,
    text: state.text,
    artifacts: state.artifacts,
    transcript: state.transcript,
    summary: state.summary,
    insights: state.insights,
    dissection: state.dissection,
    draft: state.draft,
    note_title: state.noteTitle,
    error: state.error,
  };
}

export function finishCancelledTitleAttempt(state: WorkflowState, result: WorkerResult): WorkflowState {
  if (!state.taskId) return state;
  const bound = bindNoteTitleResult(result, state.taskId);
  const committed = bound.note_title ? { ...state, noteTitle: bound.note_title } : state;
  return finishNoteTitleGeneration(committed, bound);
}
