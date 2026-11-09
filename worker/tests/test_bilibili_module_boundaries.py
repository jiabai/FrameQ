from __future__ import annotations

import ast
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1]
WORKER_PACKAGE = WORKER_ROOT / "worker_core"
ROOT_ADAPTER = WORKER_PACKAGE / "bilibili_fallback.py"
PRIVATE_MODULES = {
    "types": WORKER_PACKAGE / "bilibili" / "types.py",
    "source": WORKER_PACKAGE / "bilibili" / "source.py",
    "playback": WORKER_PACKAGE / "bilibili" / "playback.py",
    "transport": WORKER_PACKAGE / "bilibili" / "transport.py",
    "artifacts": WORKER_PACKAGE / "bilibili" / "artifacts.py",
}
FORBIDDEN_PRIVATE_IMPORT_PREFIXES = (
    "worker_core.asr",
    "worker_core.bilibili_fallback",
    "worker_core.ai_artifacts",
    "worker_core.ai_prompts",
    "worker_core.ai_runtime",
    "worker_core.dissection_agent",
    "worker_core.dissection_report",
    "worker_core.insight_errors",
    "worker_core.summary_agent",
    "worker_core.topic_agent",
    "worker_core.transcript_chunks",
    "worker_core.llm",
    "worker_core.media",
    "worker_core.pipeline",
    "worker_core.task_store",
)
BILIBILI_PROGRESS_CODES = {
    "bilibili.metadata.resolving",
    "bilibili.stream.probing",
    "bilibili.video.downloading",
    "bilibili.audio.downloading",
    "bilibili.media.merging",
}


def _imported_modules(module_path: Path) -> set[str]:
    tree = ast.parse(module_path.read_text(encoding="utf-8"), filename=str(module_path))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
    return imported


def test_bilibili_private_modules_exist() -> None:
    missing = [name for name, path in PRIVATE_MODULES.items() if not path.is_file()]

    assert missing == []


def test_bilibili_private_modules_do_not_import_root_or_application_layers() -> None:
    violations: dict[str, list[str]] = {}
    for name, module_path in PRIVATE_MODULES.items():
        assert module_path.is_file(), f"missing private module: {name}"
        forbidden = sorted(
            imported
            for imported in _imported_modules(module_path)
            if imported.startswith(FORBIDDEN_PRIVATE_IMPORT_PREFIXES)
        )
        if forbidden:
            violations[name] = forbidden

    assert violations == {}


def test_production_modules_outside_root_do_not_import_bilibili_children() -> None:
    violations: dict[str, list[str]] = {}
    for module_path in WORKER_PACKAGE.glob("*.py"):
        if module_path == ROOT_ADAPTER:
            continue
        private_imports = sorted(
            imported
            for imported in _imported_modules(module_path)
            if imported.startswith("worker_core.bilibili.")
        )
        if private_imports:
            violations[module_path.name] = private_imports

    assert violations == {}


def test_transport_owns_urllib_and_safe_streaming_dependencies() -> None:
    transport_imports = _imported_modules(PRIVATE_MODULES["transport"])
    root_imports = _imported_modules(ROOT_ADAPTER)

    assert "urllib.request" in transport_imports
    assert "worker_core.download_reliability" in transport_imports
    assert "urllib.request" not in root_imports
    assert "worker_core.download_reliability" not in root_imports


def test_artifacts_owns_ffmpeg_and_download_attempt_dependencies() -> None:
    artifacts_path = PRIVATE_MODULES["artifacts"]
    assert artifacts_path.is_file(), "missing private module: artifacts"
    artifacts_imports = _imported_modules(artifacts_path)
    root_imports = _imported_modules(ROOT_ADAPTER)

    assert "subprocess" in artifacts_imports
    assert "worker_core.download_reliability" in artifacts_imports
    assert "subprocess" not in root_imports
    assert "worker_core.download_reliability" not in root_imports


def test_artifacts_owns_dash_cleanup_primitives() -> None:
    artifacts_source = PRIVATE_MODULES["artifacts"].read_text(encoding="utf-8")
    root_source = ROOT_ADAPTER.read_text(encoding="utf-8")

    assert "def cleanup_transient_artifacts(" in artifacts_source
    assert "def cleanup_completed_dash_files(" in artifacts_source
    assert ".unlink(" not in root_source


def test_bilibili_root_owns_all_registered_progress_codes() -> None:
    root_source = ROOT_ADAPTER.read_text(encoding="utf-8")

    assert all(code in root_source for code in BILIBILI_PROGRESS_CODES)
