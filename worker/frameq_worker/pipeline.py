from __future__ import annotations

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
)
from frameq_worker.desktop_contract import OUTPUT_DIR_ENV, WORK_DIR_ENV, ProgressCallback
from frameq_worker.insightflow import (
    InsightClient,
    InsightGenerationError,
    generate_insights_from_markdown,
)
from frameq_worker.media import (
    CommandExecutionError,
    CommandRunner,
    download_video,
    extract_audio,
    extract_douyin_video_id,
    probe_media_file,
)
from frameq_worker.model_download import (
    normalize_asr_model_cache_layout,
    validate_asr_model_cache,
)
from frameq_worker.models import JobStage, ProcessRequest, ProcessResult, WorkerError

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}


def run_asr_transcript_step(
    audio_path: Path,
    output_dir: Path,
    output_stem: str,
    transcriber: Transcriber | None = None,
    model: str = DEFAULT_ASR_MODEL,
    source_url: str | None = None,
) -> ProcessResult:
    asr = transcriber or QwenAsrTranscriber(model_name=model)

    try:
        artifacts = transcribe_and_write(
            audio_path=audio_path,
            output_dir=output_dir,
            output_stem=output_stem,
            transcriber=asr,
            model=model,
            source_url=source_url,
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
        transcript_path=artifacts.txt_path.as_posix(),
        text=artifacts.text,
    )


def run_insight_generation_step(
    transcript_path: Path,
    output_dir: Path,
    output_stem: str,
    transcript_text: str,
    client: InsightClient | None,
) -> ProcessResult:
    if client is None:
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            transcript_path=transcript_path.as_posix(),
            text=transcript_text,
            error=WorkerError(
                code="INSIGHTFLOW_CONFIG_MISSING",
                message="InsightFlow LLM client is not configured.",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        )

    try:
        artifacts = generate_insights_from_markdown(
            markdown=transcript_path.read_text(encoding="utf-8"),
            output_dir=output_dir,
            output_stem=output_stem,
            client=client,
        )
    except InsightGenerationError as exc:
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            transcript_path=transcript_path.as_posix(),
            text=transcript_text,
            error=WorkerError(
                code=exc.code,
                message=str(exc),
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        )

    return ProcessResult(
        status=JobStage.COMPLETED,
        transcript_path=transcript_path.as_posix(),
        insights_path=artifacts.json_path.as_posix(),
        text=transcript_text,
        insights=[insight.text for insight in artifacts.insights],
    )


