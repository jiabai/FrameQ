from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from frameq_worker.asr import (
    DEFAULT_ASR_MODEL,
    ASRError,
    QwenAsrTranscriber,
    Transcriber,
    build_asr_transcriber,
    resolve_model_cache_dir,
    transcribe_and_write,
    write_transcript_files,
)
from frameq_worker.desktop_contract import CACHE_DIR_ENV, OUTPUT_DIR_ENV, ProgressCallback
from frameq_worker.insightflow import (
    InsightClient,
    InsightGenerationError,
    generate_insights_from_markdown,
    generate_summary_from_markdown,
)
from frameq_worker.media import CommandRunner
from frameq_worker.media_preparation import (
    MediaPreparationError,
    MediaPreparationFacade,
    UrlMediaSource,
)
from frameq_worker.model_download import (
    normalize_asr_model_cache_layout,
    validate_asr_model_cache,
)
from frameq_worker.models import (
    InsightGenerationTarget,
    JobStage,
    PreferenceSnapshot,
    ProcessRequest,
    ProcessResult,
    TranscriptMetadata,
    WorkerError,
)
from frameq_worker.output_language import OutputLanguage
from frameq_worker.progress_events import (
    build_worker_progress_event,
    normalize_language_tag,
    normalize_model_arg,
)
from frameq_worker.source_identity import (
    SourceIdentity,
    SourceIdentityError,
)
from frameq_worker.source_resolution import (
    SourceRequest,
    SourceRequestResolver,
    resolve_source_request,
)
from frameq_worker.subtitles import SubtitleTranscript
from frameq_worker.task_store import (
    TaskContext,
    TaskStoreFacade,
)

TranscriberFactory = Callable[[str, Path], Transcriber]


@dataclass(frozen=True)
class PipelineContext:
    task_context: TaskContext
    task_store: TaskStoreFacade
    source_request: SourceRequest


def run_asr_transcript_step(
    audio_path: Path,
    output_dir: Path,
    output_stem: str,
    transcriber: Transcriber | None = None,
    model: str = DEFAULT_ASR_MODEL,
    source_identity: SourceIdentity | None = None,
) -> ProcessResult:
    asr = transcriber or QwenAsrTranscriber(model_name=model)

    try:
        artifacts = transcribe_and_write(
            audio_path=audio_path,
            output_dir=output_dir,
            output_stem=output_stem,
            transcriber=asr,
            model=model,
            source_identity=source_identity,
        )
    except ASRError as exc:
        return ProcessResult(
            status=JobStage.FAILED,
            error=WorkerError(
                code=exc.code,
                message=str(exc),
                stage=JobStage.VIDEO_TRANSCRIBING,
            ),
        )

    return ProcessResult(
        status=JobStage.VIDEO_TRANSCRIBING,
        artifacts={
            "transcript_txt": artifacts.txt_path.relative_to(output_dir).as_posix(),
            "transcript_md": artifacts.md_path.relative_to(output_dir).as_posix(),
            **(
                {"segments": artifacts.segments_path.relative_to(output_dir).as_posix()}
                if artifacts.segments_path
                else {}
            ),
        },
        text=artifacts.text,
        transcript=TranscriptMetadata(
            source="asr",
            language=None,
            engine=model,
            source_identity=source_identity,
        ),
    )


def run_prepared_subtitle_transcript_step(
    subtitle: SubtitleTranscript,
    output_dir: Path,
    output_stem: str,
    source_identity: SourceIdentity,
) -> ProcessResult | None:
    metadata = TranscriptMetadata(
        source="subtitle",
        language=subtitle.language,
        engine=None,
        source_identity=source_identity,
    )
    try:
        artifacts = write_transcript_files(
            text=subtitle.text,
            output_dir=output_dir,
            output_stem=output_stem,
            metadata=metadata,
            segments=subtitle.segments,
        )
    except ASRError:
        return None

    return ProcessResult(
        status=JobStage.VIDEO_TRANSCRIBING,
        artifacts={
            "transcript_txt": artifacts.txt_path.relative_to(output_dir).as_posix(),
            "transcript_md": artifacts.md_path.relative_to(output_dir).as_posix(),
            **(
                {"segments": artifacts.segments_path.relative_to(output_dir).as_posix()}
                if artifacts.segments_path
                else {}
            ),
        },
        text=artifacts.text,
        transcript=metadata,
    )


