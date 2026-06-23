import { FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { listen, type Event } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Download,
  FileText,
  Film,
  FolderOpen,
  History as HistoryIcon,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  canSubmitUrl,
  cancelProcessing,
  createInitialWorkflow,
  formatWorkerError,
  getDetailText,
  getExportPath,
  getProgressSteps,
  getResultCards,
  getVisibleWorkflowError,
  isProcessingStage,
  mergeProgressEvent,
  startProcessing,
  startInsightRetry,
  summarizeWorkerResult,
  type DetailTab,
  type ResultCard,
  type WorkflowState,
} from "./workflow";
import { cancelProcess, processVideo, retryInsights } from "./workerClient";
import {
  ASR_MODEL_DOWNLOAD_PROGRESS_EVENT,
  cancelAsrModelDownload,
  checkFirstRun,
  downloadAsrModel,
  getLlmConfig,
  saveLlmConfig,
  type AsrModelDownloadProgress,
  type FirstRunStatus,
  type LlmConfigDraft,
} from "./settingsClient";
import { getHistory, historyItemToWorkerResult, type HistoryItem } from "./historyClient";
import {
  checkForAppUpdate,
  createDefaultUpdatePreferences,
  getUpdatePreferences,
  installAppUpdate,
  relaunchApp,
  saveUpdatePreferences,
  type AppUpdateInfo,
  type UpdatePreferences,
} from "./updateClient";
import {
  applyUpdateDownloadEvent,
  createInitialUpdateState,
  failUpdate,
  isUpdateInstallBlocked,
  markUpdateAvailable,
  markUpdateReadyToRestart,
  markUpdateUpToDate,
  postponeUpdate,
  startUpdateCheck,
  startUpdateDownload,
  type UpdateState,
} from "./updateState";
import { isModelDownloadStalled, shouldApplyModelDownloadUpdate } from "./modelDownloadState";
import {
  beginAuthFlow,
  completeAuthFlow,
  getAccountStatus,
  logoutAccount,
  redeemActivationCode,
} from "./accountClient";
import { canProcessWithAccount, createGuestAccountStatus, type AccountStatus } from "./accountState";
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
    title: "话题点生成中",
    body: "正在使用 InsightFlow 从文字稿中提炼启发话题点。",
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

type AsrModelStatus = {
  model: string;
  modelDir: string;
  available: boolean;
  source: string;
};

const defaultAsrModelStatus: AsrModelStatus = {
  model: "iic/SenseVoiceSmall",
  modelDir: "",
  available: false,
  source: "modelscope",
};

const stageSummary: Record<WorkflowState["stage"], string> = {
  waiting_input: "准备接收一个公开视频链接",
  video_extracting: "正在准备媒体文件",
  video_transcribing: "正在生成本地文字稿",
  insights_generating: "正在生成启发话题点",
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

function getResultMeta(card: ResultCard, workflow: WorkflowState): string {
  if (card.id === "video") {
    return workflow.videoPath ? "已下载，可定位文件" : "等待视频文件";
  }

  if (card.id === "audio") {
    return workflow.audioPath ? "WAV 音频，可定位文件" : "等待音频文件";
  }

  if (card.id === "insights") {
    if (card.status === "pending") {
      return "待生成，需单独确认";
    }

    if (card.status === "failed") {
      return "生成失败，可重新确认";
    }

    return `${workflow.insights.length} 个话题点`;
  }

  if (!workflow.text) {
    return "等待文字稿";
  }

  return `${workflow.text.length.toLocaleString("zh-CN")} 字`;
}

function getResultActionLabel(card: ResultCard): string {
  if (card.action === "locate") {
    return "定位文件";
  }

  if (card.action === "confirm") {
    return card.status === "failed" ? "重新生成" : "确认生成";
  }

  return "打开详情";
}

function renderResultIcon(card: ResultCard) {
  if (card.id === "video") {
    return <Film size={22} />;
  }

  if (card.id === "audio") {
    return <Volume2 size={22} />;
  }

  if (card.id === "insights") {
    return <Lightbulb size={22} />;
  }

  return <FileText size={22} />;
}

function parseAsrModelDownloadProgress(payload: unknown): AsrModelDownloadProgress | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const event = payload as Partial<AsrModelDownloadProgress>;
  if (
    typeof event.status !== "string" ||
    typeof event.message !== "string" ||
    typeof event.progress !== "number"
  ) {
    return null;
  }

  return {
    status: event.status,
    message: event.message,
    progress: Math.max(0, Math.min(100, event.progress)),
    currentFile:
      typeof event.currentFile === "string"
        ? event.currentFile
        : typeof (event as { current_file?: unknown }).current_file === "string"
          ? (event as { current_file: string }).current_file
          : undefined,
  };
}

