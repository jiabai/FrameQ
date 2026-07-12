import { FileAudio, Film, X } from "lucide-react";

import type { TaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import type { TaskArtifactKey, WorkflowState } from "../../workflow";
import { TranscriptReviewPanel } from "./TranscriptReviewPanel";
import type { TranscriptDetailController } from "./useTranscriptDetailController";

type LocalTranscriptWorkspaceProps = {
  workflow: WorkflowState;
  model: TaskWorkspaceViewModel["local"];
  controller: TranscriptDetailController;
  actionNotice: string;
  onLocateArtifact: (artifact: Extract<TaskArtifactKey, "video" | "audio">) => void;
  onCancel: () => void;
};

export function LocalTranscriptWorkspace({
  workflow,
  model,
  controller,
  actionNotice,
  onLocateArtifact,
  onCancel,
}: LocalTranscriptWorkspaceProps) {
  return (
    <section
      className="task-domain-workspace local-transcript-workspace"
      aria-label="本地文字稿工作区"
      data-task-id={model.taskId ?? undefined}
    >
      <header className="domain-workspace-header">
        <div>
          <h2>{model.phase === "ready" ? "文字稿校对" : "本地转录"}</h2>
        </div>
        {model.phase !== "ready" ? (
          <span className={`workspace-status-badge ${model.phase}`}>{localStatusLabel(model.phase)}</span>
        ) : null}
      </header>

      {model.phase === "processing" ? (
        <div className="local-progress" aria-label="本地处理进度">
          {model.progressSteps.map((step) => (
            <span className={step.state} key={step.id}>{step.label}</span>
          ))}
          <button className="secondary-button danger-soft" type="button" onClick={onCancel} disabled={workflow.stage === "cancelling"}>
            <X size={16} />
            <span>{workflow.stage === "cancelling" ? "正在取消" : "取消本地处理"}</span>
          </button>
        </div>
      ) : null}

      {actionNotice ? <p className="action-notice">{actionNotice}</p> : null}

      {model.canReview ? (
        <>
          <TranscriptReviewPanel
            workflow={workflow}
            controller={controller}
            editingDisabled={!model.canEdit}
            readOnlyReason={model.readOnlyReason}
            artifactToolbar={(
              <div className="local-artifact-toolbar" aria-label="本地文件操作">
                <button type="button" className="secondary-button" onClick={() => onLocateArtifact("video")} disabled={!workflow.artifacts.video}>
                  <Film size={16} />
                  <span>定位视频</span>
                </button>
                <button type="button" className="secondary-button" onClick={() => onLocateArtifact("audio")} disabled={!workflow.artifacts.audio}>
                  <FileAudio size={16} />
                  <span>定位音频</span>
                </button>
              </div>
            )}
          />
        </>
      ) : model.phase !== "processing" ? (
        <p className="workspace-empty-copy">文字稿生成后可在这里回听、校对和保存。</p>
      ) : null}

      {model.error ? <p className="local-workspace-error">{model.error.code}</p> : null}
    </section>
  );
}

function localStatusLabel(phase: TaskWorkspaceViewModel["local"]["phase"]): string {
  switch (phase) {
    case "processing":
      return "处理中";
    case "ready":
      return "本地完成";
    case "failed":
      return "处理失败";
    default:
      return "等待开始";
  }
}
