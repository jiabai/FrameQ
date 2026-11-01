import { useCallback, useEffect, useRef, useState } from "react";

import {
  createCollection, deleteCollection, getCollections, normalizeCollectionsErrorCode,
  renameCollection, setCollectionTaskMembership,
  type Collection, type CollectionsErrorCode, type CollectionsView,
} from "../../collectionsClient";

const EMPTY_COLLECTIONS: Collection[] = [];

export function useCollectionsController() {
  const [view, setView] = useState<CollectionsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [errorCode, setErrorCode] = useState<CollectionsErrorCode | null>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const mutationPendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      mutationPendingRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    if (!mountedRef.current || mutationPendingRef.current) return false;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setErrorCode(null);
    try {
      const committed = await getCollections();
      if (!mountedRef.current || requestId !== requestIdRef.current) return false;
      setView(committed);
      return true;
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setErrorCode(normalizeCollectionsErrorCode(error));
      }
      return false;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const mutate = useCallback(async (operation: () => Promise<CollectionsView>): Promise<boolean> => {
    if (!mountedRef.current || mutationPendingRef.current) return false;
    mutationPendingRef.current = true;
    const requestId = ++requestIdRef.current;
    setLoading(false);
    setMutating(true);
    setErrorCode(null);
    try {
      const committed = await operation();
      if (!mountedRef.current || requestId !== requestIdRef.current) return false;
      setView(committed);
      return true;
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setErrorCode(normalizeCollectionsErrorCode(error));
      }
      return false;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        mutationPendingRef.current = false;
        setMutating(false);
      }
    }
  }, []);

  const create = useCallback((name: string) => mutate(() => createCollection(name)), [mutate]);
  const rename = useCallback((id: string, name: string) => mutate(() => renameCollection(id, name)), [mutate]);
  const remove = useCallback((id: string) => mutate(() => deleteCollection(id)), [mutate]);
  const setMembership = useCallback((id: string, taskId: string, included: boolean) =>
    mutate(() => setCollectionTaskMembership(id, taskId, included)), [mutate]);

  return {
    view,
    collections: view?.collections ?? EMPTY_COLLECTIONS,
    loading, mutating, errorCode,
    load, create, rename, remove, setMembership,
  };
}
