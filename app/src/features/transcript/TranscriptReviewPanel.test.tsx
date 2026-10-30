import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { initializeI18n } from "../../i18n/i18n";
import type { TranscriptDetailController } from "./useTranscriptDetailController";
import { TranscriptReviewPanel } from "./TranscriptReviewPanel";

const FIRST_SEGMENT_TEXT = "第一段正式文字稿。";
const SECOND_SEGMENT_TEXT = "第二段正式文字稿。";
const TRANSCRIPT_DRAFT = `${FIRST_SEGMENT_TEXT}${SECOND_SEGMENT_TEXT}`;
const SEGMENTS = [
  { id: "segment-1", start_ms: 0, end_ms: 5000, text: FIRST_SEGMENT_TEXT },
  { id: "segment-2", start_ms: 5000, end_ms: 9000, text: SECOND_SEGMENT_TEXT },
];

type LocatedRange = { start: number; end: number } | null;

function panelController(locatedTranscriptRange: LocatedRange): TranscriptDetailController {
  return {
    transcriptDetail: null,
    transcriptDraft: TRANSCRIPT_DRAFT,
    transcriptSegments: SEGMENTS,
    transcriptDirty: false,
    transcriptLoading: false,
    transcriptSaving: false,
    locatedTranscriptRange,
    activeTranscriptSegmentId: null,
    editingTranscriptSegmentId: null,
    transcriptAudioCurrentTime: 0,
    transcriptAudioDuration: 0,
    transcriptAudioPlaying: false,
    transcriptAudioRef: createRef<HTMLAudioElement>(),
    transcriptSegmentRefs: { current: {} },
    transcriptAudioSrc: null,
    transcriptAudioProgress: 0,
    transcriptAudioScrubberMax: 0,
    transcriptAudioScrubberStyle: {},
    currentTranscriptPath: "D:/FrameQ/outputs/tasks/same-task/transcript/transcript.txt",
    copyTranscript: vi.fn(),
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

function renderPanel(locatedTranscriptRange: LocatedRange): string {
  return renderToStaticMarkup(
    <TranscriptReviewPanel
      transcriptSource={{ kind: "asr" }}
      controller={panelController(locatedTranscriptRange)}
      editingDisabled={false}
      readOnlyReason={null}
    />,
  );
}

function segmentClassNames(markup: string): string[] {
  return [
    ...markup.matchAll(/class="(transcript-segment(?: [^"]*)?)"/g),
  ].map((match) => match[1]);
}

describe("transcript review panel dissection source highlighting", () => {
  beforeAll(async () => {
    await initializeI18n("zh-CN");
  });

  test("renders both segments without a source highlight before any lookup", () => {
    const markup = renderPanel(null);

    expect(segmentClassNames(markup)).toHaveLength(2);
    expect(markup).not.toContain("dissection-source");
  });

  test("renders no source highlight for a zero-width located range", () => {
    const markup = renderPanel({ start: 4, end: 4 });

    expect(markup).not.toContain("dissection-source");
  });

  test("highlights only the segment matching the located range", () => {
    const start = TRANSCRIPT_DRAFT.indexOf(SECOND_SEGMENT_TEXT);
    const markup = renderPanel({
      start,
      end: start + SECOND_SEGMENT_TEXT.length,
    });

    const classNames = segmentClassNames(markup);
    expect(classNames).toHaveLength(2);
    expect(classNames[0]).not.toContain("dissection-source");
    expect(classNames[1]).toContain("dissection-source");
    expect(markup.match(/dissection-source/g)).toHaveLength(1);
  });
});

describe("transcript review panel action bar", () => {
  beforeAll(async () => {
    await initializeI18n("zh-CN");
  });

  test("keeps only copy and save so locating the transcript file is not duplicated", () => {
    const markup = renderPanel(null);
    const footer = markup.match(
      /<footer class="transcript-action-bar">[\s\S]*?<\/footer>/,
    );
    expect(footer).not.toBeNull();

    const footerButtonCount = [...(footer?.[0] ?? "").matchAll(/<button/g)].length;
    expect(footerButtonCount).toBe(2);
  });
});
