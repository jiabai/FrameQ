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
  id: "video" | "audio" | "insights" | "summary" | "transcript";
  title: string;
  status: "ready" | "pending" | "failed";
  action: "open" | "locate" | "confirm";
};

export type DetailTab = ResultCard["id"];

export type TaskArtifactKey =
  | "video"
  | "audio"
  | "transcript_txt"
  | "transcript_md"
  | "segments"
  | "summary"
  | "mindmap"
  | "insights"
  | "insights_md";

export type TaskArtifacts = Partial<Record<TaskArtifactKey, string>>;

export type WorkerResult = {
  status: "completed" | "partial_completed" | "failed";
  task_id: string | null;
  task_dir: string | null;
  artifacts: TaskArtifacts;
  text: string;
  summary: string;
  insights: string[];
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
  summary: string;
  insights: string[];
  taskId: string | null;
  taskDir: string | null;
  artifacts: TaskArtifacts;
  error: WorkerErrorResult | null;
};

const PROGRESS_STEP_LABELS: Array<Pick<ProgressStep, "id" | "label">> = [
  { id: "video_extracting", label: "视频提取中" },
  { id: "video_transcribing", label: "视频转译中" },
  { id: "insights_generating", label: "AI 整理中" },
];
const SUPPORTED_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const XIAOHONGSHU_NOTE_ID_PATTERN = /^[0-9a-f]{24}$/i;
const TRAILING_URL_PUNCTUATION_PATTERN = /[，。！？；：、,.;:!?）)\]}]+$/u;

export function createInitialWorkflow(): WorkflowState {
  return {
    stage: "waiting_input",
    url: "",
    submittedUrl: "",
    showUrlInput: true,
    statusMessage: "",
    progressPercent: 0,
    text: "",
    summary: "",
    insights: [],
    taskId: null,
    taskDir: null,
    artifacts: {},
    error: null,
  };
}

export function canSubmitUrl(rawUrl: string): boolean {
  return normalizeSubmitUrl(rawUrl) !== null;
}

export function normalizeSubmitUrl(rawUrl: string): string | null {
  const input = rawUrl.trim();
  if (XIAOHONGSHU_NOTE_ID_PATTERN.test(input)) {
    return input;
  }

  const candidates = looksLikeUrl(input) ? [input] : extractSupportedUrls(input);
  return candidates.find(canSubmitSingleUrl) ?? null;
}

function canSubmitSingleUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol.toLowerCase())) {
      return false;
    }

    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (isDouyinHost(hostname)) {
      return isDouyinSupportedUrl(url, hostname, normalizedPath);
    }

    return (
      isXiaohongshuShortLink(hostname, normalizedPath) ||
      isXiaohongshuNoteUrl(hostname, normalizedPath) ||
      isBilibiliShortLink(hostname, normalizedPath) ||
      isBilibiliVideoUrl(hostname, normalizedPath) ||
      isYoutubeShortLink(hostname, normalizedPath) ||
      isYoutubeVideoUrl(url, hostname, normalizedPath)
    );
  } catch {
    return false;
  }
}

function looksLikeUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function extractSupportedUrls(value: string): string[] {
  return Array.from(value.matchAll(SUPPORTED_URL_PATTERN), (match) =>
    trimUrlCandidate(match[0]),
  );
}

function trimUrlCandidate(value: string): string {
  return value.trim().replace(TRAILING_URL_PUNCTUATION_PATTERN, "");
}

function isDouyinHost(hostname: string): boolean {
  return hostname === "douyin.com" || hostname.endsWith(".douyin.com");
}

function isDouyinSupportedUrl(url: URL, hostname: string, normalizedPath: string): boolean {
  if (/^\/(?:video|note)\/\d+$/.test(normalizedPath)) {
    return true;
  }
  if (/^\/share\/slides\/\d+$/.test(normalizedPath)) {
    return true;
  }
  if (hasNumericSearchParam(url, ["modal_id", "aweme_id"])) {
    return true;
  }

  const shortCode = normalizedPath.split("/").filter(Boolean);
  return (
    hostname === "v.douyin.com" &&
    shortCode.length === 1 &&
    /^[A-Za-z0-9_-]+$/.test(shortCode[0])
  );
}

