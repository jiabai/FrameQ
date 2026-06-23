export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready_to_restart"
  | "up_to_date"
  | "failed"
  | "postponed";

export type UpdateState = {
  status: UpdateStatus;
  availableVersion: string | null;
  notes: string;
  message: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  postponedUntil: number | null;
  error: string | null;
};

export type UpdateInfo = {
  version: string;
  notes?: string;
};

export type UpdateDownloadEvent =
  | {
      event: "Started";
      data: {
        contentLength?: number;
      };
    }
  | {
      event: "Progress";
      data: {
        chunkLength?: number;
      };
    }
  | {
      event: "Finished";
      data?: unknown;
    };

export function createInitialUpdateState(): UpdateState {
  return {
    status: "idle",
    availableVersion: null,
    notes: "",
    message: "",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    postponedUntil: null,
    error: null,
  };
}

export function markUpdateAvailable(state: UpdateState, update: UpdateInfo): UpdateState {
  return {
    ...state,
    status: "available",
    availableVersion: update.version,
    notes: update.notes ?? "",
    message: `发现新版本 ${update.version}。`,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    postponedUntil: null,
    error: null,
  };
}

export function startUpdateCheck(state: UpdateState): UpdateState {
  return {
    ...state,
    status: "checking",
    message: "正在检查更新。",
    error: null,
  };
}

export function markUpdateUpToDate(state: UpdateState): UpdateState {
  return {
    ...state,
    status: "up_to_date",
    message: "当前已是最新版本。",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
  };
}

export function startUpdateDownload(state: UpdateState): UpdateState {
  return {
    ...state,
    status: "downloading",
    message: "正在下载更新。",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
  };
}

export function applyUpdateDownloadEvent(
  state: UpdateState,
  event: UpdateDownloadEvent,
): UpdateState {
  if (event.event === "Started") {
    const totalBytes = normalizeByteCount(event.data.contentLength);
    return {
      ...state,
      status: "downloading",
      totalBytes,
      downloadedBytes: 0,
      progress: 0,
      message: "正在下载更新。",
    };
  }

  if (event.event === "Progress") {
    const downloadedBytes =
      state.downloadedBytes + normalizeByteCount(event.data.chunkLength);
    return {
      ...state,
      status: "downloading",
      downloadedBytes,
      progress: calculateProgress(downloadedBytes, state.totalBytes),
      message: "正在下载更新。",
    };
  }

  return {
    ...state,
    status: "installing",
    progress: 100,
    message: "正在安装更新。",
  };
}

export function markUpdateReadyToRestart(state: UpdateState): UpdateState {
  return {
    ...state,
    status: "ready_to_restart",
    progress: 100,
    message: "更新已安装，重启后生效。",
    error: null,
  };
}

export function failUpdate(state: UpdateState, error: unknown): UpdateState {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...state,
    status: "failed",
    message: `更新失败：${message}`,
    error: message,
  };
}

export function postponeUpdate(
  state: UpdateState,
  durationMs: number,
  nowMs = Date.now(),
): UpdateState {
  return {
    ...state,
    status: "postponed",
    message: "已稍后提醒。",
    postponedUntil: nowMs + durationMs,
  };
}

export function isUpdateInstallBlocked(input: {
  processingActive: boolean;
  modelDownloadActive: boolean;
}): boolean {
  return input.processingActive || input.modelDownloadActive;
}

export function shouldShowToolbarUpdateReminder(state: UpdateState, nowMs = Date.now()): boolean {
  if (state.status === "available" || state.status === "ready_to_restart") {
    return true;
  }

  if (state.status === "postponed") {
    return Boolean(state.postponedUntil && nowMs >= state.postponedUntil);
  }

  return state.status === "downloading" || state.status === "installing";
}

function normalizeByteCount(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : 0;
}

function calculateProgress(downloadedBytes: number, totalBytes: number | null): number {
  if (!totalBytes || totalBytes <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
}
