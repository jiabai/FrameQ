from __future__ import annotations

import json
import os
from dataclasses import replace
from pathlib import Path

from frameq_worker.asr import DEFAULT_ASR_MODEL, ASRError, Transcriber
from frameq_worker.config import load_project_env
from frameq_worker.desktop_contract import (
    MODEL_DIR_ENV,
    MODEL_DOWNLOAD_SHA256_ENV,
    MODEL_DOWNLOAD_URL_ENV,
    MODELSCOPE_ENDPOINT_ENV,
    SENSEVOICE_REVISION_ENV,
    ProgressCallback,
)
from frameq_worker.insightflow import InsightClient
from frameq_worker.llm import build_insight_client_from_env
from frameq_worker.media import CommandRunner, run_command
from frameq_worker.model_download import ModelDownloadError, download_asr_model_cache
from frameq_worker.models import JobStage, ProcessResult, WorkerError
from frameq_worker.pipeline import (
    failed_result,
    finalize_task_result,
    resolve_output_dir,
    resolve_work_dir,
    run_insight_generation_step,
    run_worker_pipeline,
)
from frameq_worker.requests import (
    optional_env,
    parse_process_request,
    parse_retry_insights_request,
    resolve_configured_asr_model,
)
from frameq_worker.task_store import ensure_task_dirs, task_context_from_manifest


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
    return result.to_dict()


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
            text="",
        ).to_dict()

    root = project_root or Path.cwd()
    runtime_env = load_project_env(root, environ)
    configured_insight_client = insight_client or build_insight_client_from_env(runtime_env)
    output_dir = resolve_output_dir(root, runtime_env)
    work_dir = resolve_work_dir(root, runtime_env)
    try:
        task_context = task_context_from_manifest(output_dir, work_dir, request.task_id)
    except (OSError, json.JSONDecodeError) as exc:
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            task_id=request.task_id,
            error=WorkerError(
                code="TASK_MANIFEST_NOT_FOUND",
                message=f"Task manifest is required to regenerate insights: {exc}",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        ).to_dict()
    ensure_task_dirs(task_context.paths)

    transcript_text = (
        task_context.paths.transcript_txt_path.read_text(encoding="utf-8").strip()
        if task_context.paths.transcript_txt_path.exists()
        else ""
    )
    if not task_context.paths.transcript_md_path.exists() and configured_insight_client is not None:
        result = finalize_task_result(
            task_context,
            failed_insight_retry_result(
                code="TRANSCRIPT_MARKDOWN_NOT_FOUND",
                message="Transcript markdown file is required to regenerate insights.",
                text=transcript_text,
            ),
        )
        return result.to_dict()

    insight_result = run_insight_generation_step(
        transcript_path=task_context.paths.transcript_md_path,
        output_dir=task_context.paths.ai_dir,
        output_stem="",
        transcript_text=transcript_text,
        client=configured_insight_client,
    )

    return finalize_task_result(task_context, insight_result).to_dict()



def failed_insight_retry_result(
    code: str,
    message: str,
    text: str,
) -> ProcessResult:
    return ProcessResult(
        status=JobStage.PARTIAL_COMPLETED,
        text=text,
        error=WorkerError(
            code=code,
            message=message,
            stage=JobStage.INSIGHTS_GENERATING,
        ),
    )


def should_allow_real_asr(environ: dict[str, str] | None = None) -> bool:
    env = environ if environ is not None else os.environ
    return env.get("FRAMEQ_ALLOW_REAL_ASR") == "1"


def run_asr_model_download_once(
    project_root: Path | None = None,
    environ: dict[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, object]:
    root = project_root or Path.cwd()
    runtime_env = load_project_env(root, environ)
    cache_dir = Path(runtime_env.get(MODEL_DIR_ENV, str(root / "models")))

    try:
        download_asr_model_cache(
            cache_dir=cache_dir,
            download_url=optional_env(runtime_env, MODEL_DOWNLOAD_URL_ENV),
            expected_sha256=optional_env(runtime_env, MODEL_DOWNLOAD_SHA256_ENV),
            revision=optional_env(runtime_env, SENSEVOICE_REVISION_ENV),
            endpoint=optional_env(runtime_env, MODELSCOPE_ENDPOINT_ENV),
            progress_callback=progress_callback,
        )
    except ModelDownloadError as exc:
        return {
            "status": "failed",
            "code": exc.code,
            "message": exc.message,
            "model_dir": cache_dir.as_posix(),
        }
    except Exception as exc:  # noqa: BLE001 - wraps third-party downloader failures.
        return {
            "status": "failed",
            "code": "ASR_MODEL_DOWNLOAD_FAILED",
            "message": str(exc),
            "model_dir": cache_dir.as_posix(),
        }

    return {
        "status": "completed",
        "model": DEFAULT_ASR_MODEL,
        "model_dir": cache_dir.as_posix(),
    }
