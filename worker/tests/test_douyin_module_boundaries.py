from __future__ import annotations

import ast
from pathlib import Path

import pytest

WORKER_ROOT = Path(__file__).resolve().parents[1] / "frameq_worker"
ROOT_MODULE = WORKER_ROOT / "douyin_fallback.py"
PACKAGE_ROOT = WORKER_ROOT / "douyin"
PLANNED_MODULES = {
    "types.py",
    "source.py",
    "page.py",
    "streams.py",
    "transport.py",
}
PROGRESS_CODES = {
    "douyin.page.resolving",
    "douyin.stream.probing",
    "douyin.video.saving",
    "douyin.stream.retrying",
}
LOW_LEVEL_EFFECT_IMPORTS = {
    "http.cookiejar",
    "urllib.error",
    "urllib.request",
    "frameq_worker.download_reliability",
}
ROOT_FORBIDDEN_IMPORTS = {
    "http.cookiejar",
    "json",
    "re",
    "urllib.error",
    "urllib.parse",
    "urllib.request",
    "frameq_worker.download_reliability",
}
FORBIDDEN_CHILD_IMPORT_PREFIXES = {
    "frameq_worker.asr",
    "frameq_worker.bilibili",
    "frameq_worker.douyin_fallback",
    "frameq_worker.insightflow",
    "frameq_worker.llm",
    "frameq_worker.media",
    "frameq_worker.media_preparation",
    "frameq_worker.pipeline",
    "frameq_worker.platform_source_resolvers",
    "frameq_worker.source_identity",
    "frameq_worker.source_resolution",
    "frameq_worker.task_store",
    "frameq_worker.worker_service",
    "frameq_worker.xiaohongshu",
}
EXPECTED_OWNER_SYMBOLS = {
    "types.py": {
        "DouyinFallbackError",
        "DouyinStreamCandidate",
        "HttpResponse",
        "DouyinHttpClient",
    },
    "source.py": {
        "extract_aweme_id",
        "resolve_aweme_id_from_input",
        "build_share_page_url",
    },
    "page.py": {
        "parse_share_page_router_data",
        "_find_video_info_res",
    },
    "streams.py": {
        "PLAY_QUALITIES",
        "build_play_url",
        "collect_stream_candidates",
        "select_stream_candidates",
    },
    "transport.py": {
        "DOUYIN_MOBILE_USER_AGENT",
        "UrllibDouyinHttpClient",
        "public_headers",
        "download_ordered_candidates",
    },
}


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    result: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            result.add(node.module)
    return result


def top_level_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(
                target.id for target in node.targets if isinstance(target, ast.Name)
            )
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def is_forbidden_child_import(module: str) -> bool:
    return any(
        module == prefix or module.startswith(f"{prefix}.")
        for prefix in FORBIDDEN_CHILD_IMPORT_PREFIXES
    )


def test_private_package_contains_exact_planned_modules() -> None:
    assert PACKAGE_ROOT.is_dir()
    assert {path.name for path in PACKAGE_ROOT.glob("*.py")} == {
        "__init__.py",
        *PLANNED_MODULES,
    }


def test_private_package_initializer_has_no_compatibility_surface() -> None:
    initializer = PACKAGE_ROOT / "__init__.py"
    assert initializer.read_text(encoding="utf-8") == ""


@pytest.mark.parametrize(
    ("filename", "expected_symbols"),
    EXPECTED_OWNER_SYMBOLS.items(),
    ids=EXPECTED_OWNER_SYMBOLS,
)
def test_private_module_owns_expected_symbols(
    filename: str,
    expected_symbols: set[str],
) -> None:
    assert expected_symbols <= top_level_names(PACKAGE_ROOT / filename)


@pytest.mark.parametrize("filename", sorted(PLANNED_MODULES))
def test_private_modules_have_no_root_or_application_back_edges(filename: str) -> None:
    imports = imported_modules(PACKAGE_ROOT / filename)
    assert sorted(module for module in imports if is_forbidden_child_import(module)) == []


def test_low_level_http_cookie_and_download_effects_belong_only_to_transport() -> None:
    owners = {
        path.name: sorted(imported_modules(path) & LOW_LEVEL_EFFECT_IMPORTS)
        for path in PACKAGE_ROOT.glob("*.py")
        if imported_modules(path) & LOW_LEVEL_EFFECT_IMPORTS
    }
    assert owners == {"transport.py": sorted(LOW_LEVEL_EFFECT_IMPORTS)}


def test_page_policy_has_no_network_filesystem_or_progress_dependencies() -> None:
    imports = imported_modules(PACKAGE_ROOT / "page.py")
    forbidden = sorted(
        module
        for module in imports
        if module.startswith("urllib")
        or module in {"os", "pathlib", "frameq_worker.download_reliability"}
        or module.endswith("progress_events")
    )
    assert forbidden == []


def test_root_adapter_no_longer_owns_low_level_implementation_imports() -> None:
    assert sorted(imported_modules(ROOT_MODULE) & ROOT_FORBIDDEN_IMPORTS) == []


def test_root_reexports_exact_shared_type_identities() -> None:
    from frameq_worker import douyin_fallback
    from frameq_worker.douyin import types

    assert douyin_fallback.DouyinFallbackError is types.DouyinFallbackError
    assert douyin_fallback.DouyinStreamCandidate is types.DouyinStreamCandidate
    assert douyin_fallback.HttpResponse is types.HttpResponse


def test_root_reexports_exact_concrete_client_identity() -> None:
    from frameq_worker import douyin_fallback
    from frameq_worker.douyin import transport

    assert douyin_fallback.UrllibDouyinHttpClient is transport.UrllibDouyinHttpClient


def test_all_progress_codes_remain_in_the_root_only() -> None:
    root_source = ROOT_MODULE.read_text(encoding="utf-8")
    assert all(code in root_source for code in PROGRESS_CODES)
    for path in PACKAGE_ROOT.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert all(code not in source for code in PROGRESS_CODES), path.name


def test_production_modules_import_douyin_only_through_the_stable_root() -> None:
    offenders: dict[str, list[str]] = {}
    for path in WORKER_ROOT.rglob("*.py"):
        if path == ROOT_MODULE or PACKAGE_ROOT in path.parents:
            continue
        private_imports = sorted(
            module
            for module in imported_modules(path)
            if module == "frameq_worker.douyin"
            or module.startswith("frameq_worker.douyin.")
        )
        if private_imports:
            offenders[path.relative_to(WORKER_ROOT).as_posix()] = private_imports
    assert offenders == {}
