import { FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
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
  Lightbulb,
  LoaderCircle,
  Play,
  RotateCcw,
  Settings,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  canSubmitUrl,
  cancelProcessing,
  createInitialWorkflow,
  getDetailText,
  getExportPath,
  getProgressSteps,
  getResultCards,
  getVisibleWorkflowError,
  isProcessingStage,
  mergeProgressEvent,
  normalizeSubmitUrl,
  startProcessing,
  startInsightRetry,
  summarizeWorkerResult,
  type DetailTab,
  type ResultCard,
  type WorkflowState,
} from "./workflow";
import { cancelProcess, processVideo, retryInsights } from "./workerClient";
import {
  getLlmConfig,
  saveLlmConfig,
  type LlmConfigDraft,
} from "./settingsClient";
import { getHistory, historyItemToWorkerResult, type HistoryItem } from "./historyClient";
import type { UpdateState } from "./updateState";
import {
  beginAuthFlow,
  completeAuthFlow,
  getAccountStatus,
  logoutAccount,
  redeemActivationCode,
} from "./accountClient";
import {
  canProcessWithAccount,
  createAccountStatusFailure,
  createBrowserPreviewAccountStatus,
  createGuestAccountStatus,
  isBrowserPreviewRuntime,
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
import { ModelGuideSheet } from "./features/asrModel/ModelGuideSheet";
import { useAsrModelDownload } from "./features/asrModel/useAsrModelDownload";
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
  transcriptTextFromSegments,
  updateTranscriptSegmentText,
} from "./transcriptReviewState";

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
    body: "正在使用云端 LLM 生成要点总结和启发话题点。",
  },
  completed: {
    title: "文字稿完成",
    body: "视频、音频和文字稿已准备好；话题点可单独确认生成。",
  },
  partial_completed: {
    title: "部分完成",
    body: "文字稿已生成，话题点稍后可以重试。",
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
  insights_generating: "正在进行 AI 整理",
  completed: "视频、音频和文字稿已可查看",
  partial_completed: "文字稿已保留，可重试话题点",
  failed: "处理未完成，请查看原因",
};

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

  if (!account.llmConfigured) {
    return "启发话题点 LLM 尚未由管理员配置完成，请稍后再试。";
  }

  if (account.llmQuotaRemaining <= 0) {
    return "启发话题点次数已用完，请联系管理员补充额度或兑换新的激活码。";
  }

  return `当前账号暂不能${actionLabel}，请刷新账号状态后重试。`;
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

