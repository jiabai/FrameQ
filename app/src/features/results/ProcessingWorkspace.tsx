import { AudioLines, Check, Clock3, Download, FileAudio, FileText, Info, Link, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowState } from "../../workflow";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { renderWorkerProgressMessage } from "../../i18n/progressMessages";
import { renderUiMessage } from "../../i18n/uiMessage";
import { formatProgressPercent } from "../../i18n/formatters";
import { ConfirmDialog } from "../modal/ConfirmDialog";
import { WorkerErrorNotice } from "./WorkerErrorNotice";
import { createProcessingWorkspaceModel, type ProcessingWorkspaceModel } from "./processingWorkspaceModel";
import "./ProcessingWorkspace.css";

type ProcessingWorkspaceProps = {
  workflow: WorkflowState;
  onCancel: () => void;
  onRetry: () => void;
  onEditSource: () => void;
  retryDisabled: boolean;
  notice?: ReactNode;
  children?: ReactNode;
};

function useElapsedTime(running: boolean) {
  const started = useRef(Date.now());
  const wasRunning = useRef(running);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (running && !wasRunning.current) {
      started.current = Date.now();
      setSeconds(0);
    }
    wasRunning.current = running;
    if (!running) return;
    const interval = window.setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [running]);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ProcessArt({ model }: { model: ProcessingWorkspaceModel }) {
  const { t } = useTranslation("processing");
  const StatusIcon = model.failed ? Info : model.cancelling ? X : model.cloud ? Sparkles : model.phase === "transcribing" ? AudioLines : model.phase === "preparing" ? Link : Download;
  return (
    <div className="process-art" aria-hidden="true">
      <div className="art-grid" /><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
      <div className="paper paper-back" />
      <div className="paper paper-main">
        <div className="paper-heading"><span className="paper-mini-mark" /><span className="paper-date">{t("art.note")}</span></div>
        <div className="paper-title" /><div className="paper-lines"><i /><i /><i /></div>
        <div className="paper-wave">{Array.from({ length: 25 }, (_, index) => <i key={index} style={{ "--height": `${4 + ((index * 7 + index * index * 3) % 18)}px`, "--delay": `${index * -0.09}s` } as CSSProperties} />)}</div>
        <div className="paper-lines bottom-lines"><i /><i /></div><div className="paper-scan" />
      </div>
      <div className="art-status"><StatusIcon /></div><div className="floating-tick tick-one" /><div className="floating-tick tick-two" />
    </div>
  );
}

