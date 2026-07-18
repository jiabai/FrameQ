from __future__ import annotations

import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest

WORKER_ROOT = Path(__file__).resolve().parents[1]
CORE_SOURCE_MODULES = (
    WORKER_ROOT / "frameq_worker" / "models.py",
    WORKER_ROOT / "frameq_worker" / "source_identity.py",
    WORKER_ROOT / "frameq_worker" / "source_resolution.py",
)
FORBIDDEN_INFRASTRUCTURE_IMPORTS = {
    "brotli",
    "gzip",
    "subprocess",
    "urllib.request",
    "zlib",
}


def test_core_model_import_does_not_load_platform_fallbacks() -> None:
    script = """
import sys

import frameq_worker.models
import frameq_worker.source_identity

loaded = sorted(
    name
    for name in sys.modules
    if name.startswith("frameq_worker.") and name.endswith("_fallback")
)
if loaded:
    raise SystemExit(f"core import loaded platform fallbacks: {loaded}")
"""
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    existing_pythonpath = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = os.pathsep.join(
        [str(WORKER_ROOT), *([existing_pythonpath] if existing_pythonpath else [])]
    )

    completed = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        capture_output=True,
        cwd=WORKER_ROOT,
        env=environment,
        text=True,
        timeout=30,
    )

    assert completed.returncode == 0, completed.stderr


@pytest.mark.parametrize("module_path", CORE_SOURCE_MODULES, ids=lambda path: path.name)
def test_core_source_module_has_no_platform_infrastructure_imports(
    module_path: Path,
) -> None:
    tree = ast.parse(module_path.read_text(encoding="utf-8"), filename=str(module_path))
    imported_modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_modules.add(node.module)

    forbidden = sorted(
        module
        for module in imported_modules
        if module.endswith("_fallback")
        or module in FORBIDDEN_INFRASTRUCTURE_IMPORTS
    )
    assert forbidden == []