def run_worker_pipeline(
    request: ProcessRequest,
    project_root: Path,
    command_runner: CommandRunner,
    transcriber: Transcriber | None,
    insight_client: InsightClient | None,
    allow_real_asr: bool,
    environ: dict[str, str],
    progress_callback: ProgressCallback | None = None,
) -> ProcessResult:
    output_dir = resolve_output_dir(project_root, environ)
    work_dir = resolve_work_dir(project_root, environ)
    video_id = extract_douyin_video_id(request.url)
    media_files_before_download = snapshot_video_files(output_dir)

    emit_progress(
        progress_callback,
        JobStage.VIDEO_EXTRACTING,
        "正在下载视频并准备媒体文件。",
        18,
    )
    try:
        download_video(request.url, output_dir=output_dir, runner=command_runner)
    except CommandExecutionError as exc:
        return failed_result(
            code="VIDEO_DOWNLOAD_FAILED",
            message=str(exc),
            stage=JobStage.VIDEO_EXTRACTING,
        )

    emit_progress(
        progress_callback,
        JobStage.VIDEO_EXTRACTING,
        "正在校验视频和音频流。",
        34,
    )
    video_path = find_video_by_stem(output_dir, video_id) if video_id else None
    if video_path is None:
        video_path = find_new_or_updated_video(output_dir, media_files_before_download)
    if video_path is None:
        video_path = find_latest_video(output_dir)
    if video_path is None:
        return failed_result(
            code="VIDEO_DOWNLOAD_OUTPUT_MISSING",
            message="Video download completed but no media file was found.",
            stage=JobStage.VIDEO_EXTRACTING,
        )

    try:
        media_info = probe_media_file(video_path, runner=command_runner)
    except CommandExecutionError as exc:
        return failed_result(
            code="MEDIA_VALIDATION_FAILED",
            message=str(exc),
            stage=JobStage.VIDEO_EXTRACTING,
            video_path=video_path,
        )

    if not media_info.is_valid:
        return failed_result(
            code="MEDIA_VALIDATION_FAILED",
            message="Downloaded file must contain valid video and audio streams.",
            stage=JobStage.VIDEO_EXTRACTING,
            video_path=video_path,
        )

    emit_progress(
        progress_callback,
        JobStage.VIDEO_EXTRACTING,
        "正在提取 16 kHz 单声道音频。",
        48,
    )
    audio_path = work_dir / f"{video_path.stem}.wav"
    if can_reuse_audio(audio_path, command_runner):
        emit_progress(
            progress_callback,
            JobStage.VIDEO_EXTRACTING,
            "已复用本地音频，跳过音频提取。",
            50,
        )
    else:
        try:
            extract_audio(video_path, audio_path, runner=command_runner)
        except CommandExecutionError as exc:
            return failed_result(
                code="AUDIO_EXTRACTION_FAILED",
                message=str(exc),
                stage=JobStage.VIDEO_EXTRACTING,
                video_path=video_path,
            )

    if transcriber is None and not allow_real_asr:
        return failed_result(
            code="ASR_MODEL_NOT_READY",
            message="Real ASR is disabled until model cache handling is configured.",
            stage=JobStage.VIDEO_TRANSCRIBING,
            video_path=video_path,
            audio_path=audio_path,
        )

    if transcriber is None:
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
                video_path=video_path,
                audio_path=audio_path,
            )
        try:
            transcriber = build_asr_transcriber(
                model_name=request.model,
                cache_dir=model_cache_dir,
            )
        except OSError as exc:
            return failed_result(
                code="ASR_MODEL_CACHE_UNAVAILABLE",
                message=f"Model cache directory is not writable: {exc}",
                stage=JobStage.VIDEO_TRANSCRIBING,
                video_path=video_path,
                audio_path=audio_path,
            )

    emit_progress(
        progress_callback,
        JobStage.VIDEO_TRANSCRIBING,
        "正在加载模型并开始转写。",
        68,
    )
    transcript_result = run_asr_transcript_step(
        audio_path=audio_path,
        output_dir=output_dir,
        output_stem=video_path.stem,
        transcriber=transcriber,
        model=request.model,
        source_url=request.url,
    )
    if transcript_result.status == JobStage.FAILED:
        return ProcessResult(
            status=JobStage.FAILED,
            video_path=video_path.as_posix(),
            audio_path=audio_path.as_posix(),
            error=transcript_result.error,
        )

    if not request.generate_insights:
        return ProcessResult(
            status=JobStage.COMPLETED,
            video_path=video_path.as_posix(),
            audio_path=audio_path.as_posix(),
            transcript_path=transcript_result.transcript_path,
            text=transcript_result.text,
        )

    emit_progress(
        progress_callback,
        JobStage.INSIGHTS_GENERATING,
        "正在使用配置的 LLM 生成启发话题点，文字稿会发送到该服务。"
        if insight_client is not None
        else "正在生成启发话题点。",
        88,
    )
    markdown_transcript_path = output_dir / f"{video_path.stem}_transcript.md"
    insight_result = run_insight_generation_step(
        transcript_path=markdown_transcript_path,
        output_dir=output_dir,
        output_stem=video_path.stem,
        transcript_text=transcript_result.text,
        client=insight_client,
    )
    return ProcessResult(
        status=insight_result.status,
        video_path=video_path.as_posix(),
        audio_path=audio_path.as_posix(),
        transcript_path=transcript_result.transcript_path,
        insights_path=insight_result.insights_path,
        text=insight_result.text,
        insights=insight_result.insights,
        error=insight_result.error,
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


def resolve_work_dir(project_root: Path, environ: dict[str, str] | None = None) -> Path:
    env = environ if environ is not None else {}
    configured_path = env.get(WORK_DIR_ENV, "").strip()
    if not configured_path:
        return project_root / "work"

    work_dir = Path(configured_path)
    if work_dir.is_absolute():
        return work_dir
    return project_root / work_dir


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
    video_path: Path | None = None,
    audio_path: Path | None = None,
) -> ProcessResult:
    return ProcessResult(
        status=JobStage.FAILED,
        video_path=video_path.as_posix() if video_path else None,
        audio_path=audio_path.as_posix() if audio_path else None,
        error=WorkerError(
            code=code,
            message=message,
            stage=stage,
        ),
    )


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
