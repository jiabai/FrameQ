import type { Insight } from "./insightPreferences";
import type { TaskArtifactKey, WorkflowState } from "./workflowState";

export type DetailTab = "summary" | "insights" | "transcript";
export type ExportTarget = DetailTab | "video" | "audio";

export function getDetailText(tab: DetailTab, state: WorkflowState): string {
  if (tab === "transcript") {
    return state.text.trim();
  }
  if (tab === "summary") {
    return state.summary.trim();
  }
  return state.insights.map(formatInsightForCopy).join("\n\n");
}

function formatInsightForCopy(insight: Insight, index: number): string {
  return [
    `${index + 1}. ${insight.topic}`,
    `匹配理由：${insight.matchReason}`,
    `启发问题：${insight.followUpQuestions.join("；")}`,
    `适合用途：${insight.suitableUse}`,
    insight.sourceChunkId === null ? "" : `来源片段：${insight.sourceChunkId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function getExportPath(tab: ExportTarget, state: WorkflowState): string | null {
  if (tab === "video" || tab === "audio") {
    return getTaskArtifactPath(state, tab);
  }
  if (tab === "transcript") {
    return getTaskArtifactPath(state, "transcript_txt");
  }
  if (tab === "summary") {
    return getTaskArtifactPath(state, "summary");
  }
  return getTaskArtifactPath(state, "insights_md") ?? getTaskArtifactPath(state, "insights");
}

export function hasArtifact(state: WorkflowState, key: TaskArtifactKey): boolean {
  return Boolean(state.taskDir && state.artifacts[key]);
}

export function getTaskArtifactPath(
  state: WorkflowState,
  key: TaskArtifactKey,
): string | null {
  const artifact = state.artifacts[key];
  if (!state.taskDir || !artifact) {
    return null;
  }
  return joinTaskArtifactPath(state.taskDir, artifact);
}

export function joinTaskArtifactPath(taskDir: string, artifact: string): string {
  const separator = taskDir.includes("\\") ? "\\" : "/";
  const normalizedTaskDir = taskDir.replace(/[\\/]+$/, "");
  const normalizedArtifact = artifact.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator);
  return `${normalizedTaskDir}${separator}${normalizedArtifact}`;
}
