from __future__ import annotations

import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from frameq_worker.asr import (
    DEFAULT_ASR_MODEL,
    ASRError,
    QwenAsrTranscriber,
    Transcriber,
    asr_model_display_name,
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
from frameq_worker.media import (
    CommandExecutionError,
    CommandResult,
    CommandRunner,
    download_video,
    extract_audio,
    probe_media_file,
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
from frameq_worker.source_identity import (
    SourceIdentity,
    SourceIdentityError,
    SourceRequest,
    resolve_source_request,
    sanitize_source_text,
)
from frameq_worker.subtitles import find_subtitle_transcript
from frameq_worker.task_store import (
    TaskContext,
    create_task_context,
    ensure_task_dirs,
    result_with_task,
    task_artifacts_for_existing_files,
    write_task_manifest,
)

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
TranscriberFactory = Callable[[str, Path], Transcriber]
@dataclass(frozen=True)
class PipelineContext:
    task_context: TaskContext
    source_request: SourceRequest
    download_dir: Path
    video_id: str | None
    media_files_before_download: dict[str, tuple[int, int]]


@dataclass(frozen=True)
class DownloadedVideo:
    result: CommandResult
    path: Path


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


def run_subtitle_transcript_step(
    download_dir: Path,
    output_dir: Path,
    output_stem: str,
    source_identity: SourceIdentity,
) -> ProcessResult | None:
    subtitle = find_subtitle_transcript(download_dir)
    if subtitle is None:
        return None

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
) -> PipelineContext:
    output_dir = resolve_output_dir(project_root, environ)
    cache_dir = resolve_cache_dir(project_root, environ)
    source_request = resolve_source_request(
        request.url,
    )
    task_context = create_task_context(
        request,
        source_identity=source_request.identity,
        output_root=output_dir,
        cache_root=cache_dir,
    )
    ensure_task_dirs(task_context.paths)
    download_dir = task_context.paths.download_dir
    video_id = source_request.identity.stable_id
    media_files_before_download = snapshot_video_files(download_dir)
    return PipelineContext(
        task_context=task_context,
        source_request=source_request,
        download_dir=download_dir,
        video_id=video_id,
        media_files_before_download=media_files_before_download,
    )


def download_and_select_video(
    context: PipelineContext,
    command_runner: CommandRunner,
    progress_callback: ProgressCallback | None,
) -> DownloadedVideo | ProcessResult:
    emit_progress(
        progress_callback,
        JobStage.VIDEO_EXTRACTING,
        "正在下载视频并准备媒体文件。",
        18,
    )
    try:
        download_result = download_video(
            context.source_request.download_url,
            output_dir=context.download_dir,
            runner=command_runner,
            progress_callback=progress_callback,
        )
    except CommandExecutionError as exc:
        return finalize_task_result(
            context.task_context,
            failed_result(
                code="VIDEO_DOWNLOAD_FAILED",
                message=sanitize_source_text(str(exc), context.source_request),
                stage=JobStage.VIDEO_EXTRACTING,
            ),
        )

    emit_progress(
        progress_callback,
        JobStage.VIDEO_EXTRACTING,
        "正在校验视频和音频流。",
        34,
    )
    video_path = find_video_from_download_stdout(download_result.stdout, context.download_dir)
    if video_path is None:
        video_path = (
            find_video_by_stem(context.download_dir, context.video_id)
            if context.video_id
            else None
        )
    if video_path is None:
        video_path = find_new_or_updated_video(
            context.download_dir,
            context.media_files_before_download,
        )
    if video_path is None:
        video_path = find_latest_video(context.download_dir)
    if video_path is None:
        return finalize_task_result(
            context.task_context,
            failed_result(
                code="VIDEO_DOWNLOAD_OUTPUT_MISSING",
                message="Video download completed but no media file was found.",
                stage=JobStage.VIDEO_EXTRACTING,
            ),
        )

    return DownloadedVideo(result=download_result, path=video_path)


def validate_and_copy_video(
    task_context: TaskContext,
    video_path: Path,
    command_runner: CommandRunner,
) -> ProcessResult | None:
    try:
        media_info = probe_media_file(video_path, runner=command_runner)
    except CommandExecutionError:
        return finalize_task_result(
            task_context,
            failed_result(
                code="MEDIA_VALIDATION_FAILED",
                message="Downloaded media could not be validated.",
                stage=JobStage.VIDEO_EXTRACTING,
            ),
        )

    if not media_info.is_valid:
        return finalize_task_result(
            task_context,
            failed_result(
                code="MEDIA_VALIDATION_FAILED",
                message="Downloaded file must contain valid video and audio streams.",
                stage=JobStage.VIDEO_EXTRACTING,
            ),
        )

    shutil.copy2(video_path, task_context.paths.video_path)
    return None


def prepare_audio(
    task_context: TaskContext,
    video_path: Path,
    command_runner: CommandRunner,
    progress_callback: ProgressCallback | None,
) -> Path | ProcessResult:
    emit_progress(
        progress_callback,
        JobStage.VIDEO_EXTRACTING,
        "正在提取 16 kHz 单声道音频。",
        48,
    )
    audio_path = task_context.paths.audio_path
    if can_reuse_audio(audio_path, command_runner):
        emit_progress(
            progress_callback,
            JobStage.VIDEO_EXTRACTING,
            "已复用本地音频，跳过音频提取。",
            50,
        )
        return audio_path

    try:
        extract_audio(video_path, audio_path, runner=command_runner)
    except CommandExecutionError as exc:
        return finalize_task_result(
            task_context,
            failed_result(
                code="AUDIO_EXTRACTION_FAILED",
                message=str(exc),
                stage=JobStage.VIDEO_EXTRACTING,
            ),
        )
    return audio_path


def try_subtitle_transcript_stage(
    download_result: CommandResult,
    download_dir: Path,
    task_context: TaskContext,
    progress_callback: ProgressCallback | None,
) -> ProcessResult | None:
    emit_progress(
        progress_callback,
        JobStage.VIDEO_TRANSCRIBING,
        "正在检测平台字幕。",
        58,
    )
    subtitle_result = (
        None
        if download_result.command and download_result.command[0] == "bilibili-fallback"
        else run_subtitle_transcript_step(
            download_dir=download_dir,
            output_dir=task_context.paths.transcript_dir,
            output_stem="",
            source_identity=task_context.source_identity,
        )
    )
    if subtitle_result is not None:
        emit_progress(
            progress_callback,
            JobStage.VIDEO_TRANSCRIBING,
            f"已检测到 {subtitle_result.transcript.language} 字幕，跳过 ASR。",
            68,
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
        f"正在准备 {asr_model_display_name(request.model)} 模型缓存。",
        58,
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
        return factory(request.model, model_cache_dir)
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
        "未检测到字幕，开始 ASR。",
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
        "正在加载模型并开始转写。",
        68,
    )
    return run_asr_transcript_step(
        audio_path=audio_path,
        output_dir=task_context.paths.transcript_dir,
        output_stem="",
        transcriber=prepared_transcriber,
        model=request.model,
        source_identity=task_context.source_identity,
    )


def complete_transcript_stage(
    task_context: TaskContext,
    transcript_text: str,
    transcript: TranscriptMetadata | None,
) -> ProcessResult:
    return finalize_task_result(
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
) -> ProcessResult:
    try:
        pipeline_context = prepare_pipeline_context(request, project_root, environ)
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
    download_dir = pipeline_context.download_dir

    downloaded_video = download_and_select_video(
        context=pipeline_context,
        command_runner=command_runner,
        progress_callback=progress_callback,
    )
    if isinstance(downloaded_video, ProcessResult):
        return downloaded_video
    download_result = downloaded_video.result
    video_path = downloaded_video.path

    validation_failure = validate_and_copy_video(
        task_context=task_context,
        video_path=video_path,
        command_runner=command_runner,
    )
    if validation_failure is not None:
        return validation_failure

    audio_result = prepare_audio(
        task_context=task_context,
        video_path=video_path,
        command_runner=command_runner,
        progress_callback=progress_callback,
    )
    if isinstance(audio_result, ProcessResult):
        return audio_result
    audio_path = audio_result

    subtitle_result = try_subtitle_transcript_stage(
        download_result=download_result,
        download_dir=download_dir,
        task_context=task_context,
        progress_callback=progress_callback,
    )
    if subtitle_result is not None:
        return complete_transcript_stage(
            task_context=task_context,
            transcript_text=subtitle_result.text,
            transcript=subtitle_result.transcript,
        )

    transcript_result = run_asr_transcript_stage(
        request=request,
        project_root=project_root,
        audio_path=audio_path,
        transcriber=transcriber,
        transcriber_factory=transcriber_factory,
        allow_real_asr=allow_real_asr,
        environ=environ,
        task_context=task_context,
        progress_callback=progress_callback,
    )
    if transcript_result.status == JobStage.FAILED:
        return finalize_task_result(task_context, transcript_result)

    return complete_transcript_stage(
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


def find_latest_video(output_dir: Path) -> Path | None:
    if not output_dir.exists():
        return None

    candidates = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES
    ]
    if not candidates:
        return None

    return max(candidates, key=lambda path: path.stat().st_mtime)


def snapshot_video_files(output_dir: Path) -> dict[str, tuple[int, int]]:
    if not output_dir.exists():
        return {}

    snapshot: dict[str, tuple[int, int]] = {}
    for path in output_dir.iterdir():
        if not path.is_file() or path.suffix.lower() not in VIDEO_SUFFIXES:
            continue
        stat = path.stat()
        snapshot[path.as_posix()] = (stat.st_mtime_ns, stat.st_size)
    return snapshot


def find_new_or_updated_video(
    output_dir: Path,
    previous_snapshot: dict[str, tuple[int, int]],
) -> Path | None:
    if not output_dir.exists():
        return None

    candidates: list[Path] = []
    for path in output_dir.iterdir():
        if not path.is_file() or path.suffix.lower() not in VIDEO_SUFFIXES:
            continue
        stat = path.stat()
        signature = (stat.st_mtime_ns, stat.st_size)
        if previous_snapshot.get(path.as_posix()) != signature:
            candidates.append(path)
    if not candidates:
        return None

    return max(candidates, key=lambda path: path.stat().st_mtime_ns)


def find_video_by_stem(output_dir: Path, stem: str | None) -> Path | None:
    if stem is None or not output_dir.exists():
        return None

    candidates = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.stem == stem and path.suffix.lower() in VIDEO_SUFFIXES
    ]
    if not candidates:
        return None

    return max(candidates, key=lambda path: path.stat().st_mtime)


