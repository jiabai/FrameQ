from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from frameq_worker.desktop_contract import ProgressCallback
from frameq_worker.media import CommandRunner
from frameq_worker.media_preparation import (
    LocalMediaSource,
    MediaPreparationError,
    MediaPreparationFacade,
    UrlMediaSource,
)
from frameq_worker.models import (
    JobStage,
    ProcessLocalMediaRequest,
    ProcessRequest,
    ProcessResult,
    TranscriptMetadata,
)
from frameq_worker.pipeline_runtime.shared import (
    Transcriber,
    TranscriberFactory,
    failed_result,
    resolve_cache_dir,
    resolve_output_dir,
)
from frameq_worker.pipeline_runtime.transcript import (
    run_asr_transcript_stage,
    write_prepared_subtitle_stage,
)
from frameq_worker.source_identity import SourceIdentityError
from frameq_worker.source_resolution import (
    SourceRequest,
    SourceRequestResolver,
    resolve_source_request,
)
from frameq_worker.task_store import TaskContext, TaskStoreFacade


@dataclass(frozen=True)
class PipelineContext:
    task_context: TaskContext
    task_store: TaskStoreFacade
    source_request: SourceRequest


@dataclass(frozen=True)
class LocalPipelineContext:
    task_context: TaskContext
    task_store: TaskStoreFacade


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


def prepare_local_pipeline_context(
    request: ProcessLocalMediaRequest,
    project_root: Path,
    environ: dict[str, str],
) -> LocalPipelineContext:
    output_dir = resolve_output_dir(project_root, environ)
    cache_dir = resolve_cache_dir(project_root, environ)
    task_store = TaskStoreFacade(output_root=output_dir, cache_root=cache_dir)
    task_context = task_store.create_local(request)
    return LocalPipelineContext(
        task_context=task_context,
        task_store=task_store,
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
        if subtitle_result.status == JobStage.FAILED:
            return pipeline_context.task_store.finalize(task_context, subtitle_result)
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


def run_local_media_pipeline(
    request: ProcessLocalMediaRequest,
    project_root: Path,
    command_runner: CommandRunner,
    transcriber: Transcriber | None,
    allow_real_asr: bool,
    environ: dict[str, str],
    progress_callback: ProgressCallback | None = None,
    transcriber_factory: TranscriberFactory | None = None,
) -> ProcessResult:
    try:
        pipeline_context = prepare_local_pipeline_context(
            request,
            project_root,
            environ,
        )
    except (OSError, ValueError):
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
            LocalMediaSource(request),
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