function hasNumericSearchParam(url: URL, names: string[]): boolean {
  return names.some((name) => /^\d+$/.test(url.searchParams.get(name) ?? ""));
}

function isXiaohongshuShortLink(hostname: string, normalizedPath: string): boolean {
  if (hostname !== "xhslink.com" && hostname !== "www.xhslink.com") {
    return false;
  }
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.length > 0 && !(segments.length === 1 && segments[0] === "o");
}

function isXiaohongshuNoteUrl(hostname: string, normalizedPath: string): boolean {
  if (!isXiaohongshuHost(hostname)) {
    return false;
  }
  return /(?:^|\/)[0-9a-f]{24}(?:$|\/)/i.test(normalizedPath);
}

function isXiaohongshuHost(hostname: string): boolean {
  return hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
}

function isBilibiliShortLink(hostname: string, normalizedPath: string): boolean {
  if (hostname !== "b23.tv" && hostname !== "www.b23.tv") {
    return false;
  }
  return normalizedPath.split("/").filter(Boolean).length > 0;
}

function isBilibiliVideoUrl(hostname: string, normalizedPath: string): boolean {
  if (!isBilibiliHost(hostname)) {
    return false;
  }
  return /^\/video\/(?:BV[0-9A-Za-z]{10,}|av\d+)$/i.test(normalizedPath);
}

function isBilibiliHost(hostname: string): boolean {
  return hostname === "bilibili.com" || hostname.endsWith(".bilibili.com");
}

function isYoutubeShortLink(hostname: string, normalizedPath: string): boolean {
  if (hostname !== "youtu.be" && hostname !== "www.youtu.be") {
    return false;
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.length === 1 && isYoutubeVideoId(segments[0]);
}

function isYoutubeVideoUrl(url: URL, hostname: string, normalizedPath: string): boolean {
  if (!isYoutubeHost(hostname)) {
    return false;
  }

  if (normalizedPath === "/watch") {
    return isYoutubeVideoId(url.searchParams.get("v") ?? "");
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.length === 2 && segments[0] === "shorts" && isYoutubeVideoId(segments[1]);
}

function isYoutubeHost(hostname: string): boolean {
  return hostname === "youtube.com" || hostname === "www.youtube.com" || hostname === "m.youtube.com";
}

function isYoutubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
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
    summary: "",
    insights: [],
    taskId: null,
    taskDir: null,
    artifacts: {},
    error: null,
  };
}

