import { ListChecks, ShieldCheck, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getAiCreditsCostHint } from "../../aiCreditsCopy";
import { countTextUnits, formatNumber, formatWordCount } from "../../i18n/formatters";
import type { SupportedLocale } from "../../i18n/locale";
import { OutputLanguageField } from "../insightPreferences/OutputLanguageField";
import { AnimatedSheet } from "../modal/AnimatedSheet";

type SummaryConfirmationSheetProps = {
  open: boolean;
  locale: SupportedLocale;
  transcriptText: string;
  transcriptPath: string | null;
  quotaRemaining: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function SummaryConfirmationSheet({
  open,
  locale,
  transcriptText,
  transcriptPath,
  quotaRemaining,
  busy,
  onConfirm,
  onCancel,
}: SummaryConfirmationSheetProps) {
  const { t } = useTranslation("synthesis");
  const unitCount = useMemo(
    () => countTextUnits(transcriptText, locale),
    [locale, transcriptText],
  );

  return (
    <AnimatedSheet
      open={open}
      ariaLabel={t("confirmation.ariaLabel")}
      className="preference-flow-sheet"
      onBackdropClick={onCancel}
    >
      <header className="modal-header sheet-header">
        <div>
          <p className="section-label">{t("confirmation.sectionLabel")}</p>
          <h2>{t("confirmation.title")}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onCancel}
          aria-label={t("confirmation.closeAria")}
        >
          <X size={18} />
        </button>
      </header>
      <div className="preference-flow-content">
        <p className="settings-warning privacy-callout">
          <ShieldCheck size={16} />
          <span>{t("confirmation.privacy")}</span>
        </p>
        <div className="confirm-summary preference-confirm-grid">
          <div>
            <span className="account-status-label">
              {t("confirmation.currentTranscript")}
            </span>
            <strong>
              {unitCount > 0
                ? formatWordCount(unitCount, locale)
                : t("confirmation.waitingTranscript")}
            </strong>
            <small>{transcriptPath || t("confirmation.transcriptUnavailable")}</small>
          </div>
          <div>
            <span className="account-status-label">{t("confirmation.creditsLabel")}</span>
            <strong>
              {t("confirmation.creditsBalance", {
                formattedCount: formatNumber(quotaRemaining, locale),
              })}
            </strong>
            <small>{getAiCreditsCostHint(locale)}</small>
          </div>
          <OutputLanguageField locale={locale} outputLanguage={locale} />
        </div>
        <div className="settings-actions sheet-footer">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            <span>{t("confirmation.cancel")}</span>
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={busy}>
            <ListChecks size={16} />
            <span>{t("confirmation.confirm")}</span>
          </button>
        </div>
      </div>
    </AnimatedSheet>
  );
}
