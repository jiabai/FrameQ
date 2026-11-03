import { Clock3, FileText, FolderOpen, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import type { HistoryListItem } from "../../historyClient";
import { formatDateTime, formatNumber } from "../../i18n/formatters";
import { useUiLocale } from "../../i18n/LocaleProvider";
import type { SupportedLocale } from "../../i18n/locale";
import { renderUiMessage, type UiMessage } from "../../i18n/uiMessage";
import { UI_MOTION_LAYOUT_TRANSITION } from "../../uiMotion";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import { HistoryDeleteConfirmation } from "./HistoryDeleteConfirmation";
import { StatusLine } from "../common/StatusLine";
import { getHistoryTitle } from "../shell/shellNavigation";
import type { HistoryController } from "./useHistoryController";

const historyStatusKeys: Record<
  HistoryListItem["status"],
  "status.completed" | "status.partial_completed" | "status.failed"
> = {
  completed: "status.completed",
  partial_completed: "status.partial_completed",
  failed: "status.failed",
};

type HistorySheetProps = {
  controller: HistoryController;
  selectionDisabled: boolean;
  selectionDisabledReason: UiMessage;
  deletionDisabled: boolean;
  deletionDisabledReason: UiMessage;
};

function formatHistoryTimestamp(
  value: string,
  locale: SupportedLocale,
): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date, locale);
}

function historyTitle(item: HistoryListItem): string {
  return item.noteMetadata?.displayTitle || item.noteTitle?.text ? getHistoryTitle(item) : item.textPreview ||
    (item.source.kind === "local_file" ? item.source.displayName : item.source.kind === "web_page" ? item.source.title : item.source.url);
}

export function HistorySheet({
  controller,
  selectionDisabled,
  selectionDisabledReason,
  deletionDisabled,
  deletionDisabledReason,
}: HistorySheetProps) {
  const {
    historyOpen,
    historyItems,
    historyNotice,
    historyLoading,
    historyDeleteCandidate,
    historyDeleting,
    closeHistory,
    openHistoryItem,
    requestHistoryItemDeletion,
    cancelHistoryItemDeletion,
  } = controller;
  const { t } = useTranslation("history");
  const resolvedLocale = useUiLocale();
  const renderedNotice = renderUiMessage(resolvedLocale, historyNotice);
  const renderedSelectionDisabledReason = renderUiMessage(
    resolvedLocale,
    selectionDisabledReason,
  );
  const renderedDeletionDisabledReason = renderUiMessage(
    resolvedLocale,
    deletionDisabledReason,
  );
  // Both reasons are plain message codes with no interpolation args. When they
  // match, one line covers both buttons and is the one the delete button names.
  const disabledReasonsAreEqual =
    selectionDisabledReason.messageCode === deletionDisabledReason.messageCode;
  const disabledReasonLines = [
    ...(selectionDisabled
      ? [{ id: "history-selection-disabled-reason", text: renderedSelectionDisabledReason }]
      : []),
    ...(deletionDisabled && (!selectionDisabled || !disabledReasonsAreEqual)
      ? [{ id: "history-deletion-disabled-reason", text: renderedDeletionDisabledReason }]
      : []),
  ];
  const deletionReasonId = disabledReasonLines[disabledReasonLines.length - 1]?.id;

  return (
    <>
    <AnimatedSheet
      open={historyOpen}
      ariaLabel={t("sheet.ariaLabel")}
      className="history-modal history-sheet"
      onBackdropClick={closeHistory}
      onKeyDown={(event) => {
          if (event.key === "Escape" && historyDeleteCandidate) {
            event.preventDefault();
            event.stopPropagation();
            cancelHistoryItemDeletion();
          }
        }}
    >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">{t("sheet.eyebrow")}</p>
            <h2>{t("sheet.title")}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={closeHistory}
            aria-label={t("sheet.closeAriaLabel")}
            disabled={historyDeleting}
          >
            <X size={18} />
          </button>
        </header>
        {renderedNotice ? <StatusLine>{renderedNotice}</StatusLine> : null}
        {disabledReasonLines.map((reason) => (
          <StatusLine id={reason.id} key={reason.id}>
            {reason.text}
          </StatusLine>
        ))}
        <div className="history-list">
          <AnimatePresence initial={false} mode="popLayout">
            {historyItems.map((item) => (
              <motion.div
                className={`history-item ${item.status}`}
                data-motion="history-item"
                key={item.id}
                layout
                transition={UI_MOTION_LAYOUT_TRANSITION}
                exit={{ opacity: 0, scale: 0.98 }}
              >
              <button
                className="history-item-select"
                type="button"
                onClick={() => openHistoryItem(item)}
                disabled={selectionDisabled || historyDeleting}
                aria-describedby={
                  selectionDisabled ? "history-selection-disabled-reason" : undefined
                }
              >
                <div className="history-item-main">
                  <span className={`history-status ${item.status}`}>
                    {t(historyStatusKeys[item.status])}
                  </span>
                  <span className="history-title-row">
                    <strong
                      className={`history-title ${
                        item.noteMetadata?.displayTitle || item.noteTitle?.text || item.textPreview ? "history-title-preview" : "history-title-url"
                      }`}
                      title={historyTitle(item)}
                    >
                      {historyTitle(item)}
                    </strong>
                    {item.source.kind === "local_file" ? (
                      <span className="history-source-kind">
                        {t(`item.localSource.${item.source.mediaKind}`)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="history-meta">
                  <span className="history-meta-time">
                    <Clock3 size={13} />
                    <span className="history-meta-value">
                      {formatHistoryTimestamp(item.createdAt, resolvedLocale)}
                    </span>
                  </span>
                  <span
                    className="history-meta-output"
                    title={item.outputDir || t("item.outputFallback")}
                  >
                    <FolderOpen size={13} />
                    <span className="history-meta-value">
                      {item.outputDir || t("item.outputFallback")}
                    </span>
                  </span>
                  <span
                    className="history-meta-result"
                    title={
                      item.error
                        ? item.error.code
                        : t("item.insights", {
                            count: item.insightsCount,
                            formattedCount: formatNumber(item.insightsCount, resolvedLocale),
                          })
                    }
                  >
                    <span className="history-meta-value">
                      {item.error
                        ? item.error.code
                        : t("item.insights", {
                            count: item.insightsCount,
                            formattedCount: formatNumber(item.insightsCount, resolvedLocale),
                          })}
                    </span>
                  </span>
                </div>
              </button>
              <button
                className="history-item-delete"
                type="button"
                onClick={() => requestHistoryItemDeletion(item)}
                disabled={deletionDisabled || historyDeleting}
                aria-label={t("item.deleteAriaLabel", {
                  title: historyTitle(item),
                })}
                title={t("item.deleteTitle")}
                aria-describedby={deletionDisabled ? deletionReasonId : undefined}
              >
                <Trash2 size={16} />
              </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {!historyLoading && historyItems.length === 0 ? (
            <div className="history-empty">
              <FileText size={18} />
              <span>{t("empty")}</span>
            </div>
          ) : null}
        </div>
    </AnimatedSheet>
    <HistoryDeleteConfirmation controller={controller} disabled={deletionDisabled} disabledReason={renderedDeletionDisabledReason} />
    </>
  );
}
