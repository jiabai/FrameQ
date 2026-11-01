import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryListItem } from "../../historyClient";
import { getNoteInfo, openNoteSource, renameNote, safeNoteSource, setNotePinned, type NoteInfo, type NoteMutation } from "../../noteActionsClient";
import type { NoteAction } from "../shell/SidebarNoteMenu";
import { uiMessage, type UiMessage } from "../../i18n/uiMessage";

type Sheet = { kind: "rename" | "collection" | "info"; item: HistoryListItem };
type Options = {
  items: readonly HistoryListItem[];
  canMutate: () => boolean;
  onCommitted: (result: NoteMutation) => void;
  onDelete: (item: HistoryListItem) => void;
  loadCollections: () => Promise<boolean>;
};

export function useNoteActionsController(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<NoteInfo | null>(null);
  const [notice, setNotice] = useState<UiMessage | null>(null);
  const [dirty, setDirty] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  const available = useCallback((taskId: string) => latest.current.items.find((item) => item.taskId === taskId), []);
  const isBusy = useCallback(() => pending.current, []);
  const close = useCallback(() => {
    if (pending.current) return;
    generation.current += 1;
    setSheet(null); setInfo(null); setNotice(null); setDirty(false); setLoading(false);
  }, []);

  useEffect(() => { if (sheet && !available(sheet.item.taskId) && !pending.current) close(); }, [available, close, options.items, sheet]);

  const mutate = useCallback(async (taskId: string, operation: () => Promise<NoteMutation>): Promise<boolean> => {
    if (!mounted.current || pending.current) return false;
    if (!available(taskId)) { setNotice(uiMessage("noteActions.notice.unavailable")); return false; }
    if (!latest.current.canMutate()) { setNotice(uiMessage("noteActions.notice.blocked")); return false; }
    pending.current = true; setBusy(true); setNotice(null);
    const requestId = ++generation.current;
    try {
      const result = await operation();
      if (!mounted.current || requestId !== generation.current || !available(taskId)) return false;
      latest.current.onCommitted(result);
      return true;
    } catch {
      if (mounted.current && requestId === generation.current) setNotice(uiMessage("noteActions.notice.operationFailed"));
      return false;
    } finally {
      pending.current = false;
      if (mounted.current && requestId === generation.current) setBusy(false);
    }
  }, [available]);

  const refreshInfo = useCallback(async (taskId: string) => {
    if (!available(taskId) || pending.current) return;
    const requestId = ++generation.current;
    setInfo(null); setNotice(null); setLoading(true);
    try {
      const result = await getNoteInfo(taskId);
      if (mounted.current && requestId === generation.current && available(taskId)) setInfo(result);
    } catch {
      if (mounted.current && requestId === generation.current) setNotice(uiMessage("noteActions.notice.operationFailed"));
    } finally {
      if (mounted.current && requestId === generation.current) setLoading(false);
    }
  }, [available]);

  const refreshCollections = useCallback(async () => {
    if (pending.current) return;
    const requestId = ++generation.current;
    setLoading(true); setNotice(null);
    const loaded = await latest.current.loadCollections();
    if (mounted.current && requestId === generation.current) {
      setLoading(false); if (!loaded) setNotice(uiMessage("noteActions.notice.operationFailed"));
    }
  }, []);

  const perform = useCallback(async (item: HistoryListItem, action: NoteAction) => {
    if (!mounted.current || pending.current) return;
    const current = available(item.taskId);
    if (!current) { setNotice(uiMessage("noteActions.notice.unavailable")); return; }
    if (["pin", "rename", "collection", "delete"].includes(action) && !latest.current.canMutate()) { setNotice(uiMessage("noteActions.notice.blocked")); return; }
    if ((action === "pin" || action === "rename") && current.noteMetadataError) { setNotice(uiMessage("noteActions.notice.metadataLoadFailed")); return; }
    setNotice(null);
    if (action === "pin") { await mutate(item.taskId, () => setNotePinned(item.taskId, !current.noteMetadata?.pinned)); return; }
    if (action === "delete") { latest.current.onDelete(current); return; }
    if (action === "rename" || action === "collection" || action === "info") {
      setSheet({ kind: action, item: current }); setDirty(false); setInfo(null);
      if (action === "info") { await Promise.all([refreshInfo(current.taskId), latest.current.loadCollections()]); }
      if (action === "collection") {
        await refreshCollections();
      }
      return;
    }
    if (!safeNoteSource(current.source)) { setNotice(uiMessage("noteActions.notice.unavailable")); return; }
    pending.current = true; setBusy(true);
    const requestId = ++generation.current;
    try {
      if (action === "copy_source") {
        const result = await getNoteInfo(item.taskId);
        const url = safeNoteSource(result.source);
        if (!mounted.current || requestId !== generation.current || !available(item.taskId)) return;
        if (!url) throw new Error("NOTE_SOURCE_UNAVAILABLE");
        await navigator.clipboard.writeText(url);
      } else { await openNoteSource(item.taskId); }
      if (mounted.current && requestId === generation.current && available(item.taskId)) setNotice(uiMessage(action === "copy_source" ? "noteActions.notice.copied" : "noteActions.notice.sourceOpened"));
    } catch {
      if (mounted.current && requestId === generation.current) setNotice(uiMessage("noteActions.notice.operationFailed"));
    } finally {
      pending.current = false;
      if (mounted.current && requestId === generation.current) setBusy(false);
    }
  }, [available, mutate, refreshInfo, refreshCollections]);

  const saveName = useCallback(async (taskId: string, title: string) => {
    const current = available(taskId);
    if (!current || current.noteMetadataError) {
      setNotice(uiMessage(current ? "noteActions.notice.metadataLoadFailed" : "noteActions.notice.unavailable"));
      return false;
    }
    const saved = await mutate(taskId, () => renameNote(taskId, title));
    if (saved) close();
    return saved;
  }, [available, close, mutate]);

  return { sheet, busy, isBusy, loading, info, notice, dirty, setDirty, close, perform, saveName, refreshInfo, refreshCollections, available };
}
