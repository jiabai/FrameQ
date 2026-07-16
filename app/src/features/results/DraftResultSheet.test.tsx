// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { SaveDraftEditResponse } from "../../draftDetailClient";
import type { TaskArtifacts } from "../../workflow";
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

// Clipboard & URL mocks (jsdom doesn't fully support these)
const clipboardWriteSpy = vi.fn();
beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: clipboardWriteSpy },
  });
  clipboardWriteSpy.mockReset();
});

const createObjectURLSpy = vi.fn(() => "blob:mock-url");
const revokeObjectURLSpy = vi.fn();
beforeEach(() => {
  globalThis.URL.createObjectURL = createObjectURLSpy;
  globalThis.URL.revokeObjectURL = revokeObjectURLSpy;
  createObjectURLSpy.mockReset().mockReturnValue("blob:mock-url");
  revokeObjectURLSpy.mockReset();
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
      <DraftResultSheet
        open
        workflow={workflow}
        onSaved={onSaved}
        onRegenerate={onRegenerate}
        onClose={onClose}
        {...props}
      />,
    ),
  };
}

/** Check that a DOM element exists in the document. */
function expectInDocument(selector: string): HTMLElement {
  const el = document.querySelector(selector);
  expect(el, `expected ${selector} to be in the document`).not.toBeNull();
  return el as HTMLElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DraftResultSheet", () => {
  beforeEach(() => {
    mocks.loadDraftDetail.mockReset();
    mocks.saveDraftEdit.mockReset();
    mocks.revealItemInDir.mockReset();
    // Default: load returns markdown from disk
    mocks.loadDraftDetail.mockResolvedValue({
      task_id: "task-draft-1",
      markdown: "# 标题\n\n从磁盘加载的内容",
      has_original_backup: false,
      draft_seed_insight_id: null,
    });
    mocks.saveDraftEdit.mockResolvedValue(defaultSaveResponse);
  });

  afterEach(() => {
    cleanup();
  });

  // ---- 1. Open loads from disk ----

  test("on open, calls loadDraftDetail and displays loaded markdown in textarea and preview", async () => {
    renderSheet();

    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledWith("task-draft-1"));

    // textarea shows loaded content
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("# 标题\n\n从磁盘加载的内容"));

    // Right side preview renders same content (ReactMarkdown strips markdown to HTML)
    const preview = screen.getByTestId("markdown-preview");
    await waitFor(() => expect(preview.textContent).toContain("标题"));
  });

  // ---- 2. Load failure fallback ----

  test("load failure falls back to workflow.draft and shows notice", async () => {
    mocks.loadDraftDetail.mockRejectedValue(new Error("网络错误"));

    renderSheet();

    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("# 标题\n\n原始草稿内容"));
    expect(document.querySelector(".action-notice")?.textContent).toContain("无法读取草稿");
  });

  // ---- 3. Edit -> dirty -> save ----

  test("editing textarea sets dirty, save calls saveDraftEdit + onSaved + clears dirty + shows notice", async () => {
    const { onSaved } = renderSheet();

    // Wait for load
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    // Edit
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
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

  // ---- 6. Download ----

  test("download creates Blob with buffer content and triggers download with correct filename", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    const downloadButton = screen.getByRole("button", { name: "下载" });
    await act(async () => {
      fireEvent.click(downloadButton);
    });

    expect(createObjectURLSpy).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blobArg = (createObjectURLSpy as any).mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe("text/markdown");

    // Read blob content
    const text = await blobArg.text();
    expect(text).toBe("# 标题\n\n从磁盘加载的内容");

    // Cleanup
    expect(revokeObjectURLSpy).toHaveBeenCalled();
  });

  test("download uses first-line heading as filename", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    // Intercept createElement to capture the anchor
    const originalCreateElement = document.createElement.bind(document);
    let capturedAnchor: HTMLAnchorElement | null = null;
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") capturedAnchor = el as HTMLAnchorElement;
      return el;
    });

    const downloadButton = screen.getByRole("button", { name: "下载" });
    await act(async () => {
      fireEvent.click(downloadButton);
    });

    expect(capturedAnchor).not.toBeNull();
    expect((capturedAnchor as unknown as HTMLAnchorElement).getAttribute("download")).toBe("标题.md");
    expect((capturedAnchor as unknown as HTMLAnchorElement).href).toBe("blob:mock-url");

    vi.restoreAllMocks();
  });

  test("download uses taskId as filename when no heading", async () => {
    mocks.loadDraftDetail.mockResolvedValue({
      task_id: "task-draft-1",
      markdown: "无标题内容",
      has_original_backup: false,
      draft_seed_insight_id: null,
    });

    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    // Intercept createElement to capture the anchor
    const originalCreateElement = document.createElement.bind(document);
    let capturedAnchor: HTMLAnchorElement | null = null;
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") capturedAnchor = el as HTMLAnchorElement;
      return el;
    });

    const downloadButton = screen.getByRole("button", { name: "下载" });
    await act(async () => {
      fireEvent.click(downloadButton);
    });

    expect((capturedAnchor as unknown as HTMLAnchorElement).getAttribute("download")).toBe("task-draft-1.md");

    vi.restoreAllMocks();
  });

  // ---- 7. Dirty blocks download/export ----

  test("dirty state blocks download and shows save-first notice", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    // Edit to make dirty
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# 标题\n\n脏数据" } });
    });

    const downloadButton = screen.getByRole("button", { name: "下载" }) as HTMLButtonElement;
    // dirty should disable the download button
    expect(downloadButton.disabled).toBe(true);

    await act(async () => {
      fireEvent.click(downloadButton);
    });

    // Should not create blob (button is disabled, click does nothing)
    expect(createObjectURLSpy).not.toHaveBeenCalled();

    // After save, download is re-enabled
    mocks.saveDraftEdit.mockResolvedValue(defaultSaveResponse);
    const saveButton = screen.getByRole("button", { name: "保存" });
    await act(async () => {
      fireEvent.click(saveButton);
    });
    await waitFor(() => expect(mocks.saveDraftEdit).toHaveBeenCalledOnce());

    // Download button now enabled
    expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下载" }));
    });
    expect(createObjectURLSpy).toHaveBeenCalledOnce();
  });

  test("dirty state blocks export and shows save-first notice", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "dirty" } });
    });

    const exportButton = screen.getByRole("button", { name: "导出" }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);

    await act(async () => {
      fireEvent.click(exportButton);
    });

    expect(mocks.revealItemInDir).not.toHaveBeenCalled();
  });

  test("after save, export works", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

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

  test("regenerate button calls onRegenerate; disabled when no buffer", async () => {
    const { onRegenerate } = renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    const regenButton = screen.getByRole("button", { name: /重新生成/ }) as HTMLButtonElement;
    expect(regenButton.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(regenButton);
    });
    expect(onRegenerate).toHaveBeenCalledOnce();
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

  // ---- 11. Split layout ----

  test("renders split editor layout with textarea and preview", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.loadDraftDetail).toHaveBeenCalledOnce());

    expectInDocument("textarea.draft-textarea");
    expectInDocument("[data-testid='markdown-preview']");
  });
});
