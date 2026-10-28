import {
  CheckCircle2,
  Circle,
  Copy,
  FileAudio,
  FileText,
  Film,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useUiLocale } from "../../i18n/LocaleProvider";
import { renderUiMessage, type UiMessage } from "../../i18n/uiMessage";
import type { TaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import { UI_MOTION_LAYOUT_TRANSITION } from "../../uiMotion";
import type { TaskArtifactKey } from "../../workflow";
import { TranscriptReviewPanel } from "./TranscriptReviewPanel";
import { StatusLine } from "../common/StatusLine";
import type { TranscriptDetailController } from "./useTranscriptDetailController";
import { WorkerErrorNotice } from "../results/WorkerErrorNotice";

type LocalTranscriptWorkspaceProps = {
  model: TaskWorkspaceViewModel["local"];
  controller: TranscriptDetailController;
  actionNotice: UiMessage | null;
  polishingTranscript: boolean;
  onLocateArtifact: (artifact: Extract<TaskArtifactKey, "video" | "audio">) => void;
  onPolishTranscript: () => void;
  onCancel: () => void;
};

export function LocalTranscriptWorkspace({
  model,
  controller,
  actionNotice,
  polishingTranscript,
  onLocateArtifact,
  onPolishTranscript,
  onCancel,
}: LocalTranscriptWorkspaceProps) {
  const { t } = useTranslation("transcript");
  const locale = useUiLocale();
  const renderedActionNotice = renderUiMessage(locale, actionNotice);
  const polishedTranscriptText =
    controller.transcriptDetail?.polished_text ?? null;

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
        <div
          className="local-progress"
          aria-label={t("workspace.progressLabel")}
          data-motion="local-stage"
        >
          {model.progressSteps.map((step) => (
            <motion.span
              className={step.state}
              key={step.id}
              layout
              transition={UI_MOTION_LAYOUT_TRANSITION}
            >
              {step.state === "complete" ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : step.state === "active" ? (
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
              ) : (
                <Circle size={16} aria-hidden="true" />
              )}
              {t(localProgressStepKey(step.id, model.sourceMediaKind))}
            </motion.span>
          ))}
          {model.cancellation.visible ? (
            <button
              className="secondary-button danger-soft"
              type="button"
              onClick={onCancel}
              disabled={!model.cancellation.enabled}
            >
              <X size={16} />
              <span>
                {model.cancellation.inProgress
                  ? t("workspace.cancelling")
                  : t("workspace.cancel")}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {renderedActionNotice ? (
        <StatusLine>{renderedActionNotice}</StatusLine>
      ) : null}

      {model.canReview ? (
        <TranscriptReviewPanel
          transcriptSource={model.transcriptSource}
          controller={controller}
          editingDisabled={!model.canEdit || polishingTranscript}
          readOnlyReason={
            model.readOnly ? t("review.readOnlyDuringAi") : null
          }
          artifactToolbar={model.artifactActions.locateVideo.visible ||
            model.artifactActions.locateAudio.visible ||
            model.artifactActions.locateTranscript.visible ||
            model.artifactActions.copyTranscript.visible ? (
            <div
              className="local-artifact-toolbar"
              aria-label={t("workspace.artifactActions")}
            >
              <ArtifactButton
                icon={<Film size={16} />}
                label={t("workspace.locateVideo")}
                visible={model.artifactActions.locateVideo.visible}
                enabled={model.artifactActions.locateVideo.enabled}
                onClick={() => onLocateArtifact("video")}
              />
              <ArtifactButton
                icon={<FileAudio size={16} />}
                label={t("workspace.locateAudio")}
                visible={model.artifactActions.locateAudio.visible}
                enabled={model.artifactActions.locateAudio.enabled}
                onClick={() => onLocateArtifact("audio")}
              />
              <ArtifactButton
                icon={<FileText size={16} />}
                label={t("workspace.locateTranscript")}
                visible={model.artifactActions.locateTranscript.visible}
                enabled={model.artifactActions.locateTranscript.enabled}
                onClick={() => void controller.exportTranscript()}
              />
              {model.artifactActions.copyTranscript.visible ? (
                polishedTranscriptText === null ? (
                  <ArtifactButton
                    icon={
                      polishingTranscript ? (
                        <LoaderCircle size={16} className="spin" aria-hidden="true" />
                      ) : (
                        <Sparkles size={16} />
                      )
                    }
                    label={
                      polishingTranscript
                        ? t("workspace.polishingTranscript")
                        : t("workspace.polishTranscript")
                    }
                    visible
                    ariaBusy={polishingTranscript}
                    enabled={
                      model.artifactActions.copyTranscript.enabled &&
                      !controller.transcriptLoading &&
                      !polishingTranscript
                    }
                    onClick={onPolishTranscript}
                  />
                ) : (
                  <ArtifactButton
                    icon={<Copy size={16} />}
                    label={t("workspace.copyTranscript")}
                    visible
                    enabled={
                      model.artifactActions.copyTranscript.enabled &&
                      !controller.transcriptLoading
                    }
                    onClick={() => void controller.copyTranscriptFile()}
                  />
                )
              ) : null}
            </div>
          ) : undefined}
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

function ArtifactButton({
  icon,
  label,
  visible,
  enabled,
  ariaBusy = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  visible: boolean;
  enabled: boolean;
  ariaBusy?: boolean;
  onClick: () => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <button
      type="button"
      className="secondary-button"
      onClick={onClick}
      disabled={!enabled}
      aria-busy={ariaBusy}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function localStatusKey(
  phase: TaskWorkspaceViewModel["local"]["phase"],
): `workspace.status.${TaskWorkspaceViewModel["local"]["phase"]}` {
  return `workspace.status.${phase}`;
}

function localProgressStepKey(
  stage: TaskWorkspaceViewModel["local"]["progressSteps"][number]["id"],
  sourceMediaKind: TaskWorkspaceViewModel["local"]["sourceMediaKind"],
):
  | "workspace.progressSteps.videoExtracting"
  | "workspace.progressSteps.audioPreparing"
  | "workspace.progressSteps.videoTranscribing" {
  if (stage === "video_transcribing") {
    return "workspace.progressSteps.videoTranscribing";
  }
  return sourceMediaKind === "audio"
    ? "workspace.progressSteps.audioPreparing"
    : "workspace.progressSteps.videoExtracting";
}
