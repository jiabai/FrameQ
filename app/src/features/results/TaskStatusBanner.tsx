import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";

import type { TaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";

type TaskStatusBannerProps = {
  model: TaskWorkspaceViewModel["banner"];
};

export function TaskStatusBanner({ model }: TaskStatusBannerProps) {
  return (
    <section className={`task-status-banner ${model.kind}`} aria-label="任务状态">
      {model.kind === "local_complete" ? (
        <CheckCircle2 size={20} aria-hidden="true" />
      ) : model.kind === "local_failed" ? (
        <AlertTriangle size={20} aria-hidden="true" />
      ) : (
        <LoaderCircle size={20} className="spin" aria-hidden="true" />
      )}
      <div>
        <strong>
          {model.kind === "local_complete"
            ? "本地处理完成"
            : model.kind === "local_failed"
              ? "本地处理失败"
              : "本地处理中"}
        </strong>
        <span>{model.message}</span>
      </div>
    </section>
  );
}
