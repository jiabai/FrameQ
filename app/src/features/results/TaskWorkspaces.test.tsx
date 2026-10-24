import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { createGuestAccountStatus } from "../../accountState";
import {
  createInitialWorkflow,
  requestProcessingCancellation,
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
import { initializeI18n } from "../../i18n/i18n";
import type { SupportedLocale } from "../../i18n/locale";

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
    dissection: null,
    dissection_source_status: null,
    draft: "",
    error: null,
  });
}

function generatedDissectionWorkflow(): WorkflowState {
  const workflow = readyWorkflow();
  return {
    ...workflow,
    artifacts: {
      ...workflow.artifacts,
      dissection: "ai/dissection.json",
      dissection_md: "ai/dissection.md",
    },
    dissection: {
      schemaVersion: 1,
      sourceTranscriptSha256: "a".repeat(64),
      sourceLanguage: "zh-CN",
      sourceChunks: [{ id: 1, startByte: 0, endByte: 27, sha256: "b".repeat(64) }],
      overallNarrative: {
        openingHook: "问题钩子",
        structureType: "问题—分析—结论",
        turningPoint: "第二段",
        closingType: "总结",
      },
      segments: [{
        id: 1,
        title: "开场",
        sourceChunkIds: [1],
        coreClaim: "第一段正式文字稿。",
        supportingPoints: ["第二段正式文字稿。"],
        rhetoricalDevices: ["设问"],
        rhythmNote: "简洁",
        reusablePattern: "提出[问题]后给出[结论]",
        riskFlags: [],
      }],
      highlights: ["第一段正式文字稿。"],
      reusableTemplate: { name: "问题解答", skeleton: ["提出问题", "展开分析", "给出结论"] },
      audienceFit: [{ audience: "初学者", fit: "high", note: "容易理解" }],
      strengths: ["结构清晰"],
      weaknesses: ["论据较少"],
    },
  };
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
    copyTranscriptFile: vi.fn(),
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
  beforeAll(async () => {
    await initializeI18n("zh-CN");
  });

  test("renders a local completion banner and two labelled workspaces for the same task", () => {
    const workflow = readyWorkflow();
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <>
        <TaskStatusBanner model={model.banner} />
        <LocalTranscriptWorkspace
          model={model.local}
          controller={transcriptController()}
          actionNotice={null}
          polishingTranscript={false}
          onPolishTranscript={vi.fn()}
          onLocateArtifact={vi.fn()}
          onCancel={vi.fn()}
        />
        <AiGenerationWorkspace
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
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('data-motion="task-status"');
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
    expect(markup.match(/class="ai-target-status"/g)).toHaveLength(4);
  });

  test("keeps meaningful workspace statuses for active and constrained states", () => {
    const processingWorkflow = startProcessing(createInitialWorkflow(), {
      kind: "url",
      url: "https://example.invalid/video",
    });
    const processingModel = createTaskWorkspaceViewModel(processingWorkflow, aiAccount());
    const processingMarkup = renderToStaticMarkup(
      <>
        <LocalTranscriptWorkspace
          model={processingModel.local}
          controller={transcriptController()}
          actionNotice={null}
          polishingTranscript={false}
          onPolishTranscript={vi.fn()}
          onLocateArtifact={vi.fn()}
          onCancel={vi.fn()}
        />
        <AiGenerationWorkspace
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
      dissection: null,
      dissection_source_status: null,
      draft: "",
      error: { code: "MEDIA_DOWNLOAD_FAILED", message: "failed", stage: "video_extracting" },
    });
    const failedModel = createTaskWorkspaceViewModel(failedWorkflow, aiAccount());
    const failedMarkup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={failedModel.local}
        controller={transcriptController()}
          actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(failedMarkup).toContain(">处理失败</span>");

    const generatingWorkflow = startInsightRetry(readyWorkflow(), "summary");
    const generatingModel = createTaskWorkspaceViewModel(generatingWorkflow, aiAccount());
    const generatingMarkup = renderToStaticMarkup(
      <AiGenerationWorkspace
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

  test("shows motion only for the active local processing stage", () => {
    const extractingWorkflow = startProcessing(
      createInitialWorkflow(),
      { kind: "url", url: "https://example.invalid/video" },
    );
    const extractingModel = createTaskWorkspaceViewModel(extractingWorkflow, aiAccount());
    const extractingMarkup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={extractingModel.local}
        controller={transcriptController()}
        actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(extractingMarkup).toMatch(
      /<span class="active"><svg[^>]*lucide-loader-circle spin/,
    );
    expect(extractingMarkup).toContain('data-motion="local-stage"');
    expect(extractingMarkup).not.toMatch(
      /<span class="pending"><svg[^>]*lucide-loader-circle spin/,
    );

    const transcribingWorkflow: WorkflowState = {
      ...extractingWorkflow,
      stage: "video_transcribing",
    };
    const transcribingModel = createTaskWorkspaceViewModel(transcribingWorkflow, aiAccount());
    const transcribingMarkup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={transcribingModel.local}
        controller={transcriptController()}
        actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(transcribingMarkup).toMatch(
      /<span class="complete"><svg[^>]*lucide-circle-check/,
    );
    expect(transcribingMarkup).toMatch(
      /<span class="active"><svg[^>]*lucide-loader-circle spin/,
    );
  });

  test("labels local audio preparation without claiming that a video is being extracted", () => {
    const workflow = startProcessing(createInitialWorkflow(), {
      kind: "local_file",
      displayName: "Interview.mp3",
      mediaKind: "audio",
    });
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={model.local}
        controller={transcriptController()}
        actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("音频准备中");
    expect(markup).not.toContain("视频提取中");
  });

  test("hides transcript file actions until a saved transcript exists", () => {
    const workflow = startProcessing(createInitialWorkflow(), {
      kind: "local_file",
      displayName: "Interview.mp3",
      mediaKind: "audio",
    });
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={model.local}
        controller={transcriptController()}
        actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).not.toContain("定位文字稿");
    expect(markup).not.toContain("复制文字稿");
  });

  test("keeps the idle task banner static", () => {
    const model = createTaskWorkspaceViewModel(createInitialWorkflow(), aiAccount());
    const markup = renderToStaticMarkup(<TaskStatusBanner model={model.banner} />);

    expect(markup).not.toContain('class="lucide lucide-loader-circle spin"');
  });

  test("local workspace is audio-first with compact file actions and inline transcript review", () => {
    const workflow = readyWorkflow();
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={model.local}
        controller={transcriptController()}
          actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="音频回听工具栏"');
    expect(markup).toContain('class="local-artifact-toolbar"');
    expect(markup).toContain("定位视频");
    expect(markup).toContain("定位音频");
    expect(markup).toContain("定位文字稿");
    expect(markup).toContain("整理文字稿");
    expect(markup).not.toContain("复制文字稿");
    expect(markup.indexOf("定位文字稿")).toBeLessThan(
      markup.indexOf("整理文字稿"),
    );
    expect(markup).toContain('class="transcript-review-panel"');
    expect(markup).toContain("第一段正式文字稿。");
    expect(markup).toContain('class="transcript-action-bar"');
    expect(markup.match(/class="transcript-segment /g)).toHaveLength(2);
    expect(markup).not.toContain("result-grid");
  });

  test("hides transcript segments whose text was cleared without changing the saved timeline", () => {
    const workflow = readyWorkflow();
    const baseController = transcriptController();
    const segments = [
      { id: "segment-empty", start_ms: 0, end_ms: 5000, text: "   " },
      { id: "segment-visible", start_ms: 5000, end_ms: 9000, text: "保留的文字稿内容。" },
    ];
    const controller = {
      ...baseController,
      transcriptDraft: "保留的文字稿内容。",
      transcriptSegments: segments,
      transcriptDetail: baseController.transcriptDetail
        ? { ...baseController.transcriptDetail, text: "保留的文字稿内容。", segments }
        : baseController.transcriptDetail,
    } as TranscriptDetailController;
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={model.local}
        controller={controller}
        actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup.match(/class="transcript-segment /g)).toHaveLength(1);
    expect(markup).not.toContain("segment-empty");
    expect(markup).toContain("保留的文字稿内容。");
    expect(controller.transcriptSegments).toHaveLength(2);
  });

  test("renders an audio-only local workspace from the facade model without workflow state", () => {
    const workflow = summarizeWorkerResult({
      status: "completed",
      task_id: "audio-only-task",
      task_dir: "D:/FrameQ/outputs/tasks/audio-only-task",
      artifacts: {
        audio: "media/audio.wav",
        transcript_txt: "transcript/transcript.txt",
        transcript_md: "transcript/transcript.md",
      },
      text: "音频文件文字稿。",
      summary: "",
      insights: [],
      transcript: { source: "asr", language: "zh", engine: "SenseVoice" },
      dissection: null,
      dissection_source_status: null,
      draft: "",
      error: null,
    });
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={model.local}
        controller={transcriptController()}
        actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).not.toContain("定位视频");
    expect(markup).toContain("定位音频");
    expect(markup).toContain("定位文字稿");
    expect(markup).toContain("整理文字稿");
    expect(markup).toContain("来源：本地 ASR");
  });

  test("local workspace swaps the polish button for copy once a polished transcript exists", () => {
    const workflow = summarizeWorkerResult({
      status: "completed",
      task_id: "polished-task",
      task_dir: "D:/FrameQ/outputs/tasks/polished-task",
      artifacts: {
        audio: "media/audio.wav",
        transcript_txt: "transcript/transcript.txt",
        transcript_md: "transcript/transcript.md",
      },
      text: "音频文件文字稿。",
      summary: "",
      insights: [],
      transcript: { source: "asr", language: "zh", engine: "SenseVoice" },
      dissection: null,
      dissection_source_status: null,
      draft: "",
      error: null,
    });
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const polishedController: TranscriptDetailController = {
      ...transcriptController(),
      transcriptDetail: {
        ...transcriptController().transcriptDetail!,
        polished_text: "整理后的音频文件文字稿。",
      },
    };
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={model.local}
        controller={polishedController}
        actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("复制文字稿");
    expect(markup).not.toContain("整理文字稿");
  });

  test("local workspace marks the polish button busy while polishing", () => {
    const workflow = summarizeWorkerResult({
      status: "completed",
      task_id: "polishing-task",
      task_dir: "D:/FrameQ/outputs/tasks/polishing-task",
      artifacts: {
        audio: "media/audio.wav",
        transcript_txt: "transcript/transcript.txt",
        transcript_md: "transcript/transcript.md",
      },
      text: "音频文件文字稿。",
      summary: "",
      insights: [],
      transcript: { source: "asr", language: "zh", engine: "SenseVoice" },
      dissection: null,
      dissection_source_status: null,
      draft: "",
      error: null,
    });
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={model.local}
        controller={transcriptController()}
        actionNotice={null}
        polishingTranscript={true}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("整理中");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled=""');
  });

  test("AI workspace has independent summary, inspiration, and dissection targets without a mindmap target", () => {
    const workflow = readyWorkflow();
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <AiGenerationWorkspace
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
    expect(markup.match(/data-motion="ai-target"/g)).toHaveLength(4);
    expect(markup).toContain("要点总结");
    expect(markup).toContain("同时生成 Mermaid 思维导图文件");
    expect(markup).toContain('data-ai-target="insights"');
    // Four cards: summary, dissection, insights, and the draft target card (6.1).
    expect(markup.match(/<article class="ai-target-card/g)).toHaveLength(4);
    expect(markup).toContain('data-ai-target="dissection"');
    expect(markup).toContain("文字稿解剖");
    expect(markup).toContain("启发灵感");
    expect(markup.indexOf('data-ai-target="dissection"')).toBeLessThan(
      markup.indexOf('data-ai-target="insights"'),
    );
    expect(markup).toContain("AI Credits 余额：8");
    expect(markup).toContain("一次智能提炼可能消耗多个 Credits。");
    expect(markup).not.toContain("当前可用 8 次");
    expect(markup).not.toContain('data-ai-target="mindmap"');
    expect(markup.match(/class="secondary-button ai-target-action"/g)).toHaveLength(4);
    expect(markup).toContain('data-ai-target="draft"');
    expect(markup).toContain("选择种子并生成");
    expect(markup).not.toContain('class="primary-button"');
  });

  test("generated dissection card exposes only the view action", () => {
    const model = createTaskWorkspaceViewModel(generatedDissectionWorkflow(), aiAccount());
    const markup = renderToStaticMarkup(
      <AiGenerationWorkspace
        model={model.ai}
        quotaRemaining={8}
        onSummaryAction={vi.fn()}
        onInsightsAction={vi.fn()}
        onDissectionAction={vi.fn()}
        onDraftAction={vi.fn()}
        onViewTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dissectionCard = markup.match(
      /<article[^>]*data-ai-target="dissection"[\s\S]*?<\/article>/,
    )?.[0];

    expect(dissectionCard).toBeDefined();
    expect(dissectionCard).toContain("查看结果");
    expect(dissectionCard).not.toContain("确认生成");
    expect(dissectionCard).not.toContain('class="secondary-button ai-target-action"');
  });

  test("generated dissection detail exposes a specifically named redissection action", () => {
    const workflow = generatedDissectionWorkflow();
    const controller = {
      ...transcriptController(),
      detailTab: "dissection",
      detailText: "# 文字稿解剖",
      exportPath: "D:/FrameQ/outputs/tasks/same-task/ai/dissection.md",
    } as TranscriptDetailController;
    const markup = renderToStaticMarkup(
      <AiResultDetailSheet
        actionNotice={null}
        controller={controller}
        workflow={workflow}
        onOpenDirectionEditor={vi.fn()}
        onOpenDissectionConfirmation={vi.fn()}
        onLocateDissectionChunks={vi.fn()}
      />,
    );

    expect(markup).toContain("重新解剖");
    expect(markup).not.toContain("重新生成");
  });

  test("dissection detail never falls through to the inspiration empty state when the report object is missing", () => {
    const workflow = {
      ...readyWorkflow(),
      artifacts: {
        ...readyWorkflow().artifacts,
        dissection: "ai/dissection.json",
        dissection_md: "ai/dissection.md",
      },
      dissection: null,
    };
    const controller = {
      ...transcriptController(),
      detailTab: "dissection",
      detailText: "",
      exportPath: "D:/FrameQ/outputs/tasks/same-task/ai/dissection.md",
    } as TranscriptDetailController;
    const markup = renderToStaticMarkup(
      <AiResultDetailSheet
        actionNotice={null}
        controller={controller}
        workflow={workflow}
        onOpenDirectionEditor={vi.fn()}
        onOpenDissectionConfirmation={vi.fn()}
        onLocateDissectionChunks={vi.fn()}
      />,
    );

    expect(markup).toContain("文字稿解剖尚未生成。");
    expect(markup).not.toContain("启发灵感尚未生成。");
    expect(markup).not.toContain('class="insight-detail-list"');
  });

  test("renders AI cancellation from the facade model without workflow state", () => {
    const workflow = requestProcessingCancellation(
      startInsightRetry(readyWorkflow(), "summary"),
    );
    const model = createTaskWorkspaceViewModel(workflow, aiAccount());
    const markup = renderToStaticMarkup(
      <AiGenerationWorkspace
        model={model.ai}
        quotaRemaining={8}
        onSummaryAction={vi.fn()}
        onInsightsAction={vi.fn()}
        onDraftAction={vi.fn()}
        onViewTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("正在取消");
    expect(markup).toMatch(/class="secondary-button danger-soft ai-cancel-button"[^>]*disabled=""/);
  });

  test("draft target card is quietly disabled until an inspiration seed is selected", () => {
    // With no insights generated, the draft card must not expose an LLM
    // entry or consume quota. The generate action is disabled.
    const draftModel = createTaskWorkspaceViewModel(readyWorkflow(), aiAccount());
    const markup = renderToStaticMarkup(
      <AiGenerationWorkspace
        model={draftModel.ai}
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
        model={model.local}
        controller={transcriptController()}
          actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
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
        model={model.ai}
        quotaRemaining={0}
        notice={{ messageCode: "preferences.notice.preferencesReadFailed" }}
        onSummaryAction={vi.fn()}
        onInsightsAction={vi.fn()}
        onDraftAction={vi.fn()}
        onViewTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("AI Credits 已用完");
    expect(markup).toContain('class="ai-workspace-notice"');
    expect(markup).toContain("无法读取本地偏好，请稍后重试。");
    expect(markup).toContain('disabled=""');
  });

  test.each([
    ["zh-CN", "本地文字稿工作区", "文字稿校对", "播放音频", "编辑此片段", "复制", "导出", "保存"],
    ["zh-TW", "本機逐字稿工作區", "逐字稿校對", "播放音訊", "編輯此片段", "複製", "匯出", "儲存"],
    ["en-US", "Local Transcript workspace", "Transcript Review", "Play audio", "Edit this segment", "Copy", "Export", "Save"],
  ] as const)(
    "localizes transcript controls and audio accessibility copy in %s",
    async (locale, workspaceLabel, title, playAudio, editSegment, copy, exportLabel, save) => {
      await initializeI18n(locale as SupportedLocale);
      const workflow = readyWorkflow();
      const model = createTaskWorkspaceViewModel(workflow, aiAccount());
      const markup = renderToStaticMarkup(
        <LocalTranscriptWorkspace
          model={model.local}
          controller={transcriptController()}
          actionNotice={null}
          polishingTranscript={false}
          onPolishTranscript={vi.fn()}
          onLocateArtifact={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(markup).toContain(`aria-label="${workspaceLabel}"`);
      expect(markup).toContain(title);
      expect(markup).toContain(`aria-label="${playAudio}"`);
      expect(markup).toContain(`aria-label="${editSegment}"`);
      expect(markup).toContain(`>${copy}</span>`);
      expect(markup).toContain(`>${exportLabel}</span>`);
      expect(markup).toContain(`>${save}</span>`);
      expect(markup).toContain("第一段正式文字稿。");

      await initializeI18n("zh-CN");
    },
  );

  test("shows a localized generic worker error with only a safe code", async () => {
    await initializeI18n("en-US");
    const failedWorkflow = summarizeWorkerResult({
      status: "failed",
      task_id: null,
      task_dir: null,
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
      transcript: null,
      dissection: null,
      dissection_source_status: null,
      draft: "",
      error: {
        code: "FUTURE_WORKER_FAILURE",
        message: "Authorization: Bearer super-secret at C:/private/transcript.txt",
        stage: "video_transcribing",
      },
    });
    const model = createTaskWorkspaceViewModel(failedWorkflow, aiAccount());
    const markup = renderToStaticMarkup(
      <LocalTranscriptWorkspace
        model={model.local}
        controller={transcriptController()}
          actionNotice={null}
        polishingTranscript={false}
        onPolishTranscript={vi.fn()}
        onLocateArtifact={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("The operation failed. Try again later.");
    expect(markup).toContain("Technical details");
    expect(markup).toContain("FUTURE_WORKER_FAILURE");
    expect(markup).not.toContain("super-secret");
    expect(markup).not.toContain("C:/private");
    await initializeI18n("zh-CN");
  });

  test.each([
    ["zh-CN", "处理已超过最长运行时间，FrameQ 已停止本次任务。现有结果已保留，请重试。"],
    ["zh-TW", "處理已超過最長執行時間，FrameQ 已停止本次工作。現有結果已保留，請重試。"],
    ["en-US", "FrameQ stopped this operation after it reached the maximum run time. Existing results were kept; try again."],
  ] as const)(
    "shows AI execution-timeout recovery guidance in %s",
    async (locale, expectedGuidance) => {
      await initializeI18n(locale);
      const source = readyWorkflow();
      const failedWorkflow = summarizeWorkerResult(
        {
          status: "partial_completed",
          task_id: source.taskId,
          task_dir: source.taskDir,
          artifacts: source.artifacts,
          text: source.text,
          summary: source.summary,
          insights: source.insights,
          transcript: source.transcript,
          dissection: null,
          dissection_source_status: null,
          draft: source.draft,
          error: {
            code: "WORKER_EXECUTION_TIMEOUT",
            message: "untrusted runtime detail",
            stage: "insights_generating",
          },
        },
        "summary",
      );
      const model = createTaskWorkspaceViewModel(failedWorkflow, aiAccount());
      const markup = renderToStaticMarkup(
        <AiGenerationWorkspace
          model={model.ai}
          quotaRemaining={8}
          onSummaryAction={vi.fn()}
          onInsightsAction={vi.fn()}
          onDraftAction={vi.fn()}
          onViewTarget={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(markup).toContain(expectedGuidance);
      expect(markup).not.toContain("untrusted runtime detail");
      await initializeI18n("zh-CN");
    },
  );

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
        actionNotice={null}
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
        actionNotice={null}
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
