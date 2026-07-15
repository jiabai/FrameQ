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
from frameq_worker.draft_agent import run_draft
from frameq_worker.insightflow import InsightClient
from frameq_worker.llm import build_insight_client_from_env
from frameq_worker.media import CommandRunner, run_command
from frameq_worker.model_download import ModelDownloadError, download_asr_model_cache
from frameq_worker.models import (
    Insight,
    JobStage,
    PreferenceSnapshot,
    ProcessResult,
    RetryInsightsRequest,
    TranscriptMetadata,
    WorkerError,
)
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
    parse_preference_snapshot,
    parse_process_request,
    parse_retry_insights_request,
    resolve_configured_asr_model,
)
from frameq_worker.source_identity import (
    SourceIdentityError,
    resolve_source_request,
)
from frameq_worker.task_store import (
    DRAFT_SEED_UNSET,
    TaskContext,
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

    if request.target == "draft":
        # seed validation happens BEFORE any checkout / run_draft call
        # (invalid seed consumes no quota).
        draft_result = run_draft_generation_step(
            task_context=task_context,
            request=request,
            runtime_env=runtime_env,
        )
        return finalize_task_result(
            task_context,
            merge_existing_ai_artifacts(task_context.paths, draft_result),
            draft_seed_insight_id=request.insight_id,
        ).to_dict()

    insight_result = run_insight_generation_step(
        transcript_txt_path=task_context.paths.transcript_txt_path,
        output_dir=task_context.paths.ai_dir,
        output_stem="",
        client=configured_insight_client,
        transcript=transcript_metadata_from_manifest(manifest),
        preference_snapshot=request.preference_snapshot,
        target=request.target,
    )

    # target=insights regen changes the insight ids, so the old draft seed id
    # is now invalid — clear it. target=summary leaves insights untouched, so the
    # seed is preserved (finalize_task_result defaults to DRAFT_SEED_UNSET which
    # write_task_manifest carries forward from the prior manifest).
    draft_seed = None if request.target == "insights" else DRAFT_SEED_UNSET
    return finalize_task_result(
        task_context,
        merge_existing_ai_artifacts(task_context.paths, insight_result),
        draft_seed_insight_id=draft_seed,
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
        draft=result.draft,
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


def run_draft_generation_step(
    *,
    task_context: TaskContext,
    request: RetryInsightsRequest,
    runtime_env: dict[str, str],
    draft_runner: Callable[..., str] | None = None,
) -> ProcessResult:
    """draft branch: seed from a single Insight + task-local snapshot + summary.

    Validates the seed against ``ai/insights.json`` BEFORE any checkout / run_draft
    call (invalid seed consumes no LLM quota). Reads ``ai/preference-snapshot.json``
    and ``ai/summary.md`` from disk (optional grounding). On success writes
    ``ai/draft.md`` and returns a ``ProcessResult`` carrying ``draft`` text.
    """
    paths = task_context.paths

    # seed invalidation — resolve the Insight by insight_id BEFORE checkout.
    seed = _find_insight_by_id(read_existing_insights(paths), request.insight_id)
    if seed is None:
        return _draft_step_failed(
            code="DRAFT_SEED_INVALID",
            message=(
                f"insight_id {request.insight_id} is not present in ai/insights.json; "
                "re-select an insight and retry."
            ),
        )

    # preference snapshot comes from disk (written when target=insights ran).
    # Missing → None (no-personalization degrade, do not block).
    preference_snapshot = read_existing_preference_snapshot(paths)
    # summary is optional grounding; missing → None.
    existing_summary = read_existing_summary(paths)
    summary: str | None = existing_summary or None

    # Resolve at call time so tests can patch frameq_worker.worker_service.run_draft.
    runner = draft_runner if draft_runner is not None else run_draft
    try:
        draft_text = runner(seed, preference_snapshot, summary, request.platform, runtime_env)
    except Exception as exc:  # noqa: BLE001 - wraps LLM / MCP / agent-loop failures.
        import sys as _sys, traceback as _tb
        _stack = [exc]; _leaves = []
        while _stack:
            _e = _stack.pop()
            if hasattr(_e, "exceptions"):
                _stack.extend(_e.exceptions)
            else:
                _leaves.append(_e)
        for _i, _lf in enumerate(_leaves):
            _sys.stderr.write(f"===DRAFT_LEAF[{_i}] {type(_lf).__name__}: {_lf}===\n")
            for _fr in _tb.extract_tb(_lf.__traceback__)[-4:]:
                _sys.stderr.write(f"  {_fr.filename}:{_fr.lineno} in {_fr.name}  ||  {_fr.line or ''}\n")
        _sys.stderr.write("===DRAFT_DEBUG top===\n")
        _tb.print_exception(type(exc), exc, exc.__traceback__)
        return _draft_step_failed(
            code="DRAFT_GENERATION_FAILED",
            message=str(exc),
        )

    if not draft_text or not draft_text.strip():
        # 空串 / 纯空白判失败且不落盘：写空文件 + 报成功是静默失败。
        return _draft_step_failed(
            code="DRAFT_EMPTY_RESULT",
            message="Draft generation returned an empty result.",
        )

    paths.draft_path.parent.mkdir(parents=True, exist_ok=True)
    paths.draft_path.write_text(draft_text, encoding="utf-8")

    return ProcessResult(
        status=JobStage.COMPLETED,
        artifacts={"draft": "ai/draft.md"},
        draft=draft_text,
    )


def _draft_step_failed(*, code: str, message: str) -> ProcessResult:
    """Draft-branch failure wrapper — stage is always DRAFT_GENERATING."""
    return ProcessResult(
        status=JobStage.PARTIAL_COMPLETED,
        error=WorkerError(
            code=code,
            message=message,
            stage=JobStage.DRAFT_GENERATING,
        ),
    )


def _find_insight_by_id(insights: list[Insight], insight_id: int | None) -> Insight | None:
    if insight_id is None:
        return None
    for insight in insights:
        if insight.id == insight_id:
            return insight
    return None


def read_existing_preference_snapshot(paths: object) -> PreferenceSnapshot | None:
    """Round-trip ``ai/preference-snapshot.json`` back to a PreferenceSnapshot.

    Missing or malformed → None (no-personalization degrade). Reuses
    ``parse_preference_snapshot`` so the on-disk schema is validated identically.
    """
    snapshot_path = getattr(paths, "preference_snapshot_path", None)
    if not isinstance(snapshot_path, Path) or not snapshot_path.is_file():
        return None
    try:
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    try:
        return parse_preference_snapshot(payload)
    except ValueError:
        return None


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
