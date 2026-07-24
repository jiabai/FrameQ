from __future__ import annotations

from pathlib import Path

from frameq_worker.asr import DEFAULT_ASR_MODEL
from frameq_worker.config import load_project_env
from frameq_worker.desktop_contract import (
    MODEL_DIR_ENV,
    MODEL_DOWNLOAD_SHA256_ENV,
    MODEL_DOWNLOAD_URL_ENV,
    MODELSCOPE_ENDPOINT_ENV,
    SENSEVOICE_REVISION_ENV,
    ProgressCallback,
)
from frameq_worker.model_download import (
    ARCHIVE_INVALID_ERROR_CODE,
    ModelDownloadError,
    download_asr_model_cache,
)
from frameq_worker.requests import optional_env

MODEL_DOWNLOAD_FAILED_MESSAGE = "ASR model download failed."
MODEL_ARCHIVE_INVALID_MESSAGE = "Downloaded ASR model archive was invalid."


def run_asr_model_download_once(
    project_root: Path | None = None,
    environ: dict[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, object]:
    root = project_root or Path.cwd()
    runtime_env = load_project_env(root, environ)
    cache_dir = Path(runtime_env.get(MODEL_DIR_ENV, str(root / "models")))

    try:
        download_asr_model_cache(
            cache_dir=cache_dir,
            download_url=optional_env(runtime_env, MODEL_DOWNLOAD_URL_ENV),
            expected_sha256=optional_env(
                runtime_env,
                MODEL_DOWNLOAD_SHA256_ENV,
            ),
            revision=optional_env(runtime_env, SENSEVOICE_REVISION_ENV),
            endpoint=optional_env(runtime_env, MODELSCOPE_ENDPOINT_ENV),
            progress_callback=progress_callback,
        )
    except ModelDownloadError as exc:
        code, message = _safe_model_download_failure(exc.code)
        return {
            "status": "failed",
            "code": code,
            "message": message,
        }
    except Exception:  # noqa: BLE001 - maps third-party failures to a fixed result.
        return {
            "status": "failed",
            "code": "ASR_MODEL_DOWNLOAD_FAILED",
            "message": MODEL_DOWNLOAD_FAILED_MESSAGE,
        }

    return {
        "status": "completed",
        "model": DEFAULT_ASR_MODEL,
    }


def _safe_model_download_failure(code: str) -> tuple[str, str]:
    if code == ARCHIVE_INVALID_ERROR_CODE:
        return code, MODEL_ARCHIVE_INVALID_MESSAGE
    return "ASR_MODEL_DOWNLOAD_FAILED", MODEL_DOWNLOAD_FAILED_MESSAGE
