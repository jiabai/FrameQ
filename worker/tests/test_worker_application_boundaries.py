from __future__ import annotations

import ast
import inspect
from pathlib import Path

import frameq_worker.worker_application.insight_retry as insight_retry
import frameq_worker.worker_application.local_media as local_media
import frameq_worker.worker_application.source_identity as source_identity
import frameq_worker.worker_application.url_processing as url_processing
import frameq_worker.worker_service as worker_service
from frameq_worker.task_store import TaskPaths

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


def test_source_identity_handler_owns_the_source_identity_use_case() -> None:
    assert "resolve_source_identity_once" in _top_level_owned_names(
        PRIVATE_ROOT / "source_identity.py"
    )


def test_worker_service_reexports_source_identity_handler_object() -> None:
    assert (
        worker_service.resolve_source_identity_once
        is source_identity.resolve_source_identity_once
    )


def test_insight_retry_handler_owns_the_retry_use_case() -> None:
    assert "retry_insights_once" in _top_level_owned_names(
        PRIVATE_ROOT / "insight_retry.py"
    )


def test_worker_service_reexports_insight_retry_handler_object() -> None:
    assert worker_service.retry_insights_once is insight_retry.retry_insights_once


def test_insight_retry_helpers_require_task_paths() -> None:
    for name in {
        "merge_existing_ai_artifacts",
        "read_existing_summary",
        "read_existing_insights",
    }:
        parameter = inspect.signature(
            getattr(insight_retry, name)
        ).parameters["paths"]
        assert parameter.annotation in {TaskPaths, "TaskPaths"}

    source = (PRIVATE_ROOT / "insight_retry.py").read_text(encoding="utf-8")
    assert "getattr(paths" not in source
