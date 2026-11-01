import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModalFocus } from "../modal/useModalFocus";
import { getHistoryTitle } from "../shell/shellNavigation";
import type { HistoryController } from "./useHistoryController";

export function HistoryDeleteConfirmation({ controller, disabled, disabledReason }: {
  controller: HistoryController; disabled: boolean; disabledReason: string;
}) {
  const { t } = useTranslation("history");
  const { historyDeleteCandidate: item, historyDeleting, cancelHistoryItemDeletion, confirmHistoryItemDeletion } = controller;
  const historyDeleteModalRef = useModalFocus<HTMLElement>(Boolean(item));
  if (!item) return null;
  return <div className="history-delete-confirm-backdrop" role="presentation"
    onClick={historyDeleting ? undefined : cancelHistoryItemDeletion}>
    <section ref={historyDeleteModalRef} className="history-delete-confirm" role="alertdialog" aria-modal="true" aria-label={t("confirm.ariaLabel")}
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!historyDeleting) cancelHistoryItemDeletion(); }
      }}>
      <TriangleAlert size={22} />
      <div><h3>{t("confirm.title")}</h3><strong>{getHistoryTitle(item)}</strong><p>{t("confirm.body")}</p>
        {disabled && <p id="note-delete-disabled-reason">{disabledReason}</p>}
      </div>
      <div className="history-delete-confirm-actions">
        <button className="secondary-button" type="button" onClick={cancelHistoryItemDeletion} disabled={historyDeleting} data-modal-initial-focus>{t("confirm.cancel")}</button>
        <button className="danger-button" type="button" onClick={() => void confirmHistoryItemDeletion()} disabled={disabled || historyDeleting}
          aria-describedby={disabled ? "note-delete-disabled-reason" : undefined}>{historyDeleting ? t("confirm.deleting") : t("confirm.delete")}</button>
      </div>
    </section>
  </div>;
}
