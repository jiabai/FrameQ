import { Copy, Download, X } from "lucide-react";

import { getTaskArtifactPath, type WorkflowState } from "../../workflow";
import { MarkdownContent } from "./MarkdownContent";

type DraftResultSheetProps = {
  open: boolean;
  workflow: WorkflowState;
  actionNotice: string;
  onCopy: () => void;
  onExport: () => void;
  onClose: () => void;
};

/**
 * The draft result viewer. A SEPARATE container from the transcript —
 * it renders `workflow.draft` through the shared sanitized GFM renderer
 * (`MarkdownContent`: remark-gfm + rehype-sanitize + skipHtml), so raw HTML
 * is stripped and Mermaid source renders as a plain code block, not a
 * diagram. Provides 复制 (copy markdown) + 导出 (locate `ai/draft.md`).
 */
export function DraftResultSheet({
  open,
  workflow,
  actionNotice,
  onCopy,
  onExport,
  onClose,
}: DraftResultSheetProps) {
  if (!open) {
    return null;
  }

  const draftPath = getTaskArtifactPath(workflow, "draft");

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
          <span>本地结果预览</span>
          <div className="tool-actions">
            <button type="button" onClick={onCopy} disabled={!workflow.draft}>
              <Copy size={16} />
              <span>复制</span>
            </button>
            <button type="button" onClick={onExport} disabled={!draftPath}>
              <Download size={16} />
              <span>导出</span>
            </button>
          </div>
        </div>
        {actionNotice ? <p className="action-notice">{actionNotice}</p> : null}
        <div className="modal-content">
          <MarkdownContent markdown={workflow.draft} emptyText="文字稿尚未生成。" />
        </div>
      </section>
    </div>
  );
}
