import type { WorkerResult } from "../../workflowState";

export type CollectionNoteCreationResult = Pick<WorkerResult, "status" | "task_id" | "artifacts" | "error">;

type CollectionNoteIdentity = { intentId: number; collectionId: string };
export type CollectionNoteAttachment = CollectionNoteIdentity & {
  phase: "attaching";
  taskId: string;
  attemptId: number;
};

export type CollectionNoteCreationState =
  | { phase: "idle"; intentId: number }
  | (CollectionNoteIdentity & { phase: "composing" })
  | CollectionNoteAttachment
  | (Omit<CollectionNoteAttachment, "phase"> & { phase: "failed" });

export type CollectionNoteCreationAction =
  | { type: "begin"; collectionId: string }
  | { type: "clear" }
  | { type: "task_deleted"; taskId: string }
  | { type: "local_completed"; intentId: number; result: CollectionNoteCreationResult | undefined }
  | { type: "attachment_finished"; intentId: number; attemptId: number; success: boolean }
  | { type: "retry" };

export function createCollectionNoteCreation(): CollectionNoteCreationState {
  return { phase: "idle", intentId: 0 };
}

function completedTaskId(result: CollectionNoteCreationResult | undefined): string | null {
  if (
    !result ||
    (result.status !== "completed" && result.status !== "partial_completed") ||
    (result.error?.code === "WORKER_CANCELLED" && result.error.stage !== "title_generating") ||
    !result.task_id?.trim() ||
    result.task_id !== result.task_id.trim() ||
    !result.artifacts.transcript_txt?.trim()
  ) return null;
  return result.task_id;
}

export function collectionNoteCreationReducer(
  state: CollectionNoteCreationState,
  action: CollectionNoteCreationAction,
): CollectionNoteCreationState {
  switch (action.type) {
    case "begin":
      return { phase: "composing", intentId: state.intentId + 1, collectionId: action.collectionId };
    case "clear":
      return { phase: "idle", intentId: state.intentId + 1 };
    case "task_deleted":
      return (state.phase === "attaching" || state.phase === "failed") && state.taskId === action.taskId
        ? { phase: "idle", intentId: state.intentId + 1 }
        : state;
    case "local_completed": {
      if (state.phase !== "composing" || state.intentId !== action.intentId) return state;
      const taskId = completedTaskId(action.result);
      return taskId ? { ...state, phase: "attaching", taskId, attemptId: 1 } : state;
    }
    case "retry":
      return state.phase === "failed"
        ? { ...state, phase: "attaching", attemptId: state.attemptId + 1 }
        : state;
    case "attachment_finished":
      if (
        state.phase !== "attaching" ||
        state.intentId !== action.intentId ||
        state.attemptId !== action.attemptId
      ) return state;
      return action.success
        ? { phase: "idle", intentId: state.intentId }
        : { ...state, phase: "failed" };
  }
}
