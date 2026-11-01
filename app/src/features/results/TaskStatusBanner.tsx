import { AlertTriangle, CircleDashed, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { renderUiMessage } from "../../i18n/uiMessage";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { renderWorkerProgressMessage } from "../../i18n/progressMessages";
import type { TaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import { UI_MOTION_TRANSITION } from "../../uiMotion";

type TaskStatusBannerProps = {
  model: TaskWorkspaceViewModel["banner"];
};

export function TaskStatusBanner({ model }: TaskStatusBannerProps) {
  const { t } = useTranslation("workflow");
  const locale = useUiLocale();
  if (model.kind === "local_complete") return null;

  const message = model.progressMessage
    ? renderWorkerProgressMessage(locale, model.stage, model.progressMessage)
    : renderUiMessage(locale, model.message);

  return (
    <section
      className={`task-status-banner ${model.kind}`}
      data-motion="task-status"
      aria-label={t("banner.ariaLabel")}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={`icon-${model.kind}`}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={UI_MOTION_TRANSITION}
          aria-hidden="true"
        >
          {model.kind === "local_failed" ? (
            <AlertTriangle size={20} />
          ) : model.kind === "local_processing" ? (
            <LoaderCircle size={20} className="spin" />
          ) : (
            <CircleDashed size={20} />
          )}
        </motion.span>
      </AnimatePresence>
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={`copy-${model.kind}`}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={UI_MOTION_TRANSITION}
        >
          <strong>{t(model.stage === "title_generating" ? "stage.title_generating.title" : bannerTitleKey(model.kind))}</strong>
          <span>{message}</span>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function bannerTitleKey(
  kind: Exclude<TaskWorkspaceViewModel["banner"]["kind"], "local_complete">,
):
  | "banner.localFailedTitle"
  | "banner.localProcessingTitle"
  | "banner.idleTitle" {
  switch (kind) {
    case "local_failed":
      return "banner.localFailedTitle";
    case "local_processing":
      return "banner.localProcessingTitle";
    default:
      return "banner.idleTitle";
  }
}
