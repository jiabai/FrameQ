"""PyTorch 运行时组件下载链路的单元测试。"""

from __future__ import annotations

import http.server
import json
import socketserver
import threading
import zipfile
from functools import partial
from pathlib import Path

import pytest

from frameq_worker.runtime_component import (
    COMPONENT_MANIFEST_NAME,
    COMPONENT_SITE_PACKAGES_NAME,
    evaluate_component,
)
from frameq_worker.runtime_component_download import (
    RUNTIME_COMPONENT_DOWNLOAD_FAILED,
    RUNTIME_COMPONENT_INVALID,
    RuntimeComponentDownloadError,
    download_pytorch_runtime_component,
)
from frameq_worker.worker_application.runtime_component_download import (
    COMPONENT_DIR_ENV,
    COMPONENT_SHA256_ENV,
    COMPONENT_URL_ENV,
    run_runtime_component_download_once,
)


def _make_component_zip(zip_path: Path, fingerprint: str | None, *, with_site_packages: bool = True) -> str:
    """构造一个最小的组件 zip，返回其内容的 SHA-256。"""
    import hashlib

    root = zip_path.parent / "payload"
    root.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {}
    if fingerprint is not None:
        manifest["lock_fingerprint"] = fingerprint
    (root / COMPONENT_MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
    if with_site_packages:
        package = root / COMPONENT_SITE_PACKAGES_NAME / "torch_runtime_probe"
        package.mkdir(parents=True, exist_ok=True)
        (package / "__init__.py").write_text("", encoding="utf-8")
    with zipfile.ZipFile(zip_path, "w") as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())
    return hashlib.sha256(zip_path.read_bytes()).hexdigest()


class _SingleDirHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: object) -> None:  # 静默访问日志
        return


@pytest.fixture()
def component_archive_server(tmp_path: Path):
    """起一个临时 HTTP 服务，返回 (base_url, 存放目录)。"""
    serve_dir = tmp_path / "serve"
    serve_dir.mkdir()
    # SimpleHTTPRequestHandler.__init__ 会覆盖类属性 directory，必须用参数传入
    handler = partial(_SingleDirHandler, directory=str(serve_dir))
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address[:2]
            yield f"http://{host}:{port}", serve_dir
        finally:
            server.shutdown()
            thread.join()


def test_happy_path_downloads_validates_and_installs(
    tmp_path: Path, component_archive_server
) -> None:
    base_url, serve_dir = component_archive_server
    zip_path = serve_dir / "component.zip"
    sha256 = _make_component_zip(zip_path, "fp-1")

    component_dir = tmp_path / "runtime" / "pytorch" / "0.3.9"
    events: list[tuple[str, str, int]] = []
    installed = download_pytorch_runtime_component(
        component_dir=component_dir,
        download_url=f"{base_url}/component.zip",
        bundled_fingerprint="fp-1",
        expected_sha256=sha256,
        progress_callback=lambda event: events.append(
            (event["message_code"], event["status"], event["progress"])
        ),
    )

    assert installed == component_dir
    assert json.loads((component_dir / COMPONENT_MANIFEST_NAME).read_text(encoding="utf-8")) == {
        "lock_fingerprint": "fp-1"
    }
    assert (component_dir / COMPONENT_SITE_PACKAGES_NAME).is_dir()
    assert [code for code, _, _ in events] == [
        "runtime.component.preparing",
        "runtime.component.downloading",
        "runtime.component.extracting",
        "runtime.component.completed",
    ]
    assert evaluate_component(component_dir, "fp-1") == "ready"
    # staging 必须清理干净
    assert list(component_dir.parent.glob(".pytorch-runtime-staging-*")) == []


def test_sha256_mismatch_fails_without_touching_existing_component(
    tmp_path: Path, component_archive_server
) -> None:
    base_url, serve_dir = component_archive_server
    _make_component_zip(serve_dir / "component.zip", "fp-1")
    existing = tmp_path / "runtime" / "pytorch" / "0.3.9"
    existing.mkdir(parents=True)
    (existing / "keep.txt").write_text("keep", encoding="utf-8")

    with pytest.raises(RuntimeComponentDownloadError) as exc_info:
        download_pytorch_runtime_component(
            component_dir=existing,
            download_url=f"{base_url}/component.zip",
            bundled_fingerprint="fp-1",
            expected_sha256="0" * 64,
        )
    assert exc_info.value.code == RUNTIME_COMPONENT_DOWNLOAD_FAILED
    assert (existing / "keep.txt").read_text(encoding="utf-8") == "keep"


def test_fingerprint_mismatch_is_rejected_before_promotion(
    tmp_path: Path, component_archive_server
) -> None:
    base_url, serve_dir = component_archive_server
    _make_component_zip(serve_dir / "component.zip", "fp-other")

    with pytest.raises(RuntimeComponentDownloadError) as exc_info:
        download_pytorch_runtime_component(
            component_dir=tmp_path / "runtime" / "pytorch" / "0.3.9",
            download_url=f"{base_url}/component.zip",
            bundled_fingerprint="fp-1",
        )
    assert exc_info.value.code == RUNTIME_COMPONENT_INVALID


