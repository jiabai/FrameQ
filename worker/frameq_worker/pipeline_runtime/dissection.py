from __future__ import annotations

from pathlib import Path

from frameq_worker.insightflow.dissection import (
    DissectionArtifacts,
    DissectionClient,
    build_dissection_artifacts,
    generate_transcript_dissection,
)
from frameq_worker.output_language import OutputLanguage


def run_dissection_generation(
    transcript: str,
    *,
    output_dir: Path,
    client: DissectionClient,
    output_language: OutputLanguage,
    source_language: str | None,
) -> DissectionArtifacts:
    report = generate_transcript_dissection(
        transcript,
        client=client,
        output_language=output_language,
        source_language=source_language,
    )
    return build_dissection_artifacts(
        report,
        output_dir=output_dir,
        output_language=output_language,
    )