export function startInsightRetry(state: WorkflowState): WorkflowState {
  return {
    ...state,
    stage: "insights_generating",
    showUrlInput: false,
    statusMessage: "正在生成要点总结和启发话题点；如已配置云端 LLM，文字稿会发送到该服务。",
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
  const youtubeGuidance = formatYoutubeDownloadGuidance(lowerMessage);
  if (youtubeGuidance) {
    const youtubeSummary = summarizeRawError(sanitizeYoutubeRawSummary(rawSummary));
    return youtubeSummary
      ? `${youtubeGuidance}原始错误：${youtubeSummary}`
      : youtubeGuidance;
  }

  const bilibiliGuidance = formatBilibiliDownloadGuidance(lowerMessage);
  if (bilibiliGuidance) {
    return rawSummary
      ? `${bilibiliGuidance}原始错误：${rawSummary}`
      : bilibiliGuidance;
  }
  const xiaohongshuGuidance = formatXiaohongshuDownloadGuidance(lowerMessage);
  if (xiaohongshuGuidance) {
    return rawSummary
      ? `${xiaohongshuGuidance}原始错误：${rawSummary}`
      : xiaohongshuGuidance;
  }
  let guidance = "视频下载失败，请确认链接可公开访问后重试。";

  if (
    lowerMessage.includes("unsupported url") ||
    lowerMessage.includes("https://www.douyin.com/") ||
    lowerMessage.includes("404") ||
    lowerMessage.includes("not found")
  ) {
    guidance = "链接可能已过期或无效，请重新复制视频分享链接后再试。";
  } else if (
    lowerMessage.includes("douyin_no_playable_stream") ||
    lowerMessage.includes("douyin_stream_download_failed") ||
    lowerMessage.includes("douyin_share_page_unavailable") ||
    lowerMessage.includes("douyin_router_data_missing")
  ) {
    guidance = "抖音公开视频分享页暂时没有返回可播放的视频流，请确认链接公开可访问后重试。";
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

function formatYoutubeDownloadGuidance(lowerMessage: string): string | null {
  if (lowerMessage.includes("youtube_login_required")) {
    return "YouTube 要求登录或验证，FrameQ 当前不使用 Cookie 或账号登录；请换公开视频链接后重试。";
  }

  if (lowerMessage.includes("youtube_age_restricted")) {
    return "该 YouTube 视频存在年龄、会员或访问限制，FrameQ 当前不会使用登录态绕过限制；请换公开视频后重试。";
  }

  if (lowerMessage.includes("youtube_private_or_unavailable")) {
    return "该 YouTube 视频不可公开访问、已删除或为私有内容，请确认链接公开可访问后重试。";
  }

  if (lowerMessage.includes("youtube_no_playable_stream")) {
    return "YouTube 暂时没有返回可下载的视频音频格式，请稍后重试或换一个公开视频链接。";
  }

  if (lowerMessage.includes("youtube_download_failed")) {
    return "YouTube 公开视频下载失败，请检查网络或换一个公开可访问的视频链接。";
  }

  return null;
}

function sanitizeYoutubeRawSummary(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]*(?:googlevideo\.com|videoplayback)[^\s"'<>]*/gi, "[youtube media url removed]")
    .replace(/\s*(?:use|using|try|pass)?\s*--cookies(?:-from-browser)?[^\.\n]*(?:\.|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBilibiliDownloadGuidance(lowerMessage: string): string | null {
  if (lowerMessage.includes("bilibili_drm_protected")) {
    return "该 Bilibili 视频包含 DRM 或受保护内容，FrameQ 当前不会尝试解密或绕过权限。";
  }

  if (lowerMessage.includes("bilibili_ffmpeg_merge_failed")) {
    return "Bilibili 视频和音频已下载但合并失败，请确认 FFmpeg 可用后重试。";
  }

  if (
    lowerMessage.includes("bilibili_unsupported_content") ||
    lowerMessage.includes("bilibili_login_required")
  ) {
    return "当前仅支持 Bilibili 普通公开视频，不支持番剧、影视、课程、会员或受保护内容。";
  }

  if (
    lowerMessage.includes("bilibili_id_parse_failed") ||
    lowerMessage.includes("bilibili_short_link_resolve_failed")
  ) {
    return "Bilibili 链接无法识别，请粘贴普通公开视频 BV/av 链接或有效 b23.tv 短链。";
  }

  if (
    lowerMessage.includes("bilibili_video_info_unavailable") ||
    lowerMessage.includes("bilibili_part_not_found")
  ) {
    return "Bilibili 公开视频信息暂时不可用，请确认分 P 存在且链接可公开访问后重试。";
  }

  if (
    lowerMessage.includes("bilibili_no_playable_stream") ||
    lowerMessage.includes("bilibili_dash_download_failed")
  ) {
    return "Bilibili 公开视频暂时没有返回可下载的视频音频流，请稍后重试或换一个公开视频链接。";
  }

  return null;
}

function formatXiaohongshuDownloadGuidance(lowerMessage: string): string | null {
  if (lowerMessage.includes("xhs_image_only")) {
    return "小红书图文笔记暂不支持转写，请换公开视频笔记链接后重试。";
  }

  if (
    lowerMessage.includes("xhs_note_blocked") ||
    lowerMessage.includes("xhs_note_not_found")
  ) {
    return "小红书笔记需要登录、已失效或不可公开访问，请确认是公开视频笔记后重试。";
  }

  if (lowerMessage.includes("xhs_rate_limited")) {
    return "小红书请求暂时被限流，请稍后重试。";
  }

  if (lowerMessage.includes("xhs_no_playable_stream")) {
    return "小红书公开视频暂时没有返回可播放的视频流，请重新复制公开视频链接后重试。";
  }

  if (
    lowerMessage.includes("xhs_initial_state_missing") ||
    lowerMessage.includes("xhs_initial_state_malformed") ||
    lowerMessage.includes("xhs_response_decode_failed") ||
    lowerMessage.includes("xhs_response_too_large")
  ) {
    return "小红书页面结构暂时无法解析，请稍后重试或重新复制公开视频链接。";
  }

  if (lowerMessage.includes("xhs_video_too_large")) {
    return "小红书视频超过当前安全下载大小限制，请换较短的公开视频后重试。";
  }

  if (lowerMessage.includes("xhs_download_stalled")) {
    return "小红书视频下载长时间没有进展，请检查网络后重试，或重新复制公开视频链接。";
  }

  if (
    lowerMessage.includes("xhs_stream_download_failed") ||
    lowerMessage.includes("xhs_page_unavailable") ||
    lowerMessage.includes("xhs_short_link_resolution_failed") ||
    lowerMessage.includes("xhs_id_parse_failed")
  ) {
    return "小红书公开视频下载失败，请确认链接可公开访问后重试。";
  }

  return null;
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
    return "请先登录 FrameQ 账号，然后重新生成 AI 整理结果。";
  }

  if (
    error.code === "INSIGHTFLOW_CONFIG_MISSING" ||
    error.code === "INSIGHTFLOW_LLM_CONFIG_MISSING"
  ) {
    return "管理员尚未配置云端 LLM，配置完成后可重新生成 AI 整理结果。";
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

  if (error.code === "INSIGHTFLOW_EMPTY_SUMMARY") {
    return appendRaw("云端 LLM 没有返回可用的要点总结，请稍后重试或更换模型配置。");
  }

  if (error.code === "INSIGHTFLOW_INVALID_MINDMAP") {
    return appendRaw("云端 LLM 返回的 Mermaid 思维导图格式不可用，请稍后重试或更换模型配置。");
  }

  if (error.code === "INSIGHTFLOW_EMPTY_TRANSCRIPT") {
    return "文字稿为空，暂时无法生成 AI 整理结果。";
  }

  if (error.code === "TRANSCRIPT_MARKDOWN_NOT_FOUND") {
    return "未找到文字稿 Markdown 文件，请重新运行主流程后再生成 AI 整理结果。";
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
    summary: result.summary,
    insights: result.insights,
    taskId: result.task_id,
    taskDir: result.task_dir,
    artifacts: result.artifacts ?? {},
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
    hasArtifact(state, "video")
      ? {
          id: "video",
          title: "视频文件",
          status: "ready",
          action: "locate",
        }
      : null,
    hasArtifact(state, "audio")
      ? {
          id: "audio",
          title: "音频文件",
          status: "ready",
          action: "locate",
        }
      : null,
  ].filter((card): card is ResultCard => card !== null);

  const transcriptCard: ResultCard | null =
    hasArtifact(state, "transcript_txt") || state.text
      ? {
          id: "transcript",
          title: "完整文字稿",
          status: "ready",
          action: "open",
        }
      : null;
  const summaryCard: ResultCard =
    hasArtifact(state, "summary") || state.summary
      ? {
          id: "summary",
          title: "要点总结",
          status: "ready",
          action: "open",
        }
      : {
          id: "summary",
          title: "要点总结",
          status: state.stage === "partial_completed" ? "failed" : "pending",
          action: "confirm",
        };

  if (state.stage === "partial_completed") {
    return [
      ...mediaCards,
      ...(transcriptCard ? [transcriptCard] : []),
      summaryCard,
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
      summaryCard,
      state.insights.length > 0 || hasArtifact(state, "insights") || hasArtifact(state, "insights_md")
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

  if (tab === "summary") {
    return state.summary.trim();
  }

  if (tab === "insights") {
    return state.insights.map((insight, index) => `${index + 1}. ${insight}`).join("\n");
  }

  return "";
}

export function getExportPath(tab: DetailTab, state: WorkflowState): string | null {
  if (tab === "video") {
    return getTaskArtifactPath(state, "video");
  }

  if (tab === "audio") {
    return getTaskArtifactPath(state, "audio");
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
