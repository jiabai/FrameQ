import { FileAudio, Film, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isSupportedLocale } from "../../i18n/locale";
import { renderUiMessage, type UiMessage } from "../../i18n/uiMessage";
import type { TaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import type { TaskArtifactKey, WorkflowState } from "../../workflow";
import { TranscriptReviewPanel } from "./TranscriptReviewPanel";
import type { TranscriptDetailController } from "./useTranscriptDetailController";
import { WorkerErrorNotice } from "../results/WorkerErrorNotice";

type LocalTranscriptWorkspaceProps = {
  workflow: WorkflowState;
  model: TaskWorkspaceViewModel["local"];
  controller: TranscriptDetailController;
  actionNotice: UiMessage | null;
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
  const { t, i18n } = useTranslation("transcript");
  const locale = isSupportedLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : "en-US";
  const renderedActionNotice = renderUiMessage(locale, actionNotice);

  return (
    <section
      className="task-domain-workspace local-transcript-workspace"
      aria-label={t("workspace.ariaLabel")}
      data-task-id={model.taskId ?? undefined}
    >
      <header className="domain-workspace-header">
        <div>
          <h2>
            {model.phase === "ready"
              ? t("workspace.reviewTitle")
              : t("workspace.transcriptionTitle")}
          </h2>
        </div>
        {model.phase !== "ready" ? (
          <span className={`workspace-status-badge ${model.phase}`}>
            {t(localStatusKey(model.phase))}
          </span>
        ) : null}
      </header>

      {model.phase === "processing" ? (
        <div className="local-progress" aria-label={t("workspace.progressLabel")}>
          {model.progressSteps.map((step) => (
            <span className={step.state} key={step.id}>
              {t(localProgressStepKey(step.id))}
            </span>
          ))}
          <button
            className="secondary-button danger-soft"
            type="button"
            onClick={onCancel}
            disabled={workflow.stage === "cancelling"}
          >
            <X size={16} />
            <span>
              {workflow.stage === "cancelling"
                ? t("workspace.cancelling")
                : t("workspace.cancel")}
            </span>
          </button>
        </div>
      ) : null}

      {renderedActionNotice ? (
        <p className="action-notice" role="status" aria-live="polite">
          {renderedActionNotice}
        </p>
      ) : null}

      {model.canReview ? (
        <TranscriptReviewPanel
          workflow={workflow}
          controller={controller}
          editingDisabled={!model.canEdit}
          readOnlyReason={
            model.readOnly ? t("review.readOnlyDuringAi") : null
          }
          artifactToolbar={(
            <div
              className="local-artifact-toolbar"
              aria-label={t("workspace.artifactActions")}
            >
              <button
                type="button"
                className="secondary-button"
                onClick={() => onLocateArtifact("video")}
                disabled={!workflow.artifacts.video}
              >
                <Film size={16} />
                <span>{t("workspace.locateVideo")}</span>
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => onLocateArtifact("audio")}
                disabled={!workflow.artifacts.audio}
              >
                <FileAudio size={16} />
                <span>{t("workspace.locateAudio")}</span>
              </button>
            </div>
          )}
        />
      ) : model.phase !== "processing" ? (
        <p className="workspace-empty-copy">{t("workspace.empty")}</p>
      ) : null}

      {model.error ? (
        <WorkerErrorNotice
          error={model.error}
          locale={locale}
          className="local-workspace-error"
        />
      ) : null}
    </section>
  );
}

function localStatusKey(
  phase: TaskWorkspaceViewModel["local"]["phase"],
):
  | "workspace.status.processing"
  | "workspace.status.ready"
  | "workspace.status.failed"
  | "workspace.status.waiting" {
  switch (phase) {
    case "processing":
      return "workspace.status.processing";
    case "ready":
      return "workspace.status.ready";
    case "failed":
      return "workspace.status.failed";
    default:
      return "workspace.status.waiting";
  }
}

function localProgressStepKey(
  stage: TaskWorkspaceViewModel["local"]["progressSteps"][number]["id"],
): "workspace.progressSteps.videoExtracting" | "workspace.progressSteps.videoTranscribing" {
  return stage === "video_transcribing"
    ? "workspace.progressSteps.videoTranscribing"
    : "workspace.progressSteps.videoExtracting";
}
