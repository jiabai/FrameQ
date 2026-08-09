from __future__ import annotations

from pathlib import Path

from frameq_worker.asr import DEFAULT_ASR_MODEL, SENSEVOICE_SMALL_ONNX_MODEL
from frameq_worker.config import load_project_env
from frameq_worker.desktop_contract import (
    MODEL_DIR_ENV,
    MODEL_DOWNLOAD_SHA256_ENV,
    MODEL_DOWNLOAD_URL_ENV,
    MODELSCOPE_ENDPOINT_ENV,
    SENSEVOICE_REVISION_ENV,
    ProgressCallback,
)
from frameq_worker.diagnostic_events import (
    DiagnosticCallback,
    classify_model_download_exception,
)
from frameq_worker.model_download import (
    ARCHIVE_INVALID_ERROR_CODE,
    ModelDownloadError,
    download_asr_model_cache,
)
from frameq_worker.requests import optional_env

MODEL_DOWNLOAD_FAILED_MESSAGE = "ASR model download failed."
MODEL_ARCHIVE_INVALID_MESSAGE = "Downloaded ASR model archive was invalid."

_PHASE_BY_MESSAGE_CODE = {
    "model.download.preparing": "preparing",
    "model.primary.downloading": "primary_model",
    "model.vad.downloading": "vad_model",
    "model.bpe.downloading": "bpe_model",
    "model.archive.downloading": "archive_download",
    "model.archive.reading": "archive_download",
    "model.archive.extracting": "archive_validate",
    "model.file.downloading": "primary_model",
    "model.file.completed": "primary_model",
}


def run_asr_model_download_once(
    project_root: Path | None = None,
    environ: dict[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
    asr_model: str = DEFAULT_ASR_MODEL,
    diagnostic_callback: DiagnosticCallback | None = None,
) -> dict[str, object]:
    if asr_model not in {DEFAULT_ASR_MODEL, SENSEVOICE_SMALL_ONNX_MODEL}:
        return {
            "status": "failed",
            "code": "ASR_MODEL_UNSUPPORTED",
            "message": MODEL_DOWNLOAD_FAILED_MESSAGE,
        }
    root = project_root or Path.cwd()
    runtime_env = load_project_env(root, environ)
    cache_dir = Path(runtime_env.get(MODEL_DIR_ENV, str(root / "models")))
    current_phase = "preparing"

    def track_progress(event: dict[str, object]) -> None:
        nonlocal current_phase
        message_code = event.get("message_code")
        if isinstance(message_code, str):
            current_phase = _PHASE_BY_MESSAGE_CODE.get(message_code, current_phase)
        if progress_callback is not None:
            progress_callback(event)

    download_options: dict[str, object] = {
        "cache_dir": cache_dir,
        "model_name": asr_model,
        "progress_callback": track_progress,
    }
    if asr_model == DEFAULT_ASR_MODEL:
        download_options.update(
            download_url=optional_env(runtime_env, MODEL_DOWNLOAD_URL_ENV),
            expected_sha256=optional_env(runtime_env, MODEL_DOWNLOAD_SHA256_ENV),
            revision=optional_env(runtime_env, SENSEVOICE_REVISION_ENV),
            endpoint=optional_env(runtime_env, MODELSCOPE_ENDPOINT_ENV),
        )

    try:
        download_asr_model_cache(
            **download_options,
        )
    except ModelDownloadError as exc:
        safe_error_code = _safe_model_download_error_code(exc)
        diagnostic_phase = _refine_archive_invalid_phase(
            safe_error_code,
            current_phase,
            asr_model,
            download_options,
        )
        _emit_diagnostic(diagnostic_callback, exc, diagnostic_phase)
        code, message = _safe_model_download_failure(safe_error_code)
        return {
            "status": "failed",
            "code": code,
            "message": message,
        }
    except Exception as exc:  # noqa: BLE001 - maps third-party failures to a fixed result.
        _emit_diagnostic(diagnostic_callback, exc, current_phase)
        return {
            "status": "failed",
            "code": "ASR_MODEL_DOWNLOAD_FAILED",
            "message": MODEL_DOWNLOAD_FAILED_MESSAGE,
        }

    return {
        "status": "completed",
        "model": asr_model,
    }


def _safe_model_download_error_code(exception: ModelDownloadError) -> str | None:
    try:
        code = object.__getattribute__(exception, "code")
    except BaseException:
        return None
    return code if isinstance(code, str) else None


def _safe_model_download_failure(code: str | None) -> tuple[str, str]:
    if code == ARCHIVE_INVALID_ERROR_CODE:
        return code, MODEL_ARCHIVE_INVALID_MESSAGE
    return "ASR_MODEL_DOWNLOAD_FAILED", MODEL_DOWNLOAD_FAILED_MESSAGE


def _refine_archive_invalid_phase(
    error_code: str | None,
    current_phase: str,
    asr_model: str,
    download_options: dict[str, object],
) -> str:
    if error_code != ARCHIVE_INVALID_ERROR_CODE:
        return current_phase
    if current_phase == "archive_download" and download_options.get("download_url"):
        return "archive_validate"
    if current_phase in {"primary_model", "vad_model", "bpe_model"}:
        return "cache_validate"
    if current_phase == "preparing" and asr_model == SENSEVOICE_SMALL_ONNX_MODEL:
        return "cache_validate"
    return current_phase


def _emit_diagnostic(
    callback: DiagnosticCallback | None,
    exception: BaseException,
    phase: str,
) -> None:
    if callback is None:
        return
    try:
        event = classify_model_download_exception(exception, phase)
        callback(event)
    except BaseException:  # noqa: BLE001 - supplemental diagnostics cannot mask the result.
        pass
