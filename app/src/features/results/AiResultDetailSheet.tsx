import { Copy, Download, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

import { isSupportedLocale } from "../../i18n/locale";
import { renderUiMessage, type UiMessage } from "../../i18n/uiMessage";
import type { WorkflowState } from "../../workflow";
import type { TranscriptDetailController } from "../transcript/useTranscriptDetailController";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import { MarkdownContent } from "./MarkdownContent";
import { DissectionReport } from "./DissectionReport";

type AiResultDetailSheetProps = {
  actionNotice: UiMessage | null;
  controller: TranscriptDetailController;
  workflow: WorkflowState;
  onOpenDirectionEditor: () => void | Promise<void>;
  onOpenDissectionConfirmation?: () => void;
  onLocateDissectionChunks?: (chunkIds: number[]) => void;
};

export function AiResultDetailSheet({
  actionNotice,
  controller,
  workflow,
  onOpenDirectionEditor,
  onOpenDissectionConfirmation = () => undefined,
  onLocateDissectionChunks = () => undefined,
}: AiResultDetailSheetProps) {
  const { t, i18n } = useTranslation("synthesis");
  const locale = isSupportedLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : "en-US";
  const renderedActionNotice = renderUiMessage(locale, actionNotice);
  const { detailTab, closeDetail, copyDetail, exportDetail, exportPath } = controller;
  const detailOpen =
    detailTab === "summary" || detailTab === "insights" || detailTab === "dissection";
  const [lastDetailTab, setLastDetailTab] = useState<"summary" | "insights" | "dissection">("summary");
  useEffect(() => {
    if (detailOpen) {
      setLastDetailTab(detailTab);
    }
  }, [detailOpen, detailTab]);
  const contentTab = detailOpen ? detailTab : lastDetailTab;

  const title = contentTab === "summary"
    ? t("detail.summaryTitle")
    : contentTab === "insights"
      ? t("detail.insightsTitle")
      : t("dissection.card.title");
  const questionList = new Intl.ListFormat(i18n.resolvedLanguage ?? "en-US", {
    style: "long",
    type: "conjunction",
  });
  return (
    <AnimatedSheet
      open={detailOpen}
      ariaLabel={t("detail.ariaLabel", { title })}
      className="ai-result-detail-sheet"
      onBackdropClick={closeDetail}
    >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">{t("detail.sectionLabel")}</p>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={closeDetail}
            aria-label={t("detail.closeAria")}
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal-tools">
          <span>{t("detail.localPreview")}</span>
          <div className="tool-actions">
            <button type="button" onClick={copyDetail} disabled={!controller.detailText}>
              <Copy size={16} />
              <span>{t("detail.copy")}</span>
            </button>
            {contentTab === "insights" ? (
              <button type="button" onClick={() => void onOpenDirectionEditor()}>
                <RotateCcw size={16} />
                <span>{t("detail.tryAnotherDirection")}</span>
              </button>
            ) : null}
            {contentTab === "dissection" ? (
              <button
                type="button"
                data-action="redissection"
                onClick={onOpenDissectionConfirmation}
              >
                <RotateCcw size={16} />
                <span>{t("dissection.report.redissection")}</span>
              </button>
            ) : null}
            <button type="button" onClick={exportDetail} disabled={!exportPath}>
              <Download size={16} />
              <span>{t("detail.export")}</span>
            </button>
          </div>
        </div>
        {renderedActionNotice ? (
          <p className="action-notice" role="status" aria-live="polite">
            {renderedActionNotice}
          </p>
        ) : null}
        <div className="modal-content">
          {contentTab === "summary" ? (
            <MarkdownContent
              markdown={workflow.summary}
              emptyText={t("detail.summaryEmpty")}
            />
          ) : contentTab === "dissection" ? (
            workflow.dissection ? (
              <DissectionReport
                report={workflow.dissection}
                stale={workflow.dissectionStale}
                sourceLocationDisabled={controller.transcriptDirty}
                onLocateChunks={onLocateDissectionChunks}
              />
            ) : (
              <p>{t("detail.dissectionEmpty")}</p>
            )
          ) : workflow.insights.length > 0 ? (
            <ol className="insight-detail-list">
              {workflow.insights.map((insight) => (
                <li className="insight-detail-item" key={insight.id}>
                  <h3>{insight.topic}</h3>
                  <dl>
                    <div><dt>{t("detail.matchReason")}</dt><dd>{insight.matchReason}</dd></div>
                    <div>
                      <dt>{t("detail.questions")}</dt>
                      <dd>{questionList.format(insight.followUpQuestions)}</dd>
                    </div>
                    <div><dt>{t("detail.suitableUse")}</dt><dd>{insight.suitableUse}</dd></div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("detail.insightsEmpty")}</p>
          )}
        </div>
    </AnimatedSheet>
  );
}
