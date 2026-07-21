import ast
import importlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

WORKER_ROOT = Path(__file__).resolve().parents[1]
FRAMEQ_WORKER_ROOT = WORKER_ROOT / "frameq_worker"
PUBLIC_ASR_PATH = FRAMEQ_WORKER_ROOT / "asr.py"
PRIVATE_ASR_ROOT = FRAMEQ_WORKER_ROOT / "asr_runtime"
EXPECTED_PRIVATE_FILES = {
    "__init__.py",
    "artifacts.py",
    "qwen.py",
    "registry.py",
    "sensevoice.py",
    "types.py",
}


def _private_python_files() -> set[str]:
    if not PRIVATE_ASR_ROOT.is_dir():
        return set()
    return {path.name for path in PRIVATE_ASR_ROOT.glob("*.py")}


@pytest.fixture(autouse=True)
def _skip_dependent_checks_until_private_tree_exists(
    request: pytest.FixtureRequest,
) -> None:
    if request.node.name == "test_asr_runtime_private_module_tree_matches_design":
        return
    if _private_python_files() != EXPECTED_PRIVATE_FILES:
        pytest.skip("approved private ASR module tree is not complete yet")


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=path.as_posix())


def _top_level_owned_names(path: Path) -> set[str]:
    names: set[str] = set()
    for node in _parse(path).body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    names.add(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def _imported_modules(path: Path) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(_parse(path)):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def _owners_importing(import_root: str) -> set[str]:
    owners: set[str] = set()
    for path in PRIVATE_ASR_ROOT.glob("*.py"):
        if any(
            module == import_root or module.startswith(f"{import_root}.")
            for module in _imported_modules(path)
        ):
            owners.add(path.name)
    return owners


def test_asr_runtime_private_module_tree_matches_design() -> None:
    assert _private_python_files() == EXPECTED_PRIVATE_FILES
    assert (PRIVATE_ASR_ROOT / "__init__.py").read_text(encoding="utf-8").strip() == ""


def test_private_modules_own_the_approved_symbols() -> None:
    expected_owner_symbols = {
        "types.py": {
            "ASRDependencyError",
            "ASREmptyTranscriptError",
            "ASRError",
            "ASRRuntimeError",
            "ASRUnsupportedModelError",
            "AsrModelSpec",
            "ModelFactory",
            "Transcript",
            "TranscriptArtifacts",
            "TranscriptSegment",
            "Transcriber",
            "extract_provider_text",
            "missing_dependency_message",
        },
        "qwen.py": {"QWEN_ASR_MODEL", "QwenAsrTranscriber"},
        "sensevoice.py": {
            "SENSEVOICE_SMALL_MODEL",
            "SENSEVOICE_TAG_PATTERN",
            "SENSEVOICE_VAD_MAX_SEGMENT_TIME_MS",
            "SENSEVOICE_VAD_MODEL",
            "SenseVoiceTranscriber",
            "_clean_sensevoice_text",
            "_coerce_milliseconds",
            "_extract_sentence_info",
            "_extract_sensevoice_segments",
            "_extract_vad_segments",
            "_read_pcm_wav_mono_float32",
            "_sensevoice_language",
            "_slice_audio_by_milliseconds",
            "_transcribe_sensevoice_vad_blocks",
        },
        "registry.py": {
            "DEFAULT_ASR_MODEL",
            "DEFAULT_MODEL_CACHE_ENV",
            "MODELSCOPE_CACHE_ENV",
            "SUPPORTED_ASR_MODELS",
            "asr_model_display_name",
            "asr_model_family",
            "build_asr_transcriber",
            "build_qwen_asr_transcriber",
            "build_sensevoice_transcriber",
            "configure_modelscope_cache_dir",
            "resolve_asr_model_name",
            "resolve_model_cache_dir",
            "supported_asr_model_names",
        },
        "artifacts.py": {
            "_format_transcript_markdown",
            "transcribe_and_write",
            "write_transcript_files",
        },
    }

    for filename, expected_names in expected_owner_symbols.items():
        assert expected_names <= _top_level_owned_names(PRIVATE_ASR_ROOT / filename)


def test_public_asr_root_is_only_a_compatibility_surface() -> None:
    tree = _parse(PUBLIC_ASR_PATH)
    implemented_names = {
        node.name
        for node in tree.body
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assigned_names = {
        target.id
        for node in tree.body
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    }
    imported_modules = _imported_modules(PUBLIC_ASR_PATH)

    assert implemented_names == set()
    assert assigned_names == set()
    assert len(PUBLIC_ASR_PATH.read_text(encoding="utf-8").splitlines()) < 120
    assert not {
        "funasr",
        "json",
        "numpy",
        "os",
        "qwen_asr",
        "re",
        "wave",
        "frameq_worker.models",
        "frameq_worker.source_identity",
    } & imported_modules


def test_public_asr_root_reexports_exact_private_objects_and_values() -> None:
    public = importlib.import_module("frameq_worker.asr")
    artifacts = importlib.import_module("frameq_worker.asr_runtime.artifacts")
    qwen = importlib.import_module("frameq_worker.asr_runtime.qwen")
    registry = importlib.import_module("frameq_worker.asr_runtime.registry")
    sensevoice = importlib.import_module("frameq_worker.asr_runtime.sensevoice")
    types = importlib.import_module("frameq_worker.asr_runtime.types")

    for name in (
        "ASRDependencyError",
        "ASREmptyTranscriptError",
        "ASRError",
        "ASRRuntimeError",
        "ASRUnsupportedModelError",
        "AsrModelSpec",
        "ModelFactory",
        "Transcript",
        "TranscriptArtifacts",
        "TranscriptSegment",
        "Transcriber",
    ):
        assert getattr(public, name) is getattr(types, name)
    assert public.QwenAsrTranscriber is qwen.QwenAsrTranscriber
    assert public.SenseVoiceTranscriber is sensevoice.SenseVoiceTranscriber
    for name in (
        "SUPPORTED_ASR_MODELS",
        "asr_model_display_name",
        "asr_model_family",
        "build_asr_transcriber",
        "build_qwen_asr_transcriber",
        "build_sensevoice_transcriber",
        "configure_modelscope_cache_dir",
        "resolve_asr_model_name",
        "resolve_model_cache_dir",
        "supported_asr_model_names",
    ):
        assert getattr(public, name) is getattr(registry, name)
    assert public.transcribe_and_write is artifacts.transcribe_and_write
    assert public.write_transcript_files is artifacts.write_transcript_files

    assert public.QWEN_ASR_MODEL == qwen.QWEN_ASR_MODEL == "Qwen/Qwen3-ASR-0.6B"
    assert (
        public.SENSEVOICE_SMALL_MODEL
        == sensevoice.SENSEVOICE_SMALL_MODEL
        == "iic/SenseVoiceSmall"
    )
    assert public.SENSEVOICE_VAD_MODEL == sensevoice.SENSEVOICE_VAD_MODEL == "fsmn-vad"
    assert (
        public.SENSEVOICE_VAD_MAX_SEGMENT_TIME_MS
        == sensevoice.SENSEVOICE_VAD_MAX_SEGMENT_TIME_MS
        == 30000
    )
    assert public.DEFAULT_ASR_MODEL == registry.DEFAULT_ASR_MODEL == "iic/SenseVoiceSmall"
    assert public.DEFAULT_MODEL_CACHE_ENV == registry.DEFAULT_MODEL_CACHE_ENV == "FRAMEQ_MODEL_DIR"
    assert public.MODELSCOPE_CACHE_ENV == registry.MODELSCOPE_CACHE_ENV == "MODELSCOPE_CACHE"
    assert public.supported_asr_model_names() == [
        "iic/SenseVoiceSmall",
        "Qwen/Qwen3-ASR-0.6B",
    ]
    assert not hasattr(public, "SENSEVOICE_TAG_PATTERN")


def test_stable_root_import_does_not_load_provider_sdks() -> None:
    code = """
import json
import sys
import frameq_worker.asr

print(json.dumps({name: name in sys.modules for name in ("qwen_asr", "funasr", "numpy")}))
"""
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(WORKER_ROOT)

    completed = subprocess.run(
        [sys.executable, "-c", code],
        cwd=WORKER_ROOT.parent,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    assert json.loads(completed.stdout.strip()) == {
        "qwen_asr": False,
        "funasr": False,
        "numpy": False,
    }


def test_production_callers_do_not_import_private_asr_modules() -> None:
    violations: list[str] = []
    for path in FRAMEQ_WORKER_ROOT.rglob("*.py"):
        if path == PUBLIC_ASR_PATH or PRIVATE_ASR_ROOT in path.parents:
            continue
        for module in _imported_modules(path):
            if module == "frameq_worker.asr_runtime" or module.startswith(
                "frameq_worker.asr_runtime."
            ):
                violations.append(f"{path.relative_to(WORKER_ROOT)}: {module}")

    assert violations == []


def test_private_asr_modules_have_no_root_or_application_back_edges() -> None:
    forbidden_modules = {
        "frameq_worker.asr",
        "frameq_worker.cli",
        "frameq_worker.llm",
        "frameq_worker.media",
        "frameq_worker.pipeline",
        "frameq_worker.task_store",
        "frameq_worker.worker_service",
    }
    violations: list[str] = []
    for path in PRIVATE_ASR_ROOT.glob("*.py"):
        for module in _imported_modules(path):
            if module in forbidden_modules or module.startswith("frameq_worker.insightflow"):
                violations.append(f"{path.name}: {module}")

    assert violations == []


def test_low_level_dependencies_have_one_approved_owner() -> None:
    assert _owners_importing("qwen_asr") == {"qwen.py"}
    assert _owners_importing("funasr") == {"sensevoice.py"}
    assert _owners_importing("numpy") == {"sensevoice.py"}
    assert _owners_importing("wave") == {"sensevoice.py"}
    assert _owners_importing("os") == {"registry.py"}
    assert _owners_importing("json") == {"artifacts.py"}
    assert _owners_importing("frameq_worker.models") == {"artifacts.py"}
    assert _owners_importing("frameq_worker.source_identity") == {"artifacts.py"}


def test_provider_modules_do_not_depend_on_registry() -> None:
    for filename in ("qwen.py", "sensevoice.py"):
        assert "frameq_worker.asr_runtime.registry" not in _imported_modules(
            PRIVATE_ASR_ROOT / filename
        )
        assert "registry" not in _imported_modules(PRIVATE_ASR_ROOT / filename)
