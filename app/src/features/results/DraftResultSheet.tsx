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
import { revealItemInDir } from "@tauri-apps/plugin-opener";

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

type DraftResultSheetProps = {
  open: boolean;
  workflow: WorkflowState;
  onClose: () => void;
  onSaved: (markdown: string, artifacts: TaskArtifacts) => void;
  onRegenerate: (seedInsightId: number | null) => void;
};

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
}: DraftResultSheetProps) {
  const { t } = useTranslation("synthesis");
  const resolvedLocale = useUiLocale();
  const [buffer, setBuffer] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<UiMessage | null>(null);
  const [detailSeedId, setDetailSeedId] = useState<number | null>(null);
  const draftFallbackRef = useRef(workflow.draft);

  // Keep the fallback ref in sync without re-running the load effect below.
  useEffect(() => {
    draftFallbackRef.current = workflow.draft;
  }, [workflow.draft]);

  // ---- Open: load from disk ----

  useEffect(() => {
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
    setDirty(false);
    setNotice(null);

    const taskId = workflow.taskId;

    async function load() {
      try {
        const detail = await loadDraftDetail(taskId);
        if (cancelled) return;
        setBuffer(detail.markdown);
        setDetailSeedId(detail.draft_seed_insight_id);
      } catch (error) {
        if (cancelled) return;
        setBuffer(draftFallbackRef.current);
        setNotice(
          uiMessage("synthesis.draftResult.loadFailed", {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        if (!cancelled) {
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
    if (!workflow.taskId || saving) return;

    const expectedTaskId = workflow.taskId;
    setSaving(true);
    try {
      const saved = await saveDraftEdit(expectedTaskId, buffer);
      if (saved.task_id !== expectedTaskId) return;
      setDirty(false);
      setNotice(uiMessage("synthesis.draftResult.saved"));
      onSaved(saved.markdown, saved.artifacts);
    } catch (error) {
      setNotice(
        uiMessage("synthesis.draftResult.saveFailed", {
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSaving(false);
    }
  }, [buffer, saving, workflow.taskId, onSaved]);

  // ---- Copy ----

  const handleCopy = useCallback(async () => {
    if (!buffer.trim()) {
      setNotice(uiMessage("synthesis.draftResult.copyEmpty"));
      return;
    }
    try {
      await navigator.clipboard.writeText(buffer);
      setNotice(uiMessage("synthesis.draftResult.copied"));
    } catch {
      setNotice(uiMessage("synthesis.draftResult.copyFailed"));
    }
  }, [buffer]);

  // ---- Export (locate file on disk) ----

  const handleExport = useCallback(async () => {
    if (dirty) {
      setNotice(uiMessage("synthesis.draftResult.exportDirty"));
      return;
    }
    const draftPath = getTaskArtifactPath(workflow, "draft");
    if (!draftPath) {
      setNotice(uiMessage("synthesis.draftResult.exportMissing"));
      return;
    }
    try {
      await revealItemInDir(draftPath);
      setNotice(uiMessage("synthesis.draftResult.exported"));
    } catch {
      setNotice(uiMessage("synthesis.draftResult.exportFailed", { path: draftPath }));
    }
  }, [dirty, workflow]);

  // ---- Render ----

  if (!open) {
    return null;
  }

  const renderedNotice = renderUiMessage(resolvedLocale, notice);

  return (
    <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className={`sheet-panel detail-modal ai-result-detail-sheet draft-result-sheet${expanded ? " is-expanded" : ""}`}
        aria-label={t("draftResult.ariaLabel")}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">{t("draftResult.sectionLabel")}</p>
            <h2>{t("draftResult.title")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("draftResult.closeAria")}>
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
              onClick={() => onRegenerate(detailSeedId ?? workflow.draftSeedInsightId ?? null)}
              disabled={!buffer.trim()}
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
      </section>
    </div>
  );
}
