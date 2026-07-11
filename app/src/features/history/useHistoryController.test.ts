import { beforeEach, describe, expect, test, vi } from "vitest";
import type { HistoryItem, HistoryListItem } from "../../historyClient";
import type { HistoryController } from "./useHistoryController";

type StateUpdater<T> = T | ((current: T) => T);

type HookHarness = {
  resetRender: () => void;
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => T;
  useRef: <T>(initialValue: T) => { current: T };
  useState: <T>(initialValue: T | (() => T)) => [T, (next: StateUpdater<T>) => void];
};

const getHistoryMock = vi.fn<() => Promise<HistoryListItem[]>>();
const getHistoryDetailMock = vi.fn<(taskId: string) => Promise<HistoryItem>>();

vi.mock("../../historyClient", () => ({
  getHistory: getHistoryMock,
  getHistoryDetail: getHistoryDetailMock,
}));

function createHookHarness(): HookHarness {
  const states: unknown[] = [];
  let cursor = 0;

  return {
    resetRender: () => {
      cursor = 0;
    },
    useCallback: (callback) => callback,
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

function createHistoryItem(overrides: Partial<HistoryListItem> = {}): HistoryListItem {
  return {
    taskId: "task-1",
    id: "task-1",
    createdAt: "2026-07-09T00:00:00.000Z",
    url: "https://example.test/video",
    status: "completed",
    taskDir: "D:/FrameQ/tasks/task-1",
    outputDir: "D:/FrameQ/outputs",
    artifacts: { transcript_txt: "transcript/transcript.txt" },
    error: null,
    textPreview: "demo transcript",
    insightsCount: 0,
    ...overrides,
  };
}

function createHistoryDetail(taskId = "task-1"): HistoryItem {
  return {
    taskId,
    url: "https://example.test/video",
    status: "completed",
    taskDir: `D:/FrameQ/tasks/${taskId}`,
    artifacts: { transcript_txt: "transcript/transcript.txt" },
    error: null,
    text: "demo transcript body",
    summary: "",
    transcript: null,
    insights: [],
  };
}

async function createController(
  onHistoryItemSelected = vi.fn(),
): Promise<{
  render: () => HistoryController;
  onHistoryItemSelected: typeof onHistoryItemSelected;
}> {
  const harness = createHookHarness();
  vi.doMock("react", () => ({
    useCallback: harness.useCallback,
    useRef: harness.useRef,
    useState: harness.useState,
  }));
  const { useHistoryController } = await import("./useHistoryController");

  return {
    render: () => {
      harness.resetRender();
      return useHistoryController({ onHistoryItemSelected });
    },
    onHistoryItemSelected,
  };
}

describe("useHistoryController", () => {
  beforeEach(() => {
    vi.resetModules();
    getHistoryMock.mockReset();
    getHistoryDetailMock.mockReset();
  });

  test("opens history and loads items", async () => {
    const item = createHistoryItem();
    getHistoryMock.mockResolvedValueOnce([item]);
    const { render } = await createController();

    let controller = render();
    expect(controller.historyOpen).toBe(false);
    expect(controller.historyLoading).toBe(false);

    const load = controller.openHistory();
    controller = render();
    expect(controller.historyOpen).toBe(true);
    expect(controller.historyLoading).toBe(true);
    expect(controller.historyItems).toEqual([]);
    expect(controller.historyNotice).not.toBe("");

    await load;
    controller = render();
    expect(getHistoryMock).toHaveBeenCalledTimes(1);
    expect(controller.historyOpen).toBe(true);
    expect(controller.historyLoading).toBe(false);
    expect(controller.historyItems).toEqual([item]);
    expect(controller.historyNotice).toBe("");
  });

  test("shows an empty notice when history has no items", async () => {
    getHistoryMock.mockResolvedValueOnce([]);
    const { render } = await createController();

    let controller = render();
    await controller.openHistory();
    controller = render();

    expect(controller.historyOpen).toBe(true);
    expect(controller.historyLoading).toBe(false);
    expect(controller.historyItems).toEqual([]);
    expect(controller.historyNotice).not.toBe("");
  });

  test("keeps the sheet open and surfaces load errors", async () => {
    getHistoryMock.mockRejectedValueOnce(new Error("disk unavailable"));
    const { render } = await createController();

    let controller = render();
    await controller.openHistory();
    controller = render();

    expect(controller.historyOpen).toBe(true);
    expect(controller.historyLoading).toBe(false);
    expect(controller.historyItems).toEqual([]);
    expect(controller.historyNotice).toContain("disk unavailable");
  });

  test("selects a history item and closes the sheet", async () => {
    const item = createHistoryItem({ id: "selected-task" });
    const detail = createHistoryDetail(item.taskId);
    getHistoryMock.mockResolvedValueOnce([item]);
    getHistoryDetailMock.mockResolvedValueOnce(detail);
    const { render, onHistoryItemSelected } = await createController();

    let controller = render();
    await controller.openHistory();
    controller = render();
    expect(controller.historyOpen).toBe(true);

    await controller.openHistoryItem(item);
    controller = render();

    expect(getHistoryDetailMock).toHaveBeenCalledWith(item.taskId);
    expect(onHistoryItemSelected).toHaveBeenCalledWith(detail);
    expect(controller.historyOpen).toBe(false);
  });

  test("ignores an older detail response after a newer history selection", async () => {
    const first = createHistoryItem({ taskId: "first", id: "first" });
    const second = createHistoryItem({ taskId: "second", id: "second" });
    let resolveFirst!: (value: HistoryItem) => void;
    let resolveSecond!: (value: HistoryItem) => void;
    getHistoryDetailMock
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );
    const { render, onHistoryItemSelected } = await createController();
    const controller = render();

    const firstLoad = controller.openHistoryItem(first);
    const secondLoad = controller.openHistoryItem(second);
    resolveSecond(createHistoryDetail("second"));
    await secondLoad;
    resolveFirst(createHistoryDetail("first"));
    await firstLoad;

    expect(onHistoryItemSelected).toHaveBeenCalledTimes(1);
    expect(onHistoryItemSelected).toHaveBeenCalledWith(createHistoryDetail("second"));
  });
});
