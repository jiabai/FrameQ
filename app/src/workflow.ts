export type WorkflowStage =
  | "waiting_input"
  | "video_extracting"
  | "video_transcribing"
  | "insights_generating"
  | "completed"
  | "partial_completed"
  | "failed";

export type ProgressStepState = "pending" | "active" | "complete";

export type ProgressStep = {
  id: WorkflowStage;
  label: string;
  state: ProgressStepState;
};

export type ResultCard = {
  id: "video" | "audio" | "insights" | "transcript";
  title: string;
  status: "ready" | "pending" | "failed";
  action: "open" | "locate" | "confirm";
};

export type DetailTab = ResultCard["id"];

export type WorkerResult = {
  status: "completed" | "partial_completed" | "failed";
  video_path: string | null;
  audio_path: string | null;
  text: string;
  insights: string[];
  transcript_path: string | null;
  insights_path: string | null;
  error: WorkerErrorResult | null;
};

export type WorkerErrorResult = {
  code: string;
  message: string;
  stage: WorkflowStage;
};

export type WorkerProgressEvent = {
  stage: WorkflowStage;
  message: string;
  progress: number;
};

export type WorkflowState = {
  stage: WorkflowStage;
  url: string;
  submittedUrl: string;
  showUrlInput: boolean;
  statusMessage: string;
  progressPercent: number;
  text: string;
  insights: string[];
  videoPath: string | null;
  audioPath: string | null;
  transcriptPath: string | null;
  insightsPath: string | null;
  error: WorkerErrorResult | null;
};

const PROGRESS_STEP_LABELS: Array<Pick<ProgressStep, "id" | "label">> = [
  { id: "video_extracting", label: "视频提取中" },
  { id: "video_transcribing", label: "视频转译中" },
  { id: "insights_generating", label: "话题点生成中" },
];

export function createInitialWorkflow(): WorkflowState {
  return {
    stage: "waiting_input",
    url: "",
    submittedUrl: "",
    showUrlInput: true,
    statusMessage: "",
    progressPercent: 0,
    text: "",
    insights: [],
    videoPath: null,
    audioPath: null,
    transcriptPath: null,
    insightsPath: null,
    error: null,
  };
}

export function canSubmitUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol.toLowerCase())) {
      return false;
    }

    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (isDouyinHost(hostname)) {
      if (/^\/video\/\d+$/.test(normalizedPath)) {
        return true;
      }

      const shortCode = url.pathname.split("/").filter(Boolean);
      return (
        hostname === "v.douyin.com" &&
        shortCode.length === 1 &&
        /^[A-Za-z0-9_-]+$/.test(shortCode[0])
      );
    }

    return isXiaohongshuShortLink(hostname, normalizedPath);
  } catch {
    return false;
  }
}

function isDouyinHost(hostname: string): boolean {
  return hostname === "douyin.com" || hostname.endsWith(".douyin.com");
}

function isXiaohongshuShortLink(hostname: string, normalizedPath: string): boolean {
  return hostname === "xhslink.com" && /^\/o\/[A-Za-z0-9_-]+$/.test(normalizedPath);
}

export function startProcessing(state: WorkflowState, url: string): WorkflowState {
  return {
    ...state,
    stage: "video_extracting",
    url,
    submittedUrl: url,
    showUrlInput: false,
    statusMessage: "正在下载视频并准备媒体文件。",
    progressPercent: 12,
    text: "",
    insights: [],
    videoPath: null,
    audioPath: null,
    transcriptPath: null,
    insightsPath: null,
    error: null,
  };
}

export function startInsightRetry(state: WorkflowState): WorkflowState {
  return {
    ...state,
    stage: "insights_generating",
    showUrlInput: false,
    statusMessage: "正在重新生成启发话题点；如已配置云端 LLM，文字稿会发送到该服务。",
    progressPercent: 88,
    error: null,
  };
}

export function cancelProcessing(state: WorkflowState): WorkflowState {
  return {
    ...createInitialWorkflow(),
    url: state.submittedUrl || state.url,
  };
}

export function getProgressSteps(state: WorkflowState): ProgressStep[] {
  const activeIndex = PROGRESS_STEP_LABELS.findIndex((step) => step.id === state.stage);

  return PROGRESS_STEP_LABELS.map((step, index) => {
    if (state.stage === "completed" || state.stage === "partial_completed") {
      return { ...step, state: "complete" };
    }

    if (activeIndex === -1) {
      return { ...step, state: "pending" };
    }

    if (index < activeIndex) {
      return { ...step, state: "complete" };
    }

    return { ...step, state: index === activeIndex ? "active" : "pending" };
  });
}

