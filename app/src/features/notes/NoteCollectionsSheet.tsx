import { RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Collection } from "../../collectionsClient";
import type { HistoryListItem } from "../../historyClient";
import { getHistoryTitle } from "../shell/shellNavigation";
import { NoteActionSheet } from "./NoteActionSheet";

export type NoteCollectionsSheetProps = {
  item: HistoryListItem | null;
  collections: readonly Collection[];
  loading: boolean;
  mutating: boolean;
  notice: string | null;
  disabled: boolean;
  disabledReason: string;
  onSetMembership: (collectionId: string, taskId: string, included: boolean) => Promise<boolean>;
  onRefresh: () => void;
  onClose: () => void;
};

export function NoteCollectionsSheet(props: NoteCollectionsSheetProps) {
  return props.item ? <CollectionsSession key={props.item.taskId} {...props} item={props.item} /> : null;
}

function CollectionsSession({ item, collections, loading, mutating, notice, disabled, disabledReason, onSetMembership, onRefresh, onClose }: NoteCollectionsSheetProps & { item: HistoryListItem }) {
  const { t } = useTranslation("noteActions");
  const id = useId();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const focusRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef(false);
  const saving = mutating || pending;
  const blocked = loading || saving || disabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; focusRef.current = null; };
  }, []);
  useEffect(() => {
    if (loading || saving) return;
    const target = focusRef.current;
    if (disabled) {
      if (target?.isConnected) refreshRef.current?.focus();
      return;
    }
    focusRef.current = null;
    if (target?.isConnected && !target.disabled) { target.focus(); return; }
    if (!initialFocusRef.current) {
      initialFocusRef.current = true;
      listRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
    }
  }, [loading, saving, disabled]);

  async function changeMembership(collectionId: string, included: boolean, origin: HTMLInputElement) {
    if (blocked || pendingRef.current) return;
    pendingRef.current = true;
    focusRef.current = origin;
    setPending(true);
    try { await onSetMembership(collectionId, item.taskId, included); }
    finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }

  return (
    <NoteActionSheet
      open
      title={t("collections.title")}
      onClose={onClose}
      closeDisabled={saving}
      footer={<button className="note-action-button" type="button" onClick={onClose} disabled={saving}>{t("common.done")}</button>}
    >
      <p className="note-action-subtitle">{getHistoryTitle(item)}</p>
      <p className="note-action-description">{t("collections.description")}</p>
      <div className="note-action-tools"><button ref={refreshRef} className="note-action-button" type="button" onClick={onRefresh} disabled={loading || saving}><RefreshCw size={16} aria-hidden="true" />{t("common.refresh")}</button></div>
      {loading ? <p className="note-action-notice" role="status">{t("collections.loading")}</p> : null}
      {notice ? <p className="note-action-notice" role="alert">{notice}</p> : null}
      {disabled ? <p className="note-action-notice" role="status">{disabledReason}</p> : null}
      {!loading && !notice && collections.length === 0 ? <p className="note-action-description">{t("collections.empty")}</p> : null}
      {collections.length > 0 ? (
        <ul ref={listRef} className="note-collection-options">
          {collections.map((collection) => (
            <li key={collection.id}>
              <label htmlFor={`${id}-${collection.id}`}>
                <input id={`${id}-${collection.id}`} type="checkbox" checked={collection.taskIds.includes(item.taskId)} disabled={blocked} data-note-collection={collection.id} onChange={(event) => { void changeMembership(collection.id, event.currentTarget.checked, event.currentTarget); }} />
                <span>{collection.name}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </NoteActionSheet>
  );
}
