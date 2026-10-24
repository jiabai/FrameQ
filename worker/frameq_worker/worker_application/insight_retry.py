from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from frameq_worker.atomic_files import AtomicFileCommitError
from frameq_worker.config import load_project_env
from frameq_worker.desktop_contract import ProgressCallback
from frameq_worker.draft_agent import run_draft
from frameq_worker.insightflow import InsightClient
from frameq_worker.insightflow.dissection import (
    DissectionGenerationError,
    parse_persisted_dissection,
)
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
    resolve_cache_dir,
    resolve_output_dir,
    run_insight_generation_step,
)
from frameq_worker.requests import (
    INVALID_RETRY_PAYLOAD_MESSAGE,
    parse_preference_snapshot,
    parse_retry_insights_request,
)
from frameq_worker.task_store import DRAFT_SEED_UNSET, TaskContext, TaskPaths, TaskStoreFacade
from frameq_worker.task_transaction import (
    TaskArtifactCommitError,
    TaskArtifactRecoveryError,
)
from frameq_worker.transcript_polish import run_transcript_polish_step
from frameq_worker.worker_application import defaults

InsightClientFactory = Callable[[dict[str, str]], InsightClient | None]


def retry_insights_once(
    request_json: str,
    project_root: Path | None = None,
    insight_client: InsightClient | None = None,
    insight_client_factory: InsightClientFactory | None = None,
    environ: dict[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
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
    except ValueError:
        return failed_insight_retry_result(
            code="INVALID_RETRY_PAYLOAD",
            message=INVALID_RETRY_PAYLOAD_MESSAGE,
            text="",
        ).to_dict()

    root = project_root or Path.cwd()
    runtime_env = load_project_env(root, environ)
    configured_insight_client = insight_client or (
        insight_client_factory or defaults.build_insight_client_from_env
    )(runtime_env)
    output_dir = resolve_output_dir(root, runtime_env)
    cache_dir = resolve_cache_dir(root, runtime_env)
    task_store = TaskStoreFacade(output_root=output_dir, cache_root=cache_dir)
    try:
        opened_task = task_store.open(request.task_id)
    except TaskArtifactRecoveryError:
        return failed_insight_retry_result(
            code="TASK_ARTIFACT_RECOVERY_FAILED",
            message="Task artifacts could not be recovered safely.",
            text="",
        ).to_dict()
    except (OSError, ValueError, json.JSONDecodeError):
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            error=WorkerError(
                code="TASK_MANIFEST_NOT_FOUND",
                message="A safe task manifest is required to regenerate insights.",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        ).to_dict()
    task_context = opened_task.context
    if request.target == "insights" and request.preference_snapshot is not None:
        try:
            task_store.save_preference_snapshot(
                task_context,
                request.preference_snapshot,
            )
        except TaskArtifactRecoveryError:
            return failed_insight_retry_result(
                code="TASK_ARTIFACT_RECOVERY_FAILED",
                message="Task artifacts could not be recovered safely.",
                text="",
                transcript=opened_task.transcript,
            ).to_dict()
        except (AtomicFileCommitError, TaskArtifactCommitError):
            return failed_insight_retry_result(
                code="TASK_ARTIFACT_COMMIT_FAILED",
                message="Task artifacts could not be stored safely.",
                text="",
                transcript=opened_task.transcript,
            ).to_dict()

    if request.target == "draft":
        # seed validation happens BEFORE any checkout / run_draft call
        # (invalid seed consumes no quota).
        draft_result = run_draft_generation_step(
            task_context=task_context,
            request=request,
            runtime_env=runtime_env,
        )
        merged_result = merge_existing_ai_artifacts(task_context.paths, draft_result)
        try:
            return task_store.finalize(
                task_context,
                merged_result,
                draft_seed_insight_id=request.insight_id,
            ).to_dict()
        except TaskArtifactRecoveryError:
            return failed_insight_retry_result(
                code="TASK_ARTIFACT_RECOVERY_FAILED",
                message="Task artifacts could not be recovered safely.",
                text=merged_result.text,
                transcript=opened_task.transcript,
            ).to_dict()
        except (AtomicFileCommitError, TaskArtifactCommitError):
            return failed_insight_retry_result(
                code="TASK_ARTIFACT_COMMIT_FAILED",
                message="Task artifacts could not be stored safely.",
                text=merged_result.text,
                transcript=opened_task.transcript,
            ).to_dict()

    if request.target == "transcript":
        # 整理文字稿：读已保存的正式稿，产出 transcript/polished.txt，原稿不动。
        polish_result = run_transcript_polish_step(
            task_context=task_context,
            runtime_env=runtime_env,
            progress_callback=progress_callback,
        )
        merged_polish_result = merge_existing_ai_artifacts(task_context.paths, polish_result)
        return _finalize_retry_result(
            task_store=task_store,
            task_context=task_context,
            merged_result=merged_polish_result,
            transcript=opened_task.transcript,
        )

    insight_result = run_insight_generation_step(
        transcript_txt_path=task_context.paths.transcript_txt_path,
        output_dir=task_context.paths.ai_dir,
        output_stem="",
        client=configured_insight_client,
        transcript=opened_task.transcript,
        preference_snapshot=request.preference_snapshot,
        target=request.target,
        output_language=request.output_language,
        persist=False,
        progress_callback=progress_callback,
    )

    merged_result = merge_existing_ai_artifacts(task_context.paths, insight_result)
    # target=insights regen changes the insight ids, so the old draft seed id
    # is now invalid — clear it. target=summary/dissection leaves insights
    # untouched, so the seed is preserved (finalize defaults to DRAFT_SEED_UNSET
    # which serialize_task_manifest carries forward from the prior manifest).
    draft_seed = None if request.target == "insights" else DRAFT_SEED_UNSET
    try:
        return task_store.finalize(
            task_context,
            merged_result,
            draft_seed_insight_id=draft_seed,
        ).to_dict()
    except TaskArtifactRecoveryError:
        return failed_insight_retry_result(
            code="TASK_ARTIFACT_RECOVERY_FAILED",
            message="Task artifacts could not be recovered safely.",
            text=insight_result.text,
            transcript=opened_task.transcript,
        ).to_dict()
    except (AtomicFileCommitError, TaskArtifactCommitError):
        return failed_insight_retry_result(
            code="TASK_ARTIFACT_COMMIT_FAILED",
            message="Task artifacts could not be stored safely.",
            text=insight_result.text,
            transcript=opened_task.transcript,
        ).to_dict()


def merge_existing_ai_artifacts(
    paths: TaskPaths,
    result: ProcessResult,
) -> ProcessResult:
    summary = result.summary or read_existing_summary(paths)
    insights = result.insights or read_existing_insights(paths)
    dissection = result.dissection or read_existing_dissection(paths)
    return ProcessResult(
        status=result.status,
        artifacts=result.artifacts,
        text=result.text,
        summary=summary,
        insights=insights,
        transcript=result.transcript,
        dissection=dissection,
        error=result.error,
        artifact_payloads=result.artifact_payloads,
        draft=result.draft,
    )


def _finalize_retry_result(
    *,
    task_store: TaskStoreFacade,
    task_context: TaskContext,
    merged_result: ProcessResult,
    transcript: TranscriptMetadata | None,
) -> dict[str, object]:
    try:
        return task_store.finalize(
            task_context,
            merged_result,
            draft_seed_insight_id=DRAFT_SEED_UNSET,
        ).to_dict()
    except TaskArtifactRecoveryError:
        return failed_insight_retry_result(
            code="TASK_ARTIFACT_RECOVERY_FAILED",
            message="Task artifacts could not be recovered safely.",
            text=merged_result.text,
            transcript=transcript,
        ).to_dict()
    except (AtomicFileCommitError, TaskArtifactCommitError):
        return failed_insight_retry_result(
            code="TASK_ARTIFACT_COMMIT_FAILED",
            message="Task artifacts could not be stored safely.",
            text=merged_result.text,
            transcript=transcript,
        ).to_dict()


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

    # Resolve at call time so tests can patch
    # frameq_worker.worker_application.insight_retry.run_draft.
    runner = draft_runner if draft_runner is not None else run_draft
    try:
        draft_text = runner(
            seed,
            preference_snapshot,
            summary,
            request.platform,
            runtime_env,
            output_language=request.output_language,
        )
    except Exception as exc:  # noqa: BLE001 - wraps LLM / MCP / agent-loop failures.
        import sys as _sys
        import traceback as _tb

        _stack = [exc]
        _leaves = []
        while _stack:
            _e = _stack.pop()
            if hasattr(_e, "exceptions"):
                _stack.extend(_e.exceptions)
            else:
                _leaves.append(_e)
        for _i, _lf in enumerate(_leaves):
            _sys.stderr.write(f"===DRAFT_LEAF[{_i}] {type(_lf).__name__}: {_lf}===\n")
            for _fr in _tb.extract_tb(_lf.__traceback__)[-4:]:
                _sys.stderr.write(
                    f"  {_fr.filename}:{_fr.lineno} in {_fr.name}  ||  {_fr.line or ''}\n"
                )
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

    # 重生会产出新 AI 稿；旧的手改 original 备份已陈旧，删除以便下次首次编辑以新稿为基线重新备份。
    # best-effort：失败不影响生成结果（最坏只是陈旧备份留到下次编辑）。
    try:
        paths.draft_original_path.unlink(missing_ok=True)
    except OSError:
        pass

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


def _find_insight_by_id(
    insights: list[Insight],
    insight_id: int | None,
) -> Insight | None:
    if insight_id is None:
        return None
    for insight in insights:
        if insight.id == insight_id:
            return insight
    return None


def read_existing_preference_snapshot(paths: TaskPaths) -> PreferenceSnapshot | None:
    """Round-trip ``ai/preference-snapshot.json`` back to a PreferenceSnapshot.

    Missing or malformed → None (no-personalization degrade). Reuses
    ``parse_preference_snapshot`` so the on-disk schema is validated identically.
    """
    snapshot_path = paths.preference_snapshot_path
    if not snapshot_path.is_file():
        return None
    try:
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    try:
        return parse_preference_snapshot(payload)
    except ValueError:
        return None


def read_existing_summary(paths: TaskPaths) -> str:
    summary_path = paths.summary_path
    if not summary_path.is_file():
        return ""
    return summary_path.read_text(encoding="utf-8").strip()


def read_existing_insights(paths: TaskPaths) -> list[Insight]:
    insights_path = paths.insights_json_path
    if not insights_path.is_file():
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


def read_existing_dissection(paths: TaskPaths) -> dict[str, object] | None:
    if not paths.dissection_json.is_file() or not paths.transcript_txt_path.is_file():
        return None
    try:
        payload = json.loads(paths.dissection_json.read_text(encoding="utf-8"))
        transcript = paths.transcript_txt_path.read_bytes().decode("utf-8")
        return parse_persisted_dissection(payload, transcript=transcript).to_dict()
    except (OSError, UnicodeError, json.JSONDecodeError, DissectionGenerationError):
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
