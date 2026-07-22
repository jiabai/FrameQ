import { beforeEach, describe, expect, test, vi } from "vitest";

import { createBrowserPreviewAccountStatus } from "../../accountState";
import type { HistoryItem } from "../../historyClient";
import type { WorkerProgressEvent, WorkerResult } from "../../workflow";

type StateUpdater<T> = T | ((current: T) => T);

type HookHarness = {
  resetRender: () => void;
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => T;
  useMemo: <T>(factory: () => T) => T;
  useRef: <T>(initialValue: T) => { current: T };
  useState: <T>(initialValue: T | (() => T)) => [T, (next: StateUpdater<T>) => void];
};

const cancelProcessMock = vi.fn();
const processVideoMock = vi.fn();
const retryInsightsMock = vi.fn();

vi.mock("../../workerClient", () => ({
  cancelProcess: cancelProcessMock,
  processVideo: processVideoMock,
  retryInsights: retryInsightsMock,
}));

function createHookHarness(): HookHarness {
  const states: unknown[] = [];
  let cursor = 0;

  return {
    resetRender: () => {
      cursor = 0;
    },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    useRef: <T,>(initialValue: T) => {
      const stateIndex = cursor;
      cursor += 1;
      if (states.length <= stateIndex) {
        states[stateIndex] = { current: initialValue };
      }
      return states[stateIndex] as { current: T };
    },
    useState: <T,>(initialValue: T | (() => T)) => {
      const stateIndex = cursor;
      cursor += 1;
      if (states.length <= stateIndex) {
        states[stateIndex] =
          typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }
      const setState = (next: StateUpdater<T>) => {
        states[stateIndex] =
          typeof next === "function"
            ? (next as (current: T) => T)(states[stateIndex] as T)
            : next;
      };
      return [states[stateIndex] as T, setState];
    },
  };
}

function requireResolver<T>(resolver: ((value: T) => void) | null): (value: T) => void {
  if (!resolver) {
    throw new Error("Expected deferred operation resolver.");
  }
  return resolver;
}

function createHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    taskId: "history-task",
    url: "https://www.example.test/history-video",
    status: "completed",
    taskDir: "D:/FrameQ/outputs/tasks/history-task",
    artifacts: {
      transcript_txt: "transcript/transcript.txt",
      summary: "ai/summary.md",
      insights: "ai/insights.json",
    },
    error: null,
    text: "history transcript",
    summary: "history summary",
    transcript: { source: "asr", language: "Chinese", engine: "SenseVoice" },
    insights: [
      {
        id: 1,
        topic: "history insight",
        matchReason: "history relevance",
        followUpQuestions: ["history question"],
        suitableUse: "history use case",
        sourceChunkId: null,
      },
    ],
    ...overrides,
  };
}

function createWorkerResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    status: "completed",
    task_id: "active-task",
    task_dir: "D:/FrameQ/outputs/tasks/active-task",
    artifacts: { transcript_txt: "transcript/transcript.txt" },
    text: "active transcript",
    summary: "active summary",
    insights: [],
    transcript: { source: "asr", language: "Chinese", engine: "SenseVoice" },
    error: null,
    ...overrides,
  };
}

async function createController() {
  const harness = createHookHarness();
  const onResetTaskUi = vi.fn();
  vi.doMock("react", () => ({
    useCallback: harness.useCallback,
    useMemo: harness.useMemo,
    useRef: harness.useRef,
    useState: harness.useState,
  }));
  const { useTaskProcessingController } = await import("./useTaskProcessingController");

  return {
    render: () => {
      harness.resetRender();
      return useTaskProcessingController({
        onResetTaskUi,
        onRetryStarted: vi.fn(),
        processBlockerMessage: () => ({ messageCode: "account.notice.processingUnavailable" }),
        aiBlockerMessage: () => ({ messageCode: "account.notice.aiUnavailable" }),
      });
    },
    onResetTaskUi,
  };
}

