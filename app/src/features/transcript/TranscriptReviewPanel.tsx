import { CheckCircle2, Copy, Download, LoaderCircle, Pause, Play } from "lucide-react";
import type { ReactNode } from "react";

import { clampAudioTime, formatAudioClock } from "../../audioReviewBarState";
import { isTranscriptSegmentEditDisabled } from "../../transcriptReviewState";
import type { WorkflowState } from "../../workflow";
import type { TranscriptDetailController } from "./useTranscriptDetailController";

type TranscriptReviewPanelProps = {
  workflow: WorkflowState;
  controller: TranscriptDetailController;
  editingDisabled: boolean;
  readOnlyReason: string | null;
  artifactToolbar?: ReactNode;
};

function formatSegmentTime(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function TranscriptReviewPanel({
  workflow,
  controller,
  editingDisabled,
  readOnlyReason,
  artifactToolbar,
}: TranscriptReviewPanelProps) {
  const {
    transcriptDetail,
    transcriptDraft,
    transcriptSegments,
    transcriptDirty,
    transcriptLoading,
    transcriptSaving,
    activeTranscriptSegmentId,
    editingTranscriptSegmentId,
    transcriptAudioCurrentTime,
    transcriptAudioDuration,
    transcriptAudioPlaying,
    transcriptAudioRef,
    transcriptSegmentRefs,
    transcriptSourceLabel,
    transcriptAudioSrc,
    transcriptAudioProgress,
    transcriptAudioScrubberMax,
    transcriptAudioScrubberStyle,
    hasTranscriptSegments,
    copyTranscript,
    exportTranscript,
    saveTranscriptDraft,
    playTranscriptSegment,
    handleTranscriptAudioMetadata,
    handleTranscriptTimeUpdate,
    handleTranscriptAudioPlay,
    handleTranscriptAudioPause,
    toggleTranscriptAudio,
    scrubTranscriptAudio,
    beginTranscriptSegmentEdit,
    updateTranscriptSegmentDraft,
    updateFullTranscriptDraft,
  } = controller;

  return (
    <div className="transcript-review-panel">
      {transcriptSourceLabel ? <p className="transcript-source">{transcriptSourceLabel}</p> : null}
      {readOnlyReason ? <p className="transcript-readonly-notice">{readOnlyReason}</p> : null}
      {transcriptLoading ? <p className="transcript-status">正在读取文字稿详情...</p> : null}

      {transcriptAudioSrc ? (
        <>
          <audio
            ref={transcriptAudioRef}
            className="transcript-audio-engine"
            src={transcriptAudioSrc}
            preload="metadata"
            onLoadedMetadata={handleTranscriptAudioMetadata}
            onDurationChange={handleTranscriptAudioMetadata}
            onTimeUpdate={handleTranscriptTimeUpdate}
            onPlay={handleTranscriptAudioPlay}
            onPause={handleTranscriptAudioPause}
            onEnded={handleTranscriptAudioPause}
          />
          <div className="audio-review-bar" aria-label="音频回听工具栏">
            <button
              className="audio-play-button"
              type="button"
              onClick={() => void toggleTranscriptAudio()}
              aria-label={transcriptAudioPlaying ? "暂停音频" : "播放音频"}
            >
              {transcriptAudioPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <div className="audio-review-timeline">
              <input
                className="audio-review-scrubber"
                type="range"
                min={0}
                max={transcriptAudioScrubberMax}
                step={0.1}
                style={transcriptAudioScrubberStyle}
                value={clampAudioTime(transcriptAudioCurrentTime, transcriptAudioScrubberMax)}
                onChange={scrubTranscriptAudio}
                disabled={transcriptAudioDuration <= 0}
                aria-label="音频进度"
                aria-valuetext={`${formatAudioClock(transcriptAudioCurrentTime)}，${Math.round(transcriptAudioProgress)}%`}
              />
              <div className="audio-review-clock">
                <span>{formatAudioClock(transcriptAudioCurrentTime)}</span>
                <span aria-hidden="true"> / </span>
                <span>{formatAudioClock(transcriptAudioDuration)}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="transcript-status">当前任务没有可播放的本地音频。</p>
      )}

      {artifactToolbar}

      <div className="transcript-review-scroll">
        {hasTranscriptSegments ? (
          <div className="transcript-segments">
            {transcriptSegments.map((segment) => (
              <div
                key={segment.id}
                ref={(element) => {
                  transcriptSegmentRefs.current[segment.id] = element;
                }}
                className={`transcript-segment ${activeTranscriptSegmentId === segment.id ? "active" : ""} ${editingTranscriptSegmentId === segment.id ? "editing" : ""}`}
              >
                <div className="transcript-segment-header">
                  <button
                    type="button"
                    className="transcript-segment-time"
                    onClick={() => void playTranscriptSegment(segment)}
                    disabled={!transcriptDetail?.audio_asset_path || Boolean(editingTranscriptSegmentId)}
                  >
                    <Play size={14} />
                    <span>{formatSegmentTime(segment.start_ms)}</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => beginTranscriptSegmentEdit(segment.id)}
                    disabled={editingDisabled || isTranscriptSegmentEditDisabled(editingTranscriptSegmentId, segment.id)}
                  >
                    编辑
                  </button>
                </div>
                {editingTranscriptSegmentId === segment.id ? (
                  <textarea
                    value={segment.text}
                    onChange={(event) => updateTranscriptSegmentDraft(segment.id, event.currentTarget.value)}
                    disabled={editingDisabled}
                    autoFocus
                  />
                ) : (
                  <button type="button" className="transcript-segment-text" onClick={() => void playTranscriptSegment(segment)}>
                    {segment.text}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <textarea
            className="transcript-full-editor"
            value={transcriptDraft}
            onFocus={() => beginTranscriptSegmentEdit("full-text")}
            onChange={(event) => updateFullTranscriptDraft(event.currentTarget.value)}
            placeholder="文字稿生成后将在这里显示。"
            disabled={editingDisabled}
          />
        )}
      </div>

      <footer className="transcript-action-bar">
        <button type="button" className="secondary-button" onClick={copyTranscript} disabled={!transcriptDraft}>
          <Copy size={16} />
          <span>复制</span>
        </button>
        <button type="button" className="secondary-button" onClick={exportTranscript} disabled={!controller.currentTranscriptPath}>
          <Download size={16} />
          <span>导出</span>
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={saveTranscriptDraft}
          disabled={editingDisabled || !workflow.taskId || !workflow.artifacts.transcript_txt || !transcriptDirty || transcriptSaving}
        >
          {transcriptSaving ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
          <span>{transcriptSaving ? "保存中" : "保存"}</span>
        </button>
      </footer>
    </div>
  );
}
