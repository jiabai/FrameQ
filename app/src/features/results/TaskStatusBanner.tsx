import { AlertTriangle, CheckCircle2, CircleDashed, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { renderUiMessage } from "../../i18n/uiMessage";
import { isSupportedLocale } from "../../i18n/locale";
import { renderWorkerProgressMessage } from "../../i18n/progressMessages";
import type { TaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import { UI_MOTION_TRANSITION } from "../../uiMotion";

type TaskStatusBannerProps = {
  model: TaskWorkspaceViewModel["banner"];
};

export function TaskStatusBanner({ model }: TaskStatusBannerProps) {
  const { t, i18n } = useTranslation("workflow");
  const locale = isSupportedLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : "en-US";
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
          {model.kind === "local_complete" ? (
            <CheckCircle2 size={20} />
          ) : model.kind === "local_failed" ? (
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
          <strong>{t(bannerTitleKey(model.kind))}</strong>
          <span>{message}</span>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function bannerTitleKey(
  kind: TaskWorkspaceViewModel["banner"]["kind"],
):
  | "banner.localCompleteTitle"
  | "banner.localFailedTitle"
  | "banner.localProcessingTitle"
  | "banner.idleTitle" {
  switch (kind) {
    case "local_complete":
      return "banner.localCompleteTitle";
    case "local_failed":
      return "banner.localFailedTitle";
    case "local_processing":
      return "banner.localProcessingTitle";
    default:
      return "banner.idleTitle";
  }
}
