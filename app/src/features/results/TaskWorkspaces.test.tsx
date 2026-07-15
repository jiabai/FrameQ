import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { createGuestAccountStatus } from "../../accountState";
import {
  createInitialWorkflow,
  startProcessing,
  startInsightRetry,
  summarizeWorkerResult,
  type WorkflowState,
} from "../../workflow";
import { createTaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import type { TranscriptDetailController } from "../transcript/useTranscriptDetailController";
import { LocalTranscriptWorkspace } from "../transcript/LocalTranscriptWorkspace";
import { AiGenerationWorkspace } from "./AiGenerationWorkspace";
import { AiResultDetailSheet } from "./AiResultDetailSheet";
import { TaskStatusBanner } from "./TaskStatusBanner";

function readyWorkflow(): WorkflowState {
  return summarizeWorkerResult({
    status: "completed",
    task_id: "same-task",
    task_dir: "D:/FrameQ/outputs/tasks/same-task",
    artifacts: {
      video: "media/video.mp4",
      audio: "media/audio.wav",
      transcript_txt: "transcript/transcript.txt",
      transcript_md: "transcript/transcript.md",
    },
    text: "第一段正式文字稿。第二段正式文字稿。",
    summary: "",
    insights: [],
    transcript: { source: "asr", language: "zh", engine: "SenseVoice" },
    draft: "",
    error: null,
  });
}

function aiAccount(quota = 8) {
  return {
    ...createGuestAccountStatus(),
    authenticated: true,
    entitlementStatus: "active",
    llmConfigured: true,
    llmQuotaLimit: 10,
    llmQuotaUsed: 10 - quota,
    llmQuotaRemaining: quota,
    canProcess: true,
    canGenerateAi: quota > 0,
  };
}

function transcriptController(): TranscriptDetailController {
  return {
    detailTab: null,
    openDetailTab: vi.fn(),
    closeDetail: vi.fn(),
    detailTitle: "完整文字稿",
    detailText: "第一段正式文字稿。第二段正式文字稿。",
    exportPath: "D:/FrameQ/outputs/tasks/same-task/transcript/transcript.txt",
    currentTranscriptPath: "D:/FrameQ/outputs/tasks/same-task/transcript/transcript.txt",
    transcriptDetail: {
      task_id: "same-task",
      text: "第一段正式文字稿。第二段正式文字稿。",
      segments: [
        { id: "segment-1", start_ms: 0, end_ms: 5000, text: "第一段正式文字稿。" },
        { id: "segment-2", start_ms: 5000, end_ms: 9000, text: "第二段正式文字稿。" },
      ],
      audio_asset_path: "D:/FrameQ/outputs/tasks/same-task/media/audio.wav",
      audio_path: "D:/FrameQ/outputs/tasks/same-task/media/audio.wav",
      has_original_backup: true,
      artifacts: { transcript_txt: "transcript/transcript.txt" },
      transcript: { source: "asr", language: "zh", engine: "SenseVoice" },
    },
    transcriptDraft: "第一段正式文字稿。第二段正式文字稿。",
    transcriptSegments: [
      { id: "segment-1", start_ms: 0, end_ms: 5000, text: "第一段正式文字稿。" },
      { id: "segment-2", start_ms: 5000, end_ms: 9000, text: "第二段正式文字稿。" },
    ],
    transcriptDirty: false,
    transcriptLoading: false,
    transcriptSaving: false,
    activeTranscriptSegmentId: null,
    editingTranscriptSegmentId: null,
    transcriptAudioCurrentTime: 0,
    transcriptAudioDuration: 9,
    transcriptAudioPlaying: false,
    transcriptAudioRef: createRef<HTMLAudioElement>(),
    transcriptSegmentRefs: { current: {} },
    transcriptSourceLabel: "来源：本地 ASR",
    transcriptAudioSrc: "asset://audio.wav",
    transcriptAudioProgress: 0,
    transcriptAudioScrubberMax: 9,
    transcriptAudioScrubberStyle: { "--audio-progress": "0%" },
    hasTranscriptSegments: true,
    copyDetail: vi.fn(),
    copyTranscript: vi.fn(),
    exportDetail: vi.fn(),
    exportTranscript: vi.fn(),
    saveTranscriptDraft: vi.fn(),
    playTranscriptSegment: vi.fn(),
    handleTranscriptAudioMetadata: vi.fn(),
    handleTranscriptTimeUpdate: vi.fn(),
    handleTranscriptAudioPlay: vi.fn(),
    handleTranscriptAudioPause: vi.fn(),
    toggleTranscriptAudio: vi.fn(),
    scrubTranscriptAudio: vi.fn(),
    beginTranscriptSegmentEdit: vi.fn(),
    endTranscriptSegmentEdit: vi.fn(),
    updateTranscriptSegmentDraft: vi.fn(),
    updateFullTranscriptDraft: vi.fn(),
  } as unknown as TranscriptDetailController;
}

describe("task domain workspaces", () => {
  test("renders a local completion banner and two labelled workspaces for the same task", () => {
    const workflow = readyWorkflow();
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <>
        <TaskStatusBanner model={model.banner} />
        <LocalTranscriptWorkspace
          workflow={workflow}
          model={model.local}
          controller={transcriptController()}
          actionNotice=""
          onLocateArtifact={vi.fn()}
          onCancel={vi.fn()}
        />
        <AiGenerationWorkspace
          workflow={workflow}
          model={model.ai}
          quotaRemaining={8}
          onSummaryAction={vi.fn()}
          onInsightsAction={vi.fn()}
          onDraftAction={vi.fn()}
          onViewTarget={vi.fn()}
          onCancel={vi.fn()}
        />
      </>,
    );

    expect(markup).toContain('aria-label="任务状态"');
    expect(markup).toContain("视频、音频和文字稿已保存在本机");
    expect(markup).toContain('aria-label="本地文字稿工作区"');
    expect(markup).toContain('data-task-id="same-task"');
    expect(markup).toContain('aria-label="智能提炼工作区"');
    expect(markup.match(/data-task-id="same-task"/g)).toHaveLength(2);
    expect(markup).toContain("文字稿校对");
    expect(markup).toContain("智能提炼");
    expect(markup).not.toContain("Local transcript");
    expect(markup).not.toContain("Cloud AI");
    expect(markup).not.toContain(">本地完成</span>");
    expect(markup).not.toContain(">可选</span>");
    expect(markup.match(/class="ai-target-status"/g)).toHaveLength(3);
  });

  test("keeps meaningful workspace statuses for active and constrained states", () => {
    const processingWorkflow = startProcessing(createInitialWorkflow(), "https://example.invalid/video");
    const processingModel = createTaskWorkspaceViewModel(processingWorkflow, aiAccount());
    const processingMarkup = renderToStaticMarkup(
      <>
        <LocalTranscriptWorkspace
          workflow={processingWorkflow}
          model={processingModel.local}
          controller={transcriptController()}
          actionNotice=""
          onLocateArtifact={vi.fn()}
          onCancel={vi.fn()}
        />
        <AiGenerationWorkspace
          workflow={processingWorkflow}
          model={processingModel.ai}
          quotaRemaining={8}
          onSummaryAction={vi.fn()}
          onInsightsAction={vi.fn()}
          onDraftAction={vi.fn()}
          onViewTarget={vi.fn()}
          onCancel={vi.fn()}
        />
      </>,
    );
    expect(processingMarkup).toContain(">处理中</span>");
    expect(processingMarkup).toContain(">等待文字稿</span>");

    const failedWorkflow = summarizeWorkerResult({
      status: "failed",
      task_id: null,
      task_dir: null,
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
      transcript: null,
      draft: "",
      error: { code: "MEDIA_DOWNLOAD_FAILED", message: "failed", stage: "video_extracting" },
    });
    const failedModel = createTaskWorkspaceViewModel(failedWorkflow, aiAccount());
    const failedMarkup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        workflow={failedWorkflow}
        model={failedModel.local}
        controller={transcriptController()}
        actionNotice=""
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(failedMarkup).toContain(">处理失败</span>");

    const generatingWorkflow = startInsightRetry(readyWorkflow(), "summary");
    const generatingModel = createTaskWorkspaceViewModel(generatingWorkflow, aiAccount());
    const generatingMarkup = renderToStaticMarkup(
      <AiGenerationWorkspace
        workflow={generatingWorkflow}
        model={generatingModel.ai}
        quotaRemaining={8}
        onSummaryAction={vi.fn()}
        onInsightsAction={vi.fn()}
        onDraftAction={vi.fn()}
        onViewTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(generatingMarkup).toContain(">生成中</span>");
  });

  test("local workspace is audio-first with compact file actions and inline transcript review", () => {
    const workflow = readyWorkflow();
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        workflow={workflow}
        model={model.local}
        controller={transcriptController()}
        actionNotice=""
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="音频回听工具栏"');
    expect(markup).toContain('class="local-artifact-toolbar"');
    expect(markup).toContain("定位视频");
    expect(markup).toContain("定位音频");
    expect(markup).toContain('class="transcript-review-panel"');
    expect(markup).toContain("第一段正式文字稿。");
    expect(markup).toContain('class="transcript-action-bar"');
    expect(markup.match(/class="transcript-segment /g)).toHaveLength(2);
    expect(markup).not.toContain("result-grid");
  });

  test("AI workspace has independent summary and inspiration targets without a mindmap target", () => {
    const workflow = readyWorkflow();
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <AiGenerationWorkspace
        workflow={workflow}
        model={model.ai}
        quotaRemaining={8}
        onSummaryAction={vi.fn()}
        onInsightsAction={vi.fn()}
        onDraftAction={vi.fn()}
        onViewTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("智能提炼");
    expect(markup).toContain("确认后仅发送文字稿片段，视频和音频不会上传");
    expect(markup).toContain('data-ai-target="summary"');
    expect(markup).toContain("要点总结");
    expect(markup).toContain("同时生成思维导图文件");
    expect(markup).toContain('data-ai-target="insights"');
    // Three cards: summary, insights, and the draft target card (6.1).
    expect(markup.match(/<article class="ai-target-card/g)).toHaveLength(3);
    expect(markup).toContain("启发灵感");
    expect(markup).toContain("AI Credits 余额：8");
    expect(markup).toContain("一次 AI 整理可能消耗多个 Credits。");
    expect(markup).not.toContain("当前可用 8 次");
    expect(markup).not.toContain('data-ai-target="mindmap"');
    expect(markup).toContain('data-ai-target="draft"');
    expect(markup).toContain("生成文字稿");
    expect(markup).not.toContain('class="primary-button"');
  });

  test("draft target card is quietly disabled until an inspiration seed is selected", () => {
    // With no insights generated, the draft card must not expose an LLM
    // entry or consume quota. The generate action is disabled.
    const workflow = readyWorkflow();
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <AiGenerationWorkspace
        workflow={workflow}
        model={model.ai}
        quotaRemaining={8}
        onSummaryAction={vi.fn()}
        onInsightsAction={vi.fn()}
        onDraftAction={vi.fn()}
        onViewTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain('data-ai-target="draft"');
    // The draft action button is disabled (locked status -> disabled="").
    expect(markup).toContain(
      'class="secondary-button ai-target-action" disabled=""',
    );
    expect(markup).toContain("请先生成启发灵感");
  });

  test("AI generation keeps transcript review visible but disables editing and saving", () => {
    const workflow = startInsightRetry(readyWorkflow(), "summary");
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        workflow={workflow}
        model={model.local}
        controller={transcriptController()}
        actionNotice=""
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("AI 正在使用已保存版本");
    expect(markup).toContain("第一段正式文字稿。");
    expect(markup).toContain('aria-label="播放音频"');
    expect(markup).toContain(
      'class="secondary-button compact-button transcript-segment-edit"',
    );
    expect(markup).toContain('aria-label="编辑此片段"');
    expect(markup).toContain('title="编辑"');
    expect(markup).toContain('class="lucide lucide-pencil"');
    expect(markup).not.toMatch(/>编辑<\/button>/);
    expect(markup).toMatch(
      /class="secondary-button compact-button transcript-segment-edit"[^>]*disabled=""[^>]*aria-label="编辑此片段"/,
    );
    expect(markup).toContain('class="primary-button" disabled=""');
    expect(markup).toContain("<span>保存</span>");
  });

  test("quota exhaustion is explained in the AI workspace without disabling local review", () => {
    const workflow = readyWorkflow();
    const model = createTaskWorkspaceViewModel(workflow, aiAccount(0));
    const markup = renderToStaticMarkup(
      <AiGenerationWorkspace
        workflow={workflow}
        model={model.ai}
        quotaRemaining={0}
        notice="无法读取本次 AI 偏好"
        onSummaryAction={vi.fn()}
        onInsightsAction={vi.fn()}
        onDraftAction={vi.fn()}
        onViewTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("AI Credits 已用完");
    expect(markup).toContain('class="ai-workspace-notice"');
    expect(markup).toContain("无法读取本次 AI 偏好");
    expect(markup).toContain('disabled=""');
  });

  test("inspiration detail sheet exposes a replace-on-select seed affordance for each insight", () => {
    // The seed selection is single-select but selecting another insight
    // replaces the current seed (radio behaviour) rather than blocking it.
    const workflow: WorkflowState = {
      ...readyWorkflow(),
      insights: [
        {
          id: 11,
          topic: "种子话题 A",
          matchReason: "匹配",
          followUpQuestions: ["问题 A"],
          suitableUse: "适合",
          sourceChunkId: null,
        },
        {
          id: 12,
          topic: "种子话题 B",
          matchReason: "匹配",
          followUpQuestions: ["问题 B"],
          suitableUse: "适合",
          sourceChunkId: null,
        },
      ],
      draftSeedInsightId: 11,
    };
    const controller = {
      ...transcriptController(),
      detailTab: "insights" as const,
    };
    const markup = renderToStaticMarkup(
      <AiResultDetailSheet
        actionNotice=""
        controller={controller}
        workflow={workflow}
        onOpenDirectionEditor={vi.fn()}
        onSelectDraftSeed={vi.fn()}
        onClearDraftSeed={vi.fn()}
      />,
    );

    // Each insight exposes the seed affordance: the selected one shows the
    // summary + clear action, the others show the "选为文字稿种子" button.
    expect(markup).toContain("已选为文字稿种子。");
    expect(markup).toContain("取消种子");
    // Exactly one non-selected insight renders the select button (the
    // "已选为文字稿种子。" summary also contains this substring, so scope the
    // match to the button's span).
    expect(markup.match(/<span>选为文字稿种子<\/span>/g)).toHaveLength(1);

    // Replace-on-select: the non-selected insight's seed button is NOT
    // disabled (clicking it replaces the current seed).
    expect(markup).not.toMatch(
      /选为文字稿种子[\s\S]*?disabled=""/,
    );
    // The selected insight is highlighted and aria-current.
    expect(markup).toContain("draft-seed-selected");
    expect(markup).toContain('aria-current="true"');
  });

  test("inspiration detail sheet has no seed selected until the user picks one", () => {
    const workflow: WorkflowState = {
      ...readyWorkflow(),
      insights: [
        {
          id: 21,
          topic: "种子话题",
          matchReason: "匹配",
          followUpQuestions: ["问题"],
          suitableUse: "适合",
          sourceChunkId: null,
        },
      ],
      draftSeedInsightId: null,
    };
    const controller = {
      ...transcriptController(),
      detailTab: "insights" as const,
    };
    const markup = renderToStaticMarkup(
      <AiResultDetailSheet
        actionNotice=""
        controller={controller}
        workflow={workflow}
        onOpenDirectionEditor={vi.fn()}
        onSelectDraftSeed={vi.fn()}
        onClearDraftSeed={vi.fn()}
      />,
    );

    // No highlight, no clear action, just the select affordance (enabled).
    expect(markup).not.toContain("draft-seed-selected");
    expect(markup).not.toContain("取消种子");
    expect(markup).toContain("选为文字稿种子");
    expect(markup).not.toContain('disabled=""');
  });
});
