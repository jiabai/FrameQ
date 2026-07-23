import ast
import importlib
from pathlib import Path

import pytest

WORKER_ROOT = Path(__file__).resolve().parents[1]
FRAMEQ_WORKER_ROOT = WORKER_ROOT / "frameq_worker"
PUBLIC_PIPELINE_PATH = FRAMEQ_WORKER_ROOT / "pipeline.py"
PRIVATE_PIPELINE_ROOT = FRAMEQ_WORKER_ROOT / "pipeline_runtime"
EXPECTED_PRIVATE_FILES = {
    "__init__.py",
    "insights.py",
    "orchestration.py",
    "shared.py",
    "transcript.py",
}
EXPECTED_OWNER_SYMBOLS = {
    "shared.py": {
        "TranscriberFactory",
        "emit_progress",
        "failed_result",
        "resolve_cache_dir",
        "resolve_output_dir",
    },
    "transcript.py": {
        "_asr_model_args",
        "_subtitle_language_args",
        "prepare_asr_transcriber_stage",
        "run_asr_transcript_stage",
        "run_asr_transcript_step",
        "run_prepared_subtitle_transcript_step",
        "write_prepared_subtitle_stage",
    },
    "insights.py": {"run_insight_generation_step"},
    "orchestration.py": {
        "LocalPipelineContext",
        "PipelineContext",
        "complete_transcript_stage",
        "prepare_local_pipeline_context",
        "prepare_pipeline_context",
        "run_local_media_pipeline",
        "run_worker_pipeline",
    },
}
EXPECTED_PUBLIC_SYMBOLS = set().union(*EXPECTED_OWNER_SYMBOLS.values()) - {
    "_asr_model_args",
    "_subtitle_language_args",
}


def _private_python_files() -> set[str]:
    if not PRIVATE_PIPELINE_ROOT.is_dir():
        return set()
    return {path.name for path in PRIVATE_PIPELINE_ROOT.glob("*.py")}


@pytest.fixture(autouse=True)
def _skip_dependent_checks_until_private_tree_exists(
    request: pytest.FixtureRequest,
) -> None:
    if request.node.name == "test_pipeline_runtime_private_tree_matches_design":
        return
    if _private_python_files() != EXPECTED_PRIVATE_FILES:
        pytest.skip("approved private pipeline module tree is not complete yet")


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=path.as_posix())


def _top_level_owned_names(path: Path) -> set[str]:
    names: set[str] = set()
    for node in _parse(path).body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(
                target.id for target in node.targets if isinstance(target, ast.Name)
            )
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def _imported_modules(path: Path) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(_parse(path)):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            modules.add(f"{'.' * node.level}{node.module or ''}")
    return modules


def _top_level_imported_bindings(path: Path) -> set[str]:
    bindings: set[str] = set()
    for node in _parse(path).body:
        if isinstance(node, ast.Import):
            bindings.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
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


def _owners_importing(module_root: str) -> set[str]:
    owners: set[str] = set()
    for path in PRIVATE_PIPELINE_ROOT.glob("*.py"):
        if path.name == "__init__.py":
            continue
        if any(
            module == module_root or module.startswith(f"{module_root}.")
            for module in _imported_modules(path)
        ):
            owners.add(path.name)
    return owners


def _has_forbidden_module(path: Path, module_roots: set[str]) -> list[str]:
    return sorted(
        module
        for module in _imported_modules(path)
        if any(module == root or module.startswith(f"{root}.") for root in module_roots)
    )


def test_pipeline_runtime_private_tree_matches_design() -> None:
    assert _private_python_files() == EXPECTED_PRIVATE_FILES
    assert (PRIVATE_PIPELINE_ROOT / "__init__.py").read_text(
        encoding="utf-8"
    ).strip() == ""


def test_private_modules_own_each_approved_symbol_once() -> None:
    owners_by_symbol: dict[str, list[str]] = {}
    approved_symbols = set().union(*EXPECTED_OWNER_SYMBOLS.values())
    for filename in EXPECTED_OWNER_SYMBOLS:
        owned_names = _top_level_owned_names(PRIVATE_PIPELINE_ROOT / filename)
        for name in owned_names & approved_symbols:
            owners_by_symbol.setdefault(name, []).append(filename)

    assert owners_by_symbol == {
        name: [filename]
        for filename, expected_names in EXPECTED_OWNER_SYMBOLS.items()
        for name in expected_names
    }


def test_public_pipeline_root_is_only_a_direct_import_surface() -> None:
    tree = _parse(PUBLIC_PIPELINE_PATH)

    assert all(isinstance(node, (ast.Import, ast.ImportFrom)) for node in tree.body)
    assert _top_level_owned_names(PUBLIC_PIPELINE_PATH) == set()
    assert _top_level_imported_bindings(PUBLIC_PIPELINE_PATH) == EXPECTED_PUBLIC_SYMBOLS
    assert len(PUBLIC_PIPELINE_PATH.read_text(encoding="utf-8").splitlines()) < 100