def run_insight_generation_step(
    transcript_txt_path: Path,
    output_dir: Path,
    output_stem: str,
    client: InsightClient | None,
    output_language: OutputLanguage,
    transcript: TranscriptMetadata | None = None,
    preference_snapshot: PreferenceSnapshot | None = None,
    target: InsightGenerationTarget = "all",
) -> ProcessResult:
    is_junction = getattr(os.path, "isjunction", lambda _path: False)
    expected_transcript_path = output_dir.parent / "transcript" / "transcript.txt"
    if (
        transcript_txt_path.absolute() != expected_transcript_path.absolute()
        or transcript_txt_path.is_symlink()
        or transcript_txt_path.parent.is_symlink()
        or transcript_txt_path.parent.parent.is_symlink()
        or is_junction(transcript_txt_path)
        or is_junction(transcript_txt_path.parent)
        or is_junction(transcript_txt_path.parent.parent)
    ):
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            text="",
            transcript=transcript,
            error=WorkerError(
                code="TRANSCRIPT_TEXT_PATH_INVALID",
                message="Official transcript.txt is required for AI generation.",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        )

    try:
        transcript_body = transcript_txt_path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            text="",
            transcript=transcript,
            error=WorkerError(
                code="TRANSCRIPT_TEXT_NOT_FOUND",
                message="Official transcript text could not be read.",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        )

    if client is None:
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            text=transcript_body,
            transcript=transcript,
            error=WorkerError(
                code="INSIGHTFLOW_CONFIG_MISSING",
                message="InsightFlow LLM client is not configured.",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        )

    summary_artifacts = None
    insight_artifacts = None
    generation_error: InsightGenerationError | None = None

    if target in {"all", "summary"}:
        try:
            summary_artifacts = generate_summary_from_markdown(
                markdown=transcript_body,
                output_dir=output_dir,
                output_stem=output_stem,
                client=client,
                output_language=output_language,
            )
        except InsightGenerationError as exc:
            generation_error = exc

    if target in {"all", "insights"}:
        try:
            insight_artifacts = generate_insights_from_markdown(
                markdown=transcript_body,
                output_dir=output_dir,
                output_stem=output_stem,
                client=client,
                output_language=output_language,
                preference_snapshot=preference_snapshot,
            )
        except InsightGenerationError as exc:
            if generation_error is None:
                generation_error = exc

    status = JobStage.COMPLETED if generation_error is None else JobStage.PARTIAL_COMPLETED

    return ProcessResult(
        status=status,
        artifacts={
            **(
                {
                    "summary": summary_artifacts.summary_path.relative_to(output_dir).as_posix(),
                    "mindmap": summary_artifacts.mindmap_path.relative_to(output_dir).as_posix(),
                }
                if summary_artifacts
                else {}
            ),
            **(
                {
                    "insights": insight_artifacts.json_path.relative_to(output_dir).as_posix(),
                    "insights_md": insight_artifacts.md_path.relative_to(output_dir).as_posix(),
                }
                if insight_artifacts
                else {}
            ),
        },
        text=transcript_body,
        summary=summary_artifacts.summary if summary_artifacts else "",
        insights=insight_artifacts.insights if insight_artifacts else [],
        transcript=transcript,
        error=WorkerError(
            code=generation_error.code,
            message=str(generation_error),
            stage=JobStage.INSIGHTS_GENERATING,
        )
        if generation_error
        else None,
    )


def prepare_pipeline_context(
    request: ProcessRequest,
    project_root: Path,
    environ: dict[str, str],
    source_request_resolver: SourceRequestResolver = resolve_source_request,
) -> PipelineContext:
    output_dir = resolve_output_dir(project_root, environ)
    cache_dir = resolve_cache_dir(project_root, environ)
    source_request = source_request_resolver(request.url)
    task_store = TaskStoreFacade(output_root=output_dir, cache_root=cache_dir)
    task_context = task_store.create(
        request,
        source_request.identity,
    )
    return PipelineContext(
        task_context=task_context,
        task_store=task_store,
        source_request=source_request,
    )


