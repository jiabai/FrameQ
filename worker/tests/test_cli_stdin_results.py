import json
import os
import subprocess
import sys
from pathlib import Path

import jsonschema
import pytest
from frameq_worker.cli import MAX_STDIN_REQUEST_BYTES

CONTRACT_PATH = Path(__file__).parents[2] / "contracts" / "desktop-worker-contract.json"
SECRET = b"frameq-stdin-private-input"


@pytest.mark.parametrize(
    ("flag", "family", "stage"),
    [
        ("--request-stdin", "task", "waiting_input"),
        ("--process-local-media-stdin", "task", "waiting_input"),
        ("--retry-insights-stdin", "task", "insights_generating"),
        ("--resolve-source-stdin", "sourceIdentity", None),
    ],
)
@pytest.mark.parametrize(
    "payload",
    [
        pytest.param(b"", id="empty"),
        pytest.param(b'{"url":"' + SECRET, id="malformed-json"),
        pytest.param(b'["' + SECRET + b'"]', id="non-object"),
        pytest.param(b"\xff" + SECRET, id="invalid-utf8"),
        pytest.param(
            b'{"private":"' + SECRET + b"x" * MAX_STDIN_REQUEST_BYTES + b'"}',
            id="oversized",
        ),
    ],
)
def test_invalid_stdin_emits_closed_non_echoing_result(
    flag: str,
    family: str,
    stage: str | None,
    payload: bytes,
    tmp_path: Path,
) -> None:
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    completed = subprocess.run(
        [sys.executable, "-m", "frameq_worker", flag],
        input=payload,
        capture_output=True,
        cwd=tmp_path,
        env={
            **os.environ,
            "PYTHONPATH": os.pathsep.join(str(Path(path).resolve()) for path in sys.path),
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        timeout=30,
        check=False,
    )

    assert completed.returncode == 1
    assert len(completed.stdout.splitlines()) == 1
    assert SECRET not in completed.stdout + completed.stderr
    result = json.loads(completed.stdout.decode("utf-8"))
    jsonschema.validate(result, contract["terminalResults"]["schemas"][family])
    assert result["status"] == "failed"
    if family == "task":
        assert set(result) == set(contract["workerResultKeys"])
        assert result["dissection"] is None
        assert result["draft"] == ""
        assert result["error"] == {
            "code": "WORKER_STDIN_INVALID",
            "message": "Worker request stdin was invalid.",
            "stage": stage,
        }
    else:
        assert result == {
            "status": "failed",
            "error": {"code": "WORKER_STDIN_INVALID"},
        }
    assert list(tmp_path.iterdir()) == []