def test_zip_without_manifest_or_site_packages_is_invalid(
    tmp_path: Path, component_archive_server
) -> None:
    base_url, serve_dir = component_archive_server
    _make_component_zip(serve_dir / "no-manifest.zip", "fp-1", with_site_packages=False)

    with pytest.raises(RuntimeComponentDownloadError) as exc_info:
        download_pytorch_runtime_component(
            component_dir=tmp_path / "runtime" / "pytorch" / "0.3.9",
            download_url=f"{base_url}/no-manifest.zip",
            bundled_fingerprint="fp-1",
        )
    assert exc_info.value.code == RUNTIME_COMPONENT_INVALID


def test_promotion_replaces_an_older_component(
    tmp_path: Path, component_archive_server
) -> None:
    base_url, serve_dir = component_archive_server
    _make_component_zip(serve_dir / "component.zip", "fp-2")
    component_dir = tmp_path / "runtime" / "pytorch" / "0.3.9"
    component_dir.mkdir(parents=True)
    (component_dir / "stale.txt").write_text("stale", encoding="utf-8")

    download_pytorch_runtime_component(
        component_dir=component_dir,
        download_url=f"{base_url}/component.zip",
        bundled_fingerprint="fp-2",
    )
    assert not (component_dir / "stale.txt").exists()
    assert evaluate_component(component_dir, "fp-2") == "ready"


def test_service_wrapper_reports_configuration_gaps(tmp_path: Path) -> None:
    result = run_runtime_component_download_once(
        project_root=tmp_path, environ={}
    )
    assert result["status"] == "failed"
    assert result["code"] == RUNTIME_COMPONENT_INVALID

    manifest = tmp_path / "runtime-manifest.json"
    manifest.write_text(json.dumps({"lock_fingerprint": "fp-1"}), encoding="utf-8")
    environ = {
        COMPONENT_DIR_ENV: str(tmp_path / "runtime" / "pytorch" / "0.3.9"),
        COMPONENT_SHA256_ENV: "x",
    }
    result = run_runtime_component_download_once(project_root=tmp_path, environ=environ)
    assert result["code"] == RUNTIME_COMPONENT_DOWNLOAD_FAILED


def test_service_wrapper_end_to_end(tmp_path: Path, component_archive_server) -> None:
    base_url, serve_dir = component_archive_server
    zip_path = serve_dir / "component.zip"
    sha256 = _make_component_zip(zip_path, "fp-1")
    (tmp_path / "runtime-manifest.json").write_text(
        json.dumps({"lock_fingerprint": "fp-1"}), encoding="utf-8"
    )
    environ = {
        COMPONENT_DIR_ENV: str(tmp_path / "runtime" / "pytorch" / "0.3.9"),
        COMPONENT_URL_ENV: f"{base_url}/component.zip",
        COMPONENT_SHA256_ENV: sha256,
    }
    result = run_runtime_component_download_once(project_root=tmp_path, environ=environ)
    assert result["status"] == "completed"
    assert evaluate_component(Path(str(result["component_dir"])), "fp-1") == "ready"


def test_already_installed_component_skips_the_download(tmp_path: Path) -> None:
    manifest = tmp_path / "runtime-manifest.json"
    manifest.write_text(json.dumps({"lock_fingerprint": "fp-1"}), encoding="utf-8")
    component_dir = tmp_path / "runtime" / "pytorch" / "0.3.9"
    (component_dir / COMPONENT_SITE_PACKAGES_NAME).mkdir(parents=True)
    (component_dir / COMPONENT_MANIFEST_NAME).write_text(
        json.dumps({"lock_fingerprint": "fp-1"}), encoding="utf-8"
    )
    environ = {
        COMPONENT_DIR_ENV: str(component_dir),
        COMPONENT_URL_ENV: "http://127.0.0.1:1/unreachable.zip",
    }
    result = run_runtime_component_download_once(project_root=tmp_path, environ=environ)
    assert result["status"] == "completed"
    assert result["already_installed"] is True


def test_missing_bundled_manifest_means_component_not_needed(tmp_path: Path) -> None:
    environ = {
        COMPONENT_DIR_ENV: str(tmp_path / "runtime" / "pytorch" / "0.3.9"),
        COMPONENT_URL_ENV: "http://127.0.0.1:1/component.zip",
    }
    result = run_runtime_component_download_once(project_root=tmp_path, environ=environ)
    assert result["status"] == "failed"
    assert result["code"] == RUNTIME_COMPONENT_INVALID
    assert "does not ship a runtime manifest" in str(result["message"])
