import { FormEvent, type CSSProperties, type ChangeEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Download,
  FileText,
  FolderOpen,
  History as HistoryIcon,
  ListChecks,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Settings,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  canSubmitUrl,
  cancelProcessing,
  createInitialWorkflow,
  getDetailText,
  getExportPath,
  getInsightRetryTargetForCard,
  getProgressSteps,
  getResultCards,
  getTranscriptSourceLabel,
  getToolbarNewTaskButtonState,
  getVisibleWorkflowError,
  isProcessingStage,
  mergeProgressEvent,
  normalizeSubmitUrl,
  startProcessing,
  startInsightRetry,
  summarizeWorkerResult,
  type DetailTab,
  type InsightRetryTarget,
  type ResultCard,
  type WorkflowState,
} from "./workflow";
import { cancelProcess, processVideo, retryInsights } from "./workerClient";
import {
  clearAudioReviewCache,
  getAudioReviewCacheUsage,
  getLlmConfig,
  saveLlmConfig,
  type AudioReviewCacheUsage,
  type LlmConfigDraft,
} from "./settingsClient";
import { getHistory, historyItemToWorkerResult, type HistoryItem } from "./historyClient";
import type { UpdateState } from "./updateState";
import {
  canGenerateAiWithAccount,
  canProcessWithAccount,
  type AccountStatus,
} from "./accountState";
import {
  calculateDraggedWindowPosition,
  closeWindow,
  getWindowPosition,
  minimizeWindow,
  setWindowPosition,
  startWindowDrag,
  toggleMaximizeWindow,
  type WindowDragSession,
  type WindowPosition,
} from "./windowChrome";
import { AccountSheet } from "./features/account/AccountSheet";
import { useAccountController } from "./features/account/useAccountController";
import { ModelGuideSheet } from "./features/asrModel/ModelGuideSheet";
import { useAsrModelDownload } from "./features/asrModel/useAsrModelDownload";
import { InsightPreferenceFlow } from "./features/insightPreferences/InsightPreferenceFlow";
import { MarkdownContent } from "./features/results/MarkdownContent";
import { ResultWorkspace } from "./features/results/ResultWorkspace";
import { useAppUpdateController } from "./features/updates/useAppUpdateController";
import {
  loadTranscriptDetail,
  saveTranscriptEdit,
  type TranscriptDetailResponse,
  type TranscriptSegment,
} from "./transcriptDetailClient";
import {
  findActiveTranscriptSegmentId,
  isTranscriptSegmentEditDisabled,
  shouldPauseActiveTranscriptSegment,
  transcriptTextFromSegments,
  updateTranscriptSegmentText,
} from "./transcriptReviewState";
import {
  audioProgressPercent,
  clampAudioTime,
  formatAudioClock,
} from "./audioReviewBarState";
import {
  clearInspirationProfile,
  getInsightPreferences,
  saveDefaultGenerationPreferences,
  saveInspirationProfile,
  skipInspirationProfile,
  type InsightPreferenceState,
} from "./insightPreferencesClient";
import {
  createInsightPreferenceFlow,
  skipProfileSetupInFlow,
  startGenerationPreferenceEditing,
  startProfileSetupInFlow,
  type InsightPreferenceFlowState,
} from "./insightPreferenceFlow";
import {
  buildPreferenceSnapshot,
  summarizeGenerationPreferences,
  summarizeInspirationProfile,
  type GenerationPreferences,
  type InspirationProfile,
  type PreferenceSnapshot,
} from "./insightPreferences";

const stageCopy: Record<WorkflowState["stage"], { title: string; body: string }> = {
  waiting_input: {
    title: "等待输入",
    body: "等待用户提交视频链接。",
  },
  video_extracting: {
    title: "视频提取中",
    body: "正在下载视频并提取音频，请保持网络连接。",
  },
  video_transcribing: {
    title: "视频转译中",
    body: "正在使用本地 ASR 模型缓存识别语音内容。",
  },
  insights_generating: {
    title: "AI 整理中",
    body: "正在使用云端 LLM 生成所选 AI 结果。",
  },
  completed: {
    title: "文字稿完成",
    body: "视频、音频和文字稿已准备好；启发灵感可单独确认生成。",
  },
  partial_completed: {
    title: "部分完成",
    body: "文字稿已生成，失败的 AI 结果稍后可以重试。",
  },
  failed: {
    title: "失败",
    body: "处理失败，请检查链接或稍后重试。",
  },
};

const stageTitles = Object.fromEntries(
  Object.entries(stageCopy).map(([stage, copy]) => [stage, copy.title]),
) as Record<WorkflowState["stage"], string>;

const historyStatusCopy: Record<HistoryItem["status"], string> = {
  completed: "已完成",
  partial_completed: "部分完成",
  failed: "失败",
};

const defaultAsrModels = ["iic/SenseVoiceSmall"];

const asrModelLabels: Record<string, string> = {
  "Qwen/Qwen3-ASR-0.6B": "Qwen3-ASR 0.6B",
  "iic/SenseVoiceSmall": "SenseVoice Small",
};

const stageSummary: Record<WorkflowState["stage"], string> = {
  waiting_input: "准备接收一个公开视频链接",
  video_extracting: "正在准备媒体文件",
  video_transcribing: "正在生成本地文字稿",
  insights_generating: "正在生成所选 AI 结果",
  completed: "视频、音频和文字稿已可查看",
  partial_completed: "文字稿已保留，可重试失败的 AI 结果",
  failed: "处理未完成，请查看原因",
};

type SettingsCategory = "basic" | "inspiration" | "storage" | "updates" | "advanced";

