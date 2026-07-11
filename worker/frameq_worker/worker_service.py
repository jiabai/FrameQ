from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

from frameq_worker.asr import DEFAULT_ASR_MODEL, ASRError, Transcriber, build_asr_transcriber
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
from frameq_worker.models import Insight, JobStage, ProcessResult, TranscriptMetadata, WorkerError
from frameq_worker.pipeline import (
    TranscriberFactory,
    failed_result,
    finalize_task_result,
    resolve_cache_dir,
    resolve_output_dir,
    run_insight_generation_step,
    run_worker_pipeline,
)
from frameq_worker.requests import (
    optional_env,
    parse_process_request,
    parse_retry_insights_request,
    resolve_configured_asr_model,
)
from frameq_worker.source_identity import (
    SourceIdentityError,
    resolve_source_request,
)
from frameq_worker.task_store import (
    ensure_task_dirs,
    load_task_manifest,
    task_context_from_manifest,
    write_preference_snapshot_artifact,
)

InsightClientFactory = Callable[[dict[str, str]], InsightClient | None]


def run_worker_once(
    request_json: str,
    project_root: Path | None = None,
    command_runner: CommandRunner = run_command,
    transcriber: Transcriber | None = None,
    transcriber_factory: TranscriberFactory | None = None,
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

    result = run_worker_pipeline(
        request=request,
        project_root=root,
        command_runner=command_runner,
        transcriber=transcriber,
        allow_real_asr=should_allow_real_asr(runtime_env)
        if allow_real_asr is None
        else allow_real_asr,
        environ=runtime_env,
        transcriber_factory=transcriber_factory or build_asr_transcriber,
        progress_callback=progress_callback,
    )
    return result.to_dict()


def resolve_source_identity_once(request_json: str) -> dict[str, object]:
    try:
        payload = json.loads(request_json)
    except json.JSONDecodeError:
        return {
            "status": "failed",
            "error": {"code": "INVALID_SOURCE_IDENTITY_JSON"},
        }
    raw_url = payload.get("url") if isinstance(payload, dict) else None
    if not isinstance(raw_url, str) or not raw_url.strip():
        return {
            "status": "failed",
            "error": {"code": "INVALID_SOURCE_IDENTITY_PAYLOAD"},
        }
    try:
        identity = resolve_source_request(raw_url).identity
    except SourceIdentityError:
        return {
            "status": "failed",
            "error": {"code": "SOURCE_IDENTITY_UNAVAILABLE"},
        }
    return {
        "status": "completed",
        "source_url": identity.canonical_url,
        "source_identity": identity.to_manifest_dict(),
    }


def retry_insights_once(
    request_json: str,
    project_root: Path | None = None,
    insight_client: InsightClient | None = None,
    insight_client_factory: InsightClientFactory | None = None,
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
    configured_insight_client = insight_client or (
        insight_client_factory or build_insight_client_from_env
    )(runtime_env)
    output_dir = resolve_output_dir(root, runtime_env)
    cache_dir = resolve_cache_dir(root, runtime_env)
    try:
        task_context = task_context_from_manifest(output_dir, cache_dir, request.task_id)
        manifest = load_task_manifest(output_dir, request.task_id)
    except (OSError, ValueError, json.JSONDecodeError):
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            error=WorkerError(
                code="TASK_MANIFEST_NOT_FOUND",
                message="A safe task manifest is required to regenerate insights.",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        ).to_dict()
    ensure_task_dirs(task_context.paths)
    if request.target == "insights" and request.preference_snapshot is not None:
        write_preference_snapshot_artifact(
            task_context.paths,
            request.preference_snapshot,
        )

    insight_result = run_insight_generation_step(
        transcript_txt_path=task_context.paths.transcript_txt_path,
        output_dir=task_context.paths.ai_dir,
        output_stem="",
        client=configured_insight_client,
        transcript=transcript_metadata_from_manifest(manifest),
        preference_snapshot=request.preference_snapshot,
        target=request.target,
    )

    return finalize_task_result(
        task_context,
        merge_existing_ai_artifacts(task_context.paths, insight_result),
    ).to_dict()


def merge_existing_ai_artifacts(paths: object, result: ProcessResult) -> ProcessResult:
    summary = result.summary or read_existing_summary(paths)
    insights = result.insights or read_existing_insights(paths)
    return ProcessResult(
        status=result.status,
        artifacts=result.artifacts,
        text=result.text,
        summary=summary,
        insights=insights,
        transcript=result.transcript,
        error=result.error,
    )


def read_existing_summary(paths: object) -> str:
    summary_path = getattr(paths, "summary_path", None)
    if not isinstance(summary_path, Path) or not summary_path.is_file():
        return ""
    return summary_path.read_text(encoding="utf-8").strip()


def read_existing_insights(paths: object) -> list[Insight]:
    insights_path = getattr(paths, "insights_json_path", None)
    if not isinstance(insights_path, Path) or not insights_path.is_file():
        return []
    try:
        payload = json.loads(insights_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        return []
    raw_insights = payload.get("insights")
    if not isinstance(raw_insights, list):
        return []

    insights: list[Insight] = []
    for raw in raw_insights:
        if not isinstance(raw, dict):
            return []
        try:
            insight_id = int(raw["id"])
            topic = str(raw["topic"]).strip()
            match_reason = str(raw["matchReason"]).strip()
            raw_questions = raw["followUpQuestions"]
            if not isinstance(raw_questions, list):
                return []
            follow_up_questions = tuple(
                question.strip()
                for question in raw_questions
                if isinstance(question, str) and question.strip()
            )
            suitable_use = str(raw["suitableUse"]).strip()
            raw_source_chunk_id = raw.get("sourceChunkId")
            source_chunk_id = (
                int(raw_source_chunk_id)
                if raw_source_chunk_id is not None
                else None
            )
        except (KeyError, TypeError, ValueError):
            return []
        if not topic or not match_reason or not follow_up_questions or not suitable_use:
            return []
        insights.append(
            Insight(
                id=insight_id,
                topic=topic,
                match_reason=match_reason,
                follow_up_questions=follow_up_questions,
                suitable_use=suitable_use,
                source_chunk_id=source_chunk_id,
            )
        )
    return insights



def failed_insight_retry_result(
    code: str,
    message: str,
    text: str,
    transcript: TranscriptMetadata | None = None,
) -> ProcessResult:
    return ProcessResult(
        status=JobStage.PARTIAL_COMPLETED,
        text=text,
        transcript=transcript,
        error=WorkerError(
            code=code,
            message=message,
            stage=JobStage.INSIGHTS_GENERATING,
        ),
    )


def transcript_metadata_from_manifest(manifest: dict[str, object]) -> TranscriptMetadata | None:
    raw_transcript = manifest.get("transcript")
    if isinstance(raw_transcript, dict):
        source = raw_transcript.get("source")
        if source in {"asr", "subtitle"}:
            language = raw_transcript.get("language")
            engine = raw_transcript.get("engine")
            return TranscriptMetadata(
                source=source,
                language=language if isinstance(language, str) else None,
                engine=engine if isinstance(engine, str) else None,
            )

    return None


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
