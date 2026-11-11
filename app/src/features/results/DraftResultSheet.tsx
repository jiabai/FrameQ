import {
  Copy,
  Eye,
  FolderOpen,
  Maximize2,
  Minimize2,
  Pencil,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { WorkflowState } from "../../workflowState";
import type { TaskArtifacts } from "../../workflow";
import {
  loadDraftDetail,
  saveDraftEdit,
} from "../../draftDetailClient";
import { getTaskArtifactPath } from "../../workflow";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { renderUiMessage, uiMessage, type UiMessage } from "../../i18n/uiMessage";
import { MarkdownContent } from "./MarkdownContent";
import { StatusLine } from "../common/StatusLine";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import { ConfirmDialog } from "../modal/ConfirmDialog";
import { revealPath } from "../common/revealPath";
import { useStorageEditor } from "../dataStorage/useDataStorageController";

type DraftResultSheetProps = {
  open: boolean;
  workflow: WorkflowState;
  onClose: () => void;
  onSaved: (markdown: string, artifacts: TaskArtifacts, expectedTaskId: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onRegenerate: (seedInsightId: number | null, hasUnsavedChanges: boolean) => void;
};

export function canCloseDraftResult({ saving, dirty, discardAccepted }: {
  saving: boolean;
  dirty: boolean;
  discardAccepted: boolean;
}): boolean {
  return !saving && (!dirty || discardAccepted);
}

/**
 * Self-contained draft result sheet: rendered Markdown by default, an explicit
 * edit mode for the raw Markdown buffer, and a full-screen toggle. Loads from
 * disk on open, supports save/dirty/copy/export.
 */
export function DraftResultSheet({
  open,
  workflow,
  onClose,
  onSaved,
  onRegenerate,
  onBusyChange,
}: DraftResultSheetProps) {
  const { t } = useTranslation("studio");
  const resolvedLocale = useUiLocale();
  const [buffer, setBuffer] = useState("");
  const savedBuffer = useRef("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<UiMessage | null>(null);
  const [detailSeedId, setDetailSeedId] = useState<number | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const draftFallbackRef = useRef(workflow.draft);
  const [discardCandidate, setDiscardCandidate] = useState<{ taskId: string | null } | null>(null);
  const discardCandidateRef = useRef(discardCandidate);
  const savingRef = useRef(false);
  const currentTaskRef = useRef({ open, taskId: workflow.taskId });
  currentTaskRef.current = { open, taskId: workflow.taskId };

  const cancelDiscard = useCallback(() => {
    discardCandidateRef.current = null;
    setDiscardCandidate(null);
  }, []);

  useEffect(() => {
    cancelDiscard();
  }, [open, workflow.taskId, saving, cancelDiscard]);

  useEffect(() => {
    onBusyChange?.(saving);
  }, [saving, onBusyChange]);

  const handleClose = useCallback(() => {
    if (!open || savingRef.current || discardCandidateRef.current) return;
    if (dirty) {
      const candidate = { taskId: workflow.taskId };
      discardCandidateRef.current = candidate;
      setDiscardCandidate(candidate);
      return;
    }
    onClose();
  }, [open, dirty, workflow.taskId, onClose]);

  const confirmDiscard = useCallback(() => {
    const current = currentTaskRef.current;
    if (
      !discardCandidate ||
      discardCandidateRef.current !== discardCandidate ||
      !current.open ||
      current.taskId !== discardCandidate.taskId ||
      !canCloseDraftResult({ saving: savingRef.current, dirty, discardAccepted: true })
    ) return;
    cancelDiscard();
    setDirty(false);
    onClose();
  }, [discardCandidate, dirty, cancelDiscard, onClose]);

  // Keep the fallback ref in sync without re-running the load effect below.
  useEffect(() => {
    draftFallbackRef.current = workflow.draft;
  }, [workflow.draft]);

  // ---- Open: load from disk ----

  useEffect(() => {
    setDetailTaskId(null);
    if (!open) {
      setEditing(false);
      setExpanded(false);
      return;
    }
    if (!workflow.taskId) {
      return;
    }

    // The effect keys on [open, workflow.taskId], so a reopen or a task
    // switch always reloads from disk while re-renders leave the buffer
    // (and any unsaved edits) untouched.
    let cancelled = false;
    setLoading(true);
    setBuffer(draftFallbackRef.current);
    savedBuffer.current = draftFallbackRef.current;
    setDirty(false);
    setNotice(null);
    setDetailSeedId(null);

    const taskId = workflow.taskId;

    async function load() {
      try {
        const detail = await loadDraftDetail(taskId);
        if (cancelled) return;
        setBuffer(detail.markdown);
        savedBuffer.current = detail.markdown;
        setDetailSeedId(detail.draft_seed_insight_id);
      } catch (error) {
        if (cancelled) return;
        setBuffer(draftFallbackRef.current);
        setNotice(
          uiMessage("studio.draftResult.loadFailed", {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        if (!cancelled) {
          setDetailTaskId(taskId);
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, workflow.taskId]);

  // ---- Edit handler ----

  const handleBufferChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setBuffer(e.target.value);
      setDirty(true);
    },
    [],
  );

  // ---- Save ----

  const handleSave = useCallback(async () => {
    if (!open || !workflow.taskId || savingRef.current || discardCandidateRef.current) return;

    const expectedTaskId = workflow.taskId;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveDraftEdit(expectedTaskId, buffer);
      if (saved.task_id !== expectedTaskId || currentTaskRef.current.taskId !== expectedTaskId) return;
      setDirty(false);
      savedBuffer.current = saved.markdown;
      setNotice(uiMessage("studio.draftResult.saved"));
      onSaved(saved.markdown, saved.artifacts, expectedTaskId);
    } catch (error) {
      if (currentTaskRef.current.taskId !== expectedTaskId) return;
      setNotice(
        uiMessage("studio.draftResult.saveFailed", {
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [buffer, open, workflow.taskId, onSaved]);
  useStorageEditor({ id: "draft", dirty: open && dirty, saving, save: handleSave,
    discard: () => { if (!savingRef.current) { setBuffer(savedBuffer.current); setDirty(false); } } });

  // ---- Copy ----

  const handleCopy = useCallback(async () => {
    if (!buffer.trim()) {
      setNotice(uiMessage("studio.draftResult.copyEmpty"));
      return;
    }
    try {
      await navigator.clipboard.writeText(buffer);
      setNotice(uiMessage("studio.draftResult.copied"));
    } catch {
      setNotice(uiMessage("studio.draftResult.copyFailed"));
    }
  }, [buffer]);

  // ---- Export (locate file on disk) ----

  const handleExport = useCallback(async () => {
    if (dirty) {
      setNotice(uiMessage("studio.draftResult.exportDirty"));
      return;
    }
    const draftPath = getTaskArtifactPath(workflow, "draft");
    if (!draftPath) {
      setNotice(uiMessage("studio.draftResult.exportMissing"));
      return;
    }
    setNotice(
      (await revealPath(draftPath))
        ? uiMessage("studio.draftResult.exported")
        : uiMessage("studio.draftResult.exportFailed"),
    );
  }, [dirty, workflow]);

  // ---- Render ----

  const renderedNotice = renderUiMessage(resolvedLocale, notice);
  const regenerationReady = open && !loading && workflow.taskId !== null && detailTaskId === workflow.taskId;

  return (
    <>
      <AnimatedSheet
        open={open}
        ariaLabel={t("draftResult.ariaLabel")}
        className={`ai-result-detail-sheet draft-result-sheet${expanded ? " is-expanded" : ""}`}
        onBackdropClick={handleClose}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          handleClose();
        }}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">{t("draftResult.sectionLabel")}</p>
            <h2>{t("draftResult.title")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={handleClose} disabled={saving} aria-label={t("draftResult.closeAria")}>
            <X size={18} />
          </button>
        </header>

        <div className="modal-tools">
          <span className="draft-editor-label">
            {loading
              ? t("draftResult.loading")
              : editing
                ? t("draftResult.editing")
                : t("draftResult.preview")}
          </span>
          <div className="tool-actions">
            <button
              type="button"
              onClick={() => setEditing((current) => !current)}
              aria-pressed={editing}
            >
              {editing ? <Eye size={16} /> : <Pencil size={16} />}
              <span>
                {editing ? t("draftResult.renderMode") : t("draftResult.editing")}
              </span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              aria-busy={saving}
            >
              <Save size={16} />
              <span>{saving ? t("draftResult.saving") : t("draftResult.save")}</span>
            </button>
            <button type="button" onClick={handleCopy} disabled={!buffer.trim()}>
              <Copy size={16} />
              <span>{t("draftResult.copy")}</span>
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!getTaskArtifactPath(workflow, "draft")}
            >
              <FolderOpen size={16} />
              <span>{t("draftResult.export")}</span>
            </button>
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-pressed={expanded}
              aria-label={
                expanded
                  ? t("draftResult.exitFullscreen")
                  : t("draftResult.fullscreen")
              }
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              <span>
                {expanded
                  ? t("draftResult.exitFullscreen")
                  : t("draftResult.fullscreen")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!regenerationReady || savingRef.current || discardCandidateRef.current) return;
                onRegenerate(detailSeedId ?? workflow.draftSeedInsightId ?? null, dirty);
              }}
              disabled={!regenerationReady || saving || !buffer.trim()}
            >
              <RefreshCw size={16} />
              <span>{t("draftResult.regenerate")}</span>
            </button>
          </div>
        </div>

        {renderedNotice ? <StatusLine>{renderedNotice}</StatusLine> : null}

        {editing ? (
          <div className="modal-content draft-editor-pane">
            <textarea
              className="draft-textarea"
              value={buffer}
              disabled={saving}
              onChange={handleBufferChange}
              placeholder={t("draftResult.empty")}
              aria-label={t("draftResult.editAria")}
            />
          </div>
        ) : (
          <div className="modal-content draft-preview-pane" data-testid="markdown-preview">
            <MarkdownContent markdown={buffer} emptyText={t("draftResult.empty")} />
          </div>
        )}
      </AnimatedSheet>
      <ConfirmDialog
        open={open && !saving && discardCandidate !== null && discardCandidate.taskId === workflow.taskId}
        title={t("draftResult.discardChangesTitle")}
        message={t("draftResult.discardChangesConfirm")}
        cancelLabel={t("draftResult.keepEditing")}
        confirmLabel={t("draftResult.discardChanges")}
        onCancel={cancelDiscard}
        onConfirm={confirmDiscard}
      />
    </>
  );
}
