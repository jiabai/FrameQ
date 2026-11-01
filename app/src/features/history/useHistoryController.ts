import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteHistoryTask,
  getHistory,
  getHistoryDetail,
  resumeNoteDeletionCleanup,
  type HistoryItem,
  type HistoryListItem,
} from "../../historyClient";
import type { NoteMetadata } from "../../noteMetadata";
import { uiMessage, type UiMessage } from "../../i18n/uiMessage";

type UseHistoryControllerOptions = {
  onHistoryItemSelected: (item: HistoryItem) => void;
  onHistoryItemDeleted: (taskId: string) => void;
  onPrepareHistoryItemDeletion: (taskId: string) => void;
  canDelete?: () => boolean;
};

export function useHistoryController({
  onHistoryItemSelected,
  onHistoryItemDeleted,
  onPrepareHistoryItemDeletion,
  canDelete,
}: UseHistoryControllerOptions) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryListItem[]>([]);
  const [historyNotice, setHistoryNotice] = useState<UiMessage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDeleteCandidate, setHistoryDeleteCandidate] = useState<HistoryListItem | null>(null);
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const cleanupRequestPendingRef = useRef(false);
  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const detailRequestPendingRef = useRef(false);
  const deleteRequestPendingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestIdRef.current += 1;
      detailRequestIdRef.current += 1;
    };
  }, []);

  const closeHistory = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }
    listRequestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    detailRequestPendingRef.current = false;
    setHistoryOpen(false);
    setHistoryLoading(false);
    if (!deleteRequestPendingRef.current) {
      setHistoryDeleteCandidate(null);
    }
  }, []);

  const loadHistory = useCallback(async (openSheet: boolean) => {
    if (
      !mountedRef.current ||
      (!openSheet && (deleteRequestPendingRef.current || detailRequestPendingRef.current))
    ) {
      return;
    }
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    if (openSheet) {
      detailRequestIdRef.current += 1;
      detailRequestPendingRef.current = false;
      setHistoryDeleteCandidate(null);
      setHistoryOpen(true);
      setHistoryItems([]);
    }
    setHistoryLoading(true);
    setHistoryNotice(uiMessage("history.notice.loading"));
    try {
      const items = await getHistory();
      if (!mountedRef.current || listRequestIdRef.current !== requestId) {
        return;
      }
      setHistoryItems(items);
      setHistoryNotice(items.length > 0 ? null : uiMessage("history.notice.empty"));
    } catch {
      if (mountedRef.current && listRequestIdRef.current === requestId) {
        setHistoryNotice(uiMessage("history.notice.loadFailed"));
      }
    } finally {
      if (mountedRef.current && listRequestIdRef.current === requestId) {
        setHistoryLoading(false);
      }
    }
  }, []);

  const openHistory = useCallback(() => loadHistory(true), [loadHistory]);
  const refreshHistory = useCallback(() => loadHistory(false), [loadHistory]);

  const openHistoryItem = useCallback(
    async (item: HistoryListItem) => {
      if (!mountedRef.current || deleteRequestPendingRef.current) {
        return;
      }
      listRequestIdRef.current += 1;
      const requestId = detailRequestIdRef.current + 1;
      detailRequestIdRef.current = requestId;
      detailRequestPendingRef.current = true;
      setHistoryLoading(true);
      setHistoryNotice(uiMessage("history.notice.detailLoading"));
      try {
        const detail = await getHistoryDetail(item.taskId);
        if (!mountedRef.current || detailRequestIdRef.current !== requestId) {
          return;
        }
        onHistoryItemSelected(detail);
        setHistoryOpen(false);
        setHistoryNotice(null);
      } catch {
        if (mountedRef.current && detailRequestIdRef.current === requestId) {
          setHistoryNotice(uiMessage("history.notice.detailFailed"));
        }
      } finally {
        if (mountedRef.current && detailRequestIdRef.current === requestId) {
          detailRequestPendingRef.current = false;
          setHistoryLoading(false);
        }
      }
    },
    [onHistoryItemSelected],
  );

  const requestHistoryItemDeletion = useCallback((item: HistoryListItem) => {
    if (!mountedRef.current || deleteRequestPendingRef.current || cleanupRequestPendingRef.current || (canDelete && !canDelete())) {
      return;
    }
    listRequestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    detailRequestPendingRef.current = false;
    setHistoryLoading(false);
    setHistoryDeleteCandidate(item);
    setHistoryNotice(null);
  }, [canDelete]);

  const applyCommittedNoteMetadata = useCallback((taskId: string, noteMetadata: NoteMetadata) => {
    if (!mountedRef.current) return;
    listRequestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    detailRequestPendingRef.current = false;
    setHistoryLoading(false);
    setHistoryItems((current) => current.map((item) => item.taskId === taskId ? { ...item, noteMetadata, noteMetadataError: null } : item));
    setHistoryDeleteCandidate((current) => current?.taskId === taskId ? { ...current, noteMetadata, noteMetadataError: null } : current);
  }, []);

  const resumeHistoryCleanup = useCallback(async () => {
    if (!mountedRef.current || cleanupRequestPendingRef.current || deleteRequestPendingRef.current) return;
    cleanupRequestPendingRef.current = true;
    try {
      const result = await resumeNoteDeletionCleanup();
      if (!mountedRef.current) return;
      setCleanupPending(result.status === "cleanup_pending");
      setCleanupFailed(false);
      if (result.taskId) {
        listRequestIdRef.current += 1;
        detailRequestIdRef.current += 1;
        detailRequestPendingRef.current = false;
        setHistoryLoading(false);
        setHistoryItems((current) => current.filter((item) => item.taskId !== result.taskId));
        setHistoryDeleteCandidate((current) => current?.taskId === result.taskId ? null : current);
        onHistoryItemDeleted(result.taskId);
      }
    } catch {
      if (mountedRef.current) { setCleanupPending(true); setCleanupFailed(true); }
    } finally {
      cleanupRequestPendingRef.current = false;
    }
  }, [onHistoryItemDeleted]);

  const cancelHistoryItemDeletion = useCallback(() => {
    if (mountedRef.current && !deleteRequestPendingRef.current) {
      setHistoryDeleteCandidate(null);
    }
  }, []);

  const confirmHistoryItemDeletion = useCallback(async () => {
    if (!mountedRef.current || !historyDeleteCandidate || deleteRequestPendingRef.current || cleanupRequestPendingRef.current || (canDelete && !canDelete())) {
      return;
    }
    const taskId = historyDeleteCandidate.taskId;
    deleteRequestPendingRef.current = true;
    const listRequestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = listRequestId;
    detailRequestIdRef.current += 1;
    detailRequestPendingRef.current = false;
    setHistoryLoading(false);
    setHistoryDeleting(true);
    setHistoryNotice(uiMessage("history.notice.deleting"));
    onPrepareHistoryItemDeletion(taskId);
    try {
      const result = await deleteHistoryTask(taskId);
      if (!mountedRef.current) {
        return;
      }
      listRequestIdRef.current += 1;
      setHistoryLoading(false);
      setHistoryItems((current) => current.filter((item) => item.taskId !== taskId));
      setHistoryDeleteCandidate(null);
      setCleanupPending(result.status === "cleanup_pending");
      setCleanupFailed(false);
      setHistoryNotice(uiMessage(result.status === "cleanup_pending" ? "noteActions.notice.cleanupPending" : "history.notice.deleted"));
      onHistoryItemDeleted(taskId);
    } catch {
      if (!mountedRef.current || listRequestIdRef.current !== listRequestId) {
        return;
      }
      const recoveryRequestId = listRequestIdRef.current + 1;
      listRequestIdRef.current = recoveryRequestId;
      try {
        const items = await getHistory();
        if (mountedRef.current && listRequestIdRef.current === recoveryRequestId) {
          setHistoryItems(items);
        }
      } catch {
        // Keep the last safe list when the follow-up manifest projection is unavailable.
      }
      if (mountedRef.current && listRequestIdRef.current === recoveryRequestId) {
        setHistoryNotice(uiMessage("history.notice.deleteFailed"));
        setCleanupPending(true);
        setCleanupFailed(true);
      }
    } finally {
      deleteRequestPendingRef.current = false;
      if (mountedRef.current) {
        setHistoryDeleting(false);
      }
    }
  }, [
    historyDeleteCandidate,
    onHistoryItemDeleted,
    onPrepareHistoryItemDeletion,
    canDelete,
  ]);

  return {
    historyOpen,
    historyItems,
    historyNotice,
    historyLoading,
    historyDeleteCandidate,
    historyDeleting,
    cleanupPending,
    cleanupFailed,
    resumeHistoryCleanup,
    applyCommittedNoteMetadata,
    closeHistory,
    openHistory,
    refreshHistory,
    openHistoryItem,
    requestHistoryItemDeletion,
    cancelHistoryItemDeletion,
    confirmHistoryItemDeletion,
  };
}

export type HistoryController = ReturnType<typeof useHistoryController>;
