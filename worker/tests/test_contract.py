from __future__ import annotations

import json
from pathlib import Path

import frameq_worker.cli as cli
from frameq_worker.asr import DEFAULT_ASR_MODEL
from frameq_worker.cli import (
    MODEL_DIR_ENV,
    MODEL_DOWNLOAD_EVENT_PREFIX,
    OUTPUT_DIR_ENV,
    PROGRESS_EVENT_PREFIX,
)
from frameq_worker.models import Insight, JobStage, ProcessResult


def load_contract() -> dict[str, object]:
    contract_path = Path(__file__).parents[2] / "contracts" / "desktop-worker-contract.json"
    return json.loads(contract_path.read_text(encoding="utf-8"))


def test_worker_constants_match_desktop_contract() -> None:
    contract = load_contract()

    assert PROGRESS_EVENT_PREFIX == contract["events"]["workerProgressPrefix"]
    assert MODEL_DOWNLOAD_EVENT_PREFIX == contract["events"]["asrModelDownloadPrefix"]
    assert DEFAULT_ASR_MODEL == contract["asr"]["defaultModel"]
    assert OUTPUT_DIR_ENV == contract["env"]["outputDir"]
    assert contract["env"].get("cacheDir") == "FRAMEQ_CACHE_DIR"
    assert getattr(cli, "CACHE_DIR_ENV", None) == contract["env"]["cacheDir"]
    assert MODEL_DIR_ENV == contract["env"]["modelDir"]


def test_worker_result_keys_match_desktop_contract() -> None:
    contract = load_contract()

    result_keys = set(ProcessResult(status=JobStage.COMPLETED).to_dict().keys())

    assert result_keys == set(contract["workerResultKeys"])


def test_worker_result_contract_includes_task_artifacts() -> None:
    contract = load_contract()

    assert "summary" in contract["workerResultKeys"]
    assert "artifacts" in contract["workerResultKeys"]
    assert "transcript" in contract["workerResultKeys"]


def test_process_video_contract_is_transcript_only_and_retry_insights_is_ai_path() -> None:
    contract = load_contract()

    assert contract["processVideo"] == {
        "serverManagedLlmCheckout": False,
    }
    assert contract["aiGeneration"] == {
        "command": "retry_insights",
        "serverManagedLlmCheckout": True,
    }


def test_structured_insight_contract_keys_match_worker_model() -> None:
    contract = load_contract()
    insight = Insight(
        id=1,
        topic="topic",
        match_reason="matched",
        follow_up_questions=("next",),
        suitable_use="content planning",
        source_chunk_id=1,
    )

    insight_contract = contract["insightResult"]
    assert isinstance(insight_contract, dict)
    assert insight_contract["schemaVersion"] == 1
    assert set(insight.to_dict().keys()) == set(insight_contract["itemKeys"])
    assert insight_contract["preferenceSnapshotArtifact"] == "preference_snapshot"
