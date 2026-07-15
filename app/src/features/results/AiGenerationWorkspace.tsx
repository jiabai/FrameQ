import { AlertTriangle, Lightbulb, ListChecks, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { TaskWorkspaceViewModel, AiTargetViewModel } from "../../taskWorkspaceViewModel";
import type { InsightRetryTarget, WorkflowState } from "../../workflow";
import { isSupportedLocale } from "../../i18n/locale";
import { renderUiMessage, type UiMessage } from "../../i18n/uiMessage";

type AiGenerationWorkspaceProps = {
  workflow: WorkflowState;
  model: TaskWorkspaceViewModel["ai"];
  quotaRemaining: number;
  notice?: UiMessage | null;
  onSummaryAction: () => void;
  onInsightsAction: () => void;
  onViewTarget: (target: InsightRetryTarget) => void;
  onCancel: () => void;
};

export function AiGenerationWorkspace({
  workflow,
  model,
  quotaRemaining,
  notice = null,
  onSummaryAction,
  onInsightsAction,
  onViewTarget,
  onCancel,
}: AiGenerationWorkspaceProps) {
  const { t, i18n } = useTranslation("synthesis");
  const locale = isSupportedLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : "en-US";
  const renderedNotice = renderUiMessage(locale, notice);
  const blocker =
    model.availability === "quota_exhausted"
      ? t("workspace.quotaExhausted")
      : model.availability === "unavailable"
        ? t("workspace.unavailable")
        : null;
  const formattedQuota = new Intl.NumberFormat(i18n.resolvedLanguage ?? "en-US").format(
    quotaRemaining,
  );

  return (
    <section
      className="task-domain-workspace ai-generation-workspace"
      aria-label={t("workspace.ariaLabel")}
      data-task-id={model.taskId ?? undefined}
    >
      <header className="domain-workspace-header">
        <div>
          <h2>{t("workspace.title")}</h2>
        </div>
        {model.activeTarget ? (
          <span className="workspace-status-badge active">{t("workspace.generating")}</span>
        ) : model.phase === "waiting_transcript" ? (
          <span className="workspace-status-badge">{t("workspace.waitingTranscript")}</span>
        ) : null}
      </header>

      <p className="ai-privacy-copy">{t("workspace.privacy")}</p>
      {blocker ? (
        <p className="ai-availability-blocker" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{blocker}</span>
        </p>
      ) : null}
      {renderedNotice ? (
        <p className="ai-workspace-notice" role="status" aria-live="polite">
          {renderedNotice}
        </p>
      ) : null}

      <div className="ai-target-list">
        <AiTargetCard
          target={model.summary}
          title={t("target.summary.title")}
          description={t("target.summary.description")}
          creditsSummary={t("credits.summary", { formattedCount: formattedQuota })}
          blocked={Boolean(blocker)}
          icon={<ListChecks size={18} aria-hidden="true" />}
          onAction={onSummaryAction}
          onView={() => onViewTarget("summary")}
        />
        <AiTargetCard
          target={model.insights}
          title={t("target.insights.title")}
          description={t("target.insights.description")}
          creditsSummary={t("credits.summary", { formattedCount: formattedQuota })}
          blocked={Boolean(blocker)}
          icon={<Lightbulb size={18} aria-hidden="true" />}
          onAction={onInsightsAction}
          onView={() => onViewTarget("insights")}
        />
      </div>

      {model.activeTarget ? (
        <button
          className="secondary-button danger-soft ai-cancel-button"
          type="button"
          onClick={onCancel}
          disabled={workflow.stage === "cancelling"}
        >
          <X size={16} />
          <span>
            {workflow.stage === "cancelling"
              ? t("action.cancelling")
              : t("action.cancel")}
          </span>
        </button>
      ) : null}
    </section>
  );
}

type AiTargetCardProps = {
  target: AiTargetViewModel;
  title: string;
  description: string;
  creditsSummary: string;
  blocked: boolean;
  icon: React.ReactNode;
  onAction: () => void;
  onView: () => void;
};

function AiTargetCard({
  target,
  title,
  description,
  creditsSummary,
  blocked,
  icon,
  onAction,
  onView,
}: AiTargetCardProps) {
  const { t } = useTranslation("synthesis");
  const active = target.status === "generating" || target.status === "cancelling";
  const ready = target.status === "ready";
  const failed = target.status === "failed";
  const disabled = target.status === "locked" || active || blocked;
  const actionLabel = failed
    ? t("action.retry")
    : target.target === "insights"
      ? t("action.chooseAndConfirm")
      : t("action.confirm");

  return (
    <article className={`ai-target-card ${target.status}`} data-ai-target={target.target}>
      <div className="ai-target-heading">
        <span className="ai-target-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="ai-target-status">{t(`status.${target.status}`)}</span>
      </div>
      {target.errorCode ? (
        <p className="ai-target-error">{t("target.error", { code: target.errorCode })}</p>
      ) : null}
      <small>{creditsSummary}</small>
      <div className="ai-target-actions">
        {active ? (
          <LoaderCircle size={17} className="spin" aria-label={t("status.generating")} />
        ) : null}
        {ready ? (
          <button type="button" className="secondary-button" onClick={onView}>
            {t("action.view")}
          </button>
        ) : (
          <button type="button" className="secondary-button ai-target-action" onClick={onAction} disabled={disabled}>
            {actionLabel}
          </button>
        )}
      </div>
    </article>
  );
}
