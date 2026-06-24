from __future__ import annotations

import json
from pathlib import Path

from frameq_worker.asr import DEFAULT_ASR_MODEL
from frameq_worker.cli import (
    MODEL_DIR_ENV,
    MODEL_DOWNLOAD_EVENT_PREFIX,
    OUTPUT_DIR_ENV,
    PROGRESS_EVENT_PREFIX,
    WORK_DIR_ENV,
)
from frameq_worker.models import JobStage, ProcessResult


def load_contract() -> dict[str, object]:
    contract_path = Path(__file__).parents[2] / "contracts" / "desktop-worker-contract.json"
    return json.loads(contract_path.read_text(encoding="utf-8"))


def test_worker_constants_match_desktop_contract() -> None:
    contract = load_contract()

    assert PROGRESS_EVENT_PREFIX == contract["events"]["workerProgressPrefix"]
    assert MODEL_DOWNLOAD_EVENT_PREFIX == contract["events"]["asrModelDownloadPrefix"]
    assert DEFAULT_ASR_MODEL == contract["asr"]["defaultModel"]
    assert OUTPUT_DIR_ENV == contract["env"]["outputDir"]
    assert WORK_DIR_ENV == contract["env"]["workDir"]
    assert MODEL_DIR_ENV == contract["env"]["modelDir"]


def test_worker_result_keys_match_desktop_contract() -> None:
    contract = load_contract()

    result_keys = set(ProcessResult(status=JobStage.COMPLETED).to_dict().keys())

    assert result_keys == set(contract["workerResultKeys"])
