import type { DependencyList, EffectCallback, SetStateAction } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createInitialWorkflow } from "../../workflowState";
import type { WorkflowState } from "../../workflow";
import type { UiMessage } from "../../i18n/uiMessage";
import type { TranscriptDetailController } from "./useTranscriptDetailController";

type StateUpdater<T> = T | ((current: T) => T);
type EffectRecord = {
  cleanup?: void | (() => void);
  deps?: DependencyList;
};

const mocks = vi.hoisted(() => ({
  loadTranscriptDetail: vi.fn(),
  saveTranscriptEdit: vi.fn(),
}));

vi.mock("../../transcriptDetailClient", () => ({
  loadTranscriptDetail: mocks.loadTranscriptDetail,
  saveTranscriptEdit: mocks.saveTranscriptEdit,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

function createHookHarness() {
  const states: unknown[] = [];
  const refs: unknown[] = [];
  const effects: EffectRecord[] = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectCursor = 0;

  return {
    resetRender() {
      stateCursor = 0;
      refCursor = 0;
      effectCursor = 0;
    },
    useCallback<T extends (...args: never[]) => unknown>(callback: T): T {
      return callback;
    },
    useState<T>(initialValue: T | (() => T)): [T, (next: StateUpdater<T>) => void] {
      const index = stateCursor++;
      if (states.length <= index) {
        states[index] = typeof initialValue === "function"
          ? (initialValue as () => T)()
          : initialValue;
      }
      return [
        states[index] as T,
        (next) => {
          states[index] = typeof next === "function"
            ? (next as (current: T) => T)(states[index] as T)
            : next;
        },
      ];
    },
    useRef<T>(initialValue: T): { current: T } {
      const index = refCursor++;
      if (refs.length <= index) {
        refs[index] = { current: initialValue };
      }
      return refs[index] as { current: T };
    },
    useEffect(effect: EffectCallback, deps?: DependencyList): void {
      const index = effectCursor++;
      const previous = effects[index];
      const changed = !previous || !deps || !previous.deps ||
        deps.length !== previous.deps.length ||
        deps.some((value, dependencyIndex) => !Object.is(value, previous.deps?.[dependencyIndex]));
      if (!changed) {
        return;
      }
      previous?.cleanup?.();
      effects[index] = { cleanup: effect(), deps };
    },
  };
}

function readyWorkflow(): WorkflowState {
  return {
    ...createInitialWorkflow(),
    stage: "completed",
    taskId: "task-escape",
    taskDir: "D:/FrameQ/outputs/tasks/task-escape",
    text: "第一段原稿。",
    artifacts: { transcript_txt: "transcript/transcript.txt" },
  };
}

async function createController(): Promise<{
  render: () => TranscriptDetailController;
  applyTranscriptSave: ReturnType<typeof vi.fn>;
  setActionNotice: ReturnType<typeof vi.fn>;
}> {
  const harness = createHookHarness();
  vi.doMock("react", () => ({
    useCallback: harness.useCallback,
    useEffect: harness.useEffect,
    useRef: harness.useRef,
    useState: harness.useState,
  }));
  const { useTranscriptDetailController } = await import("./useTranscriptDetailController");
  const applyTranscriptSave = vi.fn();
  const setActionNotice = vi.fn<
    (value: SetStateAction<UiMessage | null>) => void
  >();
  const workflow = readyWorkflow();
  const render = () => {
    harness.resetRender();
    return useTranscriptDetailController({
      workflow,
      locale: "zh-CN",
      applyTranscriptSave,
      setActionNotice,
    });
  };

  render();
  await vi.waitFor(() => expect(mocks.loadTranscriptDetail).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(render().transcriptSegments).toHaveLength(1));
  return { render, applyTranscriptSave, setActionNotice };
}

describe("useTranscriptDetailController segment editing", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadTranscriptDetail.mockReset();
    mocks.saveTranscriptEdit.mockReset();
    mocks.loadTranscriptDetail.mockResolvedValue({
      task_id: "task-escape",
      text: "第一段原稿。",
      segments: [{ id: "segment-1", start_ms: 0, end_ms: 3000, text: "第一段原稿。" }],
      audio_path: "D:/FrameQ/outputs/tasks/task-escape/media/audio.wav",
      audio_asset_path: "D:/FrameQ/cache/audio-review/task-escape.wav",
      has_original_backup: false,
    });
    mocks.saveTranscriptEdit.mockResolvedValue({
      task_id: "task-escape",
      text: "第一段保留草稿。",
      artifacts: { transcript_txt: "transcript/transcript.txt" },
      has_original_backup: true,
    });
  });

  test("ending segment edit keeps the in-memory draft dirty without saving", async () => {
    const { render } = await createController();
    let controller = render();

    controller.beginTranscriptSegmentEdit("segment-1");
    controller = render();
    controller.updateTranscriptSegmentDraft("segment-1", "第一段保留草稿。");
    controller = render();
    controller.endTranscriptSegmentEdit();
    controller = render();

    expect(controller.editingTranscriptSegmentId).toBeNull();
    expect(controller.transcriptSegments[0]?.text).toBe("第一段保留草稿。");
    expect(controller.transcriptDraft).toBe("第一段保留草稿。");
    expect(controller.transcriptDirty).toBe(true);
    expect(mocks.saveTranscriptEdit).not.toHaveBeenCalled();
  });

  test("ending segment edit clears pending audio resume before a later save", async () => {
    const { render } = await createController();
    let controller = render();
    const audio = {
      currentTime: 0,
      duration: 3,
      paused: false,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      playbackRate: 1,
    };
    controller.transcriptAudioRef.current = audio as unknown as HTMLAudioElement;

    controller.beginTranscriptSegmentEdit("segment-1");
    controller = render();
    controller.updateTranscriptSegmentDraft("segment-1", "第一段保留草稿。");
    controller = render();
    controller.endTranscriptSegmentEdit();
    controller = render();
    await controller.saveTranscriptDraft();

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.play).not.toHaveBeenCalled();
  });

  test("releases only the current task audio before permanent deletion", async () => {
    const { render } = await createController();
    const controller = render();
    const audio = {
      paused: false,
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    };
    controller.transcriptAudioRef.current = audio as unknown as HTMLAudioElement;

    controller.prepareTranscriptForTaskDeletion("another-task");
    expect(audio.pause).not.toHaveBeenCalled();

    controller.prepareTranscriptForTaskDeletion("task-escape");

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalledOnce();
  });

  test("uses a stable localized code when saving fails without exposing raw details", async () => {
    mocks.saveTranscriptEdit.mockRejectedValueOnce(
      new Error("Authorization: Bearer secret at C:/private/transcript.txt"),
    );
    const { render, setActionNotice } = await createController();
    let controller = render();
    controller.updateFullTranscriptDraft("Edited user transcript");
    controller = render();

    await controller.saveTranscriptDraft();

    expect(setActionNotice).toHaveBeenLastCalledWith({
      messageCode: "transcript.notice.saveFailed",
    });
    expect(JSON.stringify(setActionNotice.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(setActionNotice.mock.calls)).not.toContain("C:/private");
  });
});
