from __future__ import annotations

import ast
import inspect
from pathlib import Path

import frameq_worker.worker_application.insight_retry as insight_retry
import frameq_worker.worker_application.local_media as local_media
import frameq_worker.worker_application.model_download as model_download
import frameq_worker.worker_application.source_identity as source_identity
import frameq_worker.worker_application.url_processing as url_processing
import frameq_worker.worker_service as worker_service
from frameq_worker.task_store import TaskPaths

WORKER_ROOT = Path(__file__).resolve().parents[1]
FRAMEQ_WORKER_ROOT = WORKER_ROOT / "frameq_worker"
PRIVATE_ROOT = FRAMEQ_WORKER_ROOT / "worker_application"
CLI_PATH = FRAMEQ_WORKER_ROOT / "cli.py"
FACADE_PATH = FRAMEQ_WORKER_ROOT / "worker_service.py"
MAIN_PATH = FRAMEQ_WORKER_ROOT / "__main__.py"
EXPECTED_PRIVATE_FILES = {
    "__init__.py",
    "defaults.py",
    "insight_retry.py",
    "local_media.py",
    "model_download.py",
    "source_identity.py",
    "url_processing.py",
}
EXPECTED_FACADE_SYMBOLS = [
    "run_worker_once",
    "run_local_media_once",
    "resolve_source_identity_once",
    "retry_insights_once",
    "run_asr_model_download_once",
]
HANDLER_MODULES = {
    "frameq_worker.worker_application.insight_retry",
    "frameq_worker.worker_application.local_media",
    "frameq_worker.worker_application.model_download",
    "frameq_worker.worker_application.source_identity",
    "frameq_worker.worker_application.url_processing",
}


def _private_python_files() -> set[str]:
    if not PRIVATE_ROOT.is_dir():
        return set()
    return {path.name for path in PRIVATE_ROOT.glob("*.py")}


def _top_level_owned_names(path: Path) -> set[str]:
    tree = _parse(path)
    return {
        node.name
        for node in tree.body
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=path.as_posix())


def _imported_modules(path: Path) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(_parse(path)):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            modules.add(f"{'.' * node.level}{node.module or ''}")
    return modules


def _top_level_assigned_names(path: Path) -> set[str]:
    names: set[str] = set()
    for node in _parse(path).body:
        if isinstance(node, ast.Assign):
            names.update(
                target.id
                for target in node.targets
                if isinstance(target, ast.Name)
            )
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def _top_level_imported_bindings(path: Path) -> set[str]:
    bindings: set[str] = set()
    for node in _parse(path).body:
        if isinstance(node, ast.Import):
            bindings.update(
                alias.asname or alias.name.split(".")[0]
                for alias in node.names
            )
        elif isinstance(node, ast.ImportFrom) and node.module != "__future__":
            bindings.update(alias.asname or alias.name for alias in node.names)
    return bindings


def _names_imported_from(path: Path, module: str) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(_parse(path)):
        if not isinstance(node, ast.ImportFrom):
            continue
        imported_module = f"{'.' * node.level}{node.module or ''}"
        if imported_module == module:
            names.update(alias.name for alias in node.names)
    return names


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


def test_model_download_handler_owns_the_model_download_use_case() -> None:
    assert "run_asr_model_download_once" in _top_level_owned_names(
        PRIVATE_ROOT / "model_download.py"
    )


def test_worker_service_reexports_model_download_handler_object() -> None:
    assert (
        worker_service.run_asr_model_download_once
        is model_download.run_asr_model_download_once
    )


def test_worker_service_has_exact_closed_public_surface() -> None:
    assert worker_service.__all__ == EXPECTED_FACADE_SYMBOLS
    assert _top_level_imported_bindings(FACADE_PATH) == set(
        EXPECTED_FACADE_SYMBOLS
    )
    assert len(FACADE_PATH.read_text(encoding="utf-8").splitlines()) < 80

    allowed_nodes = (ast.Import, ast.ImportFrom)
    for node in _parse(FACADE_PATH).body:
        if isinstance(node, allowed_nodes):
            continue
        assert isinstance(node, ast.Assign)
        assert len(node.targets) == 1
        assert isinstance(node.targets[0], ast.Name)
        assert node.targets[0].id == "__all__"


def test_cli_is_only_the_process_adapter() -> None:
    assert "__all__" not in _top_level_assigned_names(CLI_PATH)

    for node in ast.walk(_parse(CLI_PATH)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            assert node.args.vararg is None
            assert node.args.kwarg is None

    assert _imported_modules(CLI_PATH) <= {
        "__future__",
        "argparse",
        "collections.abc",
        "frameq_worker",
        "frameq_worker.desktop_contract",
        "frameq_worker.progress_events",
        "io",
        "json",
        "pathlib",
        "sys",
    }


def test_only_facade_imports_application_handlers_in_production() -> None:
    violations: list[str] = []
    for path in FRAMEQ_WORKER_ROOT.rglob("*.py"):
        if PRIVATE_ROOT in path.parents or path == FACADE_PATH:
            continue
        imported_handlers = _imported_modules(path) & HANDLER_MODULES
        if imported_handlers:
            violations.append(
                f"{path.relative_to(WORKER_ROOT)}: "
                f"{sorted(imported_handlers)}"
            )

    assert violations == []
    assert _imported_modules(FACADE_PATH) & HANDLER_MODULES == HANDLER_MODULES


def test_handlers_have_no_sibling_or_application_back_edges() -> None:
    violations: list[str] = []
    for path in PRIVATE_ROOT.glob("*.py"):
        if path.name in {"__init__.py", "defaults.py"}:
            continue
        for module in _imported_modules(path):
            if module in HANDLER_MODULES or module in {
                "frameq_worker.cli",
                "frameq_worker.worker_service",
            }:
                violations.append(f"{path.name}: {module}")

    assert violations == []


def test_production_dependency_factories_have_one_defaults_owner() -> None:
    expected_factory_imports = {
        "frameq_worker.asr": "build_asr_transcriber",
        "frameq_worker.llm": "build_insight_client_from_env",
        "frameq_worker.platform_source_resolvers": (
            "build_default_source_resolver"
        ),
    }
    owners: dict[str, list[str]] = {}
    application_paths = [
        CLI_PATH,
        FACADE_PATH,
        *PRIVATE_ROOT.glob("*.py"),
    ]
    for path in application_paths:
        for module, name in expected_factory_imports.items():
            if name in _names_imported_from(path, module):
                owners.setdefault(name, []).append(
                    path.relative_to(FRAMEQ_WORKER_ROOT).as_posix()
                )

    assert owners == {
        name: ["worker_application/defaults.py"]
        for name in expected_factory_imports.values()
    }


def test_main_module_imports_only_cli_main() -> None:
    assert _imported_modules(MAIN_PATH) == {"frameq_worker.cli"}
    assert _names_imported_from(MAIN_PATH, "frameq_worker.cli") == {"main"}
