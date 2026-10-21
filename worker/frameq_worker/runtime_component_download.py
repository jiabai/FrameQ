"""PyTorch 运行时组件的下载、校验与落位。

组件与模型共用下载器底座（带重试与大小上限的流式下载、SHA-256 校验、
带路径安全检查的 zip/tar 解压），但生命周期独立：组件目录由
``FRAMEQ_PYTORCH_RUNTIME_DIR`` 给出（桌面端按 ``<user_data>/runtime/pytorch/<版本>``
拼出），安装前用包内 manifest 的 ``lock_fingerprint`` 校验组件 manifest，
不一致按版本不匹配处理，绝不复用旧目录。
"""

from __future__ import annotations

import hashlib
import shutil
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

from frameq_worker.model_download import (
    _download_url_to_file,
    _extract_archive_safely,
)
from frameq_worker.progress_events import build_model_progress_event
from frameq_worker.runtime_component import (
    COMPONENT_MANIFEST_NAME,
    COMPONENT_SITE_PACKAGES_NAME,
    read_manifest_fingerprint,
)

RUNTIME_COMPONENT_DOWNLOAD_FAILED = "RUNTIME_COMPONENT_DOWNLOAD_FAILED"
RUNTIME_COMPONENT_INVALID = "RUNTIME_COMPONENT_INVALID"


class RuntimeComponentDownloadError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _emit(progress_callback, message_code: str, status: str, progress: int) -> None:
    if progress_callback is None:
        return
    progress_callback(
        build_model_progress_event(message_code, status=status, progress=progress)
    )


def _verify_sha256(path: Path, expected_sha256: str) -> None:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest().lower()
    if actual != expected_sha256.lower():
        raise RuntimeComponentDownloadError(
            RUNTIME_COMPONENT_DOWNLOAD_FAILED,
            f"PyTorch runtime component SHA256 mismatch: expected {expected_sha256}, got {actual}.",
        )


def _validate_component_layout(install_dir: Path, bundled_fingerprint: str) -> None:
    component_fingerprint = read_manifest_fingerprint(install_dir / COMPONENT_MANIFEST_NAME)
    if component_fingerprint is None:
        raise RuntimeComponentDownloadError(
            RUNTIME_COMPONENT_INVALID,
            "The downloaded PyTorch runtime component has no readable manifest.",
        )
    if component_fingerprint != bundled_fingerprint:
        raise RuntimeComponentDownloadError(
            RUNTIME_COMPONENT_INVALID,
            "The downloaded PyTorch runtime component does not match this app version.",
        )
    if not (install_dir / COMPONENT_SITE_PACKAGES_NAME).is_dir():
        raise RuntimeComponentDownloadError(
            RUNTIME_COMPONENT_INVALID,
            "The downloaded PyTorch runtime component is missing site-packages.",
        )


def download_pytorch_runtime_component(
    *,
    component_dir: Path,
    download_url: str,
    bundled_fingerprint: str,
    expected_sha256: str | None = None,
    progress_callback=None,
    urlopen: Callable[..., object] | None = None,
) -> Path:
    """下载并安装 PyTorch 运行时组件，返回最终组件目录。

    ``bundled_fingerprint`` 来自包内 ``runtime-manifest.json``；组件内容与它
    不一致时抛 ``RUNTIME_COMPONENT_INVALID``，不落位，也不改动既有目录。
    """
    component_dir = Path(component_dir)
    if not download_url:
        raise RuntimeComponentDownloadError(
            RUNTIME_COMPONENT_DOWNLOAD_FAILED,
            "PyTorch runtime component download URL is missing.",
        )
    if not bundled_fingerprint:
        raise RuntimeComponentDownloadError(
            RUNTIME_COMPONENT_INVALID,
            "The bundled runtime manifest does not carry a fingerprint.",
        )

    component_dir.parent.mkdir(parents=True, exist_ok=True)
    staging_dir = component_dir.parent / f".pytorch-runtime-staging-{uuid4().hex}"
    staging_dir.mkdir(parents=True)
    try:
        _emit(progress_callback, "runtime.component.preparing", "started", 0)
        archive_path = staging_dir / "component.zip"
        download_options: dict[str, object] = {
            "progress_callback": progress_callback,
            "downloading_message_code": "runtime.component.downloading",
        }
        if urlopen is not None:
            download_options["urlopen"] = urlopen
        _download_url_to_file(
            download_url,
            archive_path,
            **download_options,  # type: ignore[arg-type]
        )
        if expected_sha256:
            _verify_sha256(archive_path, expected_sha256)

        _emit(progress_callback, "runtime.component.extracting", "extracting", 80)
        install_dir = staging_dir / "install"
        _extract_archive_safely(archive_path, install_dir)
        _validate_component_layout(install_dir, bundled_fingerprint)

        _emit(progress_callback, "runtime.component.completed", "completed", 100)
        if component_dir.exists():
            shutil.rmtree(component_dir)
        shutil.move(str(install_dir), str(component_dir))
        return component_dir
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)
