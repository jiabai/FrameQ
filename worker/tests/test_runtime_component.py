"""PyTorch 运行时组件契约的单元测试。"""

from __future__ import annotations

import json
import types
from pathlib import Path

from frameq_worker.pipeline_runtime.transcript import evaluate_pytorch_component_gate
from frameq_worker.runtime_component import (
    BUNDLED_MANIFEST_ENV,
    COMPONENT_DIR_ENV,
    COMPONENT_MANIFEST_NAME,
    COMPONENT_SITE_PACKAGES_NAME,
    RUNTIME_COMPONENT_MISSING,
    RUNTIME_COMPONENT_READY,
    RUNTIME_COMPONENT_STALE,
    RUNTIME_COMPONENT_UNGATED,
    evaluate_component,
    install_sys_path,
    locate_bundled_manifest,
    read_manifest_fingerprint,
    resolve_component_dir,
)


def _write_manifest(directory: Path, fingerprint: str | None) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / COMPONENT_MANIFEST_NAME
    payload = {} if fingerprint is None else {"lock_fingerprint": fingerprint}
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_resolve_component_dir_reads_env_or_returns_none() -> None:
    assert resolve_component_dir({COMPONENT_DIR_ENV: " D:/runtime/pytorch/0.3.9 "}) == Path(
        "D:/runtime/pytorch/0.3.9"
    )
    assert resolve_component_dir({}) is None
    assert resolve_component_dir({COMPONENT_DIR_ENV: "   "}) is None


def test_locate_bundled_manifest_prefers_project_root_and_env(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path, "fp-1")
    assert locate_bundled_manifest(tmp_path, {}) == manifest
    assert locate_bundled_manifest(tmp_path / "empty", {}) is None
    override = _write_manifest(tmp_path / "elsewhere", "fp-2")
    assert locate_bundled_manifest(tmp_path, {BUNDLED_MANIFEST_ENV: str(override)}) == override
    assert (
        locate_bundled_manifest(tmp_path, {BUNDLED_MANIFEST_ENV: str(tmp_path / "nope.json")})
        is None
    )


def test_read_manifest_fingerprint_rejects_every_malformed_shape(tmp_path: Path) -> None:
    assert read_manifest_fingerprint(_write_manifest(tmp_path, "fp-1")) == "fp-1"

    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    assert read_manifest_fingerprint(broken) is None

    assert read_manifest_fingerprint(_write_manifest(tmp_path / "no_field", None)) is None

    wrong_type = tmp_path / "wrong_type.json"
    wrong_type.write_text(json.dumps({"lock_fingerprint": 12}), encoding="utf-8")
    assert read_manifest_fingerprint(wrong_type) is None

    empty_value = tmp_path / "empty_value.json"
    empty_value.write_text(json.dumps({"lock_fingerprint": "  "}), encoding="utf-8")
    assert read_manifest_fingerprint(empty_value) is None

    assert read_manifest_fingerprint(tmp_path / "absent.json") is None


def test_evaluate_component_states() -> None:
    assert evaluate_component(None, None) is RUNTIME_COMPONENT_UNGATED
    assert evaluate_component(Path("D:/any"), None) is RUNTIME_COMPONENT_UNGATED
    assert evaluate_component(None, "fp-1") is RUNTIME_COMPONENT_MISSING
    assert evaluate_component(Path("D:/not-here"), "fp-1") is RUNTIME_COMPONENT_MISSING


def test_evaluate_component_missing_when_manifest_unreadable(tmp_path: Path) -> None:
    component = tmp_path / "component"
    component.mkdir()
    assert evaluate_component(component, "fp-1") is RUNTIME_COMPONENT_MISSING

    broken = tmp_path / "component-broken"
    broken.mkdir()
    (broken / COMPONENT_MANIFEST_NAME).write_text("{oops", encoding="utf-8")
    assert evaluate_component(broken, "fp-1") is RUNTIME_COMPONENT_MISSING


def test_evaluate_component_matches_and_mismatches(tmp_path: Path) -> None:
    matching = _write_manifest(tmp_path / "matching", "fp-1")
    stale = _write_manifest(tmp_path / "stale", "fp-0")
    assert evaluate_component(matching.parent, "fp-1") is RUNTIME_COMPONENT_READY
    assert evaluate_component(stale.parent, "fp-1") is RUNTIME_COMPONENT_STALE


def test_install_sys_path_is_idempotent_and_requires_site_packages(tmp_path: Path) -> None:
    fake_sys = types.SimpleNamespace(path=[])
    assert install_sys_path(tmp_path, sys_module=fake_sys) is False

    (tmp_path / COMPONENT_SITE_PACKAGES_NAME).mkdir()
    assert install_sys_path(tmp_path, sys_module=fake_sys) is True
    assert fake_sys.path == [str(tmp_path / COMPONENT_SITE_PACKAGES_NAME)]
    assert install_sys_path(tmp_path, sys_module=fake_sys) is False
    assert fake_sys.path == [str(tmp_path / COMPONENT_SITE_PACKAGES_NAME)]


def test_gate_skips_non_pytorch_families(tmp_path: Path) -> None:
    environ = {COMPONENT_DIR_ENV: str(tmp_path)}
    for model_name in ("iic/SenseVoiceSmall-onnx", "vendor/not-supported"):
        status, component_dir = evaluate_pytorch_component_gate(
            model_name=model_name,
            project_root=tmp_path,
            environ=environ,
        )
        assert status is RUNTIME_COMPONENT_UNGATED
        assert component_dir is None


def test_gate_is_ungated_without_bundled_manifest(tmp_path: Path) -> None:
    status, _ = evaluate_pytorch_component_gate(
        model_name="iic/SenseVoiceSmall",
        project_root=tmp_path,
        environ={},
    )
    assert status is RUNTIME_COMPONENT_UNGATED


def test_gate_reports_missing_without_component_env(tmp_path: Path) -> None:
    _write_manifest(tmp_path, "fp-1")
    status, component_dir = evaluate_pytorch_component_gate(
        model_name="iic/SenseVoiceSmall",
        project_root=tmp_path,
        environ={},
    )
    assert status is RUNTIME_COMPONENT_MISSING
    assert component_dir is None


def test_gate_matches_and_mismatches_component(tmp_path: Path) -> None:
    _write_manifest(tmp_path, "fp-1")
    matching = _write_manifest(tmp_path / "matching", "fp-1")
    stale = _write_manifest(tmp_path / "stale", "fp-0")

    status, component_dir = evaluate_pytorch_component_gate(
        model_name="iic/SenseVoiceSmall",
        project_root=tmp_path,
        environ={COMPONENT_DIR_ENV: str(matching.parent)},
    )
    assert status is RUNTIME_COMPONENT_READY
    assert component_dir == matching.parent

    status, _ = evaluate_pytorch_component_gate(
        model_name="iic/SenseVoiceSmall",
        project_root=tmp_path,
        environ={COMPONENT_DIR_ENV: str(stale.parent)},
    )
    assert status is RUNTIME_COMPONENT_STALE
