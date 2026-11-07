import type { TaskSubmission, WorkflowStage, WorkflowState } from "../../workflow";
import { hasSourceText, normalizeWebPageInput } from "../../webPageProtocol";
import { normalizeSubmitUrl } from "../../urlSupport";

const MEDIA_STAGES = ["video_extracting", "video_transcribing", "title_generating"] as const;
const WEB_STAGES = ["web_loading", "web_extracting", "web_saving"] as const;
type StepLabel = "video" | "media" | "audio" | "transcript" | "title" | typeof WEB_STAGES[number];
type ProcessingPhase = "preparing" | "extracting" | "transcribing" | "titling" | "cancelling" | "failed" | typeof WEB_STAGES[number];

export type ProcessingWorkspaceModel = {
  phase: ProcessingPhase;
  cloud: boolean;
  cancelling: boolean;
  failed: boolean;
  hasSavedText: boolean;
  isWeb: boolean;
  activeIndex: number;
  percent: number | null;
  source: { kind: "url" | "video" | "audio" | "article"; label: string; host: string; platform?: "bilibili" | "youtube" | "douyin" | "xiaohongshu" };
  steps: Array<{ label: StepLabel; state: "complete" | "active" | "pending" | "failed" }>;
};

function sourceIdentity(workflow: WorkflowState, isWeb: boolean): ProcessingWorkspaceModel["source"] {
  const source = workflow.taskSource;
  if (source?.kind === "local_file") return { kind: source.mediaKind, label: source.displayName, host: "" };
  const rawUrl = source?.url ?? "";
  const host = URL.canParse(rawUrl) ? new URL(rawUrl).hostname : "";
  if (isWeb) return { kind: "article", label: source?.kind === "web_page" ? source.title : host, host };
  const domain = host.replace(/^www\./u, "");
  const isDomain = (name: string) => domain === name || domain.endsWith(`.${name}`);
  const isXiaohongshuShortDomain = isDomain("xhslink.com") || isDomain("xhslink.cn");
  const platform = isDomain("bilibili.com") || domain === "b23.tv" ? "bilibili"
    : isDomain("youtube.com") || domain === "youtu.be" ? "youtube"
      : isDomain("douyin.com") ? "douyin"
        : isDomain("xiaohongshu.com") || isXiaohongshuShortDomain || /^[0-9a-f]{24}$/iu.test(rawUrl) ? "xiaohongshu" : undefined;
  return { kind: "url", label: host, host, ...(platform ? { platform } : {}) };
}

export function createProcessingWorkspaceModel(workflow: WorkflowState): ProcessingWorkspaceModel | null {
  const hasSavedText = hasSourceText(workflow);
  const failed = workflow.stage === "failed" && !hasSavedText;
  const effectiveStage = workflow.stage === "cancelling" ? workflow.cancellingFromStage
    : failed ? workflow.error?.stage ?? "video_extracting" : workflow.stage;
  const isWeb = workflow.taskSource?.kind === "web_page" || Boolean(effectiveStage?.startsWith("web_"));
  const stages: readonly WorkflowStage[] = isWeb ? WEB_STAGES : MEDIA_STAGES;
  const activeIndex = stages.findIndex(stage => stage === effectiveStage);
  if (activeIndex < 0 || (workflow.stage === "failed" && !failed)) return null;
  const cancelling = workflow.stage === "cancelling";
  const cloud = effectiveStage === "title_generating";
  const source = sourceIdentity(workflow, isWeb);
  const phase: ProcessingPhase = failed ? "failed" : cancelling ? "cancelling"
    : isWeb ? effectiveStage as typeof WEB_STAGES[number]
      : cloud ? "titling" : effectiveStage === "video_transcribing" ? "transcribing"
        : workflow.progressMessage?.messageCode === "video.download.preparing" ? "preparing" : "extracting";
  const labels: StepLabel[] = isWeb ? [...WEB_STAGES]
    : [source.kind === "audio" ? "audio" : source.kind === "video" ? "media" : "video", "transcript", "title"];
  return {
    phase, cloud, cancelling, failed, hasSavedText, isWeb, activeIndex, source,
    percent: failed || cancelling || cloud || workflow.progressPercent <= 0 ? null : workflow.progressPercent,
    steps: labels.map((label, index) => ({ label, state: index < activeIndex ? "complete" : index > activeIndex ? "pending" : failed ? "failed" : "active" })),
  };
}

export function getProcessingRetrySubmission(workflow: WorkflowState): TaskSubmission | null {
  if (workflow.stage !== "failed") return null;
  const { composerSource, taskSource } = workflow;
  if (taskSource?.kind === "local_file") {
    return composerSource.kind === "local_media" &&
      composerSource.selection.displayName === taskSource.displayName &&
      composerSource.selection.mediaKind === taskSource.mediaKind
      ? { kind: "local_media", selectionToken: composerSource.selection.selectionToken } : null;
  }
  if (composerSource.kind !== "url" || !taskSource) return null;
  const currentUrl = normalizeSubmitUrl(composerSource.urlDraft) ?? normalizeWebPageInput(composerSource.urlDraft);
  const taskUrl = normalizeSubmitUrl(taskSource.url) ?? normalizeWebPageInput(taskSource.url);
  return currentUrl && currentUrl === taskUrl ? { kind: "url", url: currentUrl } : null;
}
