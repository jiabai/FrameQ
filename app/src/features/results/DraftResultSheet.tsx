import { Copy, Download, RefreshCw, Save, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { WorkflowState } from "../../workflowState";
import type { TaskArtifacts } from "../../workflow";
import {
  loadDraftDetail,
  saveDraftEdit,
} from "../../draftDetailClient";
import { getTaskArtifactPath } from "../../workflow";
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
  const [buffer, setBuffer] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
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
    setNotice("");

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
          `无法读取草稿，已显示当前结果：${error instanceof Error ? error.message : String(error)}`,
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
      setNotice("草稿已保存。");
      onSaved(saved.markdown, saved.artifacts);
    } catch (error) {
      setNotice(`保存草稿失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [buffer, saving, workflow.taskId, onSaved]);

  // ---- Copy ----

  const handleCopy = useCallback(async () => {
    if (!buffer.trim()) {
      setNotice("暂无可复制内容。");
      return;
    }
    try {
      await navigator.clipboard.writeText(buffer);
      setNotice("已复制到剪贴板。");
    } catch {
      setNotice("复制失败，请手动选择内容复制。");
    }
  }, [buffer]);

  // ---- Download ----

  const handleDownload = useCallback(() => {
    if (dirty) {
      setNotice("有未保存修改，请先保存后再下载。");
      return;
    }
    if (!buffer.trim()) {
      setNotice("暂无可下载内容。");
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
      setNotice("有未保存修改，请先保存后再定位导出文件。");
      return;
    }
    const draftPath = getTaskArtifactPath(workflow, "draft");
    if (!draftPath) {
      setNotice("暂无可导出的文件。");
      return;
    }
    try {
      await revealItemInDir(draftPath);
      setNotice("已在文件管理器中定位导出文件。");
    } catch {
      setNotice(`无法定位文件：${draftPath}`);
    }
  }, [dirty, workflow]);

  // ---- Render ----

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className="sheet-panel detail-modal ai-result-detail-sheet draft-result-sheet"
        aria-label="文字稿详情"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">AI result</p>
            <h2>生成文字稿</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭文字稿详情">
            <X size={18} />
          </button>
        </header>

        <div className="modal-tools">
          <span className="draft-editor-label">{loading ? "加载中..." : "编辑模式"}</span>
          <div className="tool-actions">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              aria-busy={saving}
            >
              <Save size={16} />
              <span>{saving ? "保存中" : "保存"}</span>
            </button>
            <button type="button" onClick={handleCopy} disabled={!buffer.trim()}>
              <Copy size={16} />
              <span>复制</span>
            </button>
            <button type="button" onClick={handleDownload} disabled={!buffer.trim()}>
              <Download size={16} />
              <span>下载</span>
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!getTaskArtifactPath(workflow, "draft")}
            >
              <Download size={16} />
              <span>导出</span>
            </button>
            <button
              type="button"
              onClick={() => onRegenerate(detailSeedId ?? workflow.draftSeedInsightId ?? null)}
              disabled={!buffer.trim()}
            >
              <RefreshCw size={16} />
              <span>重新生成</span>
            </button>
          </div>
        </div>

        {notice ? <p className="action-notice">{notice}</p> : null}

        <div className="modal-content draft-split-editor">
          <div className="draft-editor-pane">
            <textarea
              className="draft-textarea"
              value={buffer}
              onChange={handleBufferChange}
              placeholder="文字稿尚未生成。"
              aria-label="编辑文字稿"
            />
          </div>
          <div className="draft-preview-pane" data-testid="markdown-preview">
            <MarkdownContent markdown={buffer} emptyText="文字稿尚未生成。" />
          </div>
        </div>
      </section>
    </div>
  );
}
