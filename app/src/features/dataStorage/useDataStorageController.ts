import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as client from "../../dataStorageClient";
import { storageErrorCode, type CleanupPreview, type DirectorySelection, type MigrationPreview, type StorageErrorCode, type StorageState } from "../../dataStorageProtocol";

export type StorageEditorId = "transcript" | "draft" | "settings" | "collection" | "note" | "profile";
export type StorageEditor = { id: StorageEditorId; dirty: boolean; saving: boolean; save?: () => Promise<unknown>; discard: () => void | Promise<void> };
type Preparation = { busy: boolean; updateRestartRequired: boolean; restartUpdate?: () => Promise<void> };
export function acceptStorageEvent(current: StorageState | null, incoming: StorageState, closedOperations: ReadonlySet<string>): boolean {
  if (current && incoming.generation < current.generation) return false;
  if (incoming.operation && closedOperations.has(incoming.operation.operationId)) return false;
  return !(current?.operation && incoming.generation === current.generation && incoming.operation && current.operation.operationId !== incoming.operation.operationId);
}
function useController() {
  const native = isTauri();
  const [state, setState] = useState<StorageState | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const [error, setError] = useState<StorageErrorCode | null>(null);
  const [loading, setLoading] = useState(native);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(preparing); preparingRef.current = preparing;
  const [closeGuardReady, setCloseGuardReady] = useState(!native);
  const [working, setWorking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [cleanup, setCleanup] = useState<CleanupPreview | null>(null);
  const [target, setTarget] = useState<DirectorySelection | null>(null);
  const [resumeIntent, setResumeIntent] = useState<string | null>(null);
  const [cleanupIntent, setCleanupIntent] = useState<string | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const editorsRef = useRef(new Map<StorageEditorId, StorageEditor>());
  const preparationRef = useRef<Preparation>({ busy: false, updateRestartRequired: false });
  const [preparation, setPreparation] = useState(preparationRef.current);
  const [closing, setClosing] = useState(false);
  const closeAfterBusy = useRef(false);
  const closedOperations = useRef(new Set<string>());
  const eventRevision = useRef(0);
  const mounted = useRef(true);
  const request = useRef(0);
  const actionActive = useRef(false);
  const legacyTokens = useRef<string[]>([]);
  const resolvingEditor = useRef<StorageEditorId | null>(null);
  const cancelRequested = useRef(false);
  const apply = useCallback((next: StorageState, authoritative = true) => {
    if (!mounted.current || stateRef.current && next.generation < stateRef.current.generation || next.operation && closedOperations.current.has(next.operation.operationId) || (!authoritative && !acceptStorageEvent(stateRef.current, next, closedOperations.current))) return;
    const previous = stateRef.current?.operation;
    if (previous && (!next.operation || previous.operationId !== next.operation.operationId)) closedOperations.current.add(previous.operationId);
    if (!authoritative) eventRevision.current += 1;
    stateRef.current = next; setState(next);
  }, []);
  const refresh = useCallback(async () => {
    const revision = eventRevision.current;
    const next = await client.getDataStorageState(); if (revision === eventRevision.current) apply(next); return next;
  }, [apply]);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (actionActive.current) return;
    actionActive.current = true; setWorking(true); setError(null);
    try { return await action(); }
    catch (failure) { if (mounted.current) setError(storageErrorCode(failure)); return undefined; }
    finally { actionActive.current = false; if (mounted.current) setWorking(false); }
  }, []);
  const requestWindowClose = useCallback(() => {
    if (preparingRef.current) { setOpen(true); return; }
    if (preparationRef.current.busy) { closeAfterBusy.current = true; setClosing(true); return; }
    void invoke("close_window").catch(failure => { if (mounted.current) setError(storageErrorCode(failure)); });
  }, []);
  useEffect(() => {
    if (!closeAfterBusy.current || preparing || preparation.busy) return;
    closeAfterBusy.current = false; setClosing(false); requestWindowClose();
  }, [preparing, preparation.busy, requestWindowClose]);
  useEffect(() => {
    mounted.current = true;
    if (!native) { setLoading(false); return () => { mounted.current = false; }; }
    let disposed = false; let unlisten: (() => void) | undefined;
    async function connect() {
      try {
        const stop = await client.listenDataStorage(next => { if (!disposed) apply(next, false); }, failure => { if (!disposed) { setError(storageErrorCode(failure)); setOpen(true); } });
        if (disposed) { stop(); return; }
        unlisten = stop;
        const revision = eventRevision.current;
        const initial = await client.getDataStorageState();
        if (!disposed && revision === eventRevision.current) apply(initial);
      } catch (failure) { if (!disposed) setError(storageErrorCode(failure)); }
      finally { if (!disposed) setLoading(false); }
    }
    void connect();
    return () => { disposed = true; mounted.current = false; request.current += 1; unlisten?.(); };
  }, [apply, native, refresh]);
  useEffect(() => {
    if (!native) return;
    let disposed = false; let stop: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(event => {
      event.preventDefault();
      requestWindowClose();
    }).then(unlisten => { if (disposed) unlisten(); else { stop = unlisten; setCloseGuardReady(true); } })
      .catch(failure => { if (!disposed) setError(storageErrorCode(failure)); });
    return () => { disposed = true; stop?.(); };
  }, [native, requestWindowClose]);
  useEffect(() => {
    if (!native || !working && (!state?.operation || ["prepared", "failed", "cancelled"].includes(state.operation.phase))) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const revision = eventRevision.current; const next = await client.getDataStorageState(); if (!disposed && revision === eventRevision.current) apply(next); }
      catch (failure) { if (!disposed) setError(storageErrorCode(failure)); }
      if (!disposed) timer = setTimeout(() => { void poll(); }, 750);
    };
    timer = setTimeout(() => { void poll(); }, 750);
    return () => { disposed = true; clearTimeout(timer); };
  }, [apply, native, state?.operation?.operationId, state?.operation?.phase, working]);
  const registerEditor = useCallback((editor: StorageEditor) => {
    const previous = editorsRef.current.get(editor.id); editorsRef.current.set(editor.id, editor);
    if (!previous || previous.dirty !== editor.dirty || previous.saving !== editor.saving) setEditorRevision(value => value + 1);
  }, []);
  const unregisterEditor = useCallback((id: StorageEditorId) => { if (editorsRef.current.delete(id)) setEditorRevision(value => value + 1); }, []);
  const updatePreparation = useCallback((next: Preparation) => {
    const previous = preparationRef.current; preparationRef.current = next;
    if (next.busy !== previous.busy || next.updateRestartRequired !== previous.updateRestartRequired) setPreparation(next);
  }, []);
  const cancelPreparing = useCallback(() => { cancelRequested.current = true; request.current += 1; setPreparing(false); setTarget(null); setResumeIntent(null); setCleanupIntent(null); setOpen(false); setError(null); }, []);
  useEffect(() => {
    if (state?.operation?.phase !== "prepared" || preview || working) return;
    let disposed = false; const operationId = state.operation.operationId;
    void client.getPendingDataStoragePreview().then(next => {
      if (!disposed && stateRef.current?.operation?.operationId === operationId && next.operationId === operationId) setPreview(next);
    }).catch(failure => { if (!disposed) setError(storageErrorCode(failure)); });
    return () => { disposed = true; };
  }, [state?.operation?.operationId, state?.operation?.phase, preview, working]);
  const begin = useCallback(() => run(async () => {
    if (!closeGuardReady) return;
    const selected = await client.selectDataStorageDirectory("target");
    if (!selected || !mounted.current) return;
    cancelRequested.current = false; legacyTokens.current = []; setPreview(null); setCleanup(null); setResumeIntent(null); setCleanupIntent(null); setTarget(selected); setPreparing(true); setOpen(true);
  }), [closeGuardReady, run]);
  useEffect(() => {
    if (!preparing || !target && !resumeIntent && !cleanupIntent) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const prepare = async () => {
      const pending = [...editorsRef.current.values()].some(editor => editor.dirty || editor.saving);
      if (pending || preparationRef.current.busy || preparationRef.current.updateRestartRequired || actionActive.current) { timer = setTimeout(() => { void prepare(); }, 150); return; }
      const sequence = ++request.current;
      await run(async () => {
        const current = stateRef.current; if (!current) return;
        if (resumeIntent) {
          setPreparing(false); setResumeIntent(null); closedOperations.current.delete(resumeIntent);
          let next: StorageState;
          try { next = await client.resumeDataStorageMigration(resumeIntent, current.generation, legacyTokens.current); }
          catch (failure) { await refresh(); throw failure; }
          legacyTokens.current = []; apply(next); return;
        }
        if (cleanupIntent) {
          const next = await client.prepareOldStorageCleanup(cleanupIntent);
          if (!disposed && sequence === request.current) { setCleanup(next); setPreparing(false); setCleanupIntent(null); }
          return;
        }
        if (!target) return;
        try {
          const next = await client.prepareDataStorageMigration(target.selectionToken, legacyTokens.current, current.generation);
          if (disposed || cancelRequested.current || sequence !== request.current) {
            apply(await client.cancelDataStorageMigration(next.operationId, next.generation)); return;
          }
          legacyTokens.current = [];
          setPreview(next); setPreparing(false); await refresh();
        } catch (failure) {
          if (cancelRequested.current) {
            const actual = await client.getDataStorageState();
            apply(actual.operation?.canCancel ? await client.cancelDataStorageMigration(actual.operation.operationId, actual.generation) : actual);
            return;
          }
          throw failure;
        }
      });
      if (!disposed && sequence === request.current) setPreparing(false);
    };
    void prepare(); return () => { disposed = true; clearTimeout(timer); };
  }, [apply, preparing, target, resumeIntent, cleanupIntent, run, refresh]);
  const confirm = useCallback(() => run(async () => {
    if (preview) { const token = preview.planToken; setPreview(null); apply(await client.confirmDataStorageMigration(token)); }
    else if (cleanup) { const token = cleanup.planToken; setCleanup(null); apply(await client.confirmOldStorageCleanup(token)); }
  }), [apply, cleanup, preview, run]);
  const cancel = useCallback(() => {
    if (preparing) cancelPreparing();
    const current = stateRef.current;
    const candidate = current?.operation?.canCancel ? { id: current.operation.operationId, generation: current.generation } : preview ? { id: preview.operationId, generation: preview.generation } : null;
    if (candidate && !cancelling) {
      setCancelling(true);
      void client.cancelDataStorageMigration(candidate.id, candidate.generation)
        .then(next => { apply(next); setPreview(null); setError(null); if (next.dataAccess === "ready") setOpen(false); })
        .catch(failure => setError(storageErrorCode(failure))).finally(() => setCancelling(false));
    }
  }, [apply, cancelPreparing, cancelling, preparing, preview]);
  const resume = useCallback((operationId?: string) => run(async () => {
    const current = stateRef.current;
    const operation = operationId ? current?.recoveryCandidates.find(item => item.operationId === operationId) : current?.operation;
    if (!current || !operation?.canResume) return;
    if (operation.phase === "prepared") { setPreview(await client.getPendingDataStoragePreview()); setOpen(true); return; }
    cancelRequested.current = false; setTarget(null); setPreview(null); setCleanup(null); setCleanupIntent(null); setResumeIntent(operation.operationId); setPreparing(true); setOpen(true);
  }), [run]);
  const recheck = useCallback(() => run(async () => apply(await client.recheckDataStorage())), [apply, run]);
  const locate = useCallback(() => run(async () => {
    const selection = await client.selectDataStorageDirectory("relink");
    if (selection) { const next = await client.relinkDataStorage(selection.selectionToken); setPreview(null); setCleanup(null); apply(next); }
  }), [apply, run]);
  const locateLegacy = useCallback(() => run(async () => {
    const selection = await client.selectDataStorageDirectory("legacy_source"); if (!selection) return;
    if (!target) {
      const operation = stateRef.current?.operation;
      if (!operation || operation.phase !== "waiting" || !operation.canResume) return;
      setResumeIntent(operation.operationId);
    }
    cancelRequested.current = false; legacyTokens.current.push(selection.selectionToken); setError(null); setPreparing(true);
  }), [run, target]);
  const prepareCleanup = useCallback((receiptId: string) => {
    cancelRequested.current = false; setTarget(null); setResumeIntent(null); setPreview(null); setCleanup(null); setCleanupIntent(receiptId); setPreparing(true); setOpen(true);
  }, []);
  const resolveEditor = useCallback((id: StorageEditorId, discard: boolean) => run(async () => {
    const editor = editorsRef.current.get(id); if (!editor || editor.saving || !editor.dirty) return;
    resolvingEditor.current = id;
    try { if (discard) await editor.discard(); else await editor.save?.(); }
    finally { resolvingEditor.current = null; }
  }), [run]);
  const close = useCallback(() => {
    if (preparing) { cancel(); return; }
    if (preview || stateRef.current?.operation?.canCancel) { cancel(); return; }
    if (!working && stateRef.current?.dataAccess === "ready") { setCleanup(null); setOpen(false); }
  }, [cancel, preparing, preview, working]);
  return { native, state, error, loading, open, preparing, working, cancelling, preview, cleanup, preparation, closeGuardReady,
    frozen: closing || preparing || working || Boolean(preview || cleanup) || error === "DATA_STORAGE_IPC_RESPONSE_INVALID" || state !== null && state.dataAccess !== "ready",
    editors: useMemo(() => [...editorsRef.current.values()].filter(editor => editor.dirty || editor.saving), [editorRevision]),
    begin, confirm, cancel, resume, recheck, locate, locateLegacy, prepareCleanup, resolveEditor, close,
    restart: () => run(client.restartForDataStorage), restartUpdate: () => run(async () => preparationRef.current.restartUpdate?.()),
    refresh, registerEditor, unregisterEditor, updatePreparation, requestWindowClose, isResolvingEditor: (id: StorageEditorId) => resolvingEditor.current === id, show: () => setOpen(true) };
}
export type DataStorageController = ReturnType<typeof useController>;
export const DataStorageContext = createContext<DataStorageController | null>(null);
export function DataStorageProvider({ children }: { children: (controller: DataStorageController) => ReactNode }) {
  const controller = useController();
  return createElement(DataStorageContext.Provider, { value: controller }, children(controller));
}
export function useDataStorage() { return useContext(DataStorageContext); }
export function useStorageEditor(editor: StorageEditor) {
  const context = useDataStorage(); const register = context?.registerEditor; const unregister = context?.unregisterEditor;
  useLayoutEffect(() => { register?.(editor); });
  useEffect(() => () => { unregister?.(editor.id); }, [editor.id, unregister]);
}
export function useStoragePreparation(preparation: Preparation) {
  const update = useDataStorage()?.updatePreparation;
  useLayoutEffect(() => { update?.(preparation); });
}
