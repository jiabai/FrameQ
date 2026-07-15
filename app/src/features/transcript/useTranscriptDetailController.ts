import { convertFileSrc } from "@tauri-apps/api/core";
import {
  type ChangeEvent,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import {
  getDetailText,
  getExportPath,
  type DetailTab,
  type WorkflowState,
} from "../../workflow";
import { uiMessage, type UiMessage } from "../../i18n/uiMessage";
import type { SupportedLocale } from "../../i18n/locale";
import {
  loadTranscriptDetail,
  saveTranscriptEdit,
  type SaveTranscriptEditResponse,
  type TranscriptDetailResponse,
  type TranscriptSegment,
} from "../../transcriptDetailClient";
import {
  findActiveTranscriptSegmentId,
  shouldPauseActiveTranscriptSegment,
  transcriptTextFromSegments,
  updateTranscriptSegmentText,
} from "../../transcriptReviewState";
import {
  audioProgressPercent,
  clampAudioTime,
} from "../../audioReviewBarState";

type UseTranscriptDetailControllerOptions = {
  workflow: WorkflowState;
  locale: SupportedLocale;
  applyTranscriptSave: (expectedTaskId: string | null, saved: SaveTranscriptEditResponse) => void;
  setActionNotice: Dispatch<SetStateAction<UiMessage | null>>;
};

export function useTranscriptDetailController({
  workflow,
  locale,
  applyTranscriptSave,
  setActionNotice,
}: UseTranscriptDetailControllerOptions) {
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [transcriptDetail, setTranscriptDetail] = useState<TranscriptDetailResponse | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [activeTranscriptSegmentId, setActiveTranscriptSegmentId] = useState<string | null>(null);
  const [editingTranscriptSegmentId, setEditingTranscriptSegmentId] = useState<string | null>(null);
  const [transcriptAudioCurrentTime, setTranscriptAudioCurrentTime] = useState(0);
  const [transcriptAudioDuration, setTranscriptAudioDuration] = useState(0);
  const [transcriptAudioPlaying, setTranscriptAudioPlaying] = useState(false);
  const transcriptAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptSegmentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const resumeTranscriptAfterSaveRef = useRef(false);
  const transcriptLoadTaskIdRef = useRef<string | null>(null);
  const currentTaskIdRef = useRef(workflow.taskId);
  currentTaskIdRef.current = workflow.taskId;

  const openDetailTab = useCallback((tab: DetailTab | null) => {
    setDetailTab(tab);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailTab(null);
  }, []);

  useEffect(() => {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      transcriptLoadTaskIdRef.current = null;
      setTranscriptDetail(null);
      setTranscriptDraft(workflow.text);
      setTranscriptSegments([]);
      setTranscriptDirty(false);
      setActiveTranscriptSegmentId(null);
      setEditingTranscriptSegmentId(null);
      return;
    }

    if (transcriptLoadTaskIdRef.current === workflow.taskId) {
      return;
    }
    transcriptLoadTaskIdRef.current = workflow.taskId;

    let cancelled = false;
    setTranscriptLoading(true);
    setTranscriptDetail(null);
    setTranscriptDraft(workflow.text);
    setTranscriptSegments([]);
    setTranscriptDirty(false);
    setActiveTranscriptSegmentId(null);
    setEditingTranscriptSegmentId(null);
    const taskId = workflow.taskId;

    async function loadDetail() {
      try {
        const detail = await loadTranscriptDetail(taskId);
        if (cancelled) {
          return;
        }
        setTranscriptDetail(detail);
        setTranscriptDraft(detail.text || workflow.text);
        setTranscriptSegments(detail.segments);
        setActionNotice(
          detail.audio_asset_path
            ? null
            : uiMessage("transcript.notice.audioUnavailableEdit"),
        );
      } catch {
        if (cancelled) {
          return;
        }
        setTranscriptDetail(null);
        setTranscriptDraft(workflow.text);
        setTranscriptSegments([]);
        setActionNotice(uiMessage("transcript.notice.detailLoadFallback"));
      } finally {
        if (!cancelled) {
          setTranscriptLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [setActionNotice, workflow.artifacts.transcript_txt, workflow.taskId, workflow.text]);

  useEffect(() => {
    if (!activeTranscriptSegmentId) {
      return;
    }
    transcriptSegmentRefs.current[activeTranscriptSegmentId]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeTranscriptSegmentId]);

  const detailText =
    detailTab === "transcript"
      ? transcriptDraft
      : detailTab
        ? getDetailText(detailTab, workflow, locale)
        : "";
  const exportPath = detailTab ? getExportPath(detailTab, workflow) : null;
  const currentTranscriptPath = getExportPath("transcript", workflow);
  const transcriptAudioSrc = transcriptDetail?.audio_asset_path
    ? convertFileSrc(transcriptDetail.audio_asset_path)
    : "";
  const transcriptAudioProgress = audioProgressPercent(transcriptAudioCurrentTime, transcriptAudioDuration);
  const transcriptAudioScrubberMax =
    transcriptAudioDuration > 0 ? transcriptAudioDuration : Math.max(transcriptAudioCurrentTime, 1);
  const transcriptAudioScrubberStyle = {
    "--audio-progress": `${transcriptAudioProgress}%`,
  } as CSSProperties;
  const hasTranscriptSegments = transcriptSegments.length > 0;

  useEffect(() => {
    setTranscriptAudioCurrentTime(0);
    setTranscriptAudioDuration(0);
    setTranscriptAudioPlaying(false);
    if (transcriptAudioRef.current) {
      transcriptAudioRef.current.playbackRate = 1;
    }
  }, [transcriptAudioSrc]);

  const copyDetail = useCallback(async () => {
    if (!detailTab) {
      return;
    }
    const text =
      detailTab === "transcript"
        ? transcriptDraft
        : getDetailText(detailTab, workflow, locale);
    if (!text) {
      setActionNotice(uiMessage("transcript.notice.nothingToCopy"));
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setActionNotice(uiMessage("transcript.notice.copied"));
    } catch {
      setActionNotice(uiMessage("transcript.notice.copyFailed"));
    }
  }, [detailTab, locale, setActionNotice, transcriptDraft, workflow]);

  const copyTranscript = useCallback(async () => {
    if (!transcriptDraft) {
      setActionNotice(uiMessage("transcript.notice.nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(transcriptDraft);
      setActionNotice(uiMessage("transcript.notice.copied"));
    } catch {
      setActionNotice(uiMessage("transcript.notice.transcriptCopyFailed"));
    }
  }, [setActionNotice, transcriptDraft]);

  const exportDetail = useCallback(async () => {
    if (!detailTab) {
      return;
    }
    if (detailTab === "transcript" && transcriptDirty) {
      setActionNotice(uiMessage("transcript.notice.unsavedLocate"));
      return;
    }
    const detailExportPath = getExportPath(detailTab, workflow);
    if (!detailExportPath) {
      setActionNotice(uiMessage("transcript.notice.noExport"));
      return;
    }

    try {
      await revealItemInDir(detailExportPath);
      setActionNotice(uiMessage("transcript.notice.exportLocated"));
    } catch {
      setActionNotice(uiMessage("transcript.notice.exportLocateFailed"));
    }
  }, [detailTab, setActionNotice, transcriptDirty, workflow]);

  const exportTranscript = useCallback(async () => {
    if (transcriptDirty) {
      setActionNotice(uiMessage("transcript.notice.unsavedLocate"));
      return;
    }
    const transcriptPath = getExportPath("transcript", workflow);
    if (!transcriptPath) {
      setActionNotice(uiMessage("transcript.notice.noTranscriptExport"));
      return;
    }
    try {
      await revealItemInDir(transcriptPath);
      setActionNotice(uiMessage("transcript.notice.transcriptLocated"));
    } catch {
      setActionNotice(uiMessage("transcript.notice.transcriptLocateFailed"));
    }
  }, [setActionNotice, transcriptDirty, workflow]);

  const playTranscriptSegment = useCallback(
    async (segment: TranscriptSegment) => {
      if (editingTranscriptSegmentId) {
        return;
      }

      const audio = transcriptAudioRef.current;
      if (!audio || !transcriptDetail?.audio_asset_path) {
        setActiveTranscriptSegmentId(segment.id);
        setActionNotice(uiMessage("transcript.notice.audioUnavailable"));
        return;
      }

      if (shouldPauseActiveTranscriptSegment(activeTranscriptSegmentId, segment.id, !audio.paused)) {
        audio.pause();
        setTranscriptAudioPlaying(false);
        return;
      }

      setActiveTranscriptSegmentId(segment.id);
      audio.currentTime = segment.start_ms / 1000;
      audio.playbackRate = 1;
      setTranscriptAudioCurrentTime(audio.currentTime);
      try {
        await audio.play();
      } catch {
        setActionNotice(uiMessage("transcript.notice.audioAutoplayFailed"));
      }
    },
    [activeTranscriptSegmentId, editingTranscriptSegmentId, setActionNotice, transcriptDetail?.audio_asset_path],
  );

  const syncTranscriptAudioState = useCallback((audio: HTMLAudioElement) => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    setTranscriptAudioDuration(duration);
    setTranscriptAudioCurrentTime(clampAudioTime(audio.currentTime, duration));
  }, []);

  const handleTranscriptAudioMetadata = useCallback(() => {
    const audio = transcriptAudioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = 1;
    syncTranscriptAudioState(audio);
  }, [syncTranscriptAudioState]);

  const handleTranscriptTimeUpdate = useCallback(() => {
    const audio = transcriptAudioRef.current;
    if (!audio) {
      return;
    }
    syncTranscriptAudioState(audio);
    if (!editingTranscriptSegmentId) {
      const activeId = findActiveTranscriptSegmentId(transcriptSegments, audio.currentTime);
      if (activeId) {
        setActiveTranscriptSegmentId(activeId);
      }
    }
  }, [editingTranscriptSegmentId, syncTranscriptAudioState, transcriptSegments]);

  const toggleTranscriptAudio = useCallback(async () => {
    const audio = transcriptAudioRef.current;
    if (!audio || !transcriptDetail?.audio_asset_path) {
      setActionNotice(uiMessage("transcript.notice.audioUnavailable"));
      return;
    }

    if (!audio.paused) {
      audio.pause();
      return;
    }

    audio.playbackRate = 1;
    try {
      await audio.play();
    } catch {
      setActionNotice(uiMessage("transcript.notice.audioPlaybackFailed"));
    }
  }, [setActionNotice, transcriptDetail?.audio_asset_path]);

  const scrubTranscriptAudio = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const audio = transcriptAudioRef.current;
      const nextTime = clampAudioTime(event.currentTarget.valueAsNumber, transcriptAudioDuration);
      if (audio) {
        audio.currentTime = nextTime;
      }
      setTranscriptAudioCurrentTime(nextTime);
      if (!editingTranscriptSegmentId) {
        const activeId = findActiveTranscriptSegmentId(transcriptSegments, nextTime);
        if (activeId) {
          setActiveTranscriptSegmentId(activeId);
        }
      }
    },
    [editingTranscriptSegmentId, transcriptAudioDuration, transcriptSegments],
  );

  const beginTranscriptSegmentEdit = useCallback((segmentId: string) => {
    const audio = transcriptAudioRef.current;
    if (audio && !audio.paused) {
      resumeTranscriptAfterSaveRef.current = true;
      audio.pause();
    }
    setEditingTranscriptSegmentId(segmentId);
    setActiveTranscriptSegmentId(segmentId);
  }, []);

  const endTranscriptSegmentEdit = useCallback(() => {
    resumeTranscriptAfterSaveRef.current = false;
    setEditingTranscriptSegmentId(null);
  }, []);

  const updateTranscriptSegmentDraft = useCallback((segmentId: string, text: string) => {
    setTranscriptSegments((current) => {
      const next = updateTranscriptSegmentText(current, segmentId, text);
      setTranscriptDraft(transcriptTextFromSegments(next));
      return next;
    });
    setTranscriptDirty(true);
  }, []);

  const updateFullTranscriptDraft = useCallback((text: string) => {
    setTranscriptDraft(text);
    setTranscriptDirty(true);
  }, []);

  const saveTranscriptDraft = useCallback(async () => {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt || transcriptSaving) {
      return;
    }

    const expectedTaskId = workflow.taskId;
    setTranscriptSaving(true);
    try {
      const saved = await saveTranscriptEdit(
        expectedTaskId,
        transcriptDraft,
        transcriptSegments,
      );
      if (
        currentTaskIdRef.current !== expectedTaskId ||
        saved.task_id !== expectedTaskId
      ) {
        return;
      }
      setTranscriptDraft(saved.text);
      setTranscriptDirty(false);
      setEditingTranscriptSegmentId(null);
      setTranscriptDetail((current) =>
        current
          ? {
              ...current,
              text: saved.text,
              has_original_backup: saved.has_original_backup,
            }
          : current,
      );
      applyTranscriptSave(expectedTaskId, saved);
      setActionNotice(uiMessage("transcript.notice.saved"));

      if (resumeTranscriptAfterSaveRef.current && transcriptAudioRef.current) {
        resumeTranscriptAfterSaveRef.current = false;
        try {
          await transcriptAudioRef.current.play();
        } catch {
          setActionNotice(uiMessage("transcript.notice.savedAutoplayFailed"));
        }
      }
    } catch {
      setActionNotice(uiMessage("transcript.notice.saveFailed"));
    } finally {
      setTranscriptSaving(false);
    }
  }, [
    setActionNotice,
    applyTranscriptSave,
    transcriptDraft,
    transcriptSaving,
    transcriptSegments,
    workflow.artifacts.transcript_txt,
    workflow.taskId,
  ]);

  const handleTranscriptAudioPlay = useCallback(() => {
    setTranscriptAudioPlaying(true);
  }, []);

  const handleTranscriptAudioPause = useCallback(() => {
    setTranscriptAudioPlaying(false);
  }, []);

  const prepareTranscriptForTaskDeletion = useCallback(
    (expectedTaskId: string) => {
      if (!workflow.taskId || workflow.taskId !== expectedTaskId) {
        return;
      }
      resumeTranscriptAfterSaveRef.current = false;
      const audio = transcriptAudioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      setTranscriptAudioPlaying(false);
    },
    [workflow.taskId],
  );

  return {
    detailTab,
    openDetailTab,
    closeDetail,
    detailText,
    exportPath,
    currentTranscriptPath,
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
    copyDetail,
    copyTranscript,
    exportDetail,
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
    prepareTranscriptForTaskDeletion,
    updateTranscriptSegmentDraft,
    updateFullTranscriptDraft,
  };
}

export type TranscriptDetailController = ReturnType<typeof useTranscriptDetailController>;
