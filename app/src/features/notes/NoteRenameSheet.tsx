import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { HistoryListItem } from "../../historyClient";
import { isValidNoteTitleText } from "../../noteTitle";
import { getHistoryTitle } from "../shell/shellNavigation";
import { NoteActionSheet } from "./NoteActionSheet";
import { useDataStorage, useStorageEditor } from "../dataStorage/useDataStorageController";

const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u;

export type NoteRenameSheetProps = {
  item: HistoryListItem | null;
  busy: boolean;
  notice: string | null;
  disabled: boolean;
  disabledReason: string;
  onSave: (taskId: string, title: string) => Promise<boolean>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function NoteRenameSheet(props: NoteRenameSheetProps) {
  return props.item ? <RenameSession key={props.item.taskId} {...props} item={props.item} /> : null;
}

function RenameSession({ item, busy, notice, disabled, disabledReason, onSave, onClose, onDirtyChange }: NoteRenameSheetProps & { item: HistoryListItem }) {
  const { t } = useTranslation("noteActions");
  const id = useId();
  const [initialName] = useState(() => getHistoryTitle(item));
  const [draft, setDraft] = useState(initialName);
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirtyCallbackRef = useRef(onDirtyChange);
  dirtyCallbackRef.current = onDirtyChange;
  const saving = busy || pending;
  const dirty = draft.trim() !== initialName;
  const storage = useDataStorage();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; dirtyCallbackRef.current?.(false); };
  }, []);
  useEffect(() => { dirtyCallbackRef.current?.(dirty); }, [dirty]);
  useEffect(() => {
    if (!saving) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [saving]);

  const close = () => { if (!saving) { dirtyCallbackRef.current?.(false); onClose(); } };
  async function saveName() {
    if (saving || disabled && !storage?.isResolvingEditor("note") || pendingRef.current) return;
    const title = draft.trim();
    if (FORBIDDEN_NAME_CHARACTERS.test(draft) || !isValidNoteTitleText(title)) { setInvalid(true); inputRef.current?.focus(); return; }
    pendingRef.current = true;
    setPending(true);
    try {
      if (await onSave(item.taskId, title) && mountedRef.current) closeAfterSave();
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await saveName(); }
  function closeAfterSave() { dirtyCallbackRef.current?.(false); onClose(); }
  useStorageEditor({ id: "note", dirty, saving, save: saveName, discard: () => { if (!saving) { setDraft(initialName); setInvalid(false); dirtyCallbackRef.current?.(false); } } });

  return (
    <NoteActionSheet
      open
      title={t("rename.title")}
      onClose={close}
      closeDisabled={saving}
      footer={(
        <>
          <button type="button" className="note-action-button" onClick={close} disabled={saving}>{t("common.cancel")}</button>
          <button type="submit" form={`${id}-form`} className="note-action-button note-action-primary" disabled={saving || disabled} aria-busy={saving}>{t(saving ? "common.saving" : "common.save")}</button>
        </>
      )}
    >
      <form id={`${id}-form`} className="note-rename-form" onSubmit={(event) => { void save(event); }}>
        <label htmlFor={`${id}-name`}>{t("rename.name")}</label>
        <input
          ref={inputRef}
          id={`${id}-name`}
          type="text"
          value={draft}
          disabled={saving}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ""}`}
          autoComplete="off"
          onPaste={(event) => {
            if (FORBIDDEN_NAME_CHARACTERS.test(event.clipboardData.getData("text"))) { event.preventDefault(); setInvalid(true); }
          }}
          onChange={(event) => { setDraft(event.currentTarget.value); setInvalid(false); }}
        />
        <div className="note-name-guidance"><p id={`${id}-hint`}>{t("rename.hint")}</p><span>{t("rename.count", { count: Array.from(draft).length })}</span></div>
        {invalid ? <p id={`${id}-error`} className="note-action-notice" role="alert">{t("rename.invalid")}</p> : null}
        {notice ? <p className="note-action-notice" role="alert">{notice}</p> : null}
        {disabled ? <p className="note-action-notice" role="status">{disabledReason}</p> : null}
      </form>
    </NoteActionSheet>
  );
}