export function ProcessingWorkspace({ workflow, onCancel, onRetry, onEditSource, retryDisabled, notice, children }: ProcessingWorkspaceProps) {
  const { t } = useTranslation("processing");
  const { t: tWorkflow } = useTranslation("workflow");
  const locale = useUiLocale();
  const model = createProcessingWorkspaceModel(workflow);
  const elapsed = useElapsedTime(Boolean(model && !model.failed));
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [workflow.stage]);
  if (!model) return <div className="processing-workspace is-ready"><div className="processing-saved-note" key="saved-note">{children}</div></div>;

  const localMedia = model.source.kind === "audio" || model.source.kind === "video";
  const subtitlePhase = model.phase === "transcribing" ? workflow.progressMessage?.messageCode === "subtitle.detect.running" ? "subtitle_checking" : workflow.progressMessage?.messageCode === "subtitle.detect.found" ? "subtitle_found" : null : null;
  const phase = localMedia && (model.phase === "preparing" || model.phase === "extracting") ? "local_preparing" : subtitlePhase ?? model.phase;
  const message = model.cancelling ? t("detail.cancelling") : model.failed ? t("detail.failed")
    : workflow.progressMessage ? renderWorkerProgressMessage(locale, workflow.stage, workflow.progressMessage)
      : renderUiMessage(locale, workflow.statusMessage) || t(`stage.${phase}.body`);
  const sourceLabel = model.source.platform ? t(`source.platform.${model.source.platform}`) : model.source.label;
  const sourceTitle = model.source.kind === "url" && sourceLabel ? t("source.platformVideo", { platform: sourceLabel }) : sourceLabel || t("source.unknown");
  const sourceType = model.isWeb ? "article" : model.source.kind === "audio" ? "audio" : "video";
  const progressLabel = model.percent !== null ? t("progress.label") : model.failed ? t("progress.failed") : model.cancelling ? t("progress.cancelling") : model.cloud ? t("progress.generating") : t("progress.processing");
  const detail = model.failed ? "failed" : model.cancelling ? "cancelling" : model.isWeb ? "web" : model.cloud ? "titling" : subtitlePhase ?? (model.phase === "transcribing" ? "transcribing" : "extracting");
  const cancelLabel = model.cloud ? tWorkflow(model.cancelling ? "noteTitle.cancelling" : "noteTitle.cancel") : t(model.cancelling ? "footer.cancelling" : "footer.cancel");
  const SourceIcon = model.source.kind === "audio" ? FileAudio : localMedia || model.isWeb ? FileText : Link;

  return (
    <div className="processing-workspace" data-phase={model.phase}>
      <div className="workspace-content">
        <div className="page-heading"><div><div className="eyebrow">{t("kicker")}</div><h1>{t("pageTitle")}</h1></div><div className="local-badge"><ShieldCheck className="icon small" aria-hidden="true" />{t(model.cloud ? "cloudBadge" : "localBadge")}</div></div>
        <section className="processing-card" aria-label={t("ariaLabel")} data-stage={model.phase}>
          <header className="source-row">
            <div className="source-symbol"><SourceIcon aria-hidden="true" /></div>
            <div className="source-info"><h2 title={sourceTitle}>{sourceTitle}</h2><span>{t(model.isWeb ? "source.web" : localMedia ? "source.local" : "source.url")}{model.source.host && <><span className="text-dot">{t("source.separator")}</span>{model.source.host}</>}</span></div>
            <span className="source-type">{t(`source.${sourceType}`)}</span>
          </header>
          <div className="processing-hero">
            <div className="hero-copy" role="status" aria-live="polite" aria-atomic="true">
              <div className="stage-kicker"><span className="activity-dot" /><span>{model.failed || model.cancelling ? t(`stage.${model.phase}.title`) : t("stepCounter", { current: model.activeIndex + 1, total: model.steps.length })}</span></div>
              <h2>{t(`stage.${phase}.title`)}</h2><p>{t(`stage.${phase}.body`)}</p>
              <div className="working-status">{!model.failed && <span className="mini-spinner" aria-hidden="true" />}<span>{message}</span></div>
            </div>
            <ProcessArt model={model} />
          </div>
          <div className="progress-section">
            <div className="progress-labels"><span>{progressLabel}</span><span className="progress-value">{model.percent !== null ? formatProgressPercent(model.percent) : t(model.failed ? "progress.failed" : model.cancelling ? "progress.cancelling" : model.cloud ? "progress.generating" : model.phase === "preparing" ? "progress.preparing" : "progress.processing")}</span></div>
            <div className={`progress-track${model.percent === null && !model.failed ? " indeterminate" : ""}`} role="progressbar" aria-label={t("progress.label")} aria-valuenow={model.percent ?? undefined} aria-valuemin={0} aria-valuemax={100}><span style={{ width: model.percent === null ? model.failed ? "0%" : undefined : `${model.percent}%` }} /></div>
            <div className="progress-meta"><span>{t(`detail.${detail}`)}</span><span className="elapsed"><Clock3 className="icon small" aria-hidden="true" /><span>{t("progress.elapsed", { time: elapsed })}</span></span></div>
          </div>
          <ol className="stage-timeline" aria-label={t("progress.label")}>
            {model.steps.map((step, index) => {
              const StepIcon = step.state === "complete" ? Check : step.state === "failed" ? Info : step.label === "transcript" ? AudioLines : step.label === "title" ? Sparkles : model.isWeb ? FileText : Download;
              const statusKey = step.state === "complete" ? "complete" : step.state === "failed" ? "failed" : model.cancelling && index === model.activeIndex ? "cancelling" : step.label === "title" ? step.state === "active" ? "titleActive" : "titlePending" : step.state === "active" ? "active" : step.label === "transcript" ? "transcriptPending" : "pending";
              return <li className={step.state} key={step.label} aria-current={step.state === "active" ? "step" : undefined}><span className="step-node"><StepIcon aria-hidden="true" /></span><div><strong>{t(`steps.${step.label}`)}</strong><small>{t(`steps.${statusKey}`)}</small></div>{index < model.steps.length - 1 && <span className="step-connector" />}</li>;
            })}
          </ol>
          {model.failed && workflow.error && <WorkerErrorNotice error={workflow.error} locale={locale} className="processing-error" />}
          {notice && <div className="processing-error" role="status">{notice}</div>}
          <footer className="task-footer"><span><ShieldCheck className="icon small" aria-hidden="true" />{t(model.isWeb ? "footer.articleSaved" : model.source.kind === "audio" ? "footer.audioSaved" : "footer.saved")}</span>
            {model.failed ? <div className="processing-actions"><button className="cancel-button" type="button" onClick={onEditSource}>{t("footer.editSource")}</button><button className="cancel-button primary" type="button" onClick={onRetry} disabled={retryDisabled}><RefreshCw className="icon small" aria-hidden="true" />{t("footer.retry")}</button></div>
              : <button className="cancel-button" type="button" disabled={model.cancelling} onClick={() => setConfirming(true)}>{model.cancelling ? <LoaderCircle className="icon small spin" aria-hidden="true" /> : <X className="icon small" aria-hidden="true" />}<span>{cancelLabel}</span></button>}
          </footer>
        </section>
        <section className="next-section" aria-label={t("next.title")}><div className="next-heading"><h2>{t("next.title")}</h2><span>{t("next.subtitle")}</span></div><div className="next-options"><div><span className="next-icon"><FileText aria-hidden="true" /></span><span><strong>{t("next.readTitle")}</strong><small>{t(model.isWeb ? "next.articleReadBody" : "next.readBody")}</small></span></div><div><span className="next-icon"><Sparkles aria-hidden="true" /></span><span><strong>{t("next.aiTitle")}</strong><small>{t("next.aiBody")}</small></span></div></div><p className="ai-disclosure">{t(model.isWeb ? "next.webDisclosure" : "next.disclosure")}</p></section>
      </div>
      <div className="processing-saved-note" key="saved-note" hidden={!model.hasSavedText || !children}>{children}</div>
      <div className="workspace-footnote"><span className="footnote-mark" />{t("footnote")}</div>
      <ConfirmDialog open={confirming && !model.cancelling} title={t(model.cloud ? "confirmation.titleGenerationTitle" : "confirmation.title")} message={t(model.cloud ? "confirmation.titleGenerationBody" : "confirmation.body")} cancelLabel={t("confirmation.continue")} confirmLabel={cancelLabel} onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); onCancel(); }} />
    </div>
  );
}
