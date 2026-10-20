import { CheckCircle2, FileText, ShieldCheck, Sprout, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  DRAFT_PLATFORMS,
  deriveDefaultDraftPlatform,
  type DraftPlatformId,
} from "../../insightPreferences";
import { getInsightPreferences } from "../../insightPreferencesClient";
import type { WorkflowState } from "../../workflow";

type DraftConfirmationSheetProps = {
  open: boolean;
  workflow: WorkflowState;
  busy: boolean;
  quotaRemaining: number;
  transcriptPath: string | null;
  onConfirm: (platform: DraftPlatformId) => void;
  onCancel: () => void;
};

/**
 * The draft generation confirmation sheet. Simpler than the insights wizard —
 * no profile/preferences, just the selected seed summary + a 9-option target
 * platform single-select (defaulted from the inspiration profile) + a fixed-1
 * quota notice + the data privacy notice + confirm/cancel.
 *
 * The quota notice shows a FIXED 1: one draft generation attempt costs
 * exactly one quota unit, independent of success; a retry counts separately.
 * The data notice reuses the existing AI privacy copy (no web-search /
 * anysearch disclosure is added).
 *
 * Platform: the selected id is request-scoped — it is
 * returned via onConfirm and never persisted. On open the default is derived
 * READ-ONLY from the profile (preselect only when the profile has exactly
 * one mappable platform, else "other"). The profile is never written back.
 */
export function DraftConfirmationSheet({
  open,
  workflow,
  busy,
  quotaRemaining,
  transcriptPath,
  onConfirm,
  onCancel,
}: DraftConfirmationSheetProps) {
  const { t } = useTranslation("synthesis");
  const [selectedPlatform, setSelectedPlatform] = useState<DraftPlatformId>("other");

  // Derive the default platform READ-ONLY from the inspiration profile when the
  // sheet opens. The profile is never written back; reopen re-derives (G7).
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void getInsightPreferences()
      .then((state) => {
        if (cancelled) {
          return;
        }
        setSelectedPlatform(
          deriveDefaultDraftPlatform(state.profile?.platforms ?? null),
        );
      })
      .catch(() => {
        // Keep the safe "other" default on read failure; never throw to the UI.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const seed = workflow.insights.find(
    (insight) => insight.id === workflow.draftSeedInsightId,
  );

  return (
    <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="sheet-panel detail-modal preference-flow-sheet"
        aria-label={t("draftConfirmation.ariaLabel")}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">{t("draftConfirmation.sectionLabel")}</p>
            <h2>{t("draftConfirmation.title")}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onCancel}
            aria-label={t("draftConfirmation.closeAria")}
          >
            <X size={18} />
          </button>
        </header>
        <div className="preference-flow-content">
          <p className="settings-warning privacy-callout">
            <ShieldCheck size={16} />
            <span>{t("draftConfirmation.privacy")}</span>
          </p>
          <section className="preference-summary-group">
            <h3>{t("draftConfirmation.seedLabel")}</h3>
            <div className="preference-summary-list">
              {seed ? (
                <span>
                  <Sprout size={15} aria-hidden="true" />
                  {t("draftConfirmation.seedEntry", { id: seed.id, topic: seed.topic })}
                </span>
              ) : (
                <span>{t("draftConfirmation.noSeed")}</span>
              )}
            </div>
          </section>
          <section className="preference-field">
            <div className="preference-field-header">
              <span>{t("draftConfirmation.platformLabel")}</span>
            </div>
            <div
              className="preference-options"
              role="radiogroup"
              aria-label={t("draftConfirmation.platformLabel")}
            >
              {DRAFT_PLATFORMS.map((id) => {
                const selected = id === selectedPlatform;
                const label = t(`draftPlatform.${id}`);
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={label}
                    className={`preference-option ${selected ? "selected" : ""}`}
                    disabled={busy}
                    onClick={() => setSelectedPlatform(id)}
                  >
                    {selected ? <CheckCircle2 size={14} /> : null}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <div className="confirm-summary preference-confirm-grid">
            <div>
              <span className="account-status-label">{t("draftConfirmation.quotaLabel")}</span>
              <strong>{t("draftConfirmation.quotaCost")}</strong>
              <small>{t("draftConfirmation.quotaHint")}</small>
            </div>
            <div>
              <span className="account-status-label">{t("draftConfirmation.creditsLabel")}</span>
              <strong>{t("draftConfirmation.creditsBalance", { formattedCount: quotaRemaining })}</strong>
              <small>{transcriptPath || t("draftConfirmation.transcriptUnavailable")}</small>
            </div>
          </div>
          <div className="settings-actions sheet-footer">
            <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
              <span>{t("draftConfirmation.cancel")}</span>
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => onConfirm(selectedPlatform)}
              disabled={busy}
            >
              <FileText size={16} />
              <span>{busy ? t("draftConfirmation.starting") : t("draftConfirmation.confirm")}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
