from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from pathlib import Path

from frameq_worker.asr import (
    Transcriber,
    build_qwen_asr_transcriber,
    resolve_model_cache_dir,
)
from frameq_worker.insightflow import InsightClient
from frameq_worker.media import (
    CommandExecutionError,
    CommandRunner,
    download_video,
    extract_audio,
    probe_media_file,
    run_command,
)
from frameq_worker.models import JobStage, ProcessRequest, ProcessResult, WorkerError
from frameq_worker.pipeline import run_asr_transcript_step, run_insight_generation_step

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}


def run_worker_once(
    request_json: str,
    project_root: Path | None = None,
    command_runner: CommandRunner = run_command,
    transcriber: Transcriber | None = None,
    insight_client: InsightClient | None = None,
    allow_real_asr: bool | None = None,
    environ: dict[str, str] | None = None,
) -> dict[str, object]:
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

    runtime_env = environ if environ is not None else os.environ
    result = run_worker_pipeline(
        request=request,
        project_root=project_root or Path.cwd(),
        command_runner=command_runner,
        transcriber=transcriber,
        insight_client=insight_client,
        allow_real_asr=should_allow_real_asr(runtime_env)
        if allow_real_asr is None
        else allow_real_asr,
        environ=runtime_env,
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
        model=str(payload.get("model", "Qwen/Qwen3-ASR-0.6B")),
        generate_insights=bool(payload.get("generate_insights", True)),
        insightflow_mode=str(payload.get("insightflow_mode", "embedded")),
    )


def run_worker_pipeline(
    request: ProcessRequest,
    project_root: Path,
    command_runner: CommandRunner,
    transcriber: Transcriber | None,
    insight_client: InsightClient | None,
    allow_real_asr: bool,
    environ: dict[str, str],
) -> ProcessResult:
    output_dir = project_root / "outputs"
    work_dir = project_root / "work"

    try:
        download_video(request.url, output_dir=output_dir, runner=command_runner)
    except CommandExecutionError as exc:
        return failed_result(
            code="VIDEO_DOWNLOAD_FAILED",
            message=str(exc),
            stage=JobStage.VIDEO_EXTRACTING,
        )

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

    audio_path = work_dir / f"{video_path.stem}.wav"
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
        model_cache_dir = resolve_model_cache_dir(project_root=project_root, environ=environ)
        try:
            transcriber = build_qwen_asr_transcriber(
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


def render_result_json(result: dict[str, object]) -> str:
    return json.dumps(result, ensure_ascii=True)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one FrameQ worker request.")
    parser.add_argument("--request-json", required=True, help="Serialized ProcessRequest payload.")
    args = parser.parse_args(argv)

    result = run_worker_once(args.request_json)
    print(render_result_json(result))
    return 0
