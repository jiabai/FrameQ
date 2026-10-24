from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from frameq_worker.ai_runtime import insight_target_env
from frameq_worker.desktop_contract import ProgressCallback
from frameq_worker.dissection_report import DissectionGenerationError
from frameq_worker.insight_errors import InsightGenerationError
from frameq_worker.models import (
    InsightGenerationTarget,
    JobStage,
    PreferenceSnapshot,
    ProcessResult,
    TranscriptMetadata,
    WorkerError,
)
from frameq_worker.output_language import OutputLanguage
from frameq_worker.pipeline_runtime.dissection import run_dissection_generation
from frameq_worker.summary_agent import (
    SummaryRunner,
    generate_summary_via_agent_runtime,
    write_summary_files,
)
from frameq_worker.topic_agent import (
    generate_insights_via_agent_runtime,
    write_insight_files,
)


def run_insight_generation_step(
    transcript_txt_path: Path,
    output_dir: Path,
    output_stem: str,
    output_language: OutputLanguage,
    transcript: TranscriptMetadata | None = None,
    preference_snapshot: PreferenceSnapshot | None = None,
    target: InsightGenerationTarget = "all",
    persist: bool = True,
    progress_callback: ProgressCallback | None = None,
    runtime_env: Mapping[str, str] | None = None,
    summary_runner: SummaryRunner | None = None,
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
        official_transcript_bytes = transcript_txt_path.read_bytes()
        official_transcript_body = official_transcript_bytes.decode("utf-8")
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

    transcript_body = official_transcript_body.strip()
    if not transcript_body:
        return ProcessResult(
            status=JobStage.PARTIAL_COMPLETED,
            text="",
            transcript=transcript,
            error=WorkerError(
                code=(
                    "DISSECTION_EMPTY_TRANSCRIPT"
                    if target == "dissection"
                    else "INSIGHTFLOW_EMPTY_TRANSCRIPT"
                ),
                message="Official transcript text is empty.",
                stage=JobStage.INSIGHTS_GENERATING,
            ),
        )

    summary_artifacts = None
    insight_artifacts = None
    dissection_artifacts = None
    generation_error: InsightGenerationError | None = None

    if target in {"all", "summary"}:
        try:
            if summary_runner is None and runtime_env is None:
                raise InsightGenerationError(
                    "INSIGHTFLOW_CONFIG_MISSING",
                    "Summary agent LLM client is not configured.",
                )
            runner = summary_runner or generate_summary_via_agent_runtime
            summary, mindmap = runner(
                transcript_body,
                insight_target_env(runtime_env or {}, "summary"),
                output_language,
            )
            summary_artifacts = write_summary_files(
                summary=summary,
                mindmap=mindmap,
                output_dir=output_dir,
                output_stem=output_stem,
                output_language=output_language,
                persist=persist,
            )
        except InsightGenerationError as exc:
            generation_error = exc

    if target in {"all", "insights"}:
        try:
            insights = generate_insights_via_agent_runtime(
                transcript_body,
                insight_target_env(runtime_env or {}, "insights"),
                output_language,
                preference_snapshot=preference_snapshot,
            )
            insight_artifacts = write_insight_files(
                insights,
                output_dir=output_dir,
                output_stem=output_stem,
                output_language=output_language,
                persist=persist,
            )
        except InsightGenerationError as exc:
            if generation_error is None:
                generation_error = exc

    if target == "dissection":
        try:
            dissection_artifacts = run_dissection_generation(
                official_transcript_body,
                output_dir=output_dir,
                runtime_env=insight_target_env(runtime_env or {}, "dissection"),
                output_language=output_language,
                source_language=transcript.language if transcript else None,
                progress_callback=progress_callback,
            )
        except (DissectionGenerationError, InsightGenerationError) as exc:
            generation_error = InsightGenerationError(exc.code, str(exc))

    status = JobStage.COMPLETED if generation_error is None else JobStage.PARTIAL_COMPLETED

    return ProcessResult(
        status=status,
        artifacts={
            **(
                {
                    "summary": summary_artifacts.summary_path.relative_to(
                        output_dir
                    ).as_posix(),
                    "mindmap": summary_artifacts.mindmap_path.relative_to(
                        output_dir
                    ).as_posix(),
                }
                if summary_artifacts
                else {}
            ),
            **(
                {
                    "dissection": "ai/dissection.json",
                    "dissection_md": "ai/dissection.md",
                }
                if dissection_artifacts
                else {}
            ),
            **(
                {
                    "insights": insight_artifacts.json_path.relative_to(
                        output_dir
                    ).as_posix(),
                    "insights_md": insight_artifacts.md_path.relative_to(
                        output_dir
                    ).as_posix(),
                }
                if insight_artifacts
                else {}
            ),
        },
        text=transcript_body,
        summary=summary_artifacts.summary if summary_artifacts else "",
        insights=insight_artifacts.insights if insight_artifacts else [],
        transcript=transcript,
        dissection=(
            dissection_artifacts.report.to_dict() if dissection_artifacts else None
        ),
        artifact_payloads={
            **(
                {
                    summary_artifacts.summary_path.relative_to(
                        output_dir.parent
                    ).as_posix(): summary_artifacts.summary_bytes,
                    summary_artifacts.mindmap_path.relative_to(
                        output_dir.parent
                    ).as_posix(): summary_artifacts.mindmap_bytes,
                }
                if summary_artifacts
                else {}
            ),
            **(
                {
                    "ai/dissection.json": dissection_artifacts.json_bytes,
                    "ai/dissection.md": dissection_artifacts.markdown_bytes,
                }
                if dissection_artifacts
                else {}
            ),
            **(
                {
                    insight_artifacts.json_path.relative_to(
                        output_dir.parent
                    ).as_posix(): insight_artifacts.json_bytes,
                    insight_artifacts.md_path.relative_to(
                        output_dir.parent
                    ).as_posix(): insight_artifacts.md_bytes,
                }
                if insight_artifacts
                else {}
            ),
        },
        error=WorkerError(
            code=generation_error.code,
            message=str(generation_error),
            stage=JobStage.INSIGHTS_GENERATING,
        )
        if generation_error
        else None,
    )