describe("useTaskProcessingController cancellation", () => {
  beforeEach(() => {
    vi.resetModules();
    cancelProcessMock.mockReset();
    processVideoMock.mockReset();
    retryInsightsMock.mockReset();
  });

  test("keeps the workflow and operation active when process termination fails", async () => {
    processVideoMock.mockImplementation(() => new Promise<WorkerResult>(() => undefined));
    cancelProcessMock.mockResolvedValue({
      status: "failed",
      error: "tree termination failed",
    });
    const { render, onResetTaskUi } = await createController();

    let controller = render();
    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();
    void controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();

    await controller.cancelCurrentProcessing();
    controller = render();

    expect(cancelProcessMock).toHaveBeenCalledTimes(1);
    expect(onResetTaskUi).not.toHaveBeenCalled();
    expect(controller.workflow.stage).toBe("video_extracting");
    expect(controller.workflow.statusMessage).toEqual({
      messageCode: "workflow.cancellation.failed",
    });
  });

  test("claims a user cancellation once while the signal request is pending", async () => {
    processVideoMock.mockImplementation(() => new Promise<WorkerResult>(() => undefined));
    let resolveCancel: ((value: { status: "cancelling" }) => void) | null = null;
    cancelProcessMock.mockImplementation(
      () =>
        new Promise<{ status: "cancelling" }>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const { render } = await createController();

    let controller = render();
    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();
    void controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();
    const firstCancel = controller.cancelCurrentProcessing();
    controller = render();
    const secondCancel = controller.cancelCurrentProcessing();

    expect(controller.workflow.stage).toBe("cancelling");
    expect(cancelProcessMock).toHaveBeenCalledTimes(1);
    requireResolver<{ status: "cancelling" }>(resolveCancel)({ status: "cancelling" });
    await Promise.all([firstCancel, secondCancel]);
  });

  test("resets only after the worker confirms cancellation", async () => {
    let resolveWorker: ((value: { status: "failed"; task_id: null; task_dir: null; artifacts: {}; text: string; summary: string; insights: []; transcript: null; error: { code: string; message: string; stage: "video_extracting" } }) => void) | null = null;
    processVideoMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWorker = resolve;
        }),
    );
    cancelProcessMock.mockResolvedValue({ status: "cancelling" });
    const { render, onResetTaskUi } = await createController();
    let controller = render();
    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();
    const processing = controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();

    await controller.cancelCurrentProcessing();
    controller = render();
    expect(controller.workflow.stage).toBe("cancelling");
    expect(onResetTaskUi).not.toHaveBeenCalled();

    requireResolver<{
      status: "failed";
      task_id: null;
      task_dir: null;
      artifacts: {};
      text: string;
      summary: string;
      insights: [];
      transcript: null;
      error: { code: string; message: string; stage: "video_extracting" };
    }>(resolveWorker)({
      status: "failed",
      task_id: null,
      task_dir: null,
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
      transcript: null,
      error: {
        code: "WORKER_CANCELLED",
        message: "Worker process was cancelled.",
        stage: "video_extracting",
      },
    });
    await processing;
    controller = render();

    expect(onResetTaskUi).toHaveBeenCalledTimes(1);
    expect(controller.workflow.stage).toBe("waiting_input");
  });

  test("does not invalidate a running operation before its terminal result is known", async () => {
    let resolveWorker: ((value: { status: "completed"; task_id: string; task_dir: string; artifacts: {}; text: string; summary: string; insights: []; transcript: null; error: null }) => void) | null = null;
    processVideoMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWorker = resolve;
        }),
    );
    cancelProcessMock.mockResolvedValue({ status: "failed", error: "tree termination failed" });
    const { render } = await createController();
    let controller = render();

    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();
    const started = controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();
    await controller.cancelCurrentProcessing();
    requireResolver<{
      status: "completed";
      task_id: string;
      task_dir: string;
      artifacts: {};
      text: string;
      summary: string;
      insights: [];
      transcript: null;
      error: null;
    }>(resolveWorker)({
      status: "completed",
      task_id: "task-1",
      task_dir: "D:/FrameQ/outputs/task-1",
      artifacts: {},
      text: "final transcript",
      summary: "",
      insights: [],
      transcript: null,
      error: null,
    });
    await started;
    controller = render();

    expect(controller.workflow.stage).toBe("completed");
    expect(controller.workflow.text).toBe("final transcript");
  });
});

