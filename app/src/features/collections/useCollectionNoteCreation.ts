import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TaskSubmission, WorkerResult } from "../../workflowState";
import {
  collectionNoteCreationReducer,
  createCollectionNoteCreation,
  type CollectionNoteAttachment,
  type CollectionNoteCreationAction,
} from "./collectionNoteCreation";

type CollectionNoteCreationOptions = {
  submitTask: (submission: TaskSubmission) => Promise<WorkerResult | undefined>;
  setMembership: (collectionId: string, taskId: string, included: boolean) => Promise<boolean>;
};

export function useCollectionNoteCreation({ submitTask, setMembership }: CollectionNoteCreationOptions) {
  const [state, setState] = useState(createCollectionNoteCreation);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stateRef.current = collectionNoteCreationReducer(stateRef.current, { type: "clear" });
    };
  }, []);

  const transition = useCallback((action: CollectionNoteCreationAction) => {
    const previous = stateRef.current;
    if (!mountedRef.current) return previous;
    const next = collectionNoteCreationReducer(previous, action);
    if (next !== previous) {
      stateRef.current = next;
      setState(next);
    }
    return next;
  }, []);

  const attach = useCallback(async (attachment: CollectionNoteAttachment): Promise<void> => {
    const success = await setMembership(attachment.collectionId, attachment.taskId, true);
    transition({
      type: "attachment_finished", intentId: attachment.intentId,
      attemptId: attachment.attemptId, success,
    });
  }, [setMembership, transition]);

  const begin = useCallback((collectionId: string) => {
    transition({ type: "begin", collectionId });
  }, [transition]);

  const clear = useCallback(() => { transition({ type: "clear" }); }, [transition]);

  const taskDeleted = useCallback((taskId: string) => {
    transition({ type: "task_deleted", taskId });
  }, [transition]);

  const submit = useCallback(async (submission: TaskSubmission): Promise<void> => {
    if (!mountedRef.current) return;
    const intent = stateRef.current.phase === "composing" ? stateRef.current : null;
    const result = await submitTask(submission);
    if (!mountedRef.current || !intent) return;
    const previous = stateRef.current;
    const next = transition({ type: "local_completed", intentId: intent.intentId, result });
    if (next !== previous && next.phase === "attaching") await attach(next);
  }, [attach, submitTask, transition]);

  const retry = useCallback(async (): Promise<void> => {
    if (!mountedRef.current || stateRef.current.phase !== "failed") return;
    const next = transition({ type: "retry" });
    if (next.phase === "attaching") await attach(next);
  }, [attach, transition]);

  const failure = useMemo(() => state.phase === "failed"
    ? { collectionId: state.collectionId, taskId: state.taskId }
    : null, [state]);

  return {
    destinationCollectionId: state.phase === "idle" ? null : state.collectionId,
    attaching: state.phase === "attaching",
    failure,
    begin, clear, taskDeleted, submit, retry,
  };
}
