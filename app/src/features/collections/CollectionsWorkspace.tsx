import { ArrowLeft, ArrowUpRight, FileText, Folder, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { Collection } from "../../collectionsClient";
import type { HistoryListItem } from "../../historyClient";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { getHistoryTitle } from "../shell/shellNavigation";
import { getCollectionTaskCount, getCollectionTasks, validateCollectionName } from "./collectionModel";
import "./collections.css";
import { useDataStorage, useStorageEditor } from "../dataStorage/useDataStorageController";

type CollectionsWorkspaceProps = {
  collections: readonly Collection[];
  selectedCollectionId: string | null;
  items: readonly HistoryListItem[];
  loading: boolean;
  mutating: boolean;
  notice: string | null;
  disabled: boolean;
  disabledReason: string;
  onSelectCollection: (id: string | null) => void;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onSetMembership: (collectionId: string, taskId: string, included: boolean) => Promise<boolean>;
  onOpenTask: (item: HistoryListItem) => void;
  onNewNote: () => void;
  onRefresh: () => void;
  createRequested?: number;
  onCreateRequestHandled?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type NameForm = { kind: "create"; initialName: "" } | { kind: "rename"; id: string; initialName: string };
type FocusTarget = "create" | "rename" | "delete" | "membership" | "heading";

export function CollectionsWorkspace({
  collections,
  selectedCollectionId,
  items,
  loading,
  mutating,
  notice,
  disabled,
  disabledReason,
  onSelectCollection,
  onCreate,
  onRename,
  onDelete,
  onSetMembership,
  onOpenTask,
  onNewNote,
  onRefresh,
  createRequested = 0,
  onCreateRequestHandled,
  onDirtyChange,
}: CollectionsWorkspaceProps) {
  const { t } = useTranslation("shell");
  const locale = useUiLocale();
  const id = useId();
  const [form, setForm] = useState<NameForm | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState<"COLLECTION_NAME_INVALID" | "COLLECTION_NAME_EXISTS" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingMembership, setEditingMembership] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const contextRef = useRef(selectedCollectionId);
  contextRef.current = selectedCollectionId;
  const previousCollectionRef = useRef(selectedCollectionId);
  const previousRequestRef = useRef(0);
  const dirtyCallbackRef = useRef(onDirtyChange);
  dirtyCallbackRef.current = onDirtyChange;
  const focusTargetRef = useRef<FocusTarget | null>(null);
  const membershipFocusRef = useRef<{ collectionId: string; taskId: string; element: HTMLInputElement } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const membershipRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const selected = collections.find((collection) => collection.id === selectedCollectionId);
  const deleting = collections.find((collection) => collection.id === deletingId);
  const memberTasks = selected ? getCollectionTasks(selected, items) : [];
  const busy = disabled || mutating || pending || loading;
  const storage = useDataStorage();
  const dirty = Boolean(form && nameDraft.trim() !== form.initialName);
  const controlsDisabled = busy || dirty || Boolean(deleting);
  const reason = disabled ? disabledReason : loading ? t("collections.loading") : t("collections.saving");
  const filteredTasks = items.filter((item) => getHistoryTitle(item).toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)));

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; membershipFocusRef.current = null; dirtyCallbackRef.current?.(false); };
  }, []);

  useEffect(() => { dirtyCallbackRef.current?.(dirty); }, [dirty]);

  useEffect(() => {
    if (previousCollectionRef.current === selectedCollectionId) return;
    previousCollectionRef.current = selectedCollectionId;
    setForm(null);
    setDeletingId(null);
    setNameError(null);
    setEditingMembership(false);
    setQuery("");
  }, [selectedCollectionId]);

  useEffect(() => {
    if (createRequested === previousRequestRef.current) return;
    previousRequestRef.current = createRequested;
    if (createRequested === 0) return;
    setNameDraft("");
    setNameError(null);
    setDeletingId(null);
    setForm({ kind: "create", initialName: "" });
    onCreateRequestHandled?.();
  }, [createRequested, onCreateRequestHandled]);

  useEffect(() => {
    if (form && !busy) { nameInputRef.current?.focus(); nameInputRef.current?.select(); }
  }, [form, busy]);

  useEffect(() => { if (deleting && !busy) cancelDeleteRef.current?.focus(); }, [deletingId, deleting, busy]);

  useEffect(() => { if (editingMembership) filterRef.current?.focus(); }, [editingMembership]);

  useEffect(() => {
    if (busy || form || deleting || !focusTargetRef.current) return;
    const targets = { create: createRef, rename: renameRef, delete: deleteRef, membership: membershipRef, heading: headingRef };
    targets[focusTargetRef.current].current?.focus();
    focusTargetRef.current = null;
  }, [busy, form, deleting, editingMembership]);

  useEffect(() => {
    const target = membershipFocusRef.current;
    if (busy || !target) return;
    membershipFocusRef.current = null;
    if (
      mountedRef.current &&
      editingMembership &&
      selectedCollectionId === target.collectionId &&
      target.element.isConnected &&
      target.element.dataset.collectionTask === target.taskId &&
      !target.element.disabled
    ) target.element.focus();
  }, [busy, editingMembership, selectedCollectionId]);

  function openCreate() {
    setNameDraft(""); setNameError(null); setDeletingId(null);
    setForm({ kind: "create", initialName: "" });
  }

  function cancelForm() {
    if (busy) return;
    focusTargetRef.current = form?.kind === "rename" ? "rename" : "create";
    setForm(null); setNameError(null);
  }

  async function commit(operation: () => Promise<boolean>, onCommitted: () => void = () => {}) {
    if (busy && !storage?.isResolvingEditor("collection") || pendingRef.current) return;
    const context = selectedCollectionId;
    pendingRef.current = true;
    setPending(true);
    try {
      if (await operation() && mountedRef.current && contextRef.current === context) onCommitted();
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }

  async function saveName() {
    if (!form || busy && !storage?.isResolvingEditor("collection") || pendingRef.current) return;
    const validation = validateCollectionName(nameDraft, collections, form.kind === "rename" ? form.id : undefined);
    if (!validation.valid) { setNameError(validation.errorCode); return; }
    const submittedForm = form;
    await commit(
      () => submittedForm.kind === "create" ? onCreate(validation.name) : onRename(submittedForm.id, validation.name),
      () => { focusTargetRef.current = submittedForm.kind === "create" ? "create" : "rename"; setForm(null); setNameError(null); },
    );
  }
  function submitName(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void saveName(); }
  useStorageEditor({ id: "collection", dirty, saving: mutating || pending,
    save: saveName, discard: () => { if (!mutating && !pending) { setNameDraft(form?.initialName ?? ""); setForm(null); setNameError(null); } } });

  function cancelDeletion() {
    if (busy) return;
    focusTargetRef.current = "delete";
    setDeletingId(null);
  }

  function closeMembership() {
    if (busy) return;
    focusTargetRef.current = "membership";
    setEditingMembership(false);
    setQuery("");
  }

  return (
    <section className="collections-workspace" aria-labelledby={`${id}-title`}>
      <header className="collections-header">
        <div>
          {selectedCollectionId ? <button className="collections-back" type="button" disabled={controlsDisabled} onClick={() => onSelectCollection(null)}><ArrowLeft size={14} aria-hidden="true" />{t("collections.allCollections")}</button> : null}
          <h1 ref={headingRef} tabIndex={-1} id={`${id}-title`}>{selected?.name ?? t("nav.collections")}</h1>
          <p>{t("collections.description")}</p>
        </div>
        <div className="collections-actions">
          <button className="collections-button" type="button" onClick={onRefresh} disabled={controlsDisabled} aria-label={t("collections.refresh")} title={disabled ? disabledReason : t("collections.refresh")}><RefreshCw size={14} aria-hidden="true" /></button>
          {selected ? (
            <button className="collections-button" type="button" onClick={onNewNote} disabled={controlsDisabled}><Plus size={15} aria-hidden="true" />{t("collections.newNote")}</button>
          ) : !selectedCollectionId ? (
            <button ref={createRef} className="collections-button" type="button" onClick={openCreate} disabled={controlsDisabled}><Plus size={15} aria-hidden="true" />{t("collections.create")}</button>
          ) : null}
        </div>
      </header>

      {disabled ? <p className="collections-notice" id={`${id}-disabled`}>{disabledReason}</p> : null}
      {notice ? <p className="collections-notice" role="status">{notice}</p> : loading ? <p className="collections-notice" role="status">{t("collections.loading")}</p> : null}
      {mutating || pending ? <p className="collections-notice" role="status">{t("collections.saving")}</p> : null}

      {form && !selectedCollectionId ? (
        <form className="collections-name-form" aria-label={t(form.kind === "create" ? "collections.create" : "collections.rename")} onSubmit={submitName} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelForm(); }
        }}>
          <label htmlFor={`${id}-name`}>{t("collections.name")}</label>
          <div className="collections-name-controls">
            <input ref={nameInputRef} id={`${id}-name`} value={nameDraft} disabled={busy} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `${id}-name-error ${id}-name-hint` : `${id}-name-hint`} onChange={(event) => { setNameDraft(event.currentTarget.value); setNameError(null); }} />
            <button className="collections-button" type="submit" disabled={busy}>{t("collections.save")}</button>
            <button className="collections-button" type="button" disabled={busy} onClick={cancelForm}>{t("collections.cancel")}</button>
          </div>
          <p className="collections-name-hint" id={`${id}-name-hint`}>{t("collections.nameHint")}</p>
          {nameError ? <p className="collections-name-error" role="alert" id={`${id}-name-error`}>{t(`collections.errors.${nameError}`)}</p> : null}
        </form>
      ) : null}

      {selected ? (
        <>
          <div className="collections-selected-tools">
            <span>{t("collections.taskCount", { count: memberTasks.length })}</span>
          </div>

          {editingMembership ? (
            <section className="collections-membership" id={`${id}-membership`} aria-label={t("collections.manageTasks")} onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMembership(); }
            }}>
              <label className="collections-filter" htmlFor={`${id}-filter`}>{t("collections.searchTasks")}</label>
              <input ref={filterRef} id={`${id}-filter`} type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
              {items.length === 0 ? <p className="collections-empty">{t("collections.noHistory")}</p> : filteredTasks.length === 0 ? <p className="collections-empty">{t("collections.noMatches")}</p> : (
                <ul className="collections-membership-list">
                  {filteredTasks.map((item) => (
                    <li key={item.id}>
                      <label>
                        <input type="checkbox" data-collection-task={item.taskId} checked={selected.taskIds.includes(item.taskId)} disabled={controlsDisabled} onChange={(event) => {
                          if (busy || pendingRef.current) return;
                          const element = event.currentTarget;
                          const included = element.checked;
                          membershipFocusRef.current = { collectionId: selected.id, taskId: item.taskId, element };
                          void commit(() => onSetMembership(selected.id, item.taskId, included));
                        }} />
                        <span>{getHistoryTitle(item)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {!editingMembership && memberTasks.length === 0 && !loading ? (
            <div className="collections-empty">
              <p>{t("collections.emptyTasks")}</p>
            </div>
          ) : null}

          {!editingMembership && memberTasks.length > 0 ? (
            <ul className="collections-task-list" aria-label={t("collections.tasks")}>
              {memberTasks.map((item) => (
                <li key={item.id}>
                  <button className="collections-task" type="button" disabled={controlsDisabled} title={disabled ? disabledReason : undefined} aria-describedby={disabled ? `${id}-disabled` : undefined} aria-label={t("collections.openTask", { title: getHistoryTitle(item) })} onClick={() => onOpenTask(item)}>
                    <FileText size={18} aria-hidden="true" /><span>{getHistoryTitle(item)}</span><ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                  <button className="collections-remove-task" type="button" disabled={controlsDisabled} title={disabled ? disabledReason : t("collections.removeTask", { title: getHistoryTitle(item) })} aria-label={t("collections.removeTask", { title: getHistoryTitle(item) })} onClick={() => void commit(() => onSetMembership(selected.id, item.taskId, false), () => { focusTargetRef.current = "membership"; })}><X size={15} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="collections-membership-actions">
            <button ref={membershipRef} className="collections-button" type="button" disabled={controlsDisabled} onClick={() => { if (editingMembership) closeMembership(); else setEditingMembership(true); }} aria-expanded={editingMembership} aria-controls={`${id}-membership`}>{t(editingMembership ? "collections.done" : "collections.manageTasks")}</button>
          </div>
        </>
      ) : selectedCollectionId ? <p className="collections-notice">{t("collections.selectedMissing")}</p> : (
        <>
          {!loading && !notice && collections.length === 0 ? <p className="collections-empty">{t("collections.empty")}</p> : null}
          {collections.length > 0 ? (
            <ul className="collections-list" aria-label={t("nav.collections")}>
              {collections.map((collection) => (
                <li key={collection.id}>
                  <button className="collections-open" type="button" disabled={controlsDisabled} title={disabled ? disabledReason : undefined} aria-label={t("collections.selectCollection", { name: collection.name })} onClick={() => onSelectCollection(collection.id)}>
                    <Folder size={19} aria-hidden="true" /><span>{collection.name}</span><small>{t("collections.taskCount", { count: getCollectionTaskCount(collection, items) })}</small><ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                  <button className="collections-button collections-row-action" type="button" disabled={controlsDisabled} aria-label={t("collections.renameCollection", { name: collection.name })} onClick={(event) => {
                    renameRef.current = event.currentTarget;
                    setNameDraft(collection.name);
                    setNameError(null);
                    setForm({ kind: "rename", id: collection.id, initialName: collection.name });
                  }}>{t("collections.rename")}</button>
                  <button className="collections-button collections-row-action collections-delete-button" type="button" disabled={controlsDisabled} aria-label={t("collections.deleteCollection", { name: collection.name })} onClick={(event) => {
                    deleteRef.current = event.currentTarget;
                    setForm(null);
                    setDeletingId(collection.id);
                  }}>{t("collections.delete")}</button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {deleting && !selectedCollectionId ? (
        <section className="collections-delete-confirmation" role="alertdialog" aria-labelledby={`${id}-delete-title`} aria-describedby={`${id}-delete-body`} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelDeletion(); }
        }}>
          <h2 id={`${id}-delete-title`}>{t("collections.deleteTitle", { name: deleting.name })}</h2>
          <p id={`${id}-delete-body`}>{t("collections.deleteBody")}</p>
          <div className="collections-actions">
            <button ref={cancelDeleteRef} className="collections-button" type="button" disabled={busy} onClick={cancelDeletion}>{t("collections.cancel")}</button>
            <button className="collections-button collections-delete-button" type="button" disabled={busy} onClick={() => void commit(() => onDelete(deleting.id), () => { focusTargetRef.current = "create"; setDeletingId(null); })}><Trash2 size={14} aria-hidden="true" />{t("collections.deleteConfirm")}</button>
          </div>
        </section>
      ) : null}
      {busy && !disabled ? <span className="shell-visually-hidden">{reason}</span> : null}
    </section>
  );
}
