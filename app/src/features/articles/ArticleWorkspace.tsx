import { useEffect, useRef, useState } from "react";
import { Copy, FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkflowState } from "../../workflow";
import type { TaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import { getTaskArtifactPath } from "../../taskArtifacts";
import { revealPath } from "../common/revealPath";
import { MarkdownContent } from "../results/MarkdownContent";
import { WorkerErrorNotice } from "../results/WorkerErrorNotice";
import { articleSourceRanges } from "./articleSourceRanges";
import { useUiLocale } from "../../i18n/LocaleProvider";

export function ArticleWorkspace({ workflow, model, selectedChunks, onClearSelection, onCancel }: {
  workflow: WorkflowState; model: TaskWorkspaceViewModel["local"]; selectedChunks: readonly number[];
  onClearSelection: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation("webPage");
  const locale = useUiLocale();
  const [actionResult, setActionResult] = useState<"copied" | "copyFailed" | "located" | "locateFailed" | null>(null);
  const [ranges, setRanges] = useState<Array<{ text: string; highlighted: boolean }> | null>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setActionResult(null); }, [workflow.taskId]);
  useEffect(() => {
    let active = true;
    setRanges(null);
    if (selectedChunks.length && workflow.dissection && !workflow.dissectionStale) {
      void articleSourceRanges(workflow.text, workflow.dissection, selectedChunks).then((next) => {
        if (active) setRanges(next);
      }).catch(() => { if (active) onClearSelection(); });
    }
    return () => { active = false; };
  }, [workflow.taskId, workflow.text, workflow.dissection, workflow.dissectionStale, selectedChunks, onClearSelection]);
  useEffect(() => { if (ranges) sourceRef.current?.querySelector("mark")?.scrollIntoView({ block: "center" }); }, [ranges]);
  const path = getTaskArtifactPath(workflow, "article_md");
  return <section className="task-domain-workspace local-transcript-workspace" aria-label={t("title")} data-task-id={workflow.taskId ?? undefined}>
    {model.phase === "processing" && <div className="local-progress" role="status">{model.progressSteps.map((step) => <span key={step.id} className={step.state}>{t(`stages.${step.id as "web_loading" | "web_extracting" | "web_saving"}`)}</span>)}</div>}
    <div className="local-artifact-toolbar">
      <button type="button" disabled={!path} onClick={() => { if (path) void revealPath(path).then((located) => setActionResult(located ? "located" : "locateFailed")); }}><FileText size={16} /><span>{t("locate")}</span></button>
      <button type="button" disabled={!workflow.artifacts.article_txt} onClick={() => { void navigator.clipboard.writeText(workflow.text).then(() => setActionResult("copied"), () => setActionResult("copyFailed")); }}><Copy size={16} /><span>{t("copy")}</span></button>
      {model.cancellation.visible && <button type="button" disabled={!model.cancellation.enabled} onClick={onCancel}><X size={16} /><span>{t("cancel")}</span></button>}
    </div>
    {actionResult && <p role="status">{t(actionResult)}</p>}
    {model.error && <WorkerErrorNotice error={model.error} locale={locale} />}
    <div className="transcript-review-content article-reading-content">
      {ranges ? <div ref={sourceRef}><button type="button" className="secondary-button" onClick={onClearSelection}>{t("back")}</button><h3>{t("source")}</h3><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ranges.map((range, index) => range.highlighted ? <mark key={index}>{range.text}</mark> : <span key={index}>{range.text}</span>)}</div></div>
        : <MarkdownContent markdown={workflow.markdown} emptyText={t("empty")} />}
    </div>
  </section>;
}