def write_prepared_subtitle_stage(
    subtitle_candidate: SubtitleTranscript | None,
    task_context: TaskContext,
    progress_callback: ProgressCallback | None,
) -> ProcessResult | None:
    if subtitle_candidate is None:
        return None
    subtitle_result = run_prepared_subtitle_transcript_step(
        subtitle=subtitle_candidate,
        output_dir=task_context.paths.transcript_dir,
        output_stem="",
        source_identity=task_context.source_identity,
    )
    if subtitle_result is not None:
        emit_progress(
            progress_callback,
            JobStage.VIDEO_TRANSCRIBING,
            "subtitle.detect.found",
            68,
            message_args=_subtitle_language_args(subtitle_result.transcript.language),
        )
    return subtitle_result


def prepare_asr_transcriber_stage(
    request: ProcessRequest,
    project_root: Path,
    transcriber: Transcriber | None,
    allow_real_asr: bool,
    environ: dict[str, str],
    progress_callback: ProgressCallback | None,
    transcriber_factory: TranscriberFactory | None = None,
) -> Transcriber | ProcessResult:
    if transcriber is None and not allow_real_asr:
        return failed_result(
            code="ASR_MODEL_NOT_READY",
            message="Real ASR is disabled until model cache handling is configured.",
            stage=JobStage.VIDEO_TRANSCRIBING,
        )

    if transcriber is not None:
        return transcriber

    emit_progress(
        progress_callback,
        JobStage.VIDEO_TRANSCRIBING,
        "asr.cache.preparing",
        58,
        message_args=_asr_model_args(request.asr_model),
    )
    model_cache_dir = resolve_model_cache_dir(project_root=project_root, environ=environ)
    normalize_asr_model_cache_layout(model_cache_dir)
    if not validate_asr_model_cache(model_cache_dir):
        return failed_result(
            code="ASR_MODEL_NOT_DOWNLOADED",
            message="SenseVoice Small model is not downloaded yet.",
            stage=JobStage.VIDEO_TRANSCRIBING,
        )
    factory = transcriber_factory or build_asr_transcriber
    try:
        return factory(request.asr_model, model_cache_dir)
    except OSError as exc:
        return failed_result(
            code="ASR_MODEL_CACHE_UNAVAILABLE",
            message=f"Model cache directory is not writable: {exc}",
            stage=JobStage.VIDEO_TRANSCRIBING,
        )


def run_asr_transcript_stage(
    request: ProcessRequest,
    project_root: Path,
    audio_path: Path,
    transcriber: Transcriber | None,
    allow_real_asr: bool,
    environ: dict[str, str],
    task_context: TaskContext,
    progress_callback: ProgressCallback | None,
    transcriber_factory: TranscriberFactory | None = None,
) -> ProcessResult:
    emit_progress(
        progress_callback,
        JobStage.VIDEO_TRANSCRIBING,
        "asr.transcribe.starting",
        58,
    )
    prepared_transcriber = prepare_asr_transcriber_stage(
        request=request,
        project_root=project_root,
        transcriber=transcriber,
        transcriber_factory=transcriber_factory,
        allow_real_asr=allow_real_asr,
        environ=environ,
        progress_callback=progress_callback,
    )
    if isinstance(prepared_transcriber, ProcessResult):
        return prepared_transcriber

    emit_progress(
        progress_callback,
        JobStage.VIDEO_TRANSCRIBING,
        "asr.transcribe.running",
        68,
    )
    return run_asr_transcript_step(
        audio_path=audio_path,
        output_dir=task_context.paths.transcript_dir,
        output_stem="",
        transcriber=prepared_transcriber,
        model=request.asr_model,
        source_identity=task_context.source_identity,
    )


def complete_transcript_stage(
    task_store: TaskStoreFacade,
    task_context: TaskContext,
    transcript_text: str,
    transcript: TranscriptMetadata | None,
) -> ProcessResult:
    return task_store.finalize(
        task_context,
        ProcessResult(
            status=JobStage.COMPLETED,
            text=transcript_text,
            transcript=transcript,
        ),
    )