const settingsNavItems: Array<{
  id: SettingsCategory;
  label: string;
  description: string;
}> = [
  { id: "basic", label: "基础", description: "模型与输出" },
  { id: "inspiration", label: "灵感", description: "档案与偏好" },
  { id: "storage", label: "缓存", description: "本机临时区" },
  { id: "updates", label: "更新", description: "版本维护" },
  { id: "advanced", label: "高级", description: "配置文件" },
];

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatProgressPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatByteSize(value: number): string {
  const bytes = Math.max(0, value);
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 10 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function formatSegmentTime(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function asrModelSourceLabel(source: string): string {
  return source === "custom_url" ? "自定义下载源" : "ModelScope";
}

function accountProcessBlockerMessage(account: AccountStatus, actionLabel: string): string {
  if (!account.authenticated) {
    return `请先登录 FrameQ 账号后再${actionLabel}。`;
  }

  if (account.entitlementStatus !== "active") {
    return `请先输入激活码激活 FrameQ 后再${actionLabel}。`;
  }

  return account.serverError
    ? `当前账号状态暂不可用：${account.serverError}`
    : `当前账号暂不能${actionLabel}，请刷新账号状态后重试。`;
}

function accountAiBlockerMessage(account: AccountStatus, actionLabel: string): string {
  if (!account.authenticated) {
    return `请先登录 FrameQ 账号后再${actionLabel}。`;
  }

  if (account.entitlementStatus !== "active") {
    return `请先输入激活码激活 FrameQ 后再${actionLabel}。`;
  }

  if (!account.llmConfigured) {
    return "AI 结果 LLM 尚未由管理员配置完成，请稍后再试。";
  }

  if (account.llmQuotaRemaining <= 0) {
    return "LLM API 调用额度已用完，请联系管理员补充额度或兑换新的激活码。";
  }

  return account.serverError
    ? `当前账号状态暂不可用：${account.serverError}`
    : `当前账号暂不能${actionLabel}，请刷新账号状态后重试。`;
}

function updateToolbarLabel(state: UpdateState): string {
  if (state.status === "ready_to_restart") {
    return "重启更新";
  }

  if (state.status === "downloading") {
    return `${formatProgressPercent(state.progress)}`;
  }

  if (state.status === "installing") {
    return "安装中";
  }

  return state.availableVersion ? `新版本 ${state.availableVersion}` : "有更新";
}

function updateStatusLabel(state: UpdateState): string {
  const labels: Record<UpdateState["status"], string> = {
    idle: "未检查",
    checking: "检查中",
    available: "可升级",
    downloading: "下载中",
    installing: "安装中",
    ready_to_restart: "待重启",
    up_to_date: "已是最新",
    failed: "检查失败",
    postponed: "稍后提醒",
  };

  return labels[state.status];
}

function settingsProfileStatusLabel(state: InsightPreferenceState | null, loading: boolean): string {
  if (!state) {
    return loading ? "读取中" : "暂不可用";
  }

  if (state.profileStatus === "valid") {
    return "已设置";
  }

  if (state.profileStatus === "skipped") {
    return "已跳过";
  }

  if (state.profileStatus === "invalid") {
    return "需要重设";
  }

  return "未设置";
}

function settingsProfileStatusTone(state: InsightPreferenceState | null): "ready" | "missing" {
  return state?.profileStatus === "valid" ? "ready" : "missing";
}

function settingsProfileSummaryLines(state: InsightPreferenceState | null, loading: boolean): string[] {
  if (!state) {
    return [loading ? "读取后显示灵感档案状态" : "灵感档案状态暂不可用"];
  }

  if (state.profileStatus === "invalid") {
    return [state.profileError || "灵感档案需要重新设置"];
  }

  if (state.profileStatus === "valid") {
    const summary = summarizeInspirationProfile(state.profile);
    if (summary.length > 3) {
      return [...summary.slice(0, 3), `还有 ${summary.length - 3} 项，编辑时可查看`];
    }
    return summary;
  }

  return ["未设置灵感档案"];
}

function settingsGenerationPreferenceLines(state: InsightPreferenceState | null, loading: boolean): string[] {
  if (!state) {
    return [loading ? "读取后显示默认生成偏好" : "默认生成偏好暂不可用"];
  }

  if (!state.defaultGenerationPreferences) {
    return ["尚未保存默认生成偏好"];
  }

  const summary = summarizeGenerationPreferences(state.defaultGenerationPreferences);
  return [`已保存默认生成偏好（${summary.length} 项）`];
}

function App() {
  const [workflow, setWorkflow] = useState(createInitialWorkflow);
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [summaryConfirmOpen, setSummaryConfirmOpen] = useState(false);
  const [insightPreferenceFlow, setInsightPreferenceFlow] =
    useState<InsightPreferenceFlowState | null>(null);
  const [insightPreferenceBusy, setInsightPreferenceBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [transcriptDetail, setTranscriptDetail] = useState<TranscriptDetailResponse | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [activeTranscriptSegmentId, setActiveTranscriptSegmentId] = useState<string | null>(null);
  const [editingTranscriptSegmentId, setEditingTranscriptSegmentId] = useState<string | null>(null);
  const [transcriptAudioCurrentTime, setTranscriptAudioCurrentTime] = useState(0);
  const [transcriptAudioDuration, setTranscriptAudioDuration] = useState(0);
  const [transcriptAudioPlaying, setTranscriptAudioPlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("basic");
  const [settingsDraft, setSettingsDraft] = useState<LlmConfigDraft>({
    outputDir: "",
    asrModel: "iic/SenseVoiceSmall",
  });
  const [settingsSupportedAsrModels, setSettingsSupportedAsrModels] = useState(defaultAsrModels);
  const [settingsConfigPath, setSettingsConfigPath] = useState("");
  const [audioReviewCacheUsage, setAudioReviewCacheUsage] =
    useState<AudioReviewCacheUsage | null>(null);
  const [settingsInsightPreferences, setSettingsInsightPreferences] =
    useState<InsightPreferenceState | null>(null);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const {
    modelGuideOpen,
    setModelGuideOpen,
    openModelGuide,
    asrModelStatus,
    modelDownloadProgress,
    modelDownloadNotice,
    modelDownloadStalled,
    modelDownloadActive,
    refreshAsrModelStatus,
    startAsrModelDownload,
    cancelCurrentAsrModelDownload,
  } = useAsrModelDownload();
  const {
    account,
    accountOpen,
    accountNotice,
    accountLoading,
    activationCodeDraft,
    activationRedeeming,
    accountChipLabel,
    accountStatusText,
    closeAccountPanel,
    handleAuthCallback,
    openAccountPanel,
    redeemActivationCodeFromInput,
    refreshAccountStatus,
    setActivationCodeDraft,
    signOutAccount,
    startLoginFlow,
  } = useAccountController({
    formatHistoryDate,
    onSignedOut: () => {
      if (isProcessingStage(workflow.stage)) {
        void cancelProcess();
      }
      resetWorkflow();
    },
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyNotice, setHistoryNotice] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const operationIdRef = useRef(0);
  const transcriptAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptSegmentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const resumeTranscriptAfterSaveRef = useRef(false);
  const windowDragSessionRef = useRef<WindowDragSession | null>(null);
  const queuedWindowPositionRef = useRef<WindowPosition | null>(null);
  const windowMoveInFlightRef = useRef(false);
  const canSubmit = canSubmitUrl(workflow.url);
  const progressSteps = useMemo(() => getProgressSteps(workflow), [workflow]);
  const resultCards = useMemo(() => getResultCards(workflow), [workflow]);
  const visibleWorkflowError = getVisibleWorkflowError(workflow);
  const toolbarNewTaskButtonState = getToolbarNewTaskButtonState(workflow.stage);
  const {
    updateState,
    updateBusy,
    updateInstallBlocked,
    updateToolbarVisible,
    updateSpinnerVisible,
    inAppUpdates,
    checkForUpdates,
    installUpdate,
    postponeUpdateReminder,
    restartForUpdate,
    openReleases,
  } = useAppUpdateController({
    processingActive: isProcessingStage(workflow.stage),
    modelDownloadActive,
  });

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (detailTab) {
        setDetailTab(null);
        return;
      }

      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }

      if (summaryConfirmOpen) {
        setSummaryConfirmOpen(false);
        return;
      }

      if (insightPreferenceFlow) {
        setInsightPreferenceFlow(null);
        return;
      }

      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }

      if (modelGuideOpen && !modelDownloadActive) {
        setModelGuideOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [
    detailTab,
    historyOpen,
    summaryConfirmOpen,
    insightPreferenceFlow,
    settingsOpen,
    modelGuideOpen,
    modelDownloadActive,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function openFirstRunSettingsIfNeeded() {
      try {
        const firstRun = await refreshAsrModelStatus();
        if (cancelled) {
          return;
        }

        if (!firstRun.asrModelAvailable) {
          openModelGuide(
            `首次使用前需要下载 ASR 模型。模型会保存到：${firstRun.asrModelDir}`,
          );
          return;
        }

        return;
      } catch {
        // Browser-only development and tests do not always provide Tauri commands.
      }
    }

    void openFirstRunSettingsIfNeeded();
    return () => {
      cancelled = true;
    };
  }, [openModelGuide, refreshAsrModelStatus]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    async function registerDeepLinkListeners() {
      try {
        const currentUrls = await getCurrent();
        if (!cancelled && currentUrls) {
          for (const url of currentUrls) {
            void handleAuthCallback(url);
          }
        }
        unlisten = await onOpenUrl((urls) => {
          for (const url of urls) {
            void handleAuthCallback(url);
          }
        });
      } catch {
        // Browser-only tests and Vite preview do not provide the Tauri deep-link plugin.
      }
    }

    void registerDeepLinkListeners();
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleAuthCallback]);

  useEffect(() => {
    if (detailTab !== "transcript") {
      return;
    }

    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      setTranscriptDetail(null);
      setTranscriptDraft(workflow.text);
      setTranscriptSegments([]);
      setTranscriptDirty(false);
      setActiveTranscriptSegmentId(null);
      setEditingTranscriptSegmentId(null);
      return;
    }

    let cancelled = false;
    setTranscriptLoading(true);
    setTranscriptDetail(null);
    setTranscriptDraft(workflow.text);
    setTranscriptSegments([]);
    setTranscriptDirty(false);
    setActiveTranscriptSegmentId(null);
    setEditingTranscriptSegmentId(null);
    const taskId = workflow.taskId;

    async function loadDetail() {
      try {
        const detail = await loadTranscriptDetail(taskId);
        if (cancelled) {
          return;
        }
        setTranscriptDetail(detail);
        setTranscriptDraft(detail.text || workflow.text);
        setTranscriptSegments(detail.segments);
        setActionNotice(
          detail.audio_asset_path
            ? ""
            : "音频文件暂不可用，可以先编辑文字稿；点击保存后会更新正式文字稿。",
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        setTranscriptDetail(null);
        setTranscriptDraft(workflow.text);
        setTranscriptSegments([]);
        setActionNotice(
          `无法读取文字稿详情，已显示当前结果文本：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        if (!cancelled) {
          setTranscriptLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [detailTab, workflow.artifacts.transcript_txt, workflow.taskId, workflow.text]);

  useEffect(() => {
    if (!activeTranscriptSegmentId) {
      return;
    }
    transcriptSegmentRefs.current[activeTranscriptSegmentId]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeTranscriptSegmentId]);

  async function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    if (!canProcessWithAccount(account)) {
      openAccountPanel(accountProcessBlockerMessage(account, "开始新任务"));
      return;
    }
    const submittedUrl = normalizeSubmitUrl(workflow.url);
    if (!submittedUrl) {
      return;
    }
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setWorkflow((current) => startProcessing(current, submittedUrl));
    const result = await processVideo(submittedUrl, undefined, (event) => {
      if (operationIdRef.current === operationId) {
        setWorkflow((current) => mergeProgressEvent(current, event));
      }
    });
    if (operationIdRef.current !== operationId) {
      return;
    }
    setWorkflow((current) => ({
      ...summarizeWorkerResult(result),
      url: submittedUrl,
      submittedUrl: current.submittedUrl || submittedUrl,
    }));
  }

  function resetWorkflow() {
    operationIdRef.current += 1;
    setDetailTab(null);
    setSummaryConfirmOpen(false);
    setInsightPreferenceFlow(null);
    setActionNotice("");
    setWorkflow(createInitialWorkflow());
  }

  function startNewTaskFromToolbar() {
    if (toolbarNewTaskButtonState.disabled) {
      return;
    }

    resetWorkflow();
  }

  async function cancelCurrentProcessing() {
    operationIdRef.current += 1;
    setDetailTab(null);
    setSummaryConfirmOpen(false);
    setInsightPreferenceFlow(null);
    setActionNotice("");
    setWorkflow((current) => cancelProcessing(current));
    await cancelProcess();
  }

  function openCard(card: ResultCard) {
    if (card.action === "locate") {
      void locateArtifact(card);
      return;
    }

    if (card.action === "open") {
      setActionNotice("");
      setDetailTab(card.id);
      return;
    }

    if (card.action === "confirm") {
      setActionNotice("");
      const target = getInsightRetryTargetForCard(card);
      if (target === "summary") {
        openSummaryConfirmation();
        return;
      }
      if (target === "insights") {
        void openInsightPreferenceFlow();
      }
    }
  }

  async function locateArtifact(card: ResultCard) {
    const artifactPath = getExportPath(card.id, workflow);
    if (!artifactPath) {
      setActionNotice("暂无可定位的文件。");
      return;
    }

    try {
      await revealItemInDir(artifactPath);
      setActionNotice("已在文件管理器中定位文件。");
    } catch {
      setActionNotice(`无法定位文件：${artifactPath}`);
    }
  }

  async function openInsightPreferenceFlow() {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      setActionNotice("文字稿生成后才能继续生成启发灵感。");
      return;
    }

    setInsightPreferenceBusy(true);
    setActionNotice("");
    try {
      const preferences = await getInsightPreferences();
      setInsightPreferenceFlow(createInsightPreferenceFlow(preferences));
    } catch (error) {
      setActionNotice(`无法读取本地偏好：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }

  function openSummaryConfirmation() {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      setActionNotice("文字稿生成后才能继续生成要点总结。");
      return;
    }

    setSummaryConfirmOpen(true);
  }

  async function confirmSummaryGeneration() {
    if (!canGenerateAiWithAccount(account)) {
      openAccountPanel(accountAiBlockerMessage(account, "生成要点总结"));
      return;
    }

    setSummaryConfirmOpen(false);
    try {
      await retryInsightGeneration("summary", null);
    } catch (error) {
      setActionNotice(`启动要点总结失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function openProfileEditorFromSettings() {
    setSettingsOpen(false);
    setInsightPreferenceBusy(true);
    setActionNotice("");
    try {
      const preferences = await getInsightPreferences();
      setInsightPreferenceFlow(startProfileSetupInFlow(createInsightPreferenceFlow(preferences)));
    } catch (error) {
      setActionNotice(`无法读取本地偏好：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }

  async function openDirectionEditorFromDetail() {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      setActionNotice("文字稿生成后才能重新选择方向。");
      return;
    }

    setDetailTab(null);
    setInsightPreferenceBusy(true);
    setActionNotice("");
    try {
      const preferences = await getInsightPreferences();
      setInsightPreferenceFlow(startGenerationPreferenceEditing(createInsightPreferenceFlow(preferences)));
    } catch (error) {
      setActionNotice(`无法读取本地偏好：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }

  async function clearProfileFromSettings() {
    setSettingsSaving(true);
    setSettingsNotice("");
    try {
      const preferences = await clearInspirationProfile();
      setSettingsInsightPreferences(preferences);
      setSettingsNotice("已清空灵感档案；下次生成启发灵感时会重新询问。");
    } catch (error) {
      setSettingsNotice(`清空失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function skipCurrentProfileSetup() {
    if (!insightPreferenceFlow) {
      return;
    }
    setInsightPreferenceBusy(true);
    try {
      await skipInspirationProfile();
      setInsightPreferenceFlow(skipProfileSetupInFlow(insightPreferenceFlow));
    } catch (error) {
      setActionNotice(`保存跳过状态失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }

  async function saveCurrentProfile(profile: InspirationProfile) {
    setInsightPreferenceBusy(true);
    try {
      const preferences = await saveInspirationProfile(profile);
      setInsightPreferenceFlow(startGenerationPreferenceEditing(createInsightPreferenceFlow(preferences)));
    } catch (error) {
      setActionNotice(`保存灵感档案失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }

  async function confirmInsightPreferences(preferences: GenerationPreferences) {
    if (!canGenerateAiWithAccount(account)) {
      openAccountPanel(accountAiBlockerMessage(account, "生成启发灵感"));
      return;
    }

    setInsightPreferenceBusy(true);
    try {
      const preferenceSnapshot = insightPreferenceFlow
        ? buildPreferenceSnapshot({
            profile: insightPreferenceFlow.profile,
            profileSkipped: insightPreferenceFlow.profileSkipped,
            generationPreferences: preferences,
      })
        : null;
      await saveDefaultGenerationPreferences(preferences);
      setInsightPreferenceFlow(null);
      await retryInsightGeneration("insights", preferenceSnapshot);
    } catch (error) {
      setActionNotice(`启动启发灵感失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }

  async function retryInsightGeneration(
    target: InsightRetryTarget,
    preferenceSnapshot: PreferenceSnapshot | null = null,
  ) {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      return;
    }
    if (!canGenerateAiWithAccount(account)) {
      openAccountPanel(
        accountAiBlockerMessage(
          account,
          target === "summary" ? "生成要点总结" : "生成启发灵感",
        ),
      );
      return;
    }

    const taskId = workflow.taskId;
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setDetailTab(null);
    setActionNotice("");
    setWorkflow((current) => startInsightRetry(current, target));

    const result = await retryInsights(taskId, target, preferenceSnapshot);
    if (operationIdRef.current !== operationId) {
      return;
    }
    setWorkflow((current) => ({
      ...summarizeWorkerResult({
        ...result,
        task_id: result.task_id ?? current.taskId,
        task_dir: result.task_dir ?? current.taskDir,
        artifacts: {
          ...current.artifacts,
          ...(result.artifacts ?? {}),
        },
        text: result.text || current.text,
        summary: result.summary || current.summary,
        insights: result.insights.length > 0 ? result.insights : current.insights,
      }),
      url: current.url,
      submittedUrl: current.submittedUrl,
    }));
    void refreshAccountStatus();
  }

  async function copyDetail() {
    if (!detailTab) {
      return;
    }
    const text = detailTab === "transcript" ? transcriptDraft : getDetailText(detailTab, workflow);
    if (!text) {
      setActionNotice("暂无可复制内容。");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setActionNotice("已复制到剪贴板。");
    } catch {
      setActionNotice("复制失败，请手动选择内容复制。");
    }
  }

  async function exportDetail() {
    if (!detailTab) {
      return;
    }
    if (detailTab === "transcript" && transcriptDirty) {
      setActionNotice("文字稿有未保存修改，请先保存后再定位正式文件。");
      return;
    }
    const exportPath = getExportPath(detailTab, workflow);
    if (!exportPath) {
      setActionNotice("暂无可导出的文件。");
      return;
    }

    try {
      await revealItemInDir(exportPath);
      setActionNotice("已在文件管理器中定位导出文件。");
    } catch {
      setActionNotice(`无法定位文件：${exportPath}`);
    }
  }

  async function playTranscriptSegment(segment: TranscriptSegment) {
    if (editingTranscriptSegmentId) {
      return;
    }

    const audio = transcriptAudioRef.current;
    if (!audio || !transcriptDetail?.audio_asset_path) {
      setActiveTranscriptSegmentId(segment.id);
      setActionNotice("当前任务没有可播放的本地音频，只能编辑文字稿。");
      return;
    }

    if (shouldPauseActiveTranscriptSegment(activeTranscriptSegmentId, segment.id, !audio.paused)) {
      audio.pause();
      setTranscriptAudioPlaying(false);
      return;
    }

    setActiveTranscriptSegmentId(segment.id);
    audio.currentTime = segment.start_ms / 1000;
    audio.playbackRate = 1;
    setTranscriptAudioCurrentTime(audio.currentTime);
    try {
      await audio.play();
    } catch {
      setActionNotice("音频无法自动播放，请点击回听工具条继续。");
    }
  }

  function syncTranscriptAudioState(audio: HTMLAudioElement) {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    setTranscriptAudioDuration(duration);
    setTranscriptAudioCurrentTime(clampAudioTime(audio.currentTime, duration));
  }

  function handleTranscriptAudioMetadata() {
    const audio = transcriptAudioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = 1;
    syncTranscriptAudioState(audio);
  }

  function handleTranscriptTimeUpdate() {
    const audio = transcriptAudioRef.current;
    if (!audio) {
      return;
    }
    syncTranscriptAudioState(audio);
    if (!editingTranscriptSegmentId) {
      const activeId = findActiveTranscriptSegmentId(transcriptSegments, audio.currentTime);
      if (activeId) {
        setActiveTranscriptSegmentId(activeId);
      }
    }
  }

  async function toggleTranscriptAudio() {
    const audio = transcriptAudioRef.current;
    if (!audio || !transcriptDetail?.audio_asset_path) {
      setActionNotice("当前任务没有可播放的本地音频，只能编辑文字稿。");
      return;
    }

    if (!audio.paused) {
      audio.pause();
      return;
    }

    audio.playbackRate = 1;
    try {
      await audio.play();
    } catch {
      setActionNotice("音频无法播放，请确认本地音频文件仍然存在。");
    }
  }

  function scrubTranscriptAudio(event: ChangeEvent<HTMLInputElement>) {
    const audio = transcriptAudioRef.current;
    const nextTime = clampAudioTime(event.currentTarget.valueAsNumber, transcriptAudioDuration);
    if (audio) {
      audio.currentTime = nextTime;
    }
    setTranscriptAudioCurrentTime(nextTime);
    if (!editingTranscriptSegmentId) {
      const activeId = findActiveTranscriptSegmentId(transcriptSegments, nextTime);
      if (activeId) {
        setActiveTranscriptSegmentId(activeId);
      }
    }
  }

  function beginTranscriptSegmentEdit(segmentId: string) {
    const audio = transcriptAudioRef.current;
    if (audio && !audio.paused) {
      resumeTranscriptAfterSaveRef.current = true;
      audio.pause();
    }
    setEditingTranscriptSegmentId(segmentId);
    setActiveTranscriptSegmentId(segmentId);
  }

  function updateTranscriptSegmentDraft(segmentId: string, text: string) {
    setTranscriptSegments((current) => {
      const next = updateTranscriptSegmentText(current, segmentId, text);
      setTranscriptDraft(transcriptTextFromSegments(next));
      return next;
    });
    setTranscriptDirty(true);
  }

  function updateFullTranscriptDraft(text: string) {
    setTranscriptDraft(text);
    setTranscriptDirty(true);
  }

  async function saveTranscriptDraft() {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt || transcriptSaving) {
      return;
    }

    setTranscriptSaving(true);
    try {
      const saved = await saveTranscriptEdit(
        workflow.taskId,
        transcriptDraft,
        transcriptSegments,
      );
      setTranscriptDraft(saved.text);
      setTranscriptDirty(false);
      setEditingTranscriptSegmentId(null);
      setTranscriptDetail((current) =>
        current
          ? {
              ...current,
              text: saved.text,
              has_original_backup: saved.has_original_backup,
            }
          : current,
      );
      setWorkflow((current) => ({
        ...current,
        taskId: saved.task_id || current.taskId,
        text: saved.text,
        artifacts: {
          ...current.artifacts,
          ...(saved.artifacts ?? {}),
        },
      }));
      setActionNotice("文字稿已保存，后续 AI 整理会使用保存后的正式稿。");

      if (resumeTranscriptAfterSaveRef.current && transcriptAudioRef.current) {
        resumeTranscriptAfterSaveRef.current = false;
        try {
          await transcriptAudioRef.current.play();
        } catch {
          setActionNotice("文字稿已保存。音频无法自动继续，请手动点击播放器。");
        }
      }
    } catch (error) {
      setActionNotice(`保存文字稿失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTranscriptSaving(false);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryItems([]);
    setHistoryNotice("正在读取历史记录。");
    try {
      const items = await getHistory();
      setHistoryItems(items);
      setHistoryNotice(items.length > 0 ? "" : "暂无历史任务。");
    } catch (error) {
      setHistoryNotice(`读取历史失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setHistoryLoading(false);
    }
  }

  function openHistoryItem(item: HistoryItem) {
    setWorkflow({
      ...summarizeWorkerResult(historyItemToWorkerResult(item)),
      url: item.url,
      submittedUrl: item.url,
    });
    setDetailTab(item.summary ? "summary" : item.insights.length > 0 ? "insights" : item.text ? "transcript" : null);
    setActionNotice("");
    setHistoryOpen(false);
  }

  async function openSettings() {
    setSettingsCategory("basic");
    setSettingsOpen(true);
    await loadSettings();
  }

  async function loadSettings(successNotice?: string) {
    setSettingsLoading(true);
    setSettingsNotice("正在读取配置。");
    try {
      const [config, audioCacheUsage, insightPreferences] = await Promise.all([
        getLlmConfig(),
        getAudioReviewCacheUsage(),
        getInsightPreferences().catch(() => null),
      ]);
      setSettingsDraft({
        outputDir: config.outputDir,
        asrModel: config.asrModel,
      });
      setSettingsSupportedAsrModels(
        config.supportedAsrModels.length > 0 ? config.supportedAsrModels : defaultAsrModels,
      );
      setSettingsConfigPath(config.configPath);
      setAudioReviewCacheUsage(audioCacheUsage);
      setSettingsInsightPreferences(insightPreferences);
      setSettingsNotice(
        successNotice ??
          (insightPreferences
            ? "已读取本机 ASR、输出目录与灵感档案设置。"
            : "已读取本机 ASR 与输出目录设置；灵感档案状态暂不可用。"),
      );
    } catch (error) {
      setSettingsNotice(`读取配置失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsSaving(true);
    setSettingsNotice("");
    try {
      const config = await saveLlmConfig(settingsDraft);
      setSettingsDraft((current) => ({
        ...current,
        outputDir: config.outputDir,
        asrModel: config.asrModel,
      }));
      setSettingsSupportedAsrModels(
        config.supportedAsrModels.length > 0 ? config.supportedAsrModels : defaultAsrModels,
      );
      setSettingsConfigPath(config.configPath);
      setSettingsNotice("配置已保存，后续任务会使用新的 ASR 和输出目录设置。");
    } catch (error) {
      setSettingsNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSettingsSaving(false);
    }
  }

  function updateSettingsDraft(field: keyof LlmConfigDraft, value: string) {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  }

  async function clearAudioReviewCacheFromSettings() {
    setSettingsSaving(true);
    setSettingsNotice("");
    try {
      const usage = await clearAudioReviewCache();
      setAudioReviewCacheUsage(usage);
      setSettingsNotice("音频播放缓存已清理；原始任务音频不会被删除。");
    } catch (error) {
      setSettingsNotice(`清理音频播放缓存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function locateSettingsConfigFile() {
    if (!settingsConfigPath) {
      setSettingsNotice("配置文件路径尚未读取，请稍后再试。");
      return;
    }

    try {
      await revealItemInDir(settingsConfigPath);
      setSettingsNotice("已在文件管理器中定位本机配置文件。");
    } catch (error) {
      setSettingsNotice(`定位配置文件失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function runWindowChromeAction(action: () => Promise<void>) {
    void action().catch((error) => {
      console.warn("Window chrome action failed", error);
    });
  }

  function flushQueuedWindowPosition() {
    if (windowMoveInFlightRef.current || !queuedWindowPositionRef.current) {
      return;
    }

    const position = queuedWindowPositionRef.current;
    queuedWindowPositionRef.current = null;
    windowMoveInFlightRef.current = true;
    void setWindowPosition(position)
      .catch((error) => {
        console.warn("Window drag move failed", error);
      })
      .finally(() => {
        windowMoveInFlightRef.current = false;
        flushQueuedWindowPosition();
      });
  }

  async function beginManualWindowDrag(pointerX: number, pointerY: number) {
    try {
      const position = await getWindowPosition();
      windowDragSessionRef.current = {
        pointerX,
        pointerY,
        windowX: position.x,
        windowY: position.y,
      };
    } catch (error) {
      console.warn("Manual window drag failed to start", error);
      runWindowChromeAction(startWindowDrag);
    }
  }

  function handleToolbarMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, [role='button']")) {
      return;
    }

    event.preventDefault();
    void beginManualWindowDrag(event.screenX, event.screenY);
  }

  useEffect(() => {
    function moveManualWindowDrag(event: globalThis.MouseEvent) {
      const session = windowDragSessionRef.current;
      if (!session) {
        return;
      }

      queuedWindowPositionRef.current = calculateDraggedWindowPosition(session, {
        pointerX: event.screenX,
        pointerY: event.screenY,
      });
      flushQueuedWindowPosition();
    }

    function stopManualWindowDrag() {
      windowDragSessionRef.current = null;
      queuedWindowPositionRef.current = null;
    }

    window.addEventListener("mousemove", moveManualWindowDrag);
    window.addEventListener("mouseup", stopManualWindowDrag);
    window.addEventListener("blur", stopManualWindowDrag);
    return () => {
      window.removeEventListener("mousemove", moveManualWindowDrag);
      window.removeEventListener("mouseup", stopManualWindowDrag);
      window.removeEventListener("blur", stopManualWindowDrag);
    };
  }, []);

  const activeCopy = stageCopy[workflow.stage];
  const progressPercent = formatProgressPercent(workflow.progressPercent);
  const detailTitle =
    detailTab === "insights" ? "启发灵感" : detailTab === "summary" ? "要点总结" : "完整文字稿";
  const detailText =
    detailTab === "transcript" ? transcriptDraft : detailTab ? getDetailText(detailTab, workflow) : "";
  const exportPath = detailTab ? getExportPath(detailTab, workflow) : null;
  const currentTranscriptPath = getExportPath("transcript", workflow);
  const transcriptSourceLabel = getTranscriptSourceLabel(workflow);
  const transcriptAudioSrc = transcriptDetail?.audio_asset_path
    ? convertFileSrc(transcriptDetail.audio_asset_path)
    : "";
  const transcriptAudioProgress = audioProgressPercent(transcriptAudioCurrentTime, transcriptAudioDuration);
  const transcriptAudioScrubberMax =
    transcriptAudioDuration > 0 ? transcriptAudioDuration : Math.max(transcriptAudioCurrentTime, 1);
  const transcriptAudioScrubberStyle = {
    "--audio-progress": `${transcriptAudioProgress}%`,
  } as CSSProperties;
  const hasTranscriptSegments = transcriptSegments.length > 0;

  useEffect(() => {
    setTranscriptAudioCurrentTime(0);
    setTranscriptAudioDuration(0);
    setTranscriptAudioPlaying(false);
    if (transcriptAudioRef.current) {
      transcriptAudioRef.current.playbackRate = 1;
    }
  }, [transcriptAudioSrc]);

  return (
    <main className="app-shell">
      <section className="desktop-window" aria-label="FrameQ 桌面窗口">
        <header className="app-toolbar topbar" data-tauri-drag-region="" onMouseDown={handleToolbarMouseDown}>
          <div className="traffic-lights" role="group" aria-label="窗口操作">
            <button
              className="traffic-light close"
              type="button"
              aria-label="关闭窗口"
              onClick={() => runWindowChromeAction(closeWindow)}
            />
            <button
              className="traffic-light minimize"
              type="button"
              aria-label="最小化窗口"
              onClick={() => runWindowChromeAction(minimizeWindow)}
            />
            <button
              className="traffic-light zoom"
              type="button"
              aria-label="最大化或还原窗口"
              onClick={() => runWindowChromeAction(toggleMaximizeWindow)}
            />
          </div>

          <div className="toolbar-title" data-tauri-drag-region="">
            <span className="app-mark" data-tauri-drag-region="">FQ</span>
            <div data-tauri-drag-region="">
              <h1 data-tauri-drag-region="">FrameQ</h1>
            </div>
          </div>

          <div className="topbar-actions toolbar-actions">
            <button
              className={`account-chip ${canProcessWithAccount(account) ? "active" : ""}`}
              type="button"
              onClick={() => openAccountPanel()}
              aria-label="账号与授权"
            >
              <UserRound size={15} />
              <span>{accountChipLabel}</span>
            </button>
            {updateToolbarVisible ? (
              <button
                className={`update-chip ${updateState.status}`}
                type="button"
                onClick={installUpdate}
                aria-label="应用更新"
                disabled={updateBusy}
              >
                {updateSpinnerVisible ? <LoaderCircle size={15} /> : <Download size={15} />}
                <span>{updateToolbarLabel(updateState)}</span>
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={openHistory} aria-label="查看历史">
              <HistoryIcon size={17} />
            </button>
            <button className="icon-button" type="button" onClick={openSettings} aria-label="应用设置">
              <Settings size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={startNewTaskFromToolbar}
              aria-label={toolbarNewTaskButtonState.ariaLabel}
              title={toolbarNewTaskButtonState.title}
              disabled={toolbarNewTaskButtonState.disabled}
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </header>

        <section
          className={`workspace ${workflow.showUrlInput ? "waiting-layout" : "active-layout"}`}
          aria-label="视频处理工作区"
        >
          <div className="workflow-column">
            {workflow.showUrlInput ? (
              <form className="command-panel input-pane" onSubmit={submitUrl}>
                <div className="panel-heading">
                  <div>
                    <p className="section-label">New task</p>
                    <h2>粘贴视频链接</h2>
                  </div>
                </div>

                <div className="url-row command-row">
                  <input
                    id="video-url"
                    aria-label="视频 URL"
                    value={workflow.url}
                    onChange={(event) => {
                      const url = event.currentTarget.value;
                      setWorkflow((current) => ({ ...current, url }));
                    }}
                    placeholder="粘贴抖音或小红书视频链接"
                  />
                  <button className="primary-button" type="submit" disabled={!canSubmit}>
                    <Play size={17} />
                    <span>确认</span>
                  </button>
                </div>
                <p className="status-line">{activeCopy.body}</p>
              </form>
            ) : (
              <section className={`process-monitor process-pane ${workflow.stage}`} aria-label="处理进度">
                <div className="process-heading">
                  <div>
                    <p className="section-label">Task monitor</p>
                    <h2>{activeCopy.title}</h2>
                  </div>
                  {isProcessingStage(workflow.stage) ? (
                    <button className="secondary-button danger-soft" type="button" onClick={cancelCurrentProcessing}>
                      <X size={17} />
                      <span>取消任务</span>
                    </button>
                  ) : null}
                </div>

                <div className="progress-summary">
                  <div>
                    <span className="progress-value">{progressPercent}</span>
                    <p>{stageSummary[workflow.stage]}</p>
                  </div>
                  <div className="progress-track">
                    <span
                      className={`progress-fill ${workflow.stage}`}
                      style={{ width: workflow.progressPercent ? progressPercent : undefined }}
                    />
                  </div>
                </div>

                <div className="steps" aria-label="处理阶段">
                  {progressSteps.map((step) => (
                    <div className={`step ${step.state}`} key={step.id}>
                      <span className="step-dot">
                        {step.state === "complete" ? (
                          <CheckCircle2 size={14} />
                        ) : step.state === "active" ? (
                          <LoaderCircle size={14} />
                        ) : (
                          <Circle size={14} />
                        )}
                      </span>
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>
                <p className="status-line worker-message">{workflow.statusMessage || activeCopy.body}</p>
              </section>
            )}
          </div>

          <ResultWorkspace
            workflow={workflow}
            resultCards={resultCards}
            visibleWorkflowError={visibleWorkflowError}
            actionNotice={actionNotice}
            stageTitles={stageTitles}
            onOpenCard={openCard}
          />
        </section>
      </section>

      <AccountSheet
        open={accountOpen}
        account={account}
        accountStatusText={accountStatusText}
        accountNotice={accountNotice}
        accountLoading={accountLoading}
        activationCodeDraft={activationCodeDraft}
        activationRedeeming={activationRedeeming}
        formatHistoryDate={formatHistoryDate}
        onClose={closeAccountPanel}
        onActivationCodeChange={setActivationCodeDraft}
        onRedeemActivationCode={redeemActivationCodeFromInput}
        onSignOut={signOutAccount}
        onStartLogin={startLoginFlow}
      />

      <ModelGuideSheet
        open={modelGuideOpen}
        modelDownloadActive={modelDownloadActive}
        asrModelStatus={asrModelStatus}
        asrModelLabels={asrModelLabels}
        modelDownloadProgress={modelDownloadProgress}
        modelDownloadNotice={modelDownloadNotice}
        modelDownloadStalled={modelDownloadStalled}
        formatProgressPercent={formatProgressPercent}
        asrModelSourceLabel={asrModelSourceLabel}
        onClose={() => setModelGuideOpen(false)}
        onStartDownload={startAsrModelDownload}
        onCancelDownload={cancelCurrentAsrModelDownload}
      />

      {summaryConfirmOpen ? (
        <div
          className="modal-backdrop sheet-backdrop"
          role="presentation"
          onClick={() => setSummaryConfirmOpen(false)}
        >
          <section
            className="sheet-panel detail-modal preference-flow-sheet"
            aria-label="确认要点总结"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">Summary</p>
                <h2>确认要点总结</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setSummaryConfirmOpen(false)}
                aria-label="关闭要点总结确认"
              >
                <X size={18} />
              </button>
            </header>
            <div className="preference-flow-content">
              <p className="settings-warning privacy-callout">
                <ShieldCheck size={16} />
                <span>
                  确认后会把文字稿片段发送到管理员配置的云端 LLM，用于生成要点总结和本地 Mermaid mindmap。
                </span>
              </p>
              <div className="confirm-summary preference-confirm-grid">
                <div>
                  <span className="account-status-label">当前文字稿</span>
                  <strong>
                    {workflow.text.length > 0
                      ? `${workflow.text.length.toLocaleString("zh-CN")} 字`
                      : "等待文字稿"}
                  </strong>
                  <small>{currentTranscriptPath || "文字稿文件生成后才能继续。"}</small>
                </div>
                <div>
                  <span className="account-status-label">账号额度</span>
                  <strong>{account.llmQuotaRemaining} 次可用</strong>
                  <small>1 次额度 = 1 次云端 LLM API 调用尝试；本次会按实际调用次数扣除。</small>
                </div>
              </div>
              <div className="settings-actions sheet-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSummaryConfirmOpen(false)}
                  disabled={isProcessingStage(workflow.stage)}
                >
                  <span>取消</span>
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={confirmSummaryGeneration}
                  disabled={isProcessingStage(workflow.stage)}
                >
                  <ListChecks size={16} />
                  <span>确认</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {insightPreferenceFlow ? (
        <InsightPreferenceFlow
          flow={insightPreferenceFlow}
          busy={insightPreferenceBusy || isProcessingStage(workflow.stage)}
          accountQuotaRemaining={account.llmQuotaRemaining}
          transcriptLength={workflow.text.length}
          transcriptPath={currentTranscriptPath}
          onFlowChange={setInsightPreferenceFlow}
          onSkipProfile={skipCurrentProfileSetup}
          onSaveProfile={saveCurrentProfile}
          onConfirm={confirmInsightPreferences}
          onCancel={() => setInsightPreferenceFlow(null)}
        />
      ) : null}

      {detailTab ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setDetailTab(null)}>
          <section
            className="sheet-panel detail-modal detail-sheet"
            aria-label="结果详情"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">Preview</p>
                <h2>{detailTitle}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setDetailTab(null)} aria-label="关闭详情">
                <X size={18} />
              </button>
            </header>
            <div className="tabs">
              <button
                className={detailTab === "summary" ? "selected" : ""}
                type="button"
                onClick={() => setDetailTab("summary")}
              >
                要点总结
              </button>
              <button
                className={detailTab === "insights" ? "selected" : ""}
                type="button"
                onClick={() => setDetailTab("insights")}
              >
                启发灵感
              </button>
              <button
                className={detailTab === "transcript" ? "selected" : ""}
                type="button"
                onClick={() => setDetailTab("transcript")}
              >
                完整文字稿
              </button>
            </div>
            <div className="modal-tools">
              <div className="detail-tool-status">
                {detailTab === "transcript" ? (
                  <span>
                    {transcriptDirty
                      ? "有未保存修改"
                      : transcriptDetail?.has_original_backup
                        ? "已创建原始备份"
                        : "本地文字稿"}
                  </span>
                ) : (
                  <span>本地结果预览</span>
                )}
              </div>
              <div className="tool-actions">
                <button type="button" onClick={copyDetail} disabled={!detailText}>
                  <Copy size={16} />
                  <span>复制</span>
                </button>
                {detailTab === "transcript" ? (
                  <button
                    type="button"
                    onClick={saveTranscriptDraft}
                    disabled={!workflow.taskId || !workflow.artifacts.transcript_txt || !transcriptDirty || transcriptSaving}
                  >
                    {transcriptSaving ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
                    <span>{transcriptSaving ? "保存中" : "保存"}</span>
                  </button>
                ) : null}
                {detailTab === "insights" ? (
                  <button type="button" onClick={openDirectionEditorFromDetail} disabled={!workflow.taskId || !workflow.artifacts.transcript_txt}>
                    <RotateCcw size={16} />
                    <span>换个方向</span>
                  </button>
                ) : null}
                <button type="button" onClick={exportDetail} disabled={!exportPath}>
                  <Download size={16} />
                  <span>导出</span>
                </button>
              </div>
            </div>
            {actionNotice ? <p className="action-notice">{actionNotice}</p> : null}
            <div className="modal-content">
              {detailTab === "summary" ? (
                <MarkdownContent markdown={workflow.summary} emptyText="要点总结生成后将在这里显示。" />
              ) : detailTab === "insights" ? (
                workflow.insights.length > 0 ? (
                  <ol className="insight-detail-list">
                    {workflow.insights.map((insight) => (
                      <li className="insight-detail-item" key={insight.id}>
                        <h3>{insight.topic}</h3>
                        <dl>
                          <div>
                            <dt>匹配理由</dt>
                            <dd>{insight.matchReason}</dd>
                          </div>
                          <div>
                            <dt>启发问题</dt>
                            <dd>{insight.followUpQuestions.join("；")}</dd>
                          </div>
                          <div>
                            <dt>适合用途</dt>
                            <dd>{insight.suitableUse}</dd>
                          </div>
                          {insight.sourceChunkId === null ? null : (
                            <div>
                              <dt>来源片段</dt>
                              <dd>{insight.sourceChunkId}</dd>
                            </div>
                          )}
                        </dl>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>启发灵感尚未生成。</p>
                )
              ) : (
                <div className="transcript-review">
                  {transcriptSourceLabel ? (
                    <p className="transcript-source">{transcriptSourceLabel}</p>
                  ) : null}
                  {transcriptLoading ? (
                    <p className="transcript-status">正在读取文字稿详情...</p>
                  ) : null}
                  {transcriptAudioSrc ? (
                    <>
                      <audio
                        ref={transcriptAudioRef}
                        className="transcript-audio-engine"
                        src={transcriptAudioSrc}
                        preload="metadata"
                        onLoadedMetadata={handleTranscriptAudioMetadata}
                        onDurationChange={handleTranscriptAudioMetadata}
                        onTimeUpdate={handleTranscriptTimeUpdate}
                        onPlay={() => setTranscriptAudioPlaying(true)}
                        onPause={() => setTranscriptAudioPlaying(false)}
                        onEnded={() => setTranscriptAudioPlaying(false)}
                      />
                      <div className="audio-review-bar" aria-label="音频回听工具条">
                        <button
                          className="audio-play-button"
                          type="button"
                          onClick={() => void toggleTranscriptAudio()}
                          aria-label={transcriptAudioPlaying ? "暂停音频" : "播放音频"}
                        >
                          {transcriptAudioPlaying ? <Pause size={16} /> : <Play size={16} />}
                        </button>
                        <div className="audio-review-timeline">
                          <input
                            className="audio-review-scrubber"
                            type="range"
                            min={0}
                            max={transcriptAudioScrubberMax}
                            step={0.1}
                            style={transcriptAudioScrubberStyle}
                            value={clampAudioTime(transcriptAudioCurrentTime, transcriptAudioScrubberMax)}
                            onChange={scrubTranscriptAudio}
                            disabled={transcriptAudioDuration <= 0}
                            aria-label="音频进度"
                            aria-valuetext={`${formatAudioClock(transcriptAudioCurrentTime)}，${Math.round(
                              transcriptAudioProgress,
                            )}%`}
                          />
                          <div className="audio-review-clock">
                            <span>{formatAudioClock(transcriptAudioCurrentTime)}</span>
                            <span aria-hidden="true"> / </span>
                            <span>{formatAudioClock(transcriptAudioDuration)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="transcript-status">当前任务没有可播放的本地音频。</p>
                  )}
                  {hasTranscriptSegments ? (
                    <div className="transcript-segments">
                      {transcriptSegments.map((segment) => (
                        <div
                          key={segment.id}
                          ref={(element) => {
                            transcriptSegmentRefs.current[segment.id] = element;
                          }}
                          className={`transcript-segment ${
                            activeTranscriptSegmentId === segment.id ? "active" : ""
                          } ${editingTranscriptSegmentId === segment.id ? "editing" : ""}`}
                        >
                          <div className="transcript-segment-header">
                            <button
                              type="button"
                              className="transcript-segment-time"
                              onClick={() => void playTranscriptSegment(segment)}
                              disabled={!transcriptDetail?.audio_asset_path || Boolean(editingTranscriptSegmentId)}
                            >
                              <Play size={14} />
                              <span>{formatSegmentTime(segment.start_ms)}</span>
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact-button"
                              onClick={() => beginTranscriptSegmentEdit(segment.id)}
                              disabled={isTranscriptSegmentEditDisabled(editingTranscriptSegmentId, segment.id)}
                            >
                              编辑
                            </button>
                          </div>
                          {editingTranscriptSegmentId === segment.id ? (
                            <textarea
                              value={segment.text}
                              onChange={(event) =>
                                updateTranscriptSegmentDraft(segment.id, event.currentTarget.value)
                              }
                              autoFocus
                            />
                          ) : (
                            <button
                              type="button"
                              className="transcript-segment-text"
                              onClick={() => void playTranscriptSegment(segment)}
                            >
                              {segment.text}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      className="transcript-full-editor"
                      value={transcriptDraft}
                      onFocus={() => beginTranscriptSegmentEdit("full-text")}
                      onChange={(event) => updateFullTranscriptDraft(event.currentTarget.value)}
                      placeholder="文字稿生成后将在这里显示。"
                    />
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setHistoryOpen(false)}>
          <section
            className="sheet-panel detail-modal history-modal history-sheet"
            aria-label="历史任务"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">History</p>
                <h2>历史任务</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭历史">
                <X size={18} />
              </button>
            </header>
            {historyNotice ? <p className="action-notice">{historyNotice}</p> : null}
            <div className="history-list">
              {historyItems.map((item) => (
                <button
                  className={`history-item ${item.status}`}
                  key={item.id}
                  type="button"
                  onClick={() => openHistoryItem(item)}
                >
                  <div className="history-item-main">
                    <span className={`history-status ${item.status}`}>
                      {historyStatusCopy[item.status]}
                    </span>
                    <strong>{item.textPreview || item.url}</strong>
                  </div>
                  <div className="history-meta">
                    <span>
                      <Clock3 size={13} />
                      {formatHistoryDate(item.createdAt)}
                    </span>
                    <span>
                      <FolderOpen size={13} />
                      {item.outputDir || "outputs"}
                    </span>
                    <span>{item.error ? item.error.code : `${item.insightsCount} 条灵感`}</span>
                  </div>
                </button>
              ))}
              {!historyLoading && historyItems.length === 0 ? (
                <div className="history-empty">
                  <FileText size={18} />
                  <span>还没有可查看的历史任务。</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="sheet-panel detail-modal settings-modal settings-sheet"
            aria-label="应用设置"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">FrameQ</p>
                <h2>应用设置</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">
                <X size={18} />
              </button>
            </header>
            <form id="settings-form" className="settings-form" onSubmit={submitSettings}>
              <div className="settings-layout" data-active-settings-category={settingsCategory}>
                <nav className="settings-nav" aria-label="设置分类">
                  {settingsNavItems.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`settings-nav-item ${settingsCategory === item.id ? "selected" : ""}`}
                      onClick={() => setSettingsCategory(item.id)}
                      aria-current={settingsCategory === item.id ? "page" : undefined}
                      data-settings-category={item.id}
                    >
                      <span>{item.label}</span>
                      <small>{item.description}</small>
                    </button>
                  ))}
                </nav>

                <div className="settings-sections">
                  <p className="settings-warning privacy-callout">
                    <ShieldCheck size={16} />
                    <span>
                      这里仅管理本机 ASR 模型和输出目录。AI 结果 LLM 由管理员在服务端统一配置，客户端无需手动填写 API Key。
                    </span>
                  </p>

                  {settingsCategory === "basic" ? (
                    <section id="settings-basic" className="sheet-form-section">
                    <div className="form-section-heading">
                      <h3>模型与输出</h3>
                      <p>这些设置只影响后续任务。</p>
                    </div>
                    <label className="field-row">
                      <span>ASR 模型</span>
                      <select
                        value={settingsDraft.asrModel}
                        onChange={(event) => updateSettingsDraft("asrModel", event.currentTarget.value)}
                        disabled={settingsLoading || settingsSaving}
                      >
                        {settingsSupportedAsrModels.map((model) => (
                          <option value={model} key={model}>
                            {asrModelLabels[model] ?? model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="model-settings-row">
                      <div>
                        <span className={`model-status-badge ${asrModelStatus.available ? "ready" : "missing"}`}>
                          {asrModelStatus.available ? "ASR 模型已就绪" : "ASR 模型未下载"}
                        </span>
                        <small>{asrModelStatus.modelDir || "app-local data/models"}</small>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={startAsrModelDownload}
                        disabled={asrModelStatus.available || modelDownloadActive}
                      >
                        <Download size={15} />
                        <span>{modelDownloadActive ? "下载中" : "下载 ASR 模型"}</span>
                      </button>
                    </div>
                    <label className="field-row">
                      <span>输出目录</span>
                      <input
                        value={settingsDraft.outputDir}
                        onChange={(event) => updateSettingsDraft("outputDir", event.currentTarget.value)}
                        placeholder="留空使用 outputs/"
                        disabled={settingsLoading || settingsSaving}
                      />
                    </label>
                    </section>
                  ) : null}

                  {settingsCategory === "inspiration" ? (
                    <section id="settings-inspiration" className="sheet-form-section inspiration-settings-section">
                    <div className="form-section-heading">
                      <h3>灵感档案</h3>
                      <p>只保存在本机，用于后续启发灵感生成。</p>
                    </div>
                    <div className="settings-status-card inspiration-profile-card">
                      <div>
                        <span className={`model-status-badge ${settingsProfileStatusTone(settingsInsightPreferences)}`}>
                          {settingsProfileStatusLabel(settingsInsightPreferences, settingsLoading)}
                        </span>
                        <strong>我的灵感档案</strong>
                        <div className="settings-summary-list">
                          {settingsProfileSummaryLines(settingsInsightPreferences, settingsLoading).map((line, index) => (
                            <span key={`${line}-${index}`}>{line}</span>
                          ))}
                        </div>
                      </div>
                      <div className="inspiration-settings-actions">
                        <button
                          type="button"
                          className="secondary-button profile-edit-button"
                          onClick={openProfileEditorFromSettings}
                          disabled={settingsLoading || settingsSaving}
                        >
                          <UserRound size={15} />
                          <span>编辑灵感档案</span>
                        </button>
                        <button
                          type="button"
                          className="secondary-button profile-clear-button"
                          onClick={clearProfileFromSettings}
                          disabled={settingsLoading || settingsSaving}
                        >
                          <X size={15} />
                          <span>清空档案</span>
                        </button>
                      </div>
                    </div>
                    <div className="settings-status-card quiet">
                      <div>
                        <strong>默认生成偏好</strong>
                        <div className="settings-summary-list">
                          {settingsGenerationPreferenceLines(
                            settingsInsightPreferences,
                            settingsLoading,
                          ).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
                        </div>
                      </div>
                    </div>
                    </section>
                  ) : null}

                  {settingsCategory === "storage" ? (
                    <section id="settings-storage" className="sheet-form-section audio-cache-settings-section">
                    <div className="form-section-heading">
                      <h3>存储与缓存</h3>
                      <p>临时播放缓存保存在 app-local cache/.frameq-audio-review；清理不会删除原始任务音频。</p>
                    </div>
                    <div className="config-file-row audio-cache-row">
                      <code title={audioReviewCacheUsage?.cachePath ?? ""}>
                        音频播放缓存：{formatByteSize(audioReviewCacheUsage?.sizeBytes ?? 0)}
                      </code>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={clearAudioReviewCacheFromSettings}
                        disabled={settingsLoading || settingsSaving || !audioReviewCacheUsage}
                      >
                        <Trash2 size={15} />
                        <span>清理播放缓存</span>
                      </button>
                    </div>
                    </section>
                  ) : null}

                  {settingsCategory === "updates" ? (
                    <section id="settings-updates" className="sheet-form-section update-settings-section">
                    <div className="form-section-heading">
                      <h3>应用更新</h3>
                      <p>FrameQ 会升级桌面端和内置 worker；模型缓存和本机产物保持在 app-local data。</p>
                    </div>
                    <div className={`update-status-card ${updateState.status}`}>
                      <div>
                        <span className={`model-status-badge ${updateState.status === "failed" ? "missing" : "ready"}`}>
                          {inAppUpdates ? updateStatusLabel(updateState) : "手动更新"}
                        </span>
                        <strong>{updateState.availableVersion ? `FrameQ ${updateState.availableVersion}` : "FrameQ stable"}</strong>
                        <small>
                          {inAppUpdates
                            ? updateState.message ||
                              "启动后会自动静默检查更新，也可以在这里手动检查。"
                            : "macOS 版本通过发布页手动下载安装，暂未启用应用内自动更新。"}
                        </small>
                        {updateState.notes ? <small>{updateState.notes}</small> : null}
                        {updateInstallBlocked && updateState.status === "available" ? (
                          <small>当前任务或模型下载完成后才能安装更新。</small>
                        ) : null}
                      </div>
                      {updateState.status === "downloading" || updateState.status === "installing" ? (
                        <div className="update-progress">
                          <div className="progress-track">
                            <span
                              className="progress-fill video_transcribing"
                              style={{ width: `${updateState.progress}%` }}
                            />
                          </div>
                          <small>{formatProgressPercent(updateState.progress)}</small>
                        </div>
                      ) : null}
                    </div>
                    <div className="update-actions">
                      {inAppUpdates ? (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => checkForUpdates({ silent: false })}
                            disabled={updateBusy}
                          >
                            <RotateCcw size={15} />
                            <span>{updateState.status === "checking" ? "检查中" : "检查更新"}</span>
                          </button>
                          {updateState.status === "ready_to_restart" ? (
                            <button type="button" className="primary-button" onClick={restartForUpdate}>
                              <RotateCcw size={15} />
                              <span>重启完成更新</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="primary-button"
                              onClick={installUpdate}
                              disabled={
                                updateBusy ||
                                updateInstallBlocked ||
                                !["available", "postponed"].includes(updateState.status)
                              }
                            >
                              <Download size={15} />
                              <span>一键升级</span>
                            </button>
                          )}
                          {["available", "postponed"].includes(updateState.status) ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={postponeUpdateReminder}
                              disabled={updateBusy}
                            >
                              <span>稍后提醒</span>
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <button type="button" className="primary-button" onClick={() => void openReleases()}>
                          <Download size={15} />
                          <span>前往下载页</span>
                        </button>
                      )}
                    </div>
                    </section>
                  ) : null}

                  {settingsCategory === "advanced" ? (
                    <section id="settings-advanced" className="sheet-form-section settings-config-file-section">
                    <div className="form-section-heading">
                      <h3>本机配置文件</h3>
                      <p>高级本机设置保存在 app-local data 的 .env 文件中，LLM 配置仍由服务端统一管理。</p>
                    </div>
                    <div className="config-file-row">
                      <code title={settingsConfigPath}>{settingsConfigPath || "读取后显示配置文件路径"}</code>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={locateSettingsConfigFile}
                        disabled={settingsLoading || !settingsConfigPath}
                      >
                        <FolderOpen size={15} />
                        <span>定位文件</span>
                      </button>
                    </div>
                    </section>
                  ) : null}

                  {settingsNotice ? <p className="action-notice inline-notice">{settingsNotice}</p> : null}
                </div>
              </div>
            </form>
            <div className="settings-actions sheet-footer">
              <button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>
                <span>关闭</span>
              </button>
              <button
                className="primary-button"
                type="submit"
                form="settings-form"
                disabled={settingsLoading || settingsSaving}
              >
                <span>{settingsSaving ? "保存中" : "保存配置"}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
