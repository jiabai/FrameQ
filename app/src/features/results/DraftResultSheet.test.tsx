// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { SaveDraftEditResponse } from "../../draftDetailClient";
import type { TaskArtifacts } from "../../workflow";
import { initializeI18n } from "../../i18n/i18n";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { createInitialWorkflow, type WorkflowState } from "../../workflowState";
import { DraftResultSheet } from "./DraftResultSheet";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  loadDraftDetail: vi.fn(),
  saveDraftEdit: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("../../draftDetailClient", () => ({
  loadDraftDetail: mocks.loadDraftDetail,
  saveDraftEdit: mocks.saveDraftEdit,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: mocks.revealItemInDir,
}));

// Clipboard mocks (jsdom doesn't fully support this)
const clipboardWriteSpy = vi.fn();
beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: clipboardWriteSpy },
  });
  clipboardWriteSpy.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function completedWorkflow(overrides?: Partial<WorkflowState>): WorkflowState {
  return {
    ...createInitialWorkflow(),
    stage: "completed",
    taskId: "task-draft-1",
    taskDir: "/FrameQ/outputs/tasks/task-draft-1",
    text: "原始文字稿",
    draft: "# 标题\n\n原始草稿内容",
    artifacts: { draft: "ai/draft.md" },
    ...overrides,
  };
}

const savedArtifacts: TaskArtifacts = { draft: "ai/draft.md" };

const defaultSaveResponse: SaveDraftEditResponse = {
  task_id: "task-draft-1",
  markdown: "# 标题\n\n已保存内容",
  artifacts: savedArtifacts,
  has_original_backup: true,
};