function App() {
  const [workflow, setWorkflow] = useState(createInitialWorkflow);
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [insightConfirmOpen, setInsightConfirmOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [transcriptDetail, setTranscriptDetail] = useState<TranscriptDetailResponse | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [activeTranscriptSegmentId, setActiveTranscriptSegmentId] = useState<string | null>(null);
  const [editingTranscriptSegmentId, setEditingTranscriptSegmentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<LlmConfigDraft>({
    outputDir: "",
    asrModel: "iic/SenseVoiceSmall",
  });
  const [settingsSupportedAsrModels, setSettingsSupportedAsrModels] = useState(defaultAsrModels);
  const [settingsConfigPath, setSettingsConfigPath] = useState("");
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
  const [account, setAccount] = useState<AccountStatus>(createGuestAccountStatus);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountNotice, setAccountNotice] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [activationCodeDraft, setActivationCodeDraft] = useState("");
  const [activationRedeeming, setActivationRedeeming] = useState(false);
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

      if (insightConfirmOpen) {
        setInsightConfirmOpen(false);
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
  }, [detailTab, historyOpen, insightConfirmOpen, settingsOpen, modelGuideOpen, modelDownloadActive]);

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
    void refreshAccountStatus();
  }, []);

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
  }, []);

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
          detail.audio_path
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

  async function refreshAccountStatus() {
    setAccountLoading(true);
    try {
      const status = await getAccountStatus();
      setAccount(status);
      setAccountNotice(status.serverError ? `账号状态刷新失败：${status.serverError}` : "");
    } catch (error) {
      if (isBrowserPreviewRuntime()) {
        setAccount(createBrowserPreviewAccountStatus());
        setAccountNotice("浏览器预览模式：使用本地模拟账号。");
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      const serverError = message || "账号状态刷新失败";
      setAccount(createAccountStatusFailure(serverError));
      setAccountNotice(`账号状态刷新失败：${serverError}`);
    } finally {
      setAccountLoading(false);
    }
  }

  async function handleAuthCallback(callbackUrl: string) {
    if (!callbackUrl.startsWith("frameq://auth/callback")) {
      return;
    }
    setAccountOpen(true);
    setAccountLoading(true);
    setAccountNotice("正在完成登录...");
    try {
      await completeAuthFlow(callbackUrl);
      await refreshAccountStatus();
      setAccountNotice("登录已完成。");
    } catch (error) {
      setAccountNotice(`登录失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAccountLoading(false);
    }
  }

  function openAccountPanel(notice?: string) {
    setAccountOpen(true);
    setAccountNotice(notice ?? "");
    void refreshAccountStatus();
  }

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
    setInsightConfirmOpen(false);
    setActionNotice("");
    setWorkflow(createInitialWorkflow());
  }

  function resetOrCancelWorkflow() {
    if (isProcessingStage(workflow.stage)) {
      void cancelCurrentProcessing();
      return;
    }

    resetWorkflow();
  }

  async function cancelCurrentProcessing() {
    operationIdRef.current += 1;
    setDetailTab(null);
    setInsightConfirmOpen(false);
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
      setInsightConfirmOpen(true);
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

  function confirmInsightGeneration() {
    setInsightConfirmOpen(false);
    void retryInsightGeneration();
  }

  async function retryInsightGeneration() {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      return;
    }
    if (!canProcessWithAccount(account)) {
      openAccountPanel(accountProcessBlockerMessage(account, "生成要点总结和启发话题点"));
      return;
    }

    const taskId = workflow.taskId;
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setDetailTab(null);
    setActionNotice("");
    setWorkflow((current) => startInsightRetry(current));

    const result = await retryInsights(taskId);
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

    setActiveTranscriptSegmentId(segment.id);
    const audio = transcriptAudioRef.current;
    if (!audio || !transcriptDetail?.audio_path) {
      setActionNotice("当前任务没有可播放的本地音频，只能编辑文字稿。");
      return;
    }

    audio.currentTime = segment.start_ms / 1000;
    try {
      await audio.play();
    } catch {
      setActionNotice("音频无法自动播放，请手动点击播放器继续。");
    }
  }

  function handleTranscriptTimeUpdate() {
    const audio = transcriptAudioRef.current;
    if (!audio || editingTranscriptSegmentId) {
      return;
    }
    const activeId = findActiveTranscriptSegmentId(transcriptSegments, audio.currentTime);
    if (activeId) {
      setActiveTranscriptSegmentId(activeId);
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
    setSettingsOpen(true);
    await loadSettings();
  }

  async function startLoginFlow() {
    setAccountLoading(true);
    setAccountNotice("正在打开登录页面...");
    try {
      const auth = await beginAuthFlow();
      await openUrl(auth.authUrl);
      setAccountNotice("登录页面已打开。请在浏览器中输入邮箱验证码，完成后会自动回到 FrameQ。");
    } catch (error) {
      setAccountNotice(`无法开始登录：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAccountLoading(false);
    }
  }

  async function redeemActivationCodeFromInput() {
    const code = activationCodeDraft.trim();
    if (!code) {
      setAccountNotice("请输入激活码。");
      return;
    }
    setActivationRedeeming(true);
    setAccountNotice("");
    try {
      const status = await redeemActivationCode(code);
      setAccount(status);
      setActivationCodeDraft("");
      setAccountNotice("激活成功，授权已生效。");
    } catch (error) {
      setAccountNotice(`激活失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActivationRedeeming(false);
    }
  }

  async function signOutAccount() {
    setAccountLoading(true);
    try {
      await logoutAccount();
      if (isProcessingStage(workflow.stage)) {
        void cancelProcess();
      }
      resetWorkflow();
      setAccount(createGuestAccountStatus());
      setActivationCodeDraft("");
      setAccountNotice("");
      setAccountOpen(false);
    } catch (error) {
      setAccountNotice(`退出登录失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAccountLoading(false);
    }
  }

  async function loadSettings(successNotice?: string) {
    setSettingsLoading(true);
    setSettingsNotice("正在读取配置。");
    try {
      const config = await getLlmConfig();
      setSettingsDraft({
        outputDir: config.outputDir,
        asrModel: config.asrModel,
      });
      setSettingsSupportedAsrModels(
        config.supportedAsrModels.length > 0 ? config.supportedAsrModels : defaultAsrModels,
      );
      setSettingsConfigPath(config.configPath);
      setSettingsNotice(successNotice ?? "已读取本机 ASR 与输出目录设置。");
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
    detailTab === "insights" ? "启发话题点" : detailTab === "summary" ? "要点总结" : "完整文字稿";
  const detailText =
    detailTab === "transcript" ? transcriptDraft : detailTab ? getDetailText(detailTab, workflow) : "";
  const exportPath = detailTab ? getExportPath(detailTab, workflow) : null;
  const currentTranscriptPath = getExportPath("transcript", workflow);
  const transcriptAudioSrc = transcriptDetail?.audio_path
    ? convertFileSrc(transcriptDetail.audio_path)
    : "";
  const hasTranscriptSegments = transcriptSegments.length > 0;
  const accountHasActiveEntitlement =
    account.authenticated && account.entitlementStatus === "active";
  const accountChipLabel = canProcessWithAccount(account)
    ? "授权有效"
    : account.authenticated
      ? accountHasActiveEntitlement
        ? account.llmConfigured
          ? "次数不足"
          : "待配置"
        : "激活"
      : "登录";
  const accountStatusText = canProcessWithAccount(account)
    ? `授权有效${account.entitlementExpiresAt ? `至 ${formatHistoryDate(account.entitlementExpiresAt)}` : ""}`
    : account.authenticated
      ? accountHasActiveEntitlement
        ? account.llmConfigured
          ? "话题点次数不足"
          : "等待管理员配置 LLM"
        : "未激活"
      : "未登录";
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
              <p className="eyebrow" data-tauri-drag-region="">FrameQ</p>
              <h1 data-tauri-drag-region="">视频转文字</h1>
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
              onClick={resetOrCancelWorkflow}
              aria-label="处理新 URL"
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
                      <span>取消</span>
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
        onClose={() => setAccountOpen(false)}
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

      {insightConfirmOpen ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setInsightConfirmOpen(false)}>
          <section
            className="sheet-panel detail-modal insight-confirm-modal insight-confirm-sheet"
            aria-label="生成要点总结和启发话题点"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">AI organize</p>
                <h2>生成要点总结和启发话题点</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setInsightConfirmOpen(false)} aria-label="关闭确认面板">
                <X size={18} />
              </button>
            </header>
            <div className="insight-confirm-content">
              <p className="settings-warning privacy-callout">
                <ShieldCheck size={16} />
                <span>确认后会使用管理员配置的云端 LLM 生成要点总结和启发话题点，文字稿片段会发送到该服务，并消耗 1 次话题点额度。</span>
              </p>
              <div className="confirm-summary">
                <div>
                  <span className="account-status-label">当前文字稿</span>
                  <strong>{workflow.text ? `${workflow.text.length.toLocaleString("zh-CN")} 字` : "等待文字稿"}</strong>
                  <small>{currentTranscriptPath || "文字稿文件生成后才能继续。"}</small>
                </div>
                <div>
                  <span className="account-status-label">账号额度</span>
                  <strong>{account.llmQuotaRemaining} 次可用</strong>
                  <small>生成开始时扣除 1 次；视频、音频和文字稿不会重新处理。</small>
                </div>
              </div>
            </div>
            <div className="settings-actions sheet-footer">
              <button type="button" className="secondary-button" onClick={() => setInsightConfirmOpen(false)}>
                <span>取消</span>
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={confirmInsightGeneration}
                disabled={!workflow.taskId || !workflow.artifacts.transcript_txt || isProcessingStage(workflow.stage)}
              >
                <Lightbulb size={16} />
                <span>确认</span>
              </button>
            </div>
          </section>
        </div>
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
                启发话题点
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
                <button type="button" onClick={exportDetail} disabled={!exportPath}>
                  <Download size={16} />
                  <span>导出</span>
                </button>
              </div>
            </div>
            {actionNotice ? <p className="action-notice">{actionNotice}</p> : null}
            <div className="modal-content">
              {detailTab === "summary" ? (
                <p>{workflow.summary || "要点总结生成后将在这里显示。"}</p>
              ) : detailTab === "insights" ? (
                workflow.insights.length > 0 ? (
                  <ol>
                    {workflow.insights.map((insight) => (
                      <li key={insight}>{insight}</li>
                    ))}
                  </ol>
                ) : (
                  <p>话题点尚未生成。</p>
                )
              ) : (
                <div className="transcript-review">
                  {transcriptLoading ? (
                    <p className="transcript-status">正在读取文字稿详情...</p>
                  ) : null}
                  {transcriptAudioSrc ? (
                    <audio
                      ref={transcriptAudioRef}
                      className="transcript-audio"
                      controls
                      src={transcriptAudioSrc}
                      onTimeUpdate={handleTranscriptTimeUpdate}
                    />
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
                              disabled={!transcriptDetail?.audio_path || Boolean(editingTranscriptSegmentId)}
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
                    <span>{item.error ? item.error.code : `${item.insightsCount} 个话题点`}</span>
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
              <p className="settings-warning privacy-callout">
                <ShieldCheck size={16} />
                <span>
                  这里仅管理本机 ASR 模型和输出目录。启发话题点 LLM 由管理员在服务端统一配置，客户端无需手动填写 API Key。
                </span>
              </p>

              <section className="sheet-form-section">
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

              <section className="sheet-form-section settings-config-file-section">
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

              <section className="sheet-form-section update-settings-section">
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

              {settingsNotice ? <p className="action-notice">{settingsNotice}</p> : null}
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
