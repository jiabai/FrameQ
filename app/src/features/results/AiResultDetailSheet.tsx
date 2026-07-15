import { Copy, Download, RotateCcw, Sprout, X } from "lucide-react";

import type { WorkflowState } from "../../workflow";
import type { TranscriptDetailController } from "../transcript/useTranscriptDetailController";
import { MarkdownContent } from "./MarkdownContent";

type AiResultDetailSheetProps = {
  actionNotice: string;
  controller: TranscriptDetailController;
  workflow: WorkflowState;
  onOpenDirectionEditor: () => void | Promise<void>;
  // Select/clear the single draft seed insight. The selected id lives on
  // workflow.draftSeedInsightId; these callbacks mutate it via the controller.
  onSelectDraftSeed?: (insightId: number) => void;
  onClearDraftSeed?: () => void;
};

export function AiResultDetailSheet({
  actionNotice,
  controller,
  workflow,
  onOpenDirectionEditor,
  onSelectDraftSeed,
  onClearDraftSeed,
}: AiResultDetailSheetProps) {
  const { detailTab, closeDetail, copyDetail, exportDetail, exportPath } = controller;
  if (detailTab !== "summary" && detailTab !== "insights") {
    return null;
  }

  const title = detailTab === "summary" ? "要点总结" : "启发灵感";
  const seedId = workflow.draftSeedInsightId;
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
              {workflow.insights.map((insight) => {
                const selected = seedId === insight.id;
                return (
                  <li
                    className={`insight-detail-item${selected ? " draft-seed-selected" : ""}`}
                    key={insight.id}
                    aria-current={selected ? "true" : undefined}
                  >
                    <h3>{insight.topic}</h3>
                    <dl>
                      <div><dt>匹配理由</dt><dd>{insight.matchReason}</dd></div>
                      <div><dt>启发问题</dt><dd>{insight.followUpQuestions.join("；")}</dd></div>
                      <div><dt>适合用途</dt><dd>{insight.suitableUse}</dd></div>
                    </dl>
                    {onSelectDraftSeed && onClearDraftSeed ? (
                      <div className="insight-detail-seed-action">
                        {selected ? (
                          <>
                            <p className="draft-seed-summary">
                              <Sprout size={15} aria-hidden="true" />
                              <span>已选为文字稿种子。</span>
                            </p>
                            <button
                              type="button"
                              className="secondary-button compact-button"
                              onClick={() => onClearDraftSeed()}
                            >
                              取消种子
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => onSelectDraftSeed(insight.id)}
                          >
                            <Sprout size={15} aria-hidden="true" />
                            <span>选为文字稿种子</span>
                          </button>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p>启发灵感尚未生成。</p>
          )}
        </div>
      </section>
    </div>
  );
}
