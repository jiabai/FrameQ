import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUiLocale } from "../../i18n/LocaleProvider";
import type { WorkflowState } from "../../workflow";
import { WorkerErrorNotice } from "../results/WorkerErrorNotice";

type NoteTitleNoticeProps = {
  workflow: WorkflowState;
  retryDisabled: boolean;
  onRetry: () => void;
  onCancel: () => void;
};

export function NoteTitleNotice({ workflow, retryDisabled, onRetry, onCancel }: NoteTitleNoticeProps) {
  const { t } = useTranslation("workflow");
  const locale = useUiLocale();
  const metadata = workflow.noteTitle;
  if (!metadata || metadata.status === "completed") return null;
  const active = workflow.stage === "title_generating" ||
    (workflow.stage === "cancelling" && workflow.cancellingFromStage === "title_generating");
  const cancelled = metadata.status === "cancelled";
  const interrupted = metadata.status === "generating" || metadata.error_code === "TITLE_GENERATION_INTERRUPTED";
  const messageKey = active ? "noteTitle.generating"
    : cancelled ? "noteTitle.cancelled" : interrupted ? "noteTitle.interrupted" : "noteTitle.failed";
  return (
    <section className="note-title-notice" aria-label={t("stage.title_generating.title")}>
      <p role="status">{active ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : null}{t(messageKey)}</p>
      {!active && !cancelled && !interrupted && metadata.error_code ? (
        <WorkerErrorNotice locale={locale} error={{ code: metadata.error_code, message: "", stage: "title_generating" }} />
      ) : null}
      {active ? (
        <button type="button" disabled={workflow.stage === "cancelling"} onClick={onCancel}>
          {t(workflow.stage === "cancelling" ? "noteTitle.cancelling" : "noteTitle.cancel")}
        </button>
      ) : (
        <>
          <p className="note-title-disclosure">{t("noteTitle.disclosure")}</p>
          <button type="button" disabled={retryDisabled} onClick={onRetry}>{t("noteTitle.retry")}</button>
        </>
      )}
    </section>
  );
}
