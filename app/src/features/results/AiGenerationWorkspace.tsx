import { AlertTriangle, FileText, Lightbulb, ListChecks, LoaderCircle, X } from "lucide-react";

import { formatAiCreditsBalance, getAiCreditsCostHint } from "../../aiCreditsCopy";
import type { TaskWorkspaceViewModel, AiTargetViewModel } from "../../taskWorkspaceViewModel";
import type { InsightRetryTarget, WorkflowState } from "../../workflow";

type AiGenerationWorkspaceProps = {
  workflow: WorkflowState;
  model: TaskWorkspaceViewModel["ai"];
  quotaRemaining: number;
  notice?: string;
  onSummaryAction: () => void;
  onInsightsAction: () => void;
  onDraftAction: () => void;
  onViewTarget: (target: InsightRetryTarget) => void;
  onCancel: () => void;
};

export function AiGenerationWorkspace({
  workflow,
  model,
  quotaRemaining,
  notice = "",
  onSummaryAction,
  onInsightsAction,
  onDraftAction,
  onViewTarget,
  onCancel,
}: AiGenerationWorkspaceProps) {
  const blocker =
    model.availability === "quota_exhausted"
      ? "AI Credits 已用完，请联系管理员补充余额。"
      : model.availability === "unavailable"
        ? "当前账号或 AI 服务暂不可用。"
        : null;

  return (
    <section
      className="task-domain-workspace ai-generation-workspace"
      aria-label="智能提炼工作区"
      data-task-id={model.taskId ?? undefined}
    >
      <header className="domain-workspace-header">
        <div>
          <h2>智能提炼</h2>
        </div>
        {model.activeTarget ? (
          <span className="workspace-status-badge active">生成中</span>
        ) : model.phase === "waiting_transcript" ? (
          <span className="workspace-status-badge">等待文字稿</span>
        ) : null}
      </header>

      <p className="ai-privacy-copy">确认后仅发送文字稿片段，视频和音频不会上传。</p>
      {blocker ? (
        <p className="ai-availability-blocker" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{blocker}</span>
        </p>
      ) : null}
      {notice ? <p className="ai-workspace-notice">{notice}</p> : null}

      <div className="ai-target-list">
        <AiTargetCard
          target={model.summary}
          title="要点总结"
          description="同时生成思维导图文件"
          quotaRemaining={quotaRemaining}
          blocked={Boolean(blocker)}
          icon={<ListChecks size={18} aria-hidden="true" />}
          onAction={onSummaryAction}
          onView={() => onViewTarget("summary")}
        />
        <AiTargetCard
          target={model.insights}
          title="启发灵感"
          description="确认本次偏好后独立生成"
          quotaRemaining={quotaRemaining}
          blocked={Boolean(blocker)}
          icon={<Lightbulb size={18} aria-hidden="true" />}
          onAction={onInsightsAction}
          onView={() => onViewTarget("insights")}
        />
        <AiTargetCard
          target={model.draft}
          title="生成文字稿"
          description="基于一条启发灵感生成完整文字稿"
          quotaRemaining={quotaRemaining}
          blocked={Boolean(blocker)}
          icon={<FileText size={18} aria-hidden="true" />}
          actionLabel="选择种子并生成"
          lockedHint={draftLockedHint(workflow)}
          onAction={onDraftAction}
          onView={() => onViewTarget("draft")}
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
          <span>{workflow.stage === "cancelling" ? "正在取消" : "取消 AI 生成"}</span>
        </button>
      ) : null}
    </section>
  );
}

type AiTargetCardProps = {
  target: AiTargetViewModel;
  title: string;
  description: string;
  quotaRemaining: number;
  blocked: boolean;
  icon: React.ReactNode;
  actionLabel?: string;
  lockedHint?: string;
  onAction: () => void;
  onView: () => void;
};

function AiTargetCard({
  target,
  title,
  description,
  quotaRemaining,
  blocked,
  icon,
  actionLabel,
  lockedHint,
  onAction,
  onView,
}: AiTargetCardProps) {
  const active = target.status === "generating" || target.status === "cancelling";
  const ready = target.status === "ready";
  const failed = target.status === "failed";
  const locked = target.status === "locked";
  const disabled = locked || active || blocked;
  const defaultActionLabel = failed
    ? "重新生成"
    : target.target === "insights"
      ? "选择并确认"
      : "确认生成";
  const label = actionLabel ?? defaultActionLabel;

  return (
    <article className={`ai-target-card ${target.status}`} data-ai-target={target.target}>
      <div className="ai-target-heading">
        <span className="ai-target-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="ai-target-status">{targetStatusLabel(target.status)}</span>
      </div>
      {target.errorCode ? <p className="ai-target-error">{target.errorCode}</p> : null}
      {locked && lockedHint ? <p className="ai-target-locked-hint">{lockedHint}</p> : null}
      <small>{formatAiCreditsBalance(quotaRemaining)}。{getAiCreditsCostHint()}</small>
      <div className="ai-target-actions">
        {active ? <LoaderCircle size={17} className="spin" aria-label="生成中" /> : null}
        {ready ? (
          <button type="button" className="secondary-button" onClick={onView}>
            查看结果
          </button>
        ) : (
          <button type="button" className="secondary-button ai-target-action" onClick={onAction} disabled={disabled}>
            {label}
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * The copy shown when the draft target card is quietly locked. Draft needs
 * a seed insight: if no inspiration has been generated yet, prompt for that;
 * otherwise prompt to select one as the seed.
 */
function draftLockedHint(workflow: WorkflowState): string {
  const insightsReady = Boolean(
    workflow.insights.length ||
      workflow.artifacts.insights ||
      workflow.artifacts.insights_md,
  );
  return insightsReady ? "请选择一条启发灵感作为种子" : "请先生成启发灵感";
}

function targetStatusLabel(status: AiTargetViewModel["status"]): string {
  switch (status) {
    case "locked":
      return "等待文字稿";
    case "generating":
      return "生成中";
    case "cancelling":
      return "正在取消";
    case "ready":
      return "已生成";
    case "failed":
      return "生成失败";
    default:
      return "待生成";
  }
}
