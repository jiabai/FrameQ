// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  summarizeWorkerResult,
  type WorkflowState,
} from "../../workflow";
import type { Insight } from "../../insightPreferences";
import { DraftConfirmationSheet } from "./DraftConfirmationSheet";
import { DraftResultSheet } from "./DraftResultSheet";

const SEED_INSIGHT: Insight = {
  id: 7,
  topic: "短视频开头三秒决定完播率",
  matchReason: "匹配理由正文",
  followUpQuestions: ["问题一", "问题二"],
  suitableUse: "适合用途正文",
  sourceChunkId: 2,
};

function workflowWithSeed(): WorkflowState {
  const state = summarizeWorkerResult({
    status: "completed",
    task_id: "task-draft",
    task_dir: "D:/FrameQ/outputs/tasks/task-draft",
    artifacts: {
      transcript_txt: "transcript/transcript.txt",
      insights_md: "ai/insights.md",
    },
    text: "文字稿正文。",
    summary: "",
    insights: [SEED_INSIGHT],
    transcript: { source: "asr", language: "zh", engine: "SenseVoice" },
    draft: "",
    error: null,
  });
  state.draftSeedInsightId = SEED_INSIGHT.id;
  return state;
}

describe("DraftConfirmationSheet", () => {
  test("renders the seed summary (#id + topic), fixed-1 quota notice, data notice, and confirm/cancel", () => {
    const workflow = workflowWithSeed();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const markup = renderToStaticMarkup(
      <DraftConfirmationSheet
        open
        workflow={workflow}
        busy={false}
        quotaRemaining={5}
        transcriptPath="D:/FrameQ/outputs/tasks/task-draft/transcript/transcript.txt"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // Seed summary: #<id> + full topic text.
    expect(markup).toContain("#7");
    expect(markup).toContain("短视频开头三秒决定完播率");

    // Quota notice shows a FIXED 1 and the exact meaning copy.
    expect(markup).toContain("1 次额度");
    expect(markup).toContain("1 次额度 = 1 次生成尝试，不论成败，重试另计");

    // Data notice reuses the existing privacy copy (video/audio not uploaded),
    // and MUST NOT disclose web search / anysearch.
    expect(markup).toContain("视频和音频不会上传");
    expect(markup).not.toContain("检索");
    expect(markup).not.toContain("联网");
    expect(markup).not.toContain("anysearch");
    expect(markup).not.toContain("搜索");

    // Confirm + cancel affordances.
    expect(markup).toContain("确认");
    expect(markup).toContain("取消");
  });

  test("renders nothing when open is false", () => {
    const markup = renderToStaticMarkup(
      <DraftConfirmationSheet
        open={false}
        workflow={workflowWithSeed()}
        busy={false}
        quotaRemaining={5}
        transcriptPath={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(markup).toBe("");
  });
});

// Mocks for DraftResultSheet tests (loadDraftDetail is mocked at module level
// because DraftResultSheet calls it inside useEffect).
const draftMocks = vi.hoisted(() => ({
  loadDraftDetail: vi.fn(),
  saveDraftEdit: vi.fn(),
}));

vi.mock("../../draftDetailClient", () => ({
  loadDraftDetail: draftMocks.loadDraftDetail,
  saveDraftEdit: draftMocks.saveDraftEdit,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

describe("DraftResultSheet", () => {
  beforeEach(() => {
    draftMocks.loadDraftDetail.mockReset();
    draftMocks.saveDraftEdit.mockReset();
    draftMocks.loadDraftDetail.mockResolvedValue({
      task_id: "task-draft",
      markdown: "# 文字稿标题\n\n正文段落。\n",
      has_original_backup: false,
      draft_seed_insight_id: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("renders draft markdown via sanitized GFM (strips raw HTML, renders mermaid as code)", async () => {
    // loadDraftDetail returns markdown with GFM, Mermaid, and XSS payloads.
    draftMocks.loadDraftDetail.mockResolvedValue({
      task_id: "task-draft",
      markdown: `# 文字稿标题

正文段落。

\`\`\`mermaid
graph TD; A-->B
\`\`\`

<script>alert("xss")</script>
<img src=x onerror="alert(1)">`,
      has_original_backup: false,
      draft_seed_insight_id: null,
    });

    const workflow = workflowWithSeed();
    workflow.draft = "# fallback";
    workflow.artifacts.draft = "ai/draft.md";

    render(
      <DraftResultSheet
        open
        workflow={workflow}
        onSaved={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(draftMocks.loadDraftDetail).toHaveBeenCalledOnce());

    const preview = screen.getByTestId("markdown-preview");

    // GFM heading renders.
    expect(preview.innerHTML).toContain("<h1>文字稿标题</h1>");
    // Mermaid source renders as a fenced code block (plain text, language
    // tagged), NOT a rendered diagram.
    expect(preview.innerHTML).toContain('class="language-mermaid"');
    expect(preview.innerHTML).toContain("graph TD; A--&gt;B");
    expect(preview.innerHTML).not.toContain("class=\"mermaid\"");
    // Raw HTML payload is stripped: no <script> element, no onerror attribute.
    expect(preview.innerHTML).not.toContain("<script>");
    expect(preview.innerHTML).not.toContain("alert");
    expect(preview.innerHTML).not.toContain("onerror");
  });

  test("exposes copy + download + export + regenerate actions and is a separate container from the transcript", async () => {
    const workflow = workflowWithSeed();
    workflow.draft = "文字稿正文。";
    workflow.artifacts.draft = "ai/draft.md";

    render(
      <DraftResultSheet
        open
        workflow={workflow}
        onSaved={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(draftMocks.loadDraftDetail).toHaveBeenCalledOnce());

    expect(screen.getByRole("button", { name: /复制/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "导出" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /重新生成/ })).toBeTruthy();
    // The draft viewer is its own dialog (separate container from transcript).
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("文字稿详情");
  });

  test("renders nothing when open is false", () => {
    const { container } = render(
      <DraftResultSheet
        open={false}
        workflow={workflowWithSeed()}
        onSaved={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
