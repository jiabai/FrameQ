import { Copy, Download, Maximize2, Minimize2, RotateCcw, Sprout, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";

import { useUiLocale } from "../../i18n/LocaleProvider";
import { renderUiMessage, type UiMessage } from "../../i18n/uiMessage";
import type { WorkflowState } from "../../workflow";
import type { TranscriptDetailController } from "../transcript/useTranscriptDetailController";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import { MarkdownContent } from "./MarkdownContent";
import { DissectionReport } from "./DissectionReport";
import { useLastDefined } from "../common/useLastDefined";
import { StatusLine } from "../common/StatusLine";

type AiResultDetailSheetProps = {
  actionNotice: UiMessage | null;
  controller: TranscriptDetailController;
  workflow: WorkflowState;
  onOpenDirectionEditor: () => void | Promise<void>;
  onOpenDissectionConfirmation?: () => void;
  onLocateDissectionChunks?: (chunkIds: number[]) => void;
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
  onOpenDissectionConfirmation = () => undefined,
  onLocateDissectionChunks = () => undefined,
  onSelectDraftSeed,
  onClearDraftSeed,
}: AiResultDetailSheetProps) {
  const { t } = useTranslation("synthesis");
  const locale = useUiLocale();
  const renderedActionNotice = renderUiMessage(locale, actionNotice);
  const { detailTab, closeDetail, copyDetail, exportDetail, exportPath } = controller;
  const detailOpen =
    detailTab === "summary" || detailTab === "insights" || detailTab === "dissection";
  const [expanded, setExpanded] = useState(false);
  const contentTab = useLastDefined(detailTab, "summary");
  // The sheet stays mounted through its closing animation, so the expanded
  // flag has to be cleared explicitly rather than by unmount.
  useEffect(() => {
    if (!detailOpen) {
      setExpanded(false);
    }
  }, [detailOpen]);

  const title = contentTab === "summary"
    ? t("detail.summaryTitle")
    : contentTab === "insights"
      ? t("detail.insightsTitle")
      : t("dissection.card.title");
  const questionList = useMemo(
    () => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }),
    [locale],
  );
  const seedId = workflow.draftSeedInsightId;
  return (
    <AnimatedSheet
      open={detailOpen}
      ariaLabel={t("detail.ariaLabel", { title })}
      className={`ai-result-detail-sheet${expanded ? " is-expanded" : ""}`}
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
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-pressed={expanded}
              aria-label={
                expanded ? t("detail.exitFullscreen") : t("detail.fullscreen")
              }
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              <span>
                {expanded ? t("detail.exitFullscreen") : t("detail.fullscreen")}
              </span>
            </button>
          </div>
        </div>
        {renderedActionNotice ? (
          <StatusLine>{renderedActionNotice}</StatusLine>
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
                      <div><dt>{t("detail.matchReason")}</dt><dd>{insight.matchReason}</dd></div>
                      <div>
                        <dt>{t("detail.questions")}</dt>
                        <dd>{questionList.format(insight.followUpQuestions)}</dd>
                      </div>
                      <div><dt>{t("detail.suitableUse")}</dt><dd>{insight.suitableUse}</dd></div>
                    </dl>
                    {onSelectDraftSeed && onClearDraftSeed ? (
                      <div className="insight-detail-seed-action">
                        {selected ? (
                          <>
                            <p className="draft-seed-summary">
                              <Sprout size={15} aria-hidden="true" />
                              <span>{t("detail.draftSeedSelected")}</span>
                            </p>
                            <button
                              type="button"
                              className="secondary-button compact-button"
                              onClick={() => onClearDraftSeed()}
                            >
                              {t("detail.clearDraftSeed")}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => onSelectDraftSeed(insight.id)}
                          >
                            <Sprout size={15} aria-hidden="true" />
                            <span>{t("detail.selectDraftSeed")}</span>
                          </button>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p>{t("detail.insightsEmpty")}</p>
          )}
        </div>
    </AnimatedSheet>
  );
}
