from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def _run_probe(root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    model_root = root / "models"
    model_root.mkdir(exist_ok=True)
    env = dict(os.environ)
    env.update(
        {
            "APP_MODEL_DIR": str(model_root),
            "APP_RESOURCE_DIR": str(root / "resources"),
            "APP_PYTORCH_RUNTIME_DIR": str(root / "runtime"),
            "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1",
            "MODELSCOPE_OFFLINE": "1",
            "HF_HUB_OFFLINE": "1",
        }
    )
    env.pop("APP_BUNDLED_RUNTIME_MANIFEST", None)
    return subprocess.run(
        [sys.executable, "-m", "worker_core.storage_validation", *arguments],
        cwd=root,
        env=env,
        text=True,
        capture_output=True,
        check=False,
        timeout=180,
    )


def _fixture_root() -> Path:
    root = Path(__file__).resolve().parents[2] / "build/data-storage-acceptance"
    root.mkdir(parents=True, exist_ok=True)
    return root


def test_real_probe_reports_missing_models_without_creating_or_removing_cache() -> None:
    with tempfile.TemporaryDirectory(dir=_fixture_root()) as directory:
        root = Path(directory)
        result = _run_probe(root)
        assert result.returncode == 0, result.stderr
        value = json.loads(result.stdout)
        assert value == {
            "schema_version": 1,
            "ready_models": [],
            "component_state": "ungated",
            "component_fingerprint": None,
            "component_imported": False,
        }
        assert list((root / "models").iterdir()) == []
        assert not (root / "runtime").exists()
        assert not (root / "outputs").exists()


def test_missing_component_import_exits_unsuccessfully_without_success_json() -> None:
    with tempfile.TemporaryDirectory(dir=_fixture_root()) as directory:
        result = _run_probe(Path(directory), "--import-component")
        assert result.returncode != 0
        assert result.stdout.strip() == ""
        assert "Storage component is unavailable" in result.stderr


def test_invalid_existing_model_marker_is_retained_without_normalization() -> None:
    with tempfile.TemporaryDirectory(dir=_fixture_root()) as directory:
        root = Path(directory)
        model_root = root / "models"
        model_root.mkdir()
        marker = model_root / "MODEL_VERSION.txt"
        marker.write_bytes(b"incomplete-existing-model\n")
        before = marker.read_bytes()
        result = _run_probe(root)
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)["ready_models"] == []
        assert marker.read_bytes() == before
        assert [path.name for path in model_root.iterdir()] == ["MODEL_VERSION.txt"]