def find_video_from_download_stdout(stdout: str, output_dir: Path) -> Path | None:
    if not stdout.strip() or not output_dir.exists():
        return None

    try:
        output_root = output_dir.resolve()
    except OSError:
        return None

    for raw_line in reversed(stdout.splitlines()):
        raw_path = raw_line.strip().strip("\"'")
        if not raw_path:
            continue
        candidate = Path(raw_path)
        if not candidate.is_absolute():
            candidate = output_dir / candidate
        try:
            resolved_candidate = candidate.resolve()
        except OSError:
            continue
        if not resolved_candidate.is_relative_to(output_root):
            continue
        if candidate.is_file() and candidate.suffix.lower() in VIDEO_SUFFIXES:
            return candidate
    return None


def can_reuse_audio(audio_path: Path, runner: CommandRunner) -> bool:
    if not audio_path.exists():
        return False

    try:
        audio_info = probe_media_file(audio_path, runner=runner)
    except CommandExecutionError:
        return False

    return audio_info.is_valid_audio


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


def finalize_task_result(context: TaskContext, result: ProcessResult) -> ProcessResult:
    task_result = result_with_task(
        result,
        context,
        artifacts={**result.artifacts, **task_artifacts_for_existing_files(context.paths)},
    )
    write_task_manifest(context, task_result)
    return task_result


def emit_progress(
    callback: ProgressCallback | None,
    stage: JobStage,
    message: str,
    progress: int,
) -> None:
    if callback is None:
        return

    callback(
        {
            "stage": stage.value,
            "message": message,
            "progress": progress,
        }
    )
