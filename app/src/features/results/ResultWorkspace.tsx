import { AlertTriangle, FileText, Film, Lightbulb, Volume2 } from "lucide-react";

import {
  formatWorkerError,
  type ResultCard,
  type WorkerErrorResult,
  type WorkflowState,
} from "../../workflow";

type ResultWorkspaceProps = {
  workflow: WorkflowState;
  resultCards: ResultCard[];
  visibleWorkflowError: WorkerErrorResult | null;
  actionNotice: string;
  stageTitles: Record<WorkflowState["stage"], string>;
  onOpenCard: (card: ResultCard) => void;
};

export function ResultWorkspace({
  workflow,
  resultCards,
  visibleWorkflowError,
  actionNotice,
  stageTitles,
  onOpenCard,
}: ResultWorkspaceProps) {
  if (workflow.showUrlInput) {
    return null;
  }

  return (
    <section className="result-workspace result-area" aria-label="结果总览">
      <div className="result-header">
        <div>
          <p className="section-label">Results</p>
          <h2>结果工作区</h2>
        </div>
      </div>

      {visibleWorkflowError ? (
        <div className="error-result">
          <AlertTriangle size={20} />
          <div>
            <strong>{visibleWorkflowError.code}</strong>
            <span>{formatWorkerError(visibleWorkflowError)}</span>
            <small>失败阶段：{stageTitles[visibleWorkflowError.stage] ?? visibleWorkflowError.stage}</small>
          </div>
        </div>
      ) : null}

      {resultCards.length > 0 ? (
        <div className="result-grid">
          {resultCards.map((card) => (
            <button
              className={`result-card result-tile ${card.status}`}
              key={card.id}
              type="button"
              onClick={() => onOpenCard(card)}
            >
              <span className="result-icon">{renderResultIcon(card)}</span>
              <span>{card.title}</span>
              <small>{getResultMeta(card, workflow)}</small>
              <em>{getResultActionLabel(card)}</em>
            </button>
          ))}
        </div>
      ) : !visibleWorkflowError ? (
        <div className="result-placeholder empty-result">
          <div className="placeholder-icon">
            <FileText size={20} />
          </div>
          <div>
            <strong>结果生成中</strong>
            <span>
              {workflow.stage === "insights_generating" && workflow.text
                ? "文字稿已保留，正在重新生成话题点。"
                : "视频提取完成后将开始转译。"}
            </span>
          </div>
        </div>
      ) : null}
      {actionNotice ? <p className="action-notice result-action-notice">{actionNotice}</p> : null}
    </section>
  );
}

function getResultMeta(card: ResultCard, workflow: WorkflowState): string {
  if (card.id === "video") {
    return workflow.videoPath ? "已下载，可定位文件" : "等待视频文件";
  }

  if (card.id === "audio") {
    return workflow.audioPath ? "WAV 音频，可定位文件" : "等待音频文件";
  }

  if (card.id === "insights") {
    if (card.status === "pending") {
      return "待生成，需单独确认";
    }

    if (card.status === "failed") {
      return "生成失败，可重新确认";
    }

    return `${workflow.insights.length} 个话题点`;
  }

  if (!workflow.text) {
    return "等待文字稿";
  }

  return `${workflow.text.length.toLocaleString("zh-CN")} 字`;
}

function getResultActionLabel(card: ResultCard): string {
  if (card.action === "locate") {
    return "定位文件";
  }

  if (card.action === "confirm") {
    return card.status === "failed" ? "重新生成" : "确认生成";
  }

  return "打开详情";
}

function renderResultIcon(card: ResultCard) {
  if (card.id === "video") {
    return <Film size={22} />;
  }
  if (card.id === "audio") {
    return <Volume2 size={22} />;
  }
  if (card.id === "insights") {
    return <Lightbulb size={22} />;
  }
  return <FileText size={22} />;
}