function asrModelSourceLabel(source: string): string {
  return source === "custom_url" ? "自定义下载源" : "ModelScope";
}

function accountProcessBlockerMessage(account: AccountStatus, actionLabel: string): string {
  if (!account.authenticated) {
    return `请先登录 FrameQ 账号后再${actionLabel}。`;
  }

  if (account.entitlementStatus !== "active") {
    return `请先输入激活码激活 FrameQ 月卡后再${actionLabel}。`;
  }

  if (!account.llmConfigured) {
    return "启发话题点 LLM 尚未由管理员配置完成，请稍后再试。";
  }

  if (account.llmQuotaRemaining <= 0) {
    return "本月启发话题点次数已用完，请联系管理员补充额度或兑换新的激活码。";
  }

  return `当前账号暂不能${actionLabel}，请刷新账号状态后重试。`;
}

function isUpdateBusy(status: UpdateState["status"]): boolean {
  return status === "checking" || status === "downloading" || status === "installing";
}

function isUpdateActionVisible(status: UpdateState["status"]): boolean {
  return ["available", "downloading", "installing", "ready_to_restart"].includes(status);
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
  const [detailSearch, setDetailSearch] = useState("");
  const [actionNotice, setActionNotice] = useState("");
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
  const [modelGuideOpen, setModelGuideOpen] = useState(false);
  const [asrModelStatus, setAsrModelStatus] = useState<AsrModelStatus>(defaultAsrModelStatus);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<AsrModelDownloadProgress>({
    status: "idle",
    message: "",
    progress: 0,
  });
  const [modelDownloadNotice, setModelDownloadNotice] = useState("");
  const [modelDownloadStalled, setModelDownloadStalled] = useState(false);
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
  const [updateState, setUpdateState] = useState(createInitialUpdateState);
  const operationIdRef = useRef(0);
  const modelDownloadOperationIdRef = useRef(0);
  const cancelledModelDownloadOperationIdRef = useRef<number | null>(null);
  const modelDownloadProgressUpdatedAtRef = useRef(Date.now());
  const updateInfoRef = useRef<AppUpdateInfo | null>(null);
  const updatePreferencesRef = useRef<UpdatePreferences>(createDefaultUpdatePreferences());
  const windowDragSessionRef = useRef<WindowDragSession | null>(null);
  const queuedWindowPositionRef = useRef<WindowPosition | null>(null);
  const windowMoveInFlightRef = useRef(false);
  const canSubmit = canSubmitUrl(workflow.url);
  const progressSteps = useMemo(() => getProgressSteps(workflow), [workflow]);
  const resultCards = useMemo(() => getResultCards(workflow), [workflow]);
  const visibleWorkflowError = getVisibleWorkflowError(workflow);
  const modelDownloadActive = ["started", "downloading", "extracting"].includes(
    modelDownloadProgress.status,
  );
  const updateBusy = isUpdateBusy(updateState.status);
  const updateInstallBlocked = isUpdateInstallBlocked({
    processingActive: isProcessingStage(workflow.stage),
    modelDownloadActive,
  });

  useEffect(() => {
    if (!modelDownloadActive) {
      setModelDownloadStalled(false);
      return;
    }

    const interval = window.setInterval(() => {
      setModelDownloadStalled(
        isModelDownloadStalled({
          active: true,
          lastProgressAtMs: modelDownloadProgressUpdatedAtRef.current,
          nowMs: Date.now(),
        }),
      );
    }, 5_000);

    return () => window.clearInterval(interval);
  }, [modelDownloadActive]);

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
        const firstRun = await checkFirstRun();
        if (cancelled) {
          return;
        }

        updateAsrModelStatus(firstRun);
        if (!firstRun.asrModelAvailable) {
          setModelGuideOpen(true);
          setModelDownloadNotice(
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
  }, []);

  useEffect(() => {
    void refreshAccountStatus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadPreferencesAndCheckForUpdates(() => cancelled);
    }, 2_500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
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

  async function refreshAccountStatus() {
    setAccountLoading(true);
    try {
      const status = await getAccountStatus();
      setAccount(status);
      setAccountNotice(status.serverError ? `账号状态刷新失败：${status.serverError}` : "");
    } catch {
      setAccount({
        authenticated: true,
        email: "browser-preview@frameq.local",
        entitlementStatus: "active",
        entitlementExpiresAt: null,
        llmQuotaLimit: 20,
        llmQuotaUsed: 0,
        llmQuotaRemaining: 20,
        llmQuotaResetsAt: null,
        llmConfigured: true,
        lastVerifiedAt: null,
        canProcess: true,
        serverError: "Browser preview fallback",
      });
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

  function updateAsrModelStatus(status: FirstRunStatus) {
    setAsrModelStatus({
      model: status.asrModel,
      modelDir: status.asrModelDir,
      available: status.asrModelAvailable,
      source: status.asrModelSource,
    });
  }

  async function refreshAsrModelStatus(): Promise<FirstRunStatus> {
    const status = await checkFirstRun();
    updateAsrModelStatus(status);
    return status;
  }

  async function startAsrModelDownload() {
    if (modelDownloadActive) {
      return;
    }

    const operationId = modelDownloadOperationIdRef.current + 1;
    modelDownloadOperationIdRef.current = operationId;
    cancelledModelDownloadOperationIdRef.current = null;
    setModelGuideOpen(true);
    setModelDownloadNotice("");
    setModelDownloadStalled(false);
    modelDownloadProgressUpdatedAtRef.current = Date.now();
    setModelDownloadProgress({
      status: "started",
      message: "正在准备下载 ASR 模型。",
      progress: 0,
    });

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen(ASR_MODEL_DOWNLOAD_PROGRESS_EVENT, (event: Event<unknown>) => {
        const progress = parseAsrModelDownloadProgress(event.payload);
        if (
          progress &&
          shouldApplyModelDownloadUpdate({
            operationId,
            activeOperationId: modelDownloadOperationIdRef.current,
            cancelledOperationId: cancelledModelDownloadOperationIdRef.current,
          })
        ) {
          modelDownloadProgressUpdatedAtRef.current = Date.now();
          setModelDownloadStalled(false);
          setModelDownloadProgress(progress);
        }
      });

      await downloadAsrModel();
      if (
        !shouldApplyModelDownloadUpdate({
          operationId,
          activeOperationId: modelDownloadOperationIdRef.current,
          cancelledOperationId: cancelledModelDownloadOperationIdRef.current,
        })
      ) {
        return;
      }
      const status = await refreshAsrModelStatus();
      if (
        !shouldApplyModelDownloadUpdate({
          operationId,
          activeOperationId: modelDownloadOperationIdRef.current,
          cancelledOperationId: cancelledModelDownloadOperationIdRef.current,
        })
      ) {
        return;
      }
      if (status.asrModelAvailable) {
        setModelDownloadStalled(false);
        setModelDownloadProgress({
          status: "completed",
          message: "ASR 模型已下载完成。",
          progress: 100,
        });
        setModelDownloadNotice("ASR 模型已可用，后续转写会使用本地缓存。");
      } else {
        setModelDownloadStalled(false);
        setModelDownloadProgress((current) => ({
          status: "failed",
          message: "模型下载未完成。",
          progress: current.progress,
        }));
        setModelDownloadNotice("模型下载未完成，请稍后重试。");
      }
    } catch (error) {
      if (
        !shouldApplyModelDownloadUpdate({
          operationId,
          activeOperationId: modelDownloadOperationIdRef.current,
          cancelledOperationId: cancelledModelDownloadOperationIdRef.current,
        })
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setModelDownloadStalled(false);
      setModelDownloadProgress((current) => ({
        status: "failed",
        message,
        progress: current.progress,
      }));
      setModelDownloadNotice(`下载失败：${message}`);
    } finally {
      if (unlisten) {
        unlisten();
      }
    }
  }

  async function cancelCurrentAsrModelDownload() {
    try {
      const operationId = modelDownloadOperationIdRef.current;
      const result = await cancelAsrModelDownload();
      if (result.cancelled) {
        cancelledModelDownloadOperationIdRef.current = operationId;
      }
      setModelDownloadProgress((current) => ({
        status: result.cancelled ? "cancelled" : current.status,
        message: result.cancelled ? "模型下载已取消。" : result.error || "当前没有正在下载的模型。",
        progress: result.cancelled ? 0 : current.progress,
      }));
      setModelDownloadStalled(false);
      setModelDownloadNotice(result.cancelled ? "模型下载已取消。" : result.error || "当前没有正在下载的模型。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModelDownloadStalled(false);
      setModelDownloadNotice(`取消失败：${message}`);
    }
  }

  function persistUpdatePreferences(patch: Partial<UpdatePreferences>) {
    const next = {
      ...updatePreferencesRef.current,
      ...patch,
    };
    updatePreferencesRef.current = next;
    void saveUpdatePreferences(next).catch((error) => {
      console.warn("Failed to save update preferences", error);
    });
  }

  async function loadPreferencesAndCheckForUpdates(isCancelled: () => boolean) {
    try {
      const preferences = await getUpdatePreferences();
      if (isCancelled()) {
        return;
      }
      updatePreferencesRef.current = preferences;
      if (preferences.postponedUntil && preferences.postponedUntil > Date.now()) {
        return;
      }
    } catch (error) {
      console.warn("Failed to load update preferences", error);
    }

    if (!isCancelled()) {
      await checkForUpdates({ silent: true, isCancelled });
    }
  }

  async function checkForUpdates(options: { silent?: boolean; isCancelled?: () => boolean } = {}) {
    if (!options.silent) {
      persistUpdatePreferences({ postponedUntil: null });
    }
    setUpdateState((current) => startUpdateCheck(current));
    try {
      const update = await checkForAppUpdate();
      if (options.isCancelled?.()) {
        return;
      }

      if (!update) {
        updateInfoRef.current = null;
        persistUpdatePreferences({
          lastCheckedAt: new Date().toISOString(),
          skippedVersion: null,
        });
        setUpdateState((current) =>
          options.silent ? createInitialUpdateState() : markUpdateUpToDate(current),
        );
        return;
      }

      updateInfoRef.current = update;
      persistUpdatePreferences({
        lastCheckedAt: new Date().toISOString(),
        skippedVersion: null,
      });
      setUpdateState((current) =>
        markUpdateAvailable(current, {
          version: update.version,
          notes: update.notes,
        }),
      );
    } catch (error) {
      if (options.isCancelled?.()) {
        return;
      }

      if (options.silent) {
        setUpdateState(createInitialUpdateState());
        return;
      }

      setUpdateState((current) => failUpdate(current, error));
    }
  }

  async function installUpdate() {
    if (updateState.status === "ready_to_restart") {
      await restartForUpdate();
      return;
    }

    if (updateInstallBlocked) {
      setUpdateState((current) => ({
        ...current,
        message: "当前任务或模型下载完成后再安装更新。",
      }));
      return;
    }

    let update = updateInfoRef.current;
    if (!update) {
      await checkForUpdates({ silent: false });
      update = updateInfoRef.current;
    }

    if (!update) {
      return;
    }

    setUpdateState((current) => startUpdateDownload(current));
    try {
      await installAppUpdate(update, (event) => {
        setUpdateState((current) => applyUpdateDownloadEvent(current, event));
      });
      setUpdateState((current) => markUpdateReadyToRestart(current));
    } catch (error) {
      setUpdateState((current) => failUpdate(current, error));
    }
  }

  function postponeUpdateReminder() {
    const next = postponeUpdate(updateState, 24 * 60 * 60 * 1000);
    setUpdateState(next);
    persistUpdatePreferences({
      postponedUntil: next.postponedUntil,
      skippedVersion: null,
    });
  }

  async function restartForUpdate() {
    try {
      await relaunchApp();
    } catch (error) {
      setUpdateState((current) => failUpdate(current, error));
    }
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
    const submittedUrl = workflow.url;
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
      setDetailSearch("");
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
    if (!workflow.transcriptPath) {
      return;
    }
    if (!canProcessWithAccount(account)) {
      openAccountPanel(accountProcessBlockerMessage(account, "重试话题点生成"));
      return;
    }

    const transcriptPath = workflow.transcriptPath;
    const transcriptText = workflow.text;
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setDetailTab(null);
    setActionNotice("");
    setWorkflow((current) => startInsightRetry(current));

    const result = await retryInsights(transcriptPath, transcriptText);
    if (operationIdRef.current !== operationId) {
      return;
    }
    setWorkflow((current) => ({
      ...summarizeWorkerResult({
        ...result,
        video_path: result.video_path ?? current.videoPath,
        audio_path: result.audio_path ?? current.audioPath,
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
    const text = getDetailText(detailTab, workflow);
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
    setDetailTab(item.insights.length > 0 ? "insights" : item.text ? "transcript" : null);
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
      setAccountNotice("激活成功，月卡已生效。");
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
  const detailTitle = detailTab === "insights" ? "启发话题点" : "完整文字稿";
  const detailText = detailTab ? getDetailText(detailTab, workflow) : "";
  const exportPath = detailTab ? getExportPath(detailTab, workflow) : null;
  const searchQuery = detailSearch.trim().toLocaleLowerCase();
  const visibleInsights = searchQuery
    ? workflow.insights.filter((insight) => insight.toLocaleLowerCase().includes(searchQuery))
    : workflow.insights;
  const visibleTranscript =
    searchQuery && workflow.text
      ? workflow.text
          .split(/\n+/)
          .filter((line) => line.toLocaleLowerCase().includes(searchQuery))
          .join("\n")
      : workflow.text;
  const accountHasActiveEntitlement =
    account.authenticated && account.entitlementStatus === "active";
  const accountChipLabel = canProcessWithAccount(account)
    ? "月卡有效"
    : account.authenticated
      ? accountHasActiveEntitlement
        ? account.llmConfigured
          ? "次数不足"
          : "待配置"
        : "激活"
      : "登录";
  const accountStatusText = canProcessWithAccount(account)
    ? `月卡有效${account.entitlementExpiresAt ? `至 ${formatHistoryDate(account.entitlementExpiresAt)}` : ""}`
    : account.authenticated
      ? accountHasActiveEntitlement
        ? account.llmConfigured
          ? "话题点次数不足"
          : "等待管理员配置 LLM"
        : "未激活月卡"
      : "未登录";
  const updateToolbarVisible = isUpdateActionVisible(updateState.status);
  const updateSpinnerVisible = updateState.status === "downloading" || updateState.status === "installing";

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
              aria-label="账号与月卡"
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

          {!workflow.showUrlInput ? (
            <section className="result-workspace result-area" aria-label="结果总览">
              <div className="result-header">
                <div>
                  <p className="section-label">Results</p>
                  <h2>结果工作区</h2>
                </div>
              </div>

              {visibleWorkflowError ? (
                <div className="error-result">
                  <AlertTriangle size={20} />
                  <div>
                    <strong>{visibleWorkflowError.code}</strong>
                    <span>{formatWorkerError(visibleWorkflowError)}</span>
                    <small>
                      失败阶段：{stageCopy[visibleWorkflowError.stage]?.title ?? visibleWorkflowError.stage}
                    </small>
                  </div>
                </div>
              ) : null}

              {resultCards.length > 0 ? (
                <div className="result-grid">
                  {resultCards.map((card) => (
                    <button
                      className={`result-card result-tile ${card.status}`}
                      key={card.id}
                      type="button"
                      onClick={() => openCard(card)}
                    >
                      <span className="result-icon">
                        {renderResultIcon(card)}
                      </span>
                      <span>{card.title}</span>
                      <small>{getResultMeta(card, workflow)}</small>
                      <em>{getResultActionLabel(card)}</em>
                    </button>
                  ))}
                </div>
              ) : !visibleWorkflowError ? (
                <div className="result-placeholder empty-result">
                  <div className="placeholder-icon">
                    <FileText size={20} />
                  </div>
                  <div>
                    <strong>结果生成中</strong>
                    <span>
                      {workflow.stage === "insights_generating" && workflow.text
                        ? "文字稿已保留，正在重新生成话题点。"
                        : "视频提取完成后将开始转译。"}
                    </span>
                  </div>
                </div>
              ) : null}
              {actionNotice ? <p className="action-notice result-action-notice">{actionNotice}</p> : null}
            </section>
          ) : null}
        </section>
      </section>

      {accountOpen ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setAccountOpen(false)}>
          <section
            className="sheet-panel detail-modal account-modal account-sheet"
            aria-label="账号与月卡"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">Account</p>
                <h2>账号与月卡</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setAccountOpen(false)} aria-label="关闭账号面板">
                <X size={18} />
              </button>
            </header>
            <div className="account-content">
              <p className="settings-warning privacy-callout">
                <ShieldCheck size={16} />
                <span>账号服务只验证登录、激活码、月卡和话题点次数；视频、音频、文字稿和历史记录仍保留在本机，LLM 配置由管理员统一管理。</span>
              </p>
              <div className={`account-status-card ${canProcessWithAccount(account) ? "active" : "inactive"}`}>
                <div>
                  <span className="account-status-label">{accountStatusText}</span>
                  <strong>{account.email ?? "FrameQ 账号"}</strong>
                  {account.serverError ? <small>{account.serverError}</small> : null}
                </div>
              </div>

              {account.authenticated ? (
                <div className="account-quota-grid">
                  <div>
                    <span className="account-status-label">话题点次数</span>
                    <strong>
                      {account.llmQuotaRemaining} / {account.llmQuotaLimit}
                    </strong>
                    <small>
                      {account.llmQuotaResetsAt
                        ? `随月卡到期重置：${formatHistoryDate(account.llmQuotaResetsAt)}`
                        : "激活月卡后获得次数"}
                    </small>
                  </div>
                  <div>
                    <span className="account-status-label">LLM 配置</span>
                    <strong>{account.llmConfigured ? "已就绪" : "待管理员配置"}</strong>
                    <small>客户端会在生成话题点前自动领取本次配置。</small>
                  </div>
                </div>
              ) : null}

              {account.authenticated && !canProcessWithAccount(account) ? (
                <div className="activation-panel">
                  <div>
                    <span className="account-status-label">激活码</span>
                    <strong>输入管理员发放的月卡激活码</strong>
                    <small>兑换成功后将为当前邮箱增加 31 天权益。</small>
                  </div>
                  <input
                    className="activation-code-input"
                    value={activationCodeDraft}
                    onChange={(event) => setActivationCodeDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void redeemActivationCodeFromInput();
                      }
                    }}
                    placeholder="FQ-XXXX-XXXX-XXXX-XXXX"
                    disabled={activationRedeeming}
                  />
                </div>
              ) : null}

              {accountNotice ? <p className="action-notice inline-notice">{accountNotice}</p> : null}
            </div>
            <div className="settings-actions sheet-footer">
              {account.authenticated ? (
                <button type="button" className="secondary-button" onClick={signOutAccount} disabled={accountLoading}>
                  <span>退出登录</span>
                </button>
              ) : (
                <button type="button" className="secondary-button" onClick={() => setAccountOpen(false)}>
                  <span>稍后</span>
                </button>
              )}
              {account.authenticated ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={redeemActivationCodeFromInput}
                  disabled={activationRedeeming || canProcessWithAccount(account)}
                >
                  <KeyRound size={16} />
                  <span>{canProcessWithAccount(account) ? "月卡已生效" : activationRedeeming ? "兑换中" : "兑换激活码"}</span>
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={startLoginFlow} disabled={accountLoading}>
                  <UserRound size={16} />
                  <span>{accountLoading ? "登录中" : "邮箱登录"}</span>
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {modelGuideOpen ? (
        <div
          className="modal-backdrop sheet-backdrop"
          role="presentation"
          onClick={() => {
            if (!modelDownloadActive) {
              setModelGuideOpen(false);
            }
          }}
        >
          <section
            className="sheet-panel detail-modal model-guide-modal model-guide-sheet"
            aria-label="ASR 模型下载"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">ASR model</p>
                <h2>下载 ASR 模型</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setModelGuideOpen(false)}
                aria-label="关闭 ASR 模型下载"
                disabled={modelDownloadActive}
              >
                <X size={18} />
              </button>
            </header>
            <div className="model-guide-content">
              <p className="settings-warning privacy-callout">
                <ShieldCheck size={16} />
                <span>
                  ASR 在本机运行，首次使用前需要下载 ASR 模型缓存。下载完成后可离线转写。
                </span>
              </p>
              <div className="model-status-card">
                <div>
                  <span className={`model-status-badge ${asrModelStatus.available ? "ready" : "missing"}`}>
                    {asrModelStatus.available ? "已就绪" : "需要下载"}
                  </span>
                  <strong>{asrModelLabels[asrModelStatus.model] ?? asrModelStatus.model}</strong>
                  <small>来源：{asrModelSourceLabel(asrModelStatus.source)}</small>
                  <small>保存位置：{asrModelStatus.modelDir || "app-local data/models"}</small>
                </div>
              </div>
              <div className="model-download-progress">
                <div className="progress-summary compact">
                  <div>
                    <span className="progress-value">{formatProgressPercent(modelDownloadProgress.progress)}</span>
                    <p>{modelDownloadProgress.message || "等待开始下载。"}</p>
                  </div>
                  <div className="progress-track">
                    <span className="progress-fill video_transcribing" style={{ width: `${modelDownloadProgress.progress}%` }} />
                  </div>
                </div>
                {modelDownloadProgress.currentFile ? (
                  <small className="model-current-file">{modelDownloadProgress.currentFile}</small>
                ) : null}
              </div>
              {modelDownloadNotice ? <p className="action-notice inline-notice">{modelDownloadNotice}</p> : null}
              {!modelDownloadNotice && modelDownloadStalled ? (
                <p className="action-notice inline-notice">
                  下载进度暂时没有变化，可能是 ModelScope 网络较慢。可以继续等待，或取消后稍后重试。
                </p>
              ) : null}
            </div>
            <div className="settings-actions sheet-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setModelGuideOpen(false)}
                disabled={modelDownloadActive}
              >
                <span>稍后下载</span>
              </button>
              {modelDownloadActive ? (
                <button type="button" className="secondary-button danger-soft" onClick={cancelCurrentAsrModelDownload}>
                  <X size={16} />
                  <span>取消下载</span>
                </button>
              ) : (
                <button
                  className="primary-button"
                  type="button"
                  onClick={startAsrModelDownload}
                  disabled={asrModelStatus.available}
                >
                  <Download size={16} />
                  <span>{asrModelStatus.available ? "已下载" : "下载 ASR 模型"}</span>
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {insightConfirmOpen ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setInsightConfirmOpen(false)}>
          <section
            className="sheet-panel detail-modal insight-confirm-modal insight-confirm-sheet"
            aria-label="生成启发话题点"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">Insight topics</p>
                <h2>生成启发话题点</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setInsightConfirmOpen(false)} aria-label="关闭确认面板">
                <X size={18} />
              </button>
            </header>
            <div className="insight-confirm-content">
              <p className="settings-warning privacy-callout">
                <ShieldCheck size={16} />
                <span>确认后会使用管理员配置的云端 LLM 生成话题点，文字稿片段会发送到该服务，并消耗 1 次话题点额度。</span>
              </p>
              <div className="confirm-summary">
                <div>
                  <span className="account-status-label">当前文字稿</span>
                  <strong>{workflow.text ? `${workflow.text.length.toLocaleString("zh-CN")} 字` : "等待文字稿"}</strong>
                  <small>{workflow.transcriptPath || "文字稿文件生成后才能继续。"}</small>
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
                disabled={!workflow.transcriptPath || isProcessingStage(workflow.stage)}
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
                className={detailTab === "insights" ? "selected" : ""}
                type="button"
                onClick={() => {
                  setDetailSearch("");
                  setDetailTab("insights");
                }}
              >
                启发话题点
              </button>
              <button
                className={detailTab === "transcript" ? "selected" : ""}
                type="button"
                onClick={() => {
                  setDetailSearch("");
                  setDetailTab("transcript");
                }}
              >
                完整文字稿
              </button>
            </div>
            <div className="modal-tools">
              <label className="search-box">
                <Search size={16} />
                <input
                  value={detailSearch}
                  onChange={(event) => setDetailSearch(event.currentTarget.value)}
                  placeholder="搜索关键词..."
                />
              </label>
              <div className="tool-actions">
                <button type="button" onClick={copyDetail} disabled={!detailText}>
                  <Copy size={16} />
                  <span>复制</span>
                </button>
                <button type="button" onClick={exportDetail} disabled={!exportPath}>
                  <Download size={16} />
                  <span>导出</span>
                </button>
              </div>
            </div>
            {actionNotice ? <p className="action-notice">{actionNotice}</p> : null}
            <div className="modal-content">
              {detailTab === "insights" ? (
                workflow.insights.length > 0 ? (
                  visibleInsights.length > 0 ? (
                    <ol>
                      {visibleInsights.map((insight) => (
                        <li key={insight}>{insight}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>没有匹配的关键词。</p>
                  )
                ) : (
                  <p>话题点尚未生成。</p>
                )
              ) : (
                <p>{visibleTranscript || (searchQuery ? "没有匹配的关键词。" : "文字稿生成后将在这里显示。")}</p>
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
                      {updateStatusLabel(updateState)}
                    </span>
                    <strong>{updateState.availableVersion ? `FrameQ ${updateState.availableVersion}` : "FrameQ stable"}</strong>
                    <small>
                      {updateState.message ||
                        "启动后会自动静默检查更新，也可以在这里手动检查。"}
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
