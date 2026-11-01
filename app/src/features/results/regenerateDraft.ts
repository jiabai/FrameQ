import { useCallback, useEffect, useRef, useState } from "react";

type DraftRegenerationCandidate = {
  taskId: string;
  seedInsightId: number | null;
};

type DraftRegenerationOptions = {
  taskId: string | null;
  resultOpen: boolean;
  saving: boolean;
  draftEdited: boolean;
  setDraftResultOpen: (open: boolean) => void;
  setDraftConfirmOpen: (open: boolean) => void;
  setDraftSeedInsightId: (id: number | null) => void;
};

export function useDraftRegeneration(options: DraftRegenerationOptions) {
  const { taskId, resultOpen, saving } = options;
  const currentRef = useRef(options);
  currentRef.current = options;
  const [candidate, setCandidate] = useState<DraftRegenerationCandidate | null>(null);
  const candidateRef = useRef(candidate);
  const routedRef = useRef(false);

  const cancel = useCallback(() => {
    candidateRef.current = null;
    setCandidate(null);
  }, []);

  useEffect(() => {
    cancel();
  }, [taskId, resultOpen, saving, cancel]);

  useEffect(() => {
    routedRef.current = false;
  }, [taskId, resultOpen]);

  const proceed = useCallback((request: DraftRegenerationCandidate) => {
    const current = currentRef.current;
    if (
      !current.resultOpen || current.saving ||
      current.taskId !== request.taskId || routedRef.current
    ) return;
    routedRef.current = true;
    cancel();
    current.setDraftResultOpen(false);
    current.setDraftSeedInsightId(request.seedInsightId);
    current.setDraftConfirmOpen(true);
  }, [cancel]);

  const request = useCallback((seedInsightId: number | null, hasUnsavedChanges = false) => {
    const current = currentRef.current;
    if (
      !taskId || current.taskId !== taskId ||
      !current.resultOpen || current.saving ||
      candidateRef.current || routedRef.current
    ) return;
    const next = { taskId, seedInsightId };
    if (!current.draftEdited && !hasUnsavedChanges) {
      proceed(next);
      return;
    }
    candidateRef.current = next;
    setCandidate(next);
  }, [taskId, proceed]);

  const confirm = useCallback(() => {
    if (!candidate || candidateRef.current !== candidate) return;
    proceed(candidate);
  }, [candidate, proceed]);

  return {
    candidate: resultOpen && !saving && candidate?.taskId === taskId ? candidate : null,
    request,
    cancel,
    confirm,
  };
}
