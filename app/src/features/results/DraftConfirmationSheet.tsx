import { CheckCircle2, FileText, ShieldCheck, Sprout, X } from "lucide-react";
import { useEffect, useState } from "react";

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
 * The `生成文字稿` confirmation sheet. Simpler than the insights wizard —
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
 * one mappable platform, else "其他"). The profile is never written back.
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
        // Keep the safe "其他" default on read failure; never throw to the UI.
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
        aria-label="确认生成文字稿"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">Draft</p>
            <h2>确认生成文字稿</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onCancel}
            aria-label="关闭生成文字稿确认"
          >
            <X size={18} />
          </button>
        </header>
        <div className="preference-flow-content">
          <p className="settings-warning privacy-callout">
            <ShieldCheck size={16} />
            <span>
              确认后仅发送文字稿片段，视频和音频不会上传。
            </span>
          </p>
          <section className="preference-summary-group">
            <h3>文字稿种子</h3>
            <div className="preference-summary-list">
              {seed ? (
                <span>
                  <Sprout size={15} aria-hidden="true" />
                  #{seed.id} {seed.topic}
                </span>
              ) : (
                <span>未选择种子</span>
              )}
            </div>
          </section>
          <section className="preference-field">
            <div className="preference-field-header">
              <span>目标平台</span>
            </div>
            <div className="preference-options" role="radiogroup" aria-label="目标平台">
              {DRAFT_PLATFORMS.map((option) => {
                const selected = option.id === selectedPlatform;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={option.label}
                    className={`preference-option ${selected ? "selected" : ""}`}
                    disabled={busy}
                    onClick={() => setSelectedPlatform(option.id)}
                  >
                    {selected ? <CheckCircle2 size={14} /> : null}
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <div className="confirm-summary preference-confirm-grid">
            <div>
              <span className="account-status-label">本次额度</span>
              <strong>1 次额度</strong>
              <small>1 次额度 = 1 次生成尝试，不论成败，重试另计</small>
            </div>
            <div>
              <span className="account-status-label">AI Credits</span>
              <strong>余额 {quotaRemaining}</strong>
              <small>{transcriptPath || "文字稿文件生成后才能继续。"}</small>
            </div>
          </div>
          <div className="settings-actions sheet-footer">
            <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
              <span>取消</span>
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => onConfirm(selectedPlatform)}
              disabled={busy}
            >
              <FileText size={16} />
              <span>{busy ? "启动中" : "确认"}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
