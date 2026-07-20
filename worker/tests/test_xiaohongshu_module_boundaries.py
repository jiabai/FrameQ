from __future__ import annotations

import ast
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1]
WORKER_PACKAGE = WORKER_ROOT / "frameq_worker"
ROOT_ADAPTER = WORKER_PACKAGE / "xiaohongshu_fallback.py"
PRIVATE_PACKAGE = WORKER_PACKAGE / "xiaohongshu"
PRIVATE_MODULES = {
    "types": PRIVATE_PACKAGE / "types.py",
    "source": PRIVATE_PACKAGE / "source.py",
    "page": PRIVATE_PACKAGE / "page.py",
    "streams": PRIVATE_PACKAGE / "streams.py",
    "transport": PRIVATE_PACKAGE / "transport.py",
}
FORBIDDEN_PRIVATE_IMPORT_PREFIXES = (
    "frameq_worker.asr",
    "frameq_worker.insightflow",
    "frameq_worker.llm",
    "frameq_worker.media",
    "frameq_worker.media_preparation",
    "frameq_worker.pipeline",
    "frameq_worker.source_identity",
    "frameq_worker.source_resolution",
    "frameq_worker.task_store",
    "frameq_worker.xiaohongshu_fallback",
)
XIAOHONGSHU_PROGRESS_CODES = {
    "xiaohongshu.page.resolving",
    "xiaohongshu.video.saving",
    "xiaohongshu.stream.retrying",
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


def test_xiaohongshu_private_modules_and_empty_package_exist() -> None:
    init_path = PRIVATE_PACKAGE / "__init__.py"
    missing = [
        name
        for name, path in {"__init__": init_path, **PRIVATE_MODULES}.items()
        if not path.is_file()
    ]

    assert missing == []
    assert init_path.read_text(encoding="utf-8").strip() == ""


def test_xiaohongshu_children_do_not_import_root_or_application_layers() -> None:
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


def test_production_modules_outside_root_do_not_import_xiaohongshu_children() -> None:
    violations: dict[str, list[str]] = {}
    for module_path in WORKER_PACKAGE.glob("*.py"):
        if module_path == ROOT_ADAPTER:
            continue
        private_imports = sorted(
            imported
            for imported in _imported_modules(module_path)
            if imported.startswith("frameq_worker.xiaohongshu.")
        )
        if private_imports:
            violations[module_path.name] = private_imports

    assert violations == {}


def test_page_owns_compression_and_untrusted_state_parsing() -> None:
    page_imports = _imported_modules(PRIVATE_MODULES["page"])
    root_imports = _imported_modules(ROOT_ADAPTER)

    assert {"brotli", "gzip", "json", "zlib"} <= page_imports
    assert not {"brotli", "gzip", "json", "zlib"} & root_imports


def test_transport_owns_cookiejar_urllib_and_safe_downloads() -> None:
    transport_imports = _imported_modules(PRIVATE_MODULES["transport"])
    root_imports = _imported_modules(ROOT_ADAPTER)

    assert "http.cookiejar" in transport_imports
    assert "urllib.request" in transport_imports
    assert "frameq_worker.download_reliability" in transport_imports
    assert "http.cookiejar" not in root_imports
    assert "urllib.request" not in root_imports
    assert "frameq_worker.download_reliability" not in root_imports


def test_stream_policy_has_no_network_filesystem_or_progress_dependencies() -> None:
    stream_imports = _imported_modules(PRIVATE_MODULES["streams"])
    forbidden = {
        "frameq_worker.download_reliability",
        "frameq_worker.progress_events",
        "http.cookiejar",
        "pathlib",
        "urllib.request",
    }

    assert not forbidden & stream_imports


def test_xiaohongshu_root_owns_all_registered_progress_codes() -> None:
    root_source = ROOT_ADAPTER.read_text(encoding="utf-8")

    assert "build_worker_progress_event" in root_source
    assert all(code in root_source for code in XIAOHONGSHU_PROGRESS_CODES)