describe("useTaskProcessingController watchdog timeouts", () => {
  beforeEach(() => {
    vi.resetModules();
    cancelProcessMock.mockReset();
    processVideoMock.mockReset();
    retryInsightsMock.mockReset();
  });

  test("clears process busy state after timeout without starting another process command", async () => {
    processVideoMock.mockResolvedValue(
      createWorkerResult({
        status: "failed",
        task_id: null,
        task_dir: null,
        artifacts: {},
        text: "",
        summary: "",
        insights: [],
        transcript: null,
        error: {
          code: "WORKER_IDLE_TIMEOUT",
          message: "Worker process made no progress for too long.",
          stage: "video_extracting",
        },
      }),
    );
    const { render } = await createController();
    let controller = render();
    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();

    await controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();

    expect(controller.workflow.stage).toBe("failed");
    expect(controller.workflow.error?.code).toBe("WORKER_IDLE_TIMEOUT");
    expect(controller.canRestoreHistory).toBe(true);
    expect(controller.toolbarNewTaskButtonState.disabled).toBe(false);
    expect(processVideoMock).toHaveBeenCalledTimes(1);

    controller.startNewTaskFromToolbar();
    controller = render();
    expect(controller.workflow.stage).toBe("waiting_input");
    expect(processVideoMock).toHaveBeenCalledTimes(1);
  });

  test("keeps the complete current task after AI timeout without retrying or opening Credits", async () => {
    const source = createHistoryItem({
      taskId: "source-task",
      taskDir: "D:/FrameQ/outputs/tasks/source-task",
      artifacts: {
        transcript_txt: "transcript/transcript.txt",
        transcript_md: "transcript/transcript.md",
        summary: "ai/summary.md",
        insights: "ai/insights.json",
      },
      text: "preserved transcript",
      summary: "preserved summary",
    });
    retryInsightsMock.mockResolvedValue(
      createWorkerResult({
        status: "partial_completed",
        task_id: null,
        task_dir: null,
        artifacts: {},
        text: "",
        summary: "",
        insights: [],
        transcript: null,
        error: {
          code: "WORKER_EXECUTION_TIMEOUT",
          message: "Worker process exceeded the maximum execution time.",
          stage: "insights_generating",
        },
      }),
    );
    const openAccountPanel = vi.fn();
    const { render } = await createController();
    let controller = render();
    expect(controller.restoreHistoryItem(source)).toBe(true);
    controller = render();

    await controller.retryInsightGeneration(
      "summary",
      "en-US",
      null,
      createBrowserPreviewAccountStatus(),
      openAccountPanel,
    );
    controller = render();

    expect(controller.workflow.stage).toBe("partial_completed");
    expect(controller.workflow.activeAiTarget).toBeNull();
    expect(controller.workflow.aiErrorTarget).toBe("summary");
    expect(controller.workflow.taskId).toBe(source.taskId);
    expect(controller.workflow.taskDir).toBe(source.taskDir);
    expect(controller.workflow.text).toBe(source.text);
    expect(controller.workflow.transcript).toEqual(source.transcript);
    expect(controller.workflow.artifacts).toEqual(source.artifacts);
    expect(controller.workflow.summary).toBe(source.summary);
    expect(controller.workflow.insights).toEqual(source.insights);
    expect(retryInsightsMock).toHaveBeenCalledTimes(1);
    expect(retryInsightsMock).toHaveBeenCalledWith({
      taskId: "source-task",
      target: "summary",
      outputLanguage: "en-US",
    });
    expect(openAccountPanel).not.toHaveBeenCalled();
  });
});

