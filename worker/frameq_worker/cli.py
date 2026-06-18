from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from frameq_worker.asr import (
    DEFAULT_ASR_MODEL,
    ASRError,
    Transcriber,
    asr_model_display_name,
    build_asr_transcriber,
    resolve_asr_model_name,
    resolve_model_cache_dir,
)
from frameq_worker.config import load_project_env
from frameq_worker.insightflow import InsightClient
from frameq_worker.llm import build_insight_client_from_env
from frameq_worker.media import (
    CommandExecutionError,
    CommandRunner,
    download_video,
    extract_audio,
    extract_douyin_video_id,
    probe_media_file,
    run_command,
)
from frameq_worker.models import (
    JobStage,
    ProcessRequest,
    ProcessResult,
    RetryInsightsRequest,
    WorkerError,
)
from frameq_worker.pipeline import run_asr_transcript_step, run_insight_generation_step

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
PROGRESS_EVENT_PREFIX = "FRAMEQ_PROGRESS "
OUTPUT_DIR_ENV = "FRAMEQ_OUTPUT_DIR"
WORK_DIR_ENV = "FRAMEQ_WORK_DIR"
HISTORY_FILE_NAME = "history.json"
ASR_MODEL_ENV = "FRAMEQ_ASR_MODEL"
ProgressCallback = Callable[[dict[str, object]], None]


