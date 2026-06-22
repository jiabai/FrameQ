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
    return url.hostname.endsWith("douyin.com") && /^\/video\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
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
  if (error.code === "ASR_MODEL_NOT_READY") {
    return "真实 ASR 尚未启用。请用 FRAMEQ_ALLOW_REAL_ASR=1 启动应用，并确认 models/ 模型缓存目录可写。";
  }

  if (error.code === "ASR_MODEL_CACHE_UNAVAILABLE") {
    return "模型缓存目录不可写。请检查 FRAMEQ_MODEL_DIR 或项目 models/ 目录权限。";
  }

  if (error.code === "ASR_MODEL_NOT_DOWNLOADED") {
    return "SenseVoice Small 尚未下载。请先在首启引导或设置中下载 ASR 模型，然后重新转写。";
  }

  return error.message;
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