def run_worker_pipeline(
    request: ProcessRequest,
    project_root: Path,
    command_runner: CommandRunner,
    transcriber: Transcriber | None,
    allow_real_asr: bool,
    environ: dict[str, str],
    progress_callback: ProgressCallback | None = None,
    transcriber_factory: TranscriberFactory | None = None,
    source_request_resolver: SourceRequestResolver = resolve_source_request,
) -> ProcessResult:
    try:
        pipeline_context = prepare_pipeline_context(
            request,
            project_root,
            environ,
            source_request_resolver,
        )
    except SourceIdentityError:
        return failed_result(
            code="SOURCE_IDENTITY_UNAVAILABLE",
            message="Could not identify a supported stable video source.",
            stage=JobStage.VIDEO_EXTRACTING,
        )
    except OSError:
        return failed_result(
            code="TASK_STORAGE_UNAVAILABLE",
            message="Task storage could not be prepared.",
            stage=JobStage.VIDEO_EXTRACTING,
        )
    task_context = pipeline_context.task_context
    try:
        prepared_media = MediaPreparationFacade(
            command_runner=command_runner,
            progress_callback=progress_callback,
        ).prepare(
            UrlMediaSource(pipeline_context.source_request),
            task_context,
        )
    except MediaPreparationError as exc:
        return pipeline_context.task_store.finalize(
            task_context,
            failed_result(
                code=exc.code,
                message=str(exc),
                stage=exc.stage,
            ),
        )

    subtitle_result = write_prepared_subtitle_stage(
        subtitle_candidate=prepared_media.subtitle_candidate,
        task_context=task_context,
        progress_callback=progress_callback,
    )
    if subtitle_result is not None:
        return complete_transcript_stage(
            task_store=pipeline_context.task_store,
            task_context=task_context,
            transcript_text=subtitle_result.text,
            transcript=subtitle_result.transcript,
        )

    transcript_result = run_asr_transcript_stage(
        request=request,
        project_root=project_root,
        audio_path=prepared_media.audio_path,
        transcriber=transcriber,
        transcriber_factory=transcriber_factory,
        allow_real_asr=allow_real_asr,
        environ=environ,
        task_context=task_context,
        progress_callback=progress_callback,
    )
    if transcript_result.status == JobStage.FAILED:
        return pipeline_context.task_store.finalize(task_context, transcript_result)

    return complete_transcript_stage(
        task_store=pipeline_context.task_store,
        task_context=task_context,
        transcript_text=transcript_result.text,
        transcript=transcript_result.transcript,
    )


def resolve_output_dir(project_root: Path, environ: dict[str, str] | None = None) -> Path:
    env = environ if environ is not None else {}
    configured_path = env.get(OUTPUT_DIR_ENV, "").strip()
    if not configured_path:
        return project_root / "outputs"

    output_dir = Path(configured_path)
    if output_dir.is_absolute():
        return output_dir
    return project_root / output_dir


def resolve_cache_dir(project_root: Path, environ: dict[str, str] | None = None) -> Path:
    env = environ if environ is not None else {}
    configured_path = env.get(CACHE_DIR_ENV, "").strip()
    if not configured_path:
        return project_root / "cache"

    cache_dir = Path(configured_path)
    if cache_dir.is_absolute():
        return cache_dir
    return project_root / cache_dir


def failed_result(
    code: str,
    message: str,
    stage: JobStage,
) -> ProcessResult:
    return ProcessResult(
        status=JobStage.FAILED,
        error=WorkerError(
            code=code,
            message=message,
            stage=stage,
        ),
    )


def emit_progress(
    callback: ProgressCallback | None,
    stage: JobStage,
    message_code: str,
    progress: int,
    message_args: dict[str, str | int] | None = None,
) -> None:
    event = build_worker_progress_event(
        message_code,
        stage=stage.value,
        progress=progress,
        message_args=message_args,
    )
    if callback is None:
        return
    callback(event)


def _subtitle_language_args(language: object) -> dict[str, str]:
    return {"language": normalize_language_tag(language) or "und"}


def _asr_model_args(model: object) -> dict[str, str] | None:
    # The release desktop currently exposes and bundles only SenseVoice. The Qwen
    # adapter remains a hidden dev/future path, so it deliberately uses generic
    # progress instead of expanding the release progress-model allowlist.
    normalized = normalize_model_arg(model)
    return {"model": normalized} if normalized is not None else None
