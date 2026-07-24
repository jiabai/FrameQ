from __future__ import annotations

import ast
from pathlib import Path

import frameq_worker.worker_application.local_media as local_media
import frameq_worker.worker_application.url_processing as url_processing
import frameq_worker.worker_service as worker_service

WORKER_ROOT = Path(__file__).resolve().parents[1]
FRAMEQ_WORKER_ROOT = WORKER_ROOT / "frameq_worker"
PRIVATE_ROOT = FRAMEQ_WORKER_ROOT / "worker_application"
EXPECTED_PRIVATE_FILES = {
    "__init__.py",
    "defaults.py",
    "insight_retry.py",
    "local_media.py",
    "model_download.py",
    "source_identity.py",
    "url_processing.py",
}


def _private_python_files() -> set[str]:
    if not PRIVATE_ROOT.is_dir():
        return set()
    return {path.name for path in PRIVATE_ROOT.glob("*.py")}


def _top_level_owned_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=path.as_posix())
    return {
        node.name
        for node in tree.body
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
    }


def test_worker_application_private_tree_matches_design() -> None:
    assert _private_python_files() == EXPECTED_PRIVATE_FILES
    assert (PRIVATE_ROOT / "__init__.py").read_text(encoding="utf-8").strip() == ""


def test_url_processing_handler_owns_the_url_use_case() -> None:
    assert "run_worker_once" in _top_level_owned_names(
        PRIVATE_ROOT / "url_processing.py"
    )


def test_worker_service_reexports_url_handler_object() -> None:
    assert worker_service.run_worker_once is url_processing.run_worker_once


def test_local_media_handler_owns_the_local_media_use_case() -> None:
    assert "run_local_media_once" in _top_level_owned_names(
        PRIVATE_ROOT / "local_media.py"
    )


def test_worker_service_reexports_local_media_handler_object() -> None:
    assert worker_service.run_local_media_once is local_media.run_local_media_once
