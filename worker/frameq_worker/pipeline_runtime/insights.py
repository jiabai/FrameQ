from __future__ import annotations

import os
from pathlib import Path

from frameq_worker.insightflow import (
    InsightClient,
    InsightGenerationError,
    generate_insights_from_markdown,
    generate_summary_from_markdown,
)
from frameq_worker.models import (
    InsightGenerationTarget,
    JobStage,
    PreferenceSnapshot,
    ProcessResult,
    TranscriptMetadata,
    WorkerError,
)
from frameq_worker.output_language import OutputLanguage


def run_insight_generation_step(
    transcript_txt_path: Path,
    output_dir: Path,
    output_stem: str,
    client: InsightClient | None,
    output_language: OutputLanguage,
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
                output_language=output_language,
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
                output_language=output_language,
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
        error=WorkerError(
            code=generation_error.code,
            message=str(generation_error),
            stage=JobStage.INSIGHTS_GENERATING,
        )
        if generation_error
        else None,
    )