export function isProcessingStage(stage: WorkflowStage): boolean {
  return (
    stage === "video_extracting" ||
    stage === "video_transcribing" ||
    stage === "insights_generating"
  );
}

export function formatWorkerError(error: WorkerErrorResult): string {
  if (error.code === "VIDEO_DOWNLOAD_FAILED") {
    return formatVideoDownloadError(error.message);
  }

  if (error.stage === "insights_generating") {
    return formatInsightGenerationError(error);
  }

  if (error.code === "ASR_MODEL_NOT_READY") {
    return "真实 ASR 尚未启用。请用 FRAMEQ_ALLOW_REAL_ASR=1 启动应用，并确认 models/ 模型缓存目录可写。";
  }

  if (error.code === "ASR_MODEL_CACHE_UNAVAILABLE") {
    return "模型缓存目录不可写。请检查 FRAMEQ_MODEL_DIR 或项目 models/ 目录权限。";
  }

  if (error.code === "ASR_MODEL_NOT_DOWNLOADED") {
    return "ASR 模型尚未下载。请先在首启引导或设置中下载 ASR 模型，然后重新转写。";
  }

  return error.message;
}

function formatVideoDownloadError(message: string): string {
  const rawSummary = summarizeRawError(message);
  const lowerMessage = rawSummary.toLowerCase();
  let guidance = "视频下载失败，请确认链接可公开访问后重试。";

  if (
    lowerMessage.includes("unsupported url") ||
    lowerMessage.includes("https://www.douyin.com/") ||
    lowerMessage.includes("404") ||
    lowerMessage.includes("not found")
  ) {
    guidance = "链接可能已过期或无效，请重新复制视频分享链接后再试。";
  } else if (
    lowerMessage.includes("login") ||
    lowerMessage.includes("sign in") ||
    lowerMessage.includes("cookie") ||
    lowerMessage.includes("captcha") ||
    lowerMessage.includes("verify") ||
    lowerMessage.includes("verification") ||
    lowerMessage.includes("not a bot")
  ) {
    guidance = "平台要求登录或验证，当前无法直接下载，请换公开视频链接或稍后重试。";
  } else if (
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("network") ||
    lowerMessage.includes("connection")
  ) {
    guidance = "网络连接失败，请检查网络后重试。";
  }

  return rawSummary ? `${guidance}原始错误：${rawSummary}` : guidance;
}

function summarizeRawError(message: string): string {
  const summary = message.replace(/\s+/g, " ").trim();
  if (summary.length <= 180) {
    return summary;
  }
  return `${summary.slice(0, 177)}...`;
}

function formatInsightGenerationError(error: WorkerErrorResult): string {
  const rawSummary = summarizeRawError(error.message);
  const appendRaw = (guidance: string): string =>
    rawSummary ? `${guidance}原始错误：${rawSummary}` : guidance;

  if (error.code === "INSIGHTFLOW_LLM_QUOTA_UNAVAILABLE") {
    return "话题点额度不足，请续费或请管理员调整额度后重试。";
  }

  if (error.code === "INSIGHTFLOW_LLM_AUTH_REQUIRED") {
    return "请先登录 FrameQ 账号，然后重新生成话题点。";
  }

  if (
    error.code === "INSIGHTFLOW_CONFIG_MISSING" ||
    error.code === "INSIGHTFLOW_LLM_CONFIG_MISSING"
  ) {
    return "管理员尚未配置云端 LLM，配置完成后可重新生成话题点。";
  }

  if (
    error.code === "INSIGHTFLOW_LLM_CHECKOUT_FAILED" ||
    error.code === "INSIGHTFLOW_LLM_CHECKOUT_TIMEOUT" ||
    error.code === "INSIGHTFLOW_LLM_CHECKOUT_INVALID_RESPONSE"
  ) {
    return appendRaw("无法获取云端 LLM 配置，请检查账号状态、管理员配置和本地服务后重试。");
  }

  if (error.code === "INSIGHTFLOW_LLM_REQUEST_TIMEOUT") {
    return appendRaw("云端 LLM 响应超时，请稍后重试或请管理员调大超时时间。");
  }

  if (error.code === "INSIGHTFLOW_LLM_REQUEST_FAILED") {
    return appendRaw("云端 LLM 请求失败，请检查管理员配置的服务地址、API key、模型权限或服务状态后重试。");
  }

  if (error.code === "INSIGHTFLOW_LLM_CONTENT_BLOCKED") {
    return appendRaw(
      "文字稿可能触发了云端 LLM 的内容安全策略，当前服务拒绝生成话题点。请确认视频内容可被该模型处理，或请管理员更换模型/供应商后重试。",
    );
  }

  if (error.code === "INSIGHTFLOW_EMPTY_RESULT") {
    return appendRaw("云端 LLM 没有返回可用的话题点，请稍后重试或更换模型配置。");
  }

  if (error.code === "INSIGHTFLOW_EMPTY_TRANSCRIPT") {
    return "文字稿为空，暂时无法生成话题点。";
  }

  if (error.code === "TRANSCRIPT_MARKDOWN_NOT_FOUND") {
    return "未找到文字稿 Markdown 文件，请重新运行主流程后再生成话题点。";
  }

  if (error.code === "WORKER_PROCESS_FAILED" || error.code === "TAURI_COMMAND_FAILED") {
    return appendRaw("话题点生成进程异常退出，请保留文字稿并重试。");
  }

  return error.message;
}