def run_worker_once(
    request_json: str,
    project_root: Path | None = None,
    command_runner: CommandRunner = run_command,
    transcriber: Transcriber | None = None,
    insight_client: InsightClient | None = None,
    allow_real_asr: bool | None = None,
    environ: dict[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, object]:
    root = project_root or Path.cwd()
    try:
        payload = json.loads(request_json)
    except json.JSONDecodeError:
        return ProcessResult(
            status=JobStage.FAILED,
            error=WorkerError(
                code="INVALID_REQUEST_JSON",
                message="Request payload must be valid JSON.",
                stage=JobStage.WAITING_INPUT,
            ),
        ).to_dict()

    try:
        request = parse_process_request(payload)
    except ValueError as exc:
        return failed_result(
            code="INVALID_REQUEST_PAYLOAD",
            message=str(exc),
            stage=JobStage.WAITING_INPUT,
        ).to_dict()

    runtime_env = load_project_env(root, environ)
    try:
        request = replace(
            request,
            model=resolve_configured_asr_model(request.model, runtime_env),
        )
    except ASRError as exc:
        return ProcessResult(
            status=JobStage.FAILED,
            error=WorkerError(
                code=exc.code,
                message=str(exc),
                stage=JobStage.VIDEO_TRANSCRIBING,
            ),
        ).to_dict()

    configured_insight_client = insight_client or build_insight_client_from_env(runtime_env)
    result = run_worker_pipeline(
        request=request,
        project_root=root,
        command_runner=command_runner,
        transcriber=transcriber,
        insight_client=configured_insight_client,
        allow_real_asr=should_allow_real_asr(runtime_env)
        if allow_real_asr is None
        else allow_real_asr,
        environ=runtime_env,
        progress_callback=progress_callback,
    )
    append_history_item(
        project_root=root,
        request=request,
        result=result,
        output_dir=resolve_output_dir(root, runtime_env),
        work_dir=resolve_work_dir(root, runtime_env),
    )
    return result.to_dict()


def parse_process_request(payload: object) -> ProcessRequest:
    if not isinstance(payload, dict):
        raise ValueError("Request payload must be a JSON object.")

    url = payload.get("url")
    if not isinstance(url, str) or not url.strip():
        raise ValueError("Request payload must include a non-empty url.")

    output_formats = payload.get("output_formats", ("txt", "md"))
    if not isinstance(output_formats, list | tuple) or not all(
        isinstance(item, str) for item in output_formats
    ):
        raise ValueError("Request payload output_formats must be a list of strings.")

    return ProcessRequest(
        url=url.strip(),
        language=str(payload.get("language", "Chinese")),
        output_formats=tuple(output_formats),
        model=str(payload.get("model", DEFAULT_ASR_MODEL)),
        generate_insights=bool(payload.get("generate_insights", True)),
        insightflow_mode=str(payload.get("insightflow_mode", "embedded")),
    )


def retry_insights_once(
    request_json: str,
    project_root: Path | None = None,
    insight_client: InsightClient | None = None,
    environ: dict[str, str] | None = None,
) -> dict[str, object]:
    try:
        payload = json.loads(request_json)
    except json.JSONDecodeError:
        return ProcessResult(
            status=JobStage.FAILED,
            error=WorkerError(
                code="INVALID_RETRY_JSON",
                message="Retry payload must be valid JSON.",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        ).to_dict()

    try:
        request = parse_retry_insights_request(payload)
    except ValueError as exc:
        return failed_insight_retry_result(
            code="INVALID_RETRY_PAYLOAD",
            message=str(exc),
            transcript_path=None,
            text="",
        ).to_dict()

    transcript_path = Path(request.transcript_path)
    if not transcript_path.is_absolute() and project_root is not None:
        transcript_path = project_root / transcript_path

    markdown_transcript_path = resolve_markdown_transcript_path(transcript_path)
    root = project_root or Path.cwd()
    runtime_env = load_project_env(root, environ)
    configured_insight_client = insight_client or build_insight_client_from_env(runtime_env)
    if not markdown_transcript_path.exists() and configured_insight_client is not None:
        return failed_insight_retry_result(
            code="TRANSCRIPT_MARKDOWN_NOT_FOUND",
            message="Transcript markdown file is required to regenerate insights.",
            transcript_path=transcript_path,
            text=request.text,
        ).to_dict()

    insight_result = run_insight_generation_step(
        transcript_path=markdown_transcript_path,
        output_dir=transcript_path.parent,
        output_stem=derive_output_stem(transcript_path),
        transcript_text=request.text,
        client=configured_insight_client,
    )

    return ProcessResult(
        status=insight_result.status,
        transcript_path=transcript_path.as_posix(),
        insights_path=insight_result.insights_path,
        text=insight_result.text,
        insights=insight_result.insights,
        error=insight_result.error,
    ).to_dict()


def parse_retry_insights_request(payload: object) -> RetryInsightsRequest:
    if not isinstance(payload, dict):
        raise ValueError("Retry payload must be a JSON object.")

    transcript_path = payload.get("transcript_path")
    if not isinstance(transcript_path, str) or not transcript_path.strip():
        raise ValueError("Retry payload must include a non-empty transcript_path.")

    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Retry payload must include non-empty transcript text.")

    return RetryInsightsRequest(transcript_path=transcript_path.strip(), text=text)


def resolve_markdown_transcript_path(transcript_path: Path) -> Path:
    if transcript_path.suffix.lower() == ".md":
        return transcript_path

    return transcript_path.with_suffix(".md")


def derive_output_stem(transcript_path: Path) -> str:
    transcript_suffix = "_transcript"
    if transcript_path.stem.endswith(transcript_suffix):
        return transcript_path.stem[: -len(transcript_suffix)]

    return transcript_path.stem


def failed_insight_retry_result(
    code: str,
    message: str,
    transcript_path: Path | None,
    text: str,
) -> ProcessResult:
    return ProcessResult(
        status=JobStage.PARTIAL_COMPLETED,
        transcript_path=transcript_path.as_posix() if transcript_path else None,
        text=text,
        error=WorkerError(
            code=code,
            message=message,
            stage=JobStage.INSIGHTS_GENERATING,
        ),
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


def resolve_configured_asr_model(
    request_model: str,
    environ: dict[str, str] | None = None,
) -> str:
    env = environ if environ is not None else {}
    configured_model = env.get(ASR_MODEL_ENV, "").strip()
    return resolve_asr_model_name(configured_model or request_model)


def append_history_item(
    project_root: Path,
    request: ProcessRequest,
    result: ProcessResult,
    output_dir: Path,
    work_dir: Path | None = None,
) -> None:
    resolved_work_dir = work_dir or project_root / "work"
    history_path = resolved_work_dir / HISTORY_FILE_NAME
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history = load_history(history_path)
    items = history.setdefault("items", [])
    if not isinstance(items, list):
        items = []
        history["items"] = items

    items.insert(0, build_history_item(request, result, output_dir))
    history_path.write_text(
        json.dumps(history, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_history(history_path: Path) -> dict[str, object]:
    if not history_path.exists():
        return {"items": []}

    try:
        loaded = json.loads(history_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"items": []}

    if isinstance(loaded, dict) and isinstance(loaded.get("items"), list):
        return loaded
    return {"items": []}


def build_history_item(
    request: ProcessRequest,
    result: ProcessResult,
    output_dir: Path,
) -> dict[str, object]:
    error = None
    if result.error is not None:
        error = {
            "code": result.error.code,
            "message": result.error.message,
            "stage": result.error.stage.value,
        }

    return {
        "id": f"{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "url": request.url,
        "status": result.status.value,
        "output_dir": output_dir.as_posix(),
        "video_path": result.video_path,
        "audio_path": result.audio_path,
        "transcript_path": result.transcript_path,
        "insights_path": result.insights_path,
        "error": error,
        "text_preview": result.text.strip()[:180],
        "insights_count": len(result.insights),
    }


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


def should_allow_real_asr(environ: dict[str, str] | None = None) -> bool:
    env = environ if environ is not None else os.environ
    return env.get("FRAMEQ_ALLOW_REAL_ASR") == "1"


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


def render_result_json(result: dict[str, object]) -> str:
    return json.dumps(result, ensure_ascii=True)


def render_progress_event(event: dict[str, object]) -> str:
    return f"{PROGRESS_EVENT_PREFIX}{json.dumps(event, ensure_ascii=True)}"


def print_progress_event(event: dict[str, object]) -> None:
    print(render_progress_event(event), file=sys.stderr, flush=True)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one FrameQ worker request.")
    request_group = parser.add_mutually_exclusive_group(required=True)
    request_group.add_argument("--request-json", help="Serialized ProcessRequest payload.")
    request_group.add_argument(
        "--retry-insights-json",
        help="Serialized RetryInsightsRequest payload.",
    )
    args = parser.parse_args(argv)

    if args.retry_insights_json:
        result = retry_insights_once(args.retry_insights_json, project_root=Path.cwd())
    else:
        result = run_worker_once(
            args.request_json,
            project_root=Path.cwd(),
            progress_callback=print_progress_event,
        )
    print(render_result_json(result))
    return 0
