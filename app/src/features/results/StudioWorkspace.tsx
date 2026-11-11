import { AlertTriangle, FileText, Lightbulb, ListChecks, LoaderCircle, ScanText, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import type { TaskWorkspaceViewModel, StudioToolViewModel } from "../../taskWorkspaceViewModel";
import type { StudioTool } from "../../workflow";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { formatNumber } from "../../i18n/formatters";
import type { SupportedLocale } from "../../i18n/locale";
import { renderWorkerProgressMessage } from "../../i18n/progressMessages";
import { renderUiMessage, uiMessage, type UiMessage } from "../../i18n/uiMessage";
import { UI_MOTION_LAYOUT_TRANSITION, UI_MOTION_TRANSITION } from "../../uiMotion";
import { StatusLine } from "../common/StatusLine";

const STUDIO_TOOL_ICONS: Record<StudioTool, React.ReactNode> = {
  summary: <ListChecks size={18} aria-hidden="true" />,
  dissection: <ScanText size={18} aria-hidden="true" />,
  insights: <Lightbulb size={18} aria-hidden="true" />,
  draft: <FileText size={18} aria-hidden="true" />,
};

type StudioToolCardSeed = {
  tool: StudioToolViewModel;
  title: string;
  description: string;
  onAction: () => void;
  stale?: boolean;
  retainedResult?: boolean;
  actionLabel?: string;
};

type StudioWorkspaceProps = {
  model: TaskWorkspaceViewModel["ai"];
  quotaRemaining: number;
  notice?: UiMessage | null;
  onSummaryAction: () => void;
  onInsightsAction: () => void;
  onDissectionAction: () => void;
  onDraftAction: () => void;
  onViewTool: (target: StudioTool) => void;
  onCancel: () => void;
};

export function StudioWorkspace({
  model,
  quotaRemaining,
  notice = null,
  onSummaryAction,
  onInsightsAction,
  onDissectionAction,
  onDraftAction,
  onViewTool,
  onCancel,
}: StudioWorkspaceProps) {
  const { t } = useTranslation("studio");
  const { t: webT } = useTranslation("webPage");
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
      {model.activeTool || model.phase === "waiting_transcript" ? (
        <div className="domain-workspace-header ai-workspace-state">
          {model.activeTool ? (
            <span className="workspace-status-badge active">{t("workspace.generating")}</span>
          ) : (
            <span className="workspace-status-badge">{model.sourceKind === "article" ? webT("waiting") : t("workspace.waitingTranscript")}</span>
          )}
        </div>
      ) : null}

      <div className="ai-workspace-credits">
        <p className="ai-credits-balance">{t("credits.balance", { formattedCount: formattedQuota })}</p>
        <p className="ai-credits-cost">{t("credits.costHint")}</p>
      </div>
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

      <div className="studio-tool-list">
        {([
          {
            tool: model.summary,
            title: t("tools.summary.title"),
            description: t("tools.summary.description"),
            onAction: onSummaryAction,
          },
          {
            tool: model.dissection,
            title: model.sourceKind === "article" ? webT("dissection.title") : t("dissection.card.title"),
            description: t("dissection.card.description"),
            onAction: onDissectionAction,
            stale: model.dissectionStale,
            retainedResult: model.dissectionAvailable,
          },
          {
            tool: model.insights,
            title: t("tools.insights.title"),
            description: t("tools.insights.description"),
            onAction: onInsightsAction,
          },
          {
            tool: model.draft,
            title: t("tools.draft.title"),
            description: t("tools.draft.description"),
            onAction: onDraftAction,
            actionLabel: t("action.chooseSeedAndGenerate"),
          },
        ] satisfies Array<StudioToolCardSeed>).map((card) => (
          <StudioToolCard
            key={card.tool.id}
            {...card}
            icon={STUDIO_TOOL_ICONS[card.tool.id]}
            locale={locale}
            blocked={Boolean(blocker) || model.phase === "generating"}
            onView={() => onViewTool(card.tool.id)}
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

type StudioToolCardProps = {
  tool: StudioToolViewModel;
  locale: SupportedLocale;
  title: string;
  description: string;
  blocked: boolean;
  stale?: boolean;
  retainedResult?: boolean;
  icon: React.ReactNode;
  actionLabel?: string;
  onAction: () => void;
  onView: () => void;
};

function StudioToolCard({
  tool,
  locale,
  title,
  description,
  blocked,
  stale = false,
  retainedResult = false,
  icon,
  actionLabel,
  onAction,
  onView,
}: StudioToolCardProps) {
  const { t } = useTranslation("studio");
  const active = tool.status === "generating" || tool.status === "cancelling";
  const ready = tool.status === "ready";
  const failed = tool.status === "failed";
  const locked = tool.status === "locked";
  const viewable = ready || retainedResult;
  const disabled = locked || active || blocked;
  const defaultActionLabel = failed
    ? t("action.retry")
    : tool.id === "insights"
      ? t("action.chooseAndConfirm")
      : t("action.confirm");
  const label = actionLabel ?? defaultActionLabel;
  const timeoutGuidance = renderTimeoutGuidance(tool.errorCode, locale);

  return (
    <motion.article
      className={`studio-tool-card ${tool.status}`}
      data-studio-tool={tool.id}
      data-motion="studio-tool"
      layout
      transition={UI_MOTION_LAYOUT_TRANSITION}
    >
      <div className="studio-tool-heading">
        <span className="studio-tool-icon">{icon}</span>
        <h3>{title}</h3>
        <span className="studio-tool-status">{t(`status.${tool.status}`)}</span>
      </div>
      <p className="studio-tool-description">{description}</p>
      {stale ? <p className="dissection-card-stale">{t("dissection.card.stale")}</p> : null}
      <AnimatePresence initial={false}>
        {tool.errorCode ? (
          <motion.p
            className="studio-tool-error"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={UI_MOTION_TRANSITION}
          >
            {timeoutGuidance ?? t("tools.error", { code: tool.errorCode })}
          </motion.p>
        ) : null}
      </AnimatePresence>
      {locked && tool.lockedHint ? (
        <p className="studio-tool-locked-hint">{renderUiMessage(locale, tool.lockedHint)}</p>
      ) : null}
      <div className="studio-tool-actions">
        {active ? (
          <LoaderCircle size={17} className="spin" aria-label={t("status.generating")} />
        ) : null}
        {viewable ? (
            <button type="button" className="secondary-button" onClick={onView}>
              {t("action.view")}
            </button>
        ) : null}
        {!active && !ready ? (
          <button type="button" className="secondary-button studio-tool-action" onClick={onAction} disabled={disabled}>
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
