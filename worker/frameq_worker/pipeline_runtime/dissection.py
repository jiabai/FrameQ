from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from frameq_worker.desktop_contract import ProgressCallback
from frameq_worker.dissection_agent import (
    DissectionRunner,
    generate_dissection_via_agent_runtime,
)
from frameq_worker.dissection_report import (
    DissectionArtifacts,
    build_dissection_artifacts,
)
from frameq_worker.output_language import OutputLanguage


def run_dissection_generation(
    transcript: str,
    *,
    output_dir: Path,
    output_language: OutputLanguage,
    source_language: str | None,
    progress_callback: ProgressCallback | None = None,
    runtime_env: Mapping[str, str] | None = None,
    dissection_runner: DissectionRunner | None = None,
) -> DissectionArtifacts:
    runner = dissection_runner or generate_dissection_via_agent_runtime
    report = runner(
        transcript,
        os.environ if runtime_env is None else runtime_env,
        output_language,
        source_language,
        progress_callback=progress_callback,
    )
    return build_dissection_artifacts(
        report,
        output_dir=output_dir,
        output_language=output_language,
    )
