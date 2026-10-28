import { ShieldCheck, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatNumber } from "../../i18n/formatters";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { getOutputLanguageName } from "../../i18n/preferencePresentation";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import { StatusLine } from "../common/StatusLine";
import { useLastDefined } from "../common/useLastDefined";
import type { DissectionPreview } from "./useTranscriptDissectionController";

type Props = {
  preview: DissectionPreview | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function TranscriptDissectionConfirmationSheet({
  preview,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation("synthesis");
  const locale = useUiLocale();
  const renderPreview = useLastDefined(preview, null);
  if (!renderPreview) {
    return null;
  }

  const blockReason = !renderPreview.eligible
    ? t("dissection.confirmation.tooLong")
    : !renderPreview.canConfirm
      ? t("dissection.confirmation.insufficientQuota")
      : null;

  return (
    <AnimatedSheet
      open={preview !== null}
      ariaLabel={t("dissection.confirmation.ariaLabel")}
      className="dissection-confirmation-sheet"
      onBackdropClick={onCancel}
    >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">{t("dissection.confirmation.sectionLabel")}</p>
            <h2>{t("dissection.confirmation.title")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label={t("dissection.confirmation.closeAria")}>
            <X size={18} />
          </button>
        </header>
        <div className="preference-flow-content">
          <p className="settings-warning privacy-callout">
            <ShieldCheck size={16} />
            <span>{t("dissection.confirmation.privacy")}</span>
          </p>
          <dl className="dissection-preview-grid">
            <div><dt>{t("dissection.confirmation.task")}</dt><dd>{renderPreview.taskTitle}</dd></div>
            <div><dt>{t("dissection.confirmation.characters")}</dt><dd>{formatNumber(renderPreview.characterCount, locale)}</dd></div>
            <div><dt>{t("dissection.confirmation.chunks")}</dt><dd>{formatNumber(renderPreview.chunkCount, locale)}</dd></div>
            <div><dt>{t("dissection.confirmation.language")}</dt><dd>{getOutputLanguageName(renderPreview.outputLanguage, renderPreview.outputLanguage)}</dd></div>
            <div>
              <dt>{t("dissection.confirmation.calls")}</dt>
              <dd>{t("dissection.confirmation.callRange", {
                minimum: formatNumber(renderPreview.minimumCalls, locale),
                maximum: formatNumber(renderPreview.maximumCalls, locale),
                hardMaximum: formatNumber(renderPreview.hardMaximumCalls, locale),
              })}</dd>
            </div>
            <div><dt>{t("dissection.confirmation.quota")}</dt><dd>{formatNumber(renderPreview.quotaRemaining, locale)}</dd></div>
          </dl>
          <p className="dissection-credit-disclosure">{t("dissection.confirmation.creditDisclosure")}</p>
          {blockReason ? <StatusLine className="ai-availability-blocker">{blockReason}</StatusLine> : null}
          <div className="settings-actions sheet-footer">
            <button type="button" className="secondary-button" onClick={onCancel}>{t("dissection.confirmation.cancel")}</button>
            <button type="button" className="primary-button" onClick={() => void onConfirm()} disabled={!renderPreview.canConfirm}>
              <Sparkles size={16} />
              <span>{t("dissection.confirmation.confirm")}</span>
            </button>
          </div>
        </div>
    </AnimatedSheet>
  );
}
