import {
  CheckCircle2,
  Copy,
  Download,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
} from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";

import { clampAudioTime, formatAudioClock } from "../../audioReviewBarState";
import { formatNumber, formatPercent } from "../../i18n/formatters";
import { resolveSystemLocale } from "../../i18n/locale";
import { isTranscriptSegmentEditDisabled } from "../../transcriptReviewState";
import type { WorkflowState } from "../../workflow";
import type { TranscriptDetailController } from "./useTranscriptDetailController";

const AUDIO_TIME_SEPARATOR = " / ";

type TranscriptReviewPanelProps = {
  workflow: WorkflowState;
  controller: TranscriptDetailController;
  editingDisabled: boolean;
  readOnlyReason: string | null;
  artifactToolbar?: ReactNode;
};

function formatSegmentTime(startMs: number, locale: ReturnType<typeof resolveSystemLocale>): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${formatNumber(minutes, locale)}:${formatNumber(seconds, locale, {
    minimumIntegerDigits: 2,
  })}`;
}

export function TranscriptReviewPanel({
  workflow,
  controller,
  editingDisabled,
  readOnlyReason,
  artifactToolbar,
}: TranscriptReviewPanelProps) {
  const { t, i18n } = useTranslation("transcript");
  const locale = resolveSystemLocale([
    i18n.resolvedLanguage ?? i18n.language ?? "en-US",
  ]);
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
    endTranscriptSegmentEdit,
    updateTranscriptSegmentDraft,
    updateFullTranscriptDraft,
  } = controller;
  const transcriptEditButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sourceLabel = workflow.transcript
    ? workflow.transcript.source === "subtitle"
      ? workflow.transcript.language
        ? t("review.source.subtitleWithLanguage", {
            language: workflow.transcript.language,
          })
        : t("review.source.subtitle")
      : t("review.source.asr")
    : null;
  const audioProgressText = formatPercent(
    Math.max(0, Math.min(100, transcriptAudioProgress)) / 100,
    locale,
  );

  return (
    <div className="transcript-review-panel">
      {sourceLabel ? <p className="transcript-source">{sourceLabel}</p> : null}
      {readOnlyReason ? (
        <p className="transcript-readonly-notice">{readOnlyReason}</p>
      ) : null}
      {transcriptLoading ? (
        <p className="transcript-status">{t("review.loading")}</p>
      ) : null}

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
          <div className="audio-review-bar" aria-label={t("review.audioToolbar")}>
            <button
              className="audio-play-button"
              type="button"
              onClick={() => void toggleTranscriptAudio()}
              aria-label={
                transcriptAudioPlaying
                  ? t("review.pauseAudio")
                  : t("review.playAudio")
              }
            >
              {transcriptAudioPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <input
              className="audio-review-scrubber"
              type="range"
              min={0}
              max={transcriptAudioScrubberMax}
              step={0.1}
              style={transcriptAudioScrubberStyle}
              value={clampAudioTime(
                transcriptAudioCurrentTime,
                transcriptAudioScrubberMax,
              )}
              onChange={scrubTranscriptAudio}
              disabled={transcriptAudioDuration <= 0}
              aria-label={t("review.audioProgress")}
              aria-valuetext={t("review.audioProgressValue", {
                time: formatAudioClock(transcriptAudioCurrentTime),
                progress: audioProgressText,
              })}
            />
            <div className="audio-review-clock">
              <span>{formatAudioClock(transcriptAudioCurrentTime)}</span>
              <span aria-hidden="true">{AUDIO_TIME_SEPARATOR}</span>
              <span>{formatAudioClock(transcriptAudioDuration)}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="transcript-status">{t("review.noAudio")}</p>
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
                    disabled={
                      !transcriptDetail?.audio_asset_path ||
                      Boolean(editingTranscriptSegmentId)
                    }
                  >
                    <Play size={14} />
                    <span>{formatSegmentTime(segment.start_ms, locale)}</span>
                  </button>
                  <button
                    ref={(element) => {
                      transcriptEditButtonRefs.current[segment.id] = element;
                    }}
                    type="button"
                    className="secondary-button compact-button transcript-segment-edit"
                    onClick={() => beginTranscriptSegmentEdit(segment.id)}
                    disabled={
                      editingDisabled ||
                      isTranscriptSegmentEditDisabled(
                        editingTranscriptSegmentId,
                        segment.id,
                      )
                    }
                    aria-label={t("review.editSegment")}
                    title={t("review.edit")}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                {editingTranscriptSegmentId === segment.id ? (
                  <textarea
                    value={segment.text}
                    onChange={(event) =>
                      updateTranscriptSegmentDraft(
                        segment.id,
                        event.currentTarget.value,
                      )
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key !== "Escape" ||
                        event.nativeEvent.isComposing
                      ) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      const editButton =
                        transcriptEditButtonRefs.current[segment.id];
                      endTranscriptSegmentEdit();
                      editButton?.focus();
                    }}
                    disabled={editingDisabled}
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    className="transcript-segment-text"
                    onClick={() => void playTranscriptSegment(segment)}
                  >
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
            onChange={(event) =>
              updateFullTranscriptDraft(event.currentTarget.value)
            }
            placeholder={t("review.placeholder")}
            disabled={editingDisabled}
          />
        )}
      </div>

      <footer className="transcript-action-bar">
        <button
          type="button"
          className="secondary-button"
          onClick={copyTranscript}
          disabled={!transcriptDraft}
        >
          <Copy size={16} />
          <span>{t("review.copy")}</span>
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={exportTranscript}
          disabled={!controller.currentTranscriptPath}
        >
          <Download size={16} />
          <span>{t("review.export")}</span>
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={saveTranscriptDraft}
          disabled={
            editingDisabled ||
            !workflow.taskId ||
            !workflow.artifacts.transcript_txt ||
            !transcriptDirty ||
            transcriptSaving
          }
        >
          {transcriptSaving ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <CheckCircle2 size={16} />
          )}
          <span>{transcriptSaving ? t("review.saving") : t("review.save")}</span>
        </button>
      </footer>
    </div>
  );
}