describe("useTaskProcessingController history restore", () => {
  beforeEach(() => {
    vi.resetModules();
    cancelProcessMock.mockReset();
    processVideoMock.mockReset();
    retryInsightsMock.mockReset();
  });

  test("rejects history restore while video processing and keeps the active result authoritative", async () => {
    let progress: ((event: WorkerProgressEvent) => void) | null = null;
    let resolveWorker: ((value: WorkerResult) => void) | null = null;
    processVideoMock.mockImplementation(
      (_url: string, _runner: unknown, onProgress?: (event: WorkerProgressEvent) => void) => {
        progress = onProgress ?? null;
        return new Promise<WorkerResult>((resolve) => {
          resolveWorker = resolve;
        });
      },
    );
    const { render } = await createController();
    let controller = render();
    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();
    const processing = controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();

    expect(controller.restoreHistoryItem(createHistoryItem())).toBe(false);
    expect(controller.workflow.stage).toBe("video_extracting");
    expect(controller.canRestoreHistory).toBe(false);
    requireResolver<WorkerProgressEvent>(progress)({
      stage: "video_transcribing",
      message: { messageCode: "asr.transcribe.running", args: {} },
      progress: 60,
    });
    requireResolver<WorkerResult>(resolveWorker)(createWorkerResult());
    await processing;
    controller = render();

    expect(controller.workflow.taskId).toBe("active-task");
    expect(controller.workflow.text).toBe("active transcript");
    expect(controller.workflow.stage).toBe("completed");
    expect(controller.canRestoreHistory).toBe(true);
  });

  test("rejects history restore during AI retry without mixing task artifacts or insights", async () => {
    let resolveRetry: ((value: WorkerResult) => void) | null = null;
    retryInsightsMock.mockImplementation(
      () =>
        new Promise<WorkerResult>((resolve) => {
          resolveRetry = resolve;
        }),
    );
    const source = createHistoryItem({ taskId: "source-task" });
    const rejected = createHistoryItem({
      taskId: "other-task",
      text: "other transcript",
      summary: "other summary",
      artifacts: { transcript_txt: "other/transcript.txt" },
      insights: [],
    });
    const { render } = await createController();
    let controller = render();
    expect(controller.restoreHistoryItem(source)).toBe(true);
    controller = render();

    const retry = controller.retryInsightGeneration(
      "insights",
      "en-US",
      null,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();
    expect(controller.workflow.stage).toBe("insights_generating");
    expect(retryInsightsMock).toHaveBeenCalledWith({
      taskId: "source-task",
      target: "insights",
      outputLanguage: "en-US",
    });
    expect(controller.restoreHistoryItem(rejected)).toBe(false);
    requireResolver<WorkerResult>(resolveRetry)(
      createWorkerResult({
        task_id: "source-task",
        task_dir: source.taskDir,
        artifacts: { insights: "ai/fresh-insights.json" },
        text: "",
        summary: "",
        insights: [
          {
            id: 2,
            topic: "fresh insight",
            matchReason: "fresh relevance",
            followUpQuestions: ["fresh question"],
            suitableUse: "fresh use case",
            sourceChunkId: null,
          },
        ],
      }),
    );
    await retry;
    controller = render();

    expect(controller.workflow.taskId).toBe("source-task");
    expect(controller.workflow.taskDir).toBe(source.taskDir);
    expect(controller.workflow.artifacts.transcript_txt).toBe("transcript/transcript.txt");
    expect(controller.workflow.artifacts.insights).toBe("ai/fresh-insights.json");
    expect(controller.workflow.text).toBe("history transcript");
    expect(controller.workflow.insights[0]?.topic).toBe("fresh insight");
    expect(controller.workflow.text).not.toBe("other transcript");
  });

  test("attributes a partial AI retry failure to its typed target and keeps the transcript", async () => {
    retryInsightsMock.mockResolvedValue(
      createWorkerResult({
        status: "partial_completed",
        task_id: "source-task",
        text: "",
        summary: "",
        insights: [],
        error: {
          code: "INSIGHTFLOW_EMPTY_SUMMARY",
          message: "No summary returned.",
          stage: "insights_generating",
        },
      }),
    );
    const source = createHistoryItem({
      taskId: "source-task",
      summary: "",
      artifacts: { transcript_txt: "transcript/transcript.txt" },
      insights: [],
    });
    const { render } = await createController();
    let controller = render();
    expect(controller.restoreHistoryItem(source)).toBe(true);
    controller = render();

    const retry = controller.retryInsightGeneration(
      "summary",
      "zh-TW",
      null,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();
    expect(controller.workflow.activeAiTarget).toBe("summary");
    expect(retryInsightsMock).toHaveBeenCalledWith({
      taskId: "source-task",
      target: "summary",
      outputLanguage: "zh-TW",
    });

    await retry;
    controller = render();

    expect(controller.workflow.stage).toBe("partial_completed");
    expect(controller.workflow.activeAiTarget).toBeNull();
    expect(controller.workflow.aiErrorTarget).toBe("summary");
    expect(controller.workflow.text).toBe("history transcript");
  });

  test("rejects history restore while cancelling and accepts the natural terminal result", async () => {
    let resolveWorker: ((value: WorkerResult) => void) | null = null;
    processVideoMock.mockImplementation(
      () =>
        new Promise<WorkerResult>((resolve) => {
          resolveWorker = resolve;
        }),
    );
    cancelProcessMock.mockResolvedValue({ status: "cancelling" });
    const { render } = await createController();
    let controller = render();
    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();
    const processing = controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();
    await controller.cancelCurrentProcessing();
    controller = render();

    expect(controller.workflow.stage).toBe("cancelling");
    expect(controller.canRestoreHistory).toBe(false);
    expect(controller.restoreHistoryItem(createHistoryItem())).toBe(false);
    requireResolver<WorkerResult>(resolveWorker)(createWorkerResult());
    await processing;
    controller = render();

    expect(controller.workflow.taskId).toBe("active-task");
    expect(controller.workflow.stage).toBe("completed");
  });

  test("restores a stable history task as one complete identity and invalidates old progress", async () => {
    const history = createHistoryItem();
    const { render, onResetTaskUi } = await createController();
    let controller = render();

    expect(controller.restoreHistoryItem(history)).toBe(true);
    controller = render();

    expect(onResetTaskUi).toHaveBeenCalledTimes(1);
    expect(controller.workflow.taskId).toBe(history.taskId);
    expect(controller.workflow.taskDir).toBe(history.taskDir);
    expect(controller.workflow.artifacts).toEqual(history.artifacts);
    expect(controller.workflow.text).toBe(history.text);
    expect(controller.workflow.summary).toBe(history.summary);
    expect(controller.workflow.insights).toEqual(history.insights);
    expect(controller.workflow.url).toBe(history.url);
    expect(controller.workflow.submittedUrl).toBe(history.url);
    expect("setWorkflow" in controller).toBe(false);
  });

  test("resets only when the successfully deleted history task is current", async () => {
    const history = createHistoryItem();
    const { render, onResetTaskUi } = await createController();
    let controller = render();
    expect(controller.restoreHistoryItem(history)).toBe(true);
    controller = render();
    onResetTaskUi.mockClear();

    expect(controller.completeHistoryTaskDeletion("another-task")).toBe(false);
    controller = render();
    expect(controller.workflow.taskId).toBe(history.taskId);
    expect(onResetTaskUi).not.toHaveBeenCalled();

    expect(controller.completeHistoryTaskDeletion(history.taskId)).toBe(true);
    controller = render();
    expect(controller.workflow.stage).toBe("waiting_input");
    expect(controller.workflow.taskId).toBeNull();
    expect(onResetTaskUi).toHaveBeenCalledTimes(1);

    controller.applyTranscriptSave(history.taskId, {
      task_id: history.taskId,
      text: "late deleted transcript",
      artifacts: { transcript_txt: "transcript/transcript.txt" },
      has_original_backup: true,
    });
    controller = render();
    expect(controller.workflow.taskId).toBeNull();
    expect(controller.workflow.text).toBe("");
  });

  test("refuses deletion completion while the workflow is active", async () => {
    processVideoMock.mockImplementation(() => new Promise<WorkerResult>(() => undefined));
    const { render, onResetTaskUi } = await createController();
    let controller = render();
    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();
    void controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();

    expect(controller.completeHistoryTaskDeletion("active-task")).toBe(false);
    controller = render();
    expect(controller.workflow.stage).toBe("video_extracting");
    expect(onResetTaskUi).not.toHaveBeenCalled();
  });

  test("ignores late progress and a terminal result from an invalidated operation after restoring history", async () => {
    let progress: ((event: WorkerProgressEvent) => void) | null = null;
    let resolveWorker: ((value: WorkerResult) => void) | null = null;
    processVideoMock.mockImplementation(
      (_url: string, _runner: unknown, onProgress?: (event: WorkerProgressEvent) => void) => {
        progress = onProgress ?? null;
        return new Promise<WorkerResult>((resolve) => {
          resolveWorker = resolve;
        });
      },
    );
    const history = createHistoryItem();
    const { render } = await createController();
    let controller = render();
    controller.updateUrlDraft("https://www.douyin.com/video/7524373044106677544");
    controller = render();
    const oldProcessing = controller.submitUrl(
      { preventDefault: vi.fn() } as never,
      createBrowserPreviewAccountStatus(),
      vi.fn(),
    );
    controller = render();

    controller.resetWorkflow();
    controller = render();
    expect(controller.restoreHistoryItem(history)).toBe(true);
    controller = render();
    requireResolver<WorkerProgressEvent>(progress)({
      stage: "video_transcribing",
      message: { messageCode: "asr.transcribe.running", args: {} },
      progress: 80,
    });
    requireResolver<WorkerResult>(resolveWorker)(createWorkerResult());
    await oldProcessing;
    controller = render();

    expect(controller.workflow.taskId).toBe(history.taskId);
    expect(controller.workflow.text).toBe(history.text);
    expect(controller.workflow.summary).toBe(history.summary);
    expect(controller.workflow.insights).toEqual(history.insights);
  });

  test("applies transcript saves only to the still-current task after history restoration", async () => {
    const first = createHistoryItem({ taskId: "first-task" });
    const second = createHistoryItem({
      taskId: "second-task",
      text: "second transcript",
      artifacts: { transcript_txt: "second/transcript.txt" },
    });
    const { render } = await createController();
    let controller = render();
    expect(controller.restoreHistoryItem(first)).toBe(true);
    controller = render();
    expect(controller.restoreHistoryItem(second)).toBe(true);
    controller = render();

    controller.applyTranscriptSave("first-task", {
      task_id: "first-task",
      text: "late first-task edit",
      artifacts: { transcript_txt: "first/edited.txt" },
      has_original_backup: true,
    });
    controller = render();
    expect(controller.workflow.taskId).toBe("second-task");
    expect(controller.workflow.text).toBe("second transcript");
    expect(controller.workflow.artifacts.transcript_txt).toBe("second/transcript.txt");

    controller.applyTranscriptSave("second-task", {
      task_id: "second-task",
      text: "second edited transcript",
      artifacts: { transcript_txt: "second/edited.txt" },
      has_original_backup: true,
    });
    controller = render();
    expect(controller.workflow.text).toBe("second edited transcript");
    expect(controller.workflow.artifacts.transcript_txt).toBe("second/edited.txt");
  });
});
