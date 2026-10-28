import { AlertTriangle, FileText, Lightbulb, ListChecks, LoaderCircle, ScanText, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import type { TaskWorkspaceViewModel, AiTargetViewModel } from "../../taskWorkspaceViewModel";
import type { InsightRetryTarget } from "../../workflow";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { formatNumber } from "../../i18n/formatters";
import type { SupportedLocale } from "../../i18n/locale";
import { renderWorkerProgressMessage } from "../../i18n/progressMessages";
import { renderUiMessage, uiMessage, type UiMessage } from "../../i18n/uiMessage";
import { UI_MOTION_LAYOUT_TRANSITION, UI_MOTION_TRANSITION } from "../../uiMotion";
import { StatusLine } from "../common/StatusLine";

type AiGenerationWorkspaceProps = {
  model: TaskWorkspaceViewModel["ai"];
  quotaRemaining: number;
  notice?: UiMessage | null;
  onSummaryAction: () => void;
  onInsightsAction: () => void;
  onDissectionAction: () => void;
  onDraftAction: () => void;
  onViewTarget: (target: InsightRetryTarget) => void;
  onCancel: () => void;
};

export function AiGenerationWorkspace({
  model,
  quotaRemaining,
  notice = null,
  onSummaryAction,
  onInsightsAction,
  onDissectionAction,
  onDraftAction,
  onViewTarget,
  onCancel,
}: AiGenerationWorkspaceProps) {
  const { t } = useTranslation("synthesis");
  const locale = useUiLocale();
  const renderedNotice = renderUiMessage(locale, notice);
  const renderedProgress = model.progressMessage
    ? renderWorkerProgressMessage(
        locale,
        "insights_generating",
        model.progressMessage,
      )
    : null;
  const blocker =
    model.availability === "quota_exhausted"
      ? t("workspace.quotaExhausted")
      : model.availability === "unavailable"
        ? t("workspace.unavailable")
        : null;
  const formattedQuota = formatNumber(quotaRemaining, locale);

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
      {renderedProgress ? (
        <StatusLine className="ai-progress-message">{renderedProgress}</StatusLine>
      ) : null}
      {blocker ? (
        <StatusLine className="ai-availability-blocker">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{blocker}</span>
        </StatusLine>
      ) : null}
      {renderedNotice ? (
        <StatusLine className="ai-workspace-notice">{renderedNotice}</StatusLine>
      ) : null}

      <div className="ai-target-list">
        {(
          [
            {
              target: model.summary,
              title: t("target.summary.title"),
              description: t("target.summary.description"),
              icon: <ListChecks size={18} aria-hidden="true" />,
              onAction: onSummaryAction,
              viewTarget: "summary",
            },
            {
              target: model.dissection,
              title: t("dissection.card.title"),
              description: t("dissection.card.description"),
              icon: <ScanText size={18} aria-hidden="true" />,
              onAction: onDissectionAction,
              viewTarget: "dissection",
              stale: model.dissectionStale,
              retainedResult: model.dissectionAvailable,
            },
            {
              target: model.insights,
              title: t("target.insights.title"),
              description: t("target.insights.description"),
              icon: <Lightbulb size={18} aria-hidden="true" />,
              onAction: onInsightsAction,
              viewTarget: "insights",
            },
            {
              target: model.draft,
              title: t("target.draft.title"),
              description: t("target.draft.description"),
              icon: <FileText size={18} aria-hidden="true" />,
              onAction: onDraftAction,
              viewTarget: "draft",
              actionLabel: t("action.chooseSeedAndGenerate"),
            },
          ] satisfies Array<{
            target: AiTargetViewModel;
            title: string;
            description: string;
            icon: React.ReactNode;
            onAction: () => void;
            viewTarget: InsightRetryTarget;
            stale?: boolean;
            retainedResult?: boolean;
            actionLabel?: string;
          }>
        ).map(({ viewTarget, ...card }) => (
          <AiTargetCard
            key={card.target.target}
            {...card}
            locale={locale}
            creditsSummary={t("credits.summary", { formattedCount: formattedQuota })}
            blocked={Boolean(blocker)}
            onView={() => onViewTarget(viewTarget)}
          />
        ))}
      </div>

      {model.cancellation.visible ? (
        <button
          className="secondary-button danger-soft ai-cancel-button"
          type="button"
          onClick={onCancel}
          disabled={!model.cancellation.enabled}
        >
          <X size={16} />
          <span>
            {model.cancellation.inProgress
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
  locale: SupportedLocale;
  title: string;
  description: string;
  creditsSummary: string;
  blocked: boolean;
  stale?: boolean;
  retainedResult?: boolean;
  icon: React.ReactNode;
  actionLabel?: string;
  onAction: () => void;
  onView: () => void;
};

function AiTargetCard({
  target,
  locale,
  title,
  description,
  creditsSummary,
  blocked,
  stale = false,
  retainedResult = false,
  icon,
  actionLabel,
  onAction,
  onView,
}: AiTargetCardProps) {
  const { t } = useTranslation("synthesis");
  const active = target.status === "generating" || target.status === "cancelling";
  const ready = target.status === "ready";
  const failed = target.status === "failed";
  const locked = target.status === "locked";
  const viewable = ready || retainedResult;
  const disabled = locked || active || blocked;
  const defaultActionLabel = failed
    ? t("action.retry")
    : target.target === "insights"
      ? t("action.chooseAndConfirm")
      : t("action.confirm");
  const label = actionLabel ?? defaultActionLabel;
  const timeoutGuidance = renderTimeoutGuidance(target.errorCode, locale);

  return (
    <motion.article
      className={`ai-target-card ${target.status}`}
      data-ai-target={target.target}
      data-motion="ai-target"
      layout
      transition={UI_MOTION_LAYOUT_TRANSITION}
    >
      <div className="ai-target-heading">
        <span className="ai-target-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="ai-target-status">{t(`status.${target.status}`)}</span>
      </div>
      {stale ? <p className="dissection-card-stale">{t("dissection.card.stale")}</p> : null}
      <AnimatePresence initial={false}>
        {target.errorCode ? (
          <motion.p
            className="ai-target-error"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={UI_MOTION_TRANSITION}
          >
            {timeoutGuidance ?? t("target.error", { code: target.errorCode })}
          </motion.p>
        ) : null}
      </AnimatePresence>
      {locked && target.lockedHint ? (
        <p className="ai-target-locked-hint">{renderUiMessage(locale, target.lockedHint)}</p>
      ) : null}
      <small>{creditsSummary}</small>
      <div className="ai-target-actions">
        {active ? (
          <LoaderCircle size={17} className="spin" aria-label={t("status.generating")} />
        ) : null}
        {viewable ? (
            <button type="button" className="secondary-button" onClick={onView}>
              {t("action.view")}
            </button>
        ) : null}
        {!active && !ready ? (
          <button type="button" className="secondary-button ai-target-action" onClick={onAction} disabled={disabled}>
            {label}
          </button>
        ) : null}
      </div>
    </motion.article>
  );
}

function renderTimeoutGuidance(
  errorCode: string | null,
  locale: SupportedLocale,
): string | null {
  if (errorCode === "WORKER_IDLE_TIMEOUT") {
    return renderUiMessage(locale, uiMessage("errors.worker.idleTimeout"));
  }
  if (errorCode === "WORKER_EXECUTION_TIMEOUT") {
    return renderUiMessage(locale, uiMessage("errors.worker.executionTimeout"));
  }
  return null;
}
