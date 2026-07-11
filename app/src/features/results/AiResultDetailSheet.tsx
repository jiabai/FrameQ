import { Copy, Download, RotateCcw, X } from "lucide-react";

import type { WorkflowState } from "../../workflow";
import type { TranscriptDetailController } from "../transcript/useTranscriptDetailController";
import { MarkdownContent } from "./MarkdownContent";

type AiResultDetailSheetProps = {
  actionNotice: string;
  controller: TranscriptDetailController;
  workflow: WorkflowState;
  onOpenDirectionEditor: () => void | Promise<void>;
};

export function AiResultDetailSheet({
  actionNotice,
  controller,
  workflow,
  onOpenDirectionEditor,
}: AiResultDetailSheetProps) {
  const { detailTab, closeDetail, copyDetail, exportDetail, exportPath } = controller;
  if (detailTab !== "summary" && detailTab !== "insights") {
    return null;
  }

  const title = detailTab === "summary" ? "要点总结" : "启发灵感";
  return (
    <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={closeDetail}>
      <section
        className="sheet-panel detail-modal ai-result-detail-sheet"
        aria-label={`${title}详情`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">AI result</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={closeDetail} aria-label="关闭 AI 结果详情">
            <X size={18} />
          </button>
        </header>
        <div className="modal-tools">
          <span>本地结果预览</span>
          <div className="tool-actions">
            <button type="button" onClick={copyDetail} disabled={!controller.detailText}>
              <Copy size={16} />
              <span>复制</span>
            </button>
            {detailTab === "insights" ? (
              <button type="button" onClick={() => void onOpenDirectionEditor()}>
                <RotateCcw size={16} />
                <span>换个方向</span>
              </button>
            ) : null}
            <button type="button" onClick={exportDetail} disabled={!exportPath}>
              <Download size={16} />
              <span>导出</span>
            </button>
          </div>
        </div>
        {actionNotice ? <p className="action-notice">{actionNotice}</p> : null}
        <div className="modal-content">
          {detailTab === "summary" ? (
            <MarkdownContent markdown={workflow.summary} emptyText="要点总结尚未生成。" />
          ) : workflow.insights.length > 0 ? (
            <ol className="insight-detail-list">
              {workflow.insights.map((insight) => (
                <li className="insight-detail-item" key={insight.id}>
                  <h3>{insight.topic}</h3>
                  <dl>
                    <div><dt>匹配理由</dt><dd>{insight.matchReason}</dd></div>
                    <div><dt>启发问题</dt><dd>{insight.followUpQuestions.join("；")}</dd></div>
                    <div><dt>适合用途</dt><dd>{insight.suitableUse}</dd></div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <p>启发灵感尚未生成。</p>
          )}
        </div>
      </section>
    </div>
  );
}