function renderSheet(props: Partial<Parameters<typeof DraftResultSheet>[0]> = {}) {
  const workflow = completedWorkflow();
  const onSaved = vi.fn();
  const onRegenerate = vi.fn();
  const onClose = vi.fn();
  return {
    workflow,
    onSaved,
    onRegenerate,
    onClose,
    ...render(
      <LocaleProvider
        initialOutcome={{
          preference: "zh-CN",
          resolvedLocale: "zh-CN",
          persistedAnchor: "zh-CN",
          notice: null,
        }}
      >
        <DraftResultSheet
          open
          workflow={workflow}
          onSaved={onSaved}
          onRegenerate={onRegenerate}
          onClose={onClose}
          {...props}
        />
      </LocaleProvider>,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DraftResultSheet", () => {
  beforeEach(async () => {
    await initializeI18n("zh-CN");
    mocks.loadDraftDetail.mockReset();
    mocks.saveDraftEdit.mockReset();
    mocks.revealItemInDir.mockReset();
    // Default: load returns markdown from disk with a seed insight id
    mocks.loadDraftDetail.mockResolvedValue({
      task_id: "task-draft-1",
      markdown: "# 标题\n\n从磁盘加载的内容",
      has_original_backup: false,
      draft_seed_insight_id: 42,
    });
    mocks.saveDraftEdit.mockResolvedValue(defaultSaveResponse);
  });

  afterEach(() => {
    cleanup();
  });

  // ---- 1. Open loads from disk ----

  test("on open, loads from disk and renders Markdown without the raw editor", async () => {
    renderSheet();

    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledWith("task-draft-1"));

    const preview = screen.getByTestId("markdown-preview");
    await waitFor(() => expect(preview.textContent).toContain("从磁盘加载的内容"));

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // ---- 2. Load failure fallback ----

  test("load failure falls back to workflow.draft and shows notice", async () => {
    mocks.loadDraftDetail.mockRejectedValue(new Error("网络错误"));

    renderSheet();

    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());
    const preview = screen.getByTestId("markdown-preview");
    await waitFor(() => expect(preview.textContent).toContain("原始草稿内容"));
    expect(document.querySelector(".action-notice")?.textContent).toContain("无法读取草稿");
  });

  // ---- 3. Edit -> dirty -> save ----

  test("editing textarea sets dirty, save calls saveDraftEdit + onSaved + clears dirty + shows notice", async () => {
    const { onSaved } = renderSheet();

    // Wait for load, then enter edit mode
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));

    // Edit
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("# 标题\n\n从磁盘加载的内容");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# 标题\n\n修改后的内容" } });
    });

    // The save button should be enabled (no disabled attribute)
    const saveButton = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);

    // Save
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => expect(mocks.saveDraftEdit).toHaveBeenCalledWith("task-draft-1", "# 标题\n\n修改后的内容"));
    expect(onSaved).toHaveBeenCalledWith("# 标题\n\n已保存内容", savedArtifacts);
    expect(document.querySelector(".action-notice")?.textContent).toContain("草稿已保存。");

    // After save, dirty should be cleared -- save is not called again without edits
    mocks.saveDraftEdit.mockClear();
    await act(async () => {
      fireEvent.click(saveButton);
    });
    expect(mocks.saveDraftEdit).not.toHaveBeenCalled();
  });

  // ---- 4. Save failure ----

  test("save failure shows error notice and keeps dirty", async () => {
    mocks.saveDraftEdit.mockRejectedValue(new Error("保存失败"));

    const { onSaved } = renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "edited" } });
    });

    const saveButton = screen.getByRole("button", { name: "保存" });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(document.querySelector(".action-notice")?.textContent).toContain("保存草稿失败");
    });
    expect(onSaved).not.toHaveBeenCalled();

    // Dirty persists -- save button still works on retry
    mocks.saveDraftEdit.mockResolvedValue(defaultSaveResponse);
    await act(async () => {
      fireEvent.click(saveButton);
    });
    await waitFor(() => expect(mocks.saveDraftEdit).toHaveBeenCalledTimes(2));
  });

  // ---- 5. Copy ----

  test("copy writes buffer to clipboard", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    const copyButton = screen.getByRole("button", { name: /复制/ });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(clipboardWriteSpy).toHaveBeenCalledWith("# 标题\n\n从磁盘加载的内容");
  });

  // ---- 6. No download, render/edit toggle, full screen ----

  test("does not render a download button", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    expect(screen.queryByRole("button", { name: "下载" })).toBeNull();
  });

  test("edit mode replaces the rendered view until the user returns to it", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    expect(screen.getByTestId("markdown-preview")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));
    expect(screen.queryByTestId("markdown-preview")).toBeNull();
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        "# 标题\n\n从磁盘加载的内容",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "渲染模式" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("markdown-preview").textContent).toContain(
      "从磁盘加载的内容",
    );
  });

  test("full-screen button expands and restores the sheet", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    const sheet = document.querySelector(".draft-result-sheet") as HTMLElement;
    expect(sheet.classList.contains("is-expanded")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    expect(sheet.classList.contains("is-expanded")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(sheet.classList.contains("is-expanded")).toBe(false);
  });

  // ---- 7. Dirty blocks export ----

  test("dirty state allows clicking export but shows save-first notice", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "dirty" } });
    });

    const exportButton = screen.getByRole("button", { name: "导出" }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(exportButton);
    });

    // Should show save-first notice and NOT locate file
    expect(document.querySelector(".action-notice")?.textContent).toContain("有未保存修改，请先保存后再定位导出文件");
    expect(mocks.revealItemInDir).not.toHaveBeenCalled();
  });

  test("after save, export works", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));

    // Edit to make dirty, then save
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "edited content" } });
    });

    const saveButton = screen.getByRole("button", { name: "保存" });
    await act(async () => {
      fireEvent.click(saveButton);
    });
    await waitFor(() => expect(mocks.saveDraftEdit).toHaveBeenCalledOnce());

    // Export should now be enabled and work
    const exportButton = screen.getByRole("button", { name: "导出" });
    await act(async () => {
      fireEvent.click(exportButton);
    });

    expect(mocks.revealItemInDir).toHaveBeenCalledOnce();
  });

  // ---- 8. Regenerate button ----

  test("regenerate button calls onRegenerate with detail seed insight id", async () => {
    const { onRegenerate } = renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    const regenButton = screen.getByRole("button", { name: /重新生成/ }) as HTMLButtonElement;
    expect(regenButton.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(regenButton);
    });
    expect(onRegenerate).toHaveBeenCalledWith(42);
  });

  test("regenerate falls back to workflow.draftSeedInsightId when detail seed is null", async () => {
    mocks.loadDraftDetail.mockResolvedValue({
      task_id: "task-draft-1",
      markdown: "# 标题\n\n内容",
      has_original_backup: false,
      draft_seed_insight_id: null,
    });
    const workflowWithSeed = completedWorkflow({ draftSeedInsightId: 99 });
    const { onRegenerate } = renderSheet({ workflow: workflowWithSeed });
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /重新生成/ }));
    });
    expect(onRegenerate).toHaveBeenCalledWith(99);
  });

  test("regenerate passes null when both detail and workflow seed are absent", async () => {
    mocks.loadDraftDetail.mockResolvedValue({
      task_id: "task-draft-1",
      markdown: "# 标题\n\n内容",
      has_original_backup: false,
      draft_seed_insight_id: null,
    });
    const { onRegenerate } = renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /重新生成/ }));
    });
    expect(onRegenerate).toHaveBeenCalledWith(null);
  });

  test("regenerate button disabled when buffer is empty", async () => {
    // Workflow with no draft content
    const noDraftWorkflow = completedWorkflow({ draft: "" });
    mocks.loadDraftDetail.mockResolvedValue({
      task_id: "task-draft-1",
      markdown: "",
      has_original_backup: false,
      draft_seed_insight_id: null,
    });

    renderSheet({ workflow: noDraftWorkflow });
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    const regenButton = screen.getByRole("button", { name: /重新生成/ }) as HTMLButtonElement;
    expect(regenButton.disabled).toBe(true);
  });

  // ---- 9. Close ----

  test("close button calls onClose", async () => {
    const { onClose } = renderSheet();

    const closeButton = screen.getByRole("button", { name: /关闭/ });
    await act(async () => {
      fireEvent.click(closeButton);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ---- 10. Not open ----

  test("renders nothing when open is false", () => {
    const { container } = renderSheet({ open: false });
    expect(container.innerHTML).toBe("");
  });
});