export function getVisibleWorkflowError(state: WorkflowState): WorkerErrorResult | null {
  if (!state.error) {
    return null;
  }

  return state.stage === "failed" || state.stage === "partial_completed" ? state.error : null;
}

export function summarizeWorkerResult(result: WorkerResult): WorkflowState {
  return {
    ...createInitialWorkflow(),
    stage: result.status,
    showUrlInput: false,
    statusMessage: "",
    progressPercent: result.status === "failed" ? 35 : 100,
    text: result.text,
    insights: result.insights,
    videoPath: result.video_path,
    audioPath: result.audio_path,
    transcriptPath: result.transcript_path,
    insightsPath: result.insights_path,
    error: result.error,
  };
}

export function mergeProgressEvent(
  state: WorkflowState,
  event: WorkerProgressEvent,
): WorkflowState {
  return {
    ...state,
    stage: event.stage,
    showUrlInput: false,
    statusMessage: event.message,
    progressPercent: Math.max(0, Math.min(100, event.progress)),
  };
}

export function getResultCards(state: WorkflowState): ResultCard[] {
  const mediaCards: ResultCard[] = [
    state.videoPath
      ? {
          id: "video",
          title: "视频文件",
          status: "ready",
          action: "locate",
        }
      : null,
    state.audioPath
      ? {
          id: "audio",
          title: "音频文件",
          status: "ready",
          action: "locate",
        }
      : null,
  ].filter((card): card is ResultCard => card !== null);

  const transcriptCard: ResultCard | null =
    state.transcriptPath || state.text
      ? {
          id: "transcript",
          title: "完整文字稿",
          status: "ready",
          action: "open",
        }
      : null;

  if (state.stage === "partial_completed") {
    return [
      ...mediaCards,
      ...(transcriptCard ? [transcriptCard] : []),
      {
        id: "insights",
        title: "启发话题点",
        status: "failed",
        action: "confirm",
      },
    ];
  }

  if (state.stage === "completed") {
    return [
      ...mediaCards,
      ...(transcriptCard ? [transcriptCard] : []),
      state.insights.length > 0
        ? {
            id: "insights",
            title: "启发话题点",
            status: "ready",
            action: "open",
          }
        : {
            id: "insights",
            title: "启发话题点",
            status: "pending",
            action: "confirm",
          },
    ];
  }

  if (state.stage === "failed") {
    return [...mediaCards, ...(transcriptCard ? [transcriptCard] : [])];
  }

  return [];
}

export function getDetailText(tab: DetailTab, state: WorkflowState): string {
  if (tab === "transcript") {
    return state.text.trim();
  }

  if (tab === "insights") {
    return state.insights.map((insight, index) => `${index + 1}. ${insight}`).join("\n");
  }

  return "";
}

export function getExportPath(tab: DetailTab, state: WorkflowState): string | null {
  if (tab === "video") {
    return state.videoPath;
  }

  if (tab === "audio") {
    return state.audioPath;
  }

  if (tab === "transcript") {
    return state.transcriptPath;
  }

  return state.insightsPath;
}
