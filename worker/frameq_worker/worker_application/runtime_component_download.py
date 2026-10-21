"""运行时组件下载的服务入口，环境变量驱动，形态与模型下载一致。"""

from __future__ import annotations

from pathlib import Path

from frameq_worker.config import load_project_env
from frameq_worker.runtime_component import (
    RUNTIME_COMPONENT_READY,
    evaluate_component,
    locate_bundled_manifest,
    read_manifest_fingerprint,
    resolve_component_dir,
)
from frameq_worker.runtime_component_download import (
    RUNTIME_COMPONENT_DOWNLOAD_FAILED,
    RUNTIME_COMPONENT_INVALID,
    RuntimeComponentDownloadError,
    download_pytorch_runtime_component,
)

COMPONENT_DIR_ENV = "FRAMEQ_PYTORCH_RUNTIME_DIR"
COMPONENT_URL_ENV = "FRAMEQ_PYTORCH_RUNTIME_URL"
COMPONENT_SHA256_ENV = "FRAMEQ_PYTORCH_RUNTIME_SHA256"

_COMPONENT_DOWNLOAD_FAILED_MESSAGE = "The PyTorch runtime component download failed."
_COMPONENT_INVALID_MESSAGE = "The downloaded PyTorch runtime component was invalid."


def _env_value(environ: dict[str, str], key: str) -> str | None:
    value = (environ.get(key) or "").strip()
    return value or None


def _bundled_fingerprint(project_root: Path, environ: dict[str, str]) -> str | None:
    manifest = locate_bundled_manifest(project_root, environ)
    if manifest is None:
        return None
    return read_manifest_fingerprint(manifest)


def run_runtime_component_download_once(
    project_root: Path | None = None,
    environ: dict[str, str] | None = None,
    progress_callback=None,
) -> dict[str, object]:
    """下载 PyTorch 运行时组件并落位，返回结构化结果。"""
    root = project_root or Path.cwd()
    runtime_env = load_project_env(root, environ)

    component_dir = resolve_component_dir(runtime_env)
    if component_dir is None:
        return {
            "status": "failed",
            "code": RUNTIME_COMPONENT_INVALID,
            "message": "The PyTorch runtime component directory is not configured.",
        }
    download_url = _env_value(runtime_env, COMPONENT_URL_ENV)
    if download_url is None:
        return {
            "status": "failed",
            "code": RUNTIME_COMPONENT_DOWNLOAD_FAILED,
            "message": "The PyTorch runtime component download URL is not configured.",
        }
    bundled_fingerprint = _bundled_fingerprint(root, runtime_env)
    if bundled_fingerprint is None:
        return {
            "status": "failed",
            "code": RUNTIME_COMPONENT_INVALID,
            "message": "This installation does not ship a runtime manifest; the component is not needed.",
        }

    try:
        installed = download_pytorch_runtime_component(
            component_dir=component_dir,
            download_url=download_url,
            bundled_fingerprint=bundled_fingerprint,
            expected_sha256=_env_value(runtime_env, COMPONENT_SHA256_ENV),
            progress_callback=progress_callback,
        )
    except RuntimeComponentDownloadError as exc:
        message = (
            _COMPONENT_INVALID_MESSAGE
            if exc.code == RUNTIME_COMPONENT_INVALID
            else _COMPONENT_DOWNLOAD_FAILED_MESSAGE
        )
        return {"status": "failed", "code": exc.code, "message": message}
    except Exception:  # noqa: BLE001 - third-party failures map to a fixed result.
        return {
            "status": "failed",
            "code": RUNTIME_COMPONENT_DOWNLOAD_FAILED,
            "message": _COMPONENT_DOWNLOAD_FAILED_MESSAGE,
        }

    # 落位后按门禁口径自检一次，与 ASR 阶段的判定保持同一把尺子。
    status = evaluate_component(installed, bundled_fingerprint)
    if status != RUNTIME_COMPONENT_READY:
        return {
            "status": "failed",
            "code": RUNTIME_COMPONENT_INVALID,
            "message": _COMPONENT_INVALID_MESSAGE,
        }
    return {"status": "completed", "component_dir": str(installed)}