def test_public_pipeline_root_reexports_exact_private_objects() -> None:
    owner_exports = {
        "shared": EXPECTED_OWNER_SYMBOLS["shared.py"],
        "transcript": EXPECTED_OWNER_SYMBOLS["transcript.py"]
        - {"_asr_model_args", "_subtitle_language_args"},
        "insights": EXPECTED_OWNER_SYMBOLS["insights.py"],
        "orchestration": EXPECTED_OWNER_SYMBOLS["orchestration.py"],
    }
    public = importlib.import_module("frameq_worker.pipeline")

    for owner, names in owner_exports.items():
        private = importlib.import_module(f"frameq_worker.pipeline_runtime.{owner}")
        for name in names:
            assert getattr(public, name) is getattr(private, name)


def test_private_modules_have_no_root_or_application_back_edges() -> None:
    forbidden_modules = {
        "frameq_worker.cli",
        "frameq_worker.pipeline",
        "frameq_worker.worker_service",
    }
    violations: list[str] = []
    for path in PRIVATE_PIPELINE_ROOT.glob("*.py"):
        for module in _imported_modules(path):
            if module in forbidden_modules:
                violations.append(f"{path.name}: {module}")

    assert violations == []


def test_shared_owner_imports_only_the_asr_transcriber_contract() -> None:
    shared_path = PRIVATE_PIPELINE_ROOT / "shared.py"

    assert _names_imported_from(shared_path, "frameq_worker.asr") == {"Transcriber"}
    assert _has_forbidden_module(
        shared_path,
        {
            "frameq_worker.insightflow",
            "frameq_worker.media",
            "frameq_worker.media_preparation",
            "frameq_worker.model_download",
            "frameq_worker.output_language",
            "frameq_worker.source_resolution",
            "frameq_worker.task_store",
        },
    ) == []


def test_transcript_owner_excludes_media_ai_and_orchestration() -> None:
    transcript_path = PRIVATE_PIPELINE_ROOT / "transcript.py"

    assert _has_forbidden_module(
        transcript_path,
        {
            ".insights",
            ".orchestration",
            "frameq_worker.pipeline_runtime.insights",
            "frameq_worker.pipeline_runtime.orchestration",
            "frameq_worker.insightflow",
            "frameq_worker.llm",
            "frameq_worker.media",
            "frameq_worker.media_preparation",
            "frameq_worker.output_language",
            "frameq_worker.source_resolution",
        },
    ) == []


def test_insights_owner_excludes_process_media_asr_and_task_dependencies() -> None:
    insights_path = PRIVATE_PIPELINE_ROOT / "insights.py"

    assert _has_forbidden_module(
        insights_path,
        {
            ".orchestration",
            ".shared",
            ".transcript",
            "frameq_worker.pipeline_runtime.orchestration",
            "frameq_worker.pipeline_runtime.shared",
            "frameq_worker.pipeline_runtime.transcript",
            "frameq_worker.asr",
            "frameq_worker.media",
            "frameq_worker.media_preparation",
            "frameq_worker.source_identity",
            "frameq_worker.source_resolution",
            "frameq_worker.task_store",
        },
    ) == []


def test_orchestration_owner_excludes_ai_dependencies() -> None:
    orchestration_path = PRIVATE_PIPELINE_ROOT / "orchestration.py"

    assert _has_forbidden_module(
        orchestration_path,
        {
            ".insights",
            "frameq_worker.pipeline_runtime.insights",
            "frameq_worker.insightflow",
            "frameq_worker.llm",
            "frameq_worker.output_language",
        },
    ) == []


def test_low_level_application_dependencies_have_approved_owners() -> None:
    assert _owners_importing("frameq_worker.asr") == {"shared.py", "transcript.py"}
    assert _owners_importing("frameq_worker.media_preparation") == {"orchestration.py"}
    assert _owners_importing("frameq_worker.source_resolution") == {"orchestration.py"}
    assert _names_imported_from(
        PRIVATE_PIPELINE_ROOT / "transcript.py", "frameq_worker.task_store"
    ) == {"TaskContext"}
    assert "TaskStoreFacade" not in _names_imported_from(
        PRIVATE_PIPELINE_ROOT / "transcript.py", "frameq_worker.task_store"
    )
    assert "TaskStoreFacade" in _names_imported_from(
        PRIVATE_PIPELINE_ROOT / "orchestration.py", "frameq_worker.task_store"
    )


def test_production_callers_do_not_import_private_pipeline_modules() -> None:
    violations: list[str] = []
    for path in FRAMEQ_WORKER_ROOT.rglob("*.py"):
        if path == PUBLIC_PIPELINE_PATH or PRIVATE_PIPELINE_ROOT in path.parents:
            continue
        for module in _imported_modules(path):
            if module == "frameq_worker.pipeline_runtime" or module.startswith(
                "frameq_worker.pipeline_runtime."
            ):
                violations.append(f"{path.relative_to(WORKER_ROOT)}: {module}")

    assert violations == []
