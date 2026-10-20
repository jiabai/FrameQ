import { Copy, Download, RefreshCw, Save, X } from "lucide-react";
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
import { useLocale } from "../../i18n/LocaleProvider";
import { renderUiMessage, uiMessage, type UiMessage } from "../../i18n/uiMessage";
import { MarkdownContent } from "./MarkdownContent";

type DraftResultSheetProps = {
  open: boolean;
  workflow: WorkflowState;
  onClose: () => void;
  onSaved: (markdown: string, artifacts: TaskArtifacts) => void;
  onRegenerate: (seedInsightId: number | null) => void;
};

/**
 * Extracts a download filename from the buffer's first heading line,
 * or falls back to the taskId.
 */
function draftDownloadFilename(buffer: string, fallbackTaskId: string | null): string {
  const firstLine = buffer.split("\n").map(l => l.trim()).find(l => l.length > 0) ?? "";
  const headingMatch = firstLine.match(/^#{1,6}\s+(.+)$/);
  if (headingMatch) {
    const title = headingMatch[1].trim().replace(/[\\/:*?"<>|]/g, "_");
    if (title) return `${title}.md`;
  }
  return `${fallbackTaskId ?? "draft"}.md`;
}

/**
 * Self-contained split-pane draft editor: left textarea, right MarkdownContent
 * preview. Loads from disk on open, supports save/dirty/copy/download/export.
 */
export function DraftResultSheet({
  open,
  workflow,
  onClose,
  onSaved,
  onRegenerate,
}: DraftResultSheetProps) {
  const { t } = useTranslation("synthesis");
  const { resolvedLocale } = useLocale();
  const [buffer, setBuffer] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<UiMessage | null>(null);
  const [detailSeedId, setDetailSeedId] = useState<number | null>(null);
  const loadTaskIdRef = useRef<string | null>(null);
  const draftFallbackRef = useRef(workflow.draft);

  // Keep the fallback ref in sync without triggering effect reruns.
  draftFallbackRef.current = workflow.draft;

  // ---- Open: load from disk ----

  useEffect(() => {
    if (!open || !workflow.taskId) {
      return;
    }

    if (loadTaskIdRef.current === workflow.taskId) {
      return;
    }
    loadTaskIdRef.current = workflow.taskId;

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

  // ---- Download ----

  const handleDownload = useCallback(() => {
    if (dirty) {
      setNotice(uiMessage("synthesis.draftResult.downloadDirty"));
      return;
    }
    if (!buffer.trim()) {
      setNotice(uiMessage("synthesis.draftResult.downloadEmpty"));
      return;
    }

    const blob = new Blob([buffer], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const filename = draftDownloadFilename(buffer, workflow.taskId);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [buffer, dirty, workflow.taskId]);

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
        className="sheet-panel detail-modal ai-result-detail-sheet draft-result-sheet"
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
          <span className="draft-editor-label">{loading ? t("draftResult.loading") : t("draftResult.editing")}</span>
          <div className="tool-actions">
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
            <button type="button" onClick={handleDownload} disabled={!buffer.trim()}>
              <Download size={16} />
              <span>{t("draftResult.download")}</span>
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!getTaskArtifactPath(workflow, "draft")}
            >
              <Download size={16} />
              <span>{t("draftResult.export")}</span>
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

        {renderedNotice ? <p className="action-notice">{renderedNotice}</p> : null}

        <div className="modal-content draft-split-editor">
          <div className="draft-editor-pane">
            <textarea
              className="draft-textarea"
              value={buffer}
              onChange={handleBufferChange}
              placeholder={t("draftResult.empty")}
              aria-label={t("draftResult.editAria")}
            />
          </div>
          <div className="draft-preview-pane" data-testid="markdown-preview">
            <MarkdownContent markdown={buffer} emptyText={t("draftResult.empty")} />
          </div>
        </div>
      </section>
    </div>
  );
}
