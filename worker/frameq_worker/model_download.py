from __future__ import annotations

import hashlib
import shutil
import stat
import tarfile
import tempfile
import urllib.request
import zipfile
from collections.abc import Callable
from pathlib import Path

from modelscope.hub.callback import ProgressCallback as ModelScopeProgressCallback
from modelscope.hub.snapshot_download import snapshot_download

SENSEVOICE_MODEL_ID = "iic/SenseVoiceSmall"
VAD_MODEL_ID = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"
DEFAULT_SENSEVOICE_REVISION = "master"
MODEL_VERSION_FILE_NAME = "MODEL_VERSION.txt"
MODEL_DOWNLOAD_ERROR_CODE = "ASR_MODEL_DOWNLOAD_FAILED"
ARCHIVE_INVALID_ERROR_CODE = "ASR_MODEL_ARCHIVE_INVALID"

ModelDownloadEventCallback = Callable[[dict[str, object]], None]
SnapshotDownloader = Callable[..., str]


class ModelDownloadError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def validate_asr_model_cache(cache_dir: Path) -> bool:
    marker = cache_dir / MODEL_VERSION_FILE_NAME
    sensevoice_model = cache_dir / "models" / "iic" / "SenseVoiceSmall" / "model.pt"
    vad_model = (
        cache_dir
        / "models"
        / "iic"
        / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
        / "model.pt"
    )
    if not marker.is_file() or not sensevoice_model.is_file() or not vad_model.is_file():
        return False

    try:
        marker_text = marker.read_text(encoding="utf-8")
    except OSError:
        return False
    return SENSEVOICE_MODEL_ID in marker_text and VAD_MODEL_ID in marker_text


def download_asr_model_cache(
    cache_dir: Path,
    download_url: str | None = None,
    expected_sha256: str | None = None,
    revision: str | None = None,
    endpoint: str | None = None,
    snapshot_downloader: SnapshotDownloader = snapshot_download,
    progress_callback: ModelDownloadEventCallback | None = None,
) -> Path:
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    _emit(progress_callback, "started", "正在准备 SenseVoice Small 模型下载。", 0)

    if download_url:
        _download_custom_archive(
            cache_dir=cache_dir,
            download_url=download_url,
            expected_sha256=expected_sha256,
            progress_callback=progress_callback,
        )
    else:
        _download_from_modelscope(
            cache_dir=cache_dir,
            revision=revision,
            endpoint=endpoint,
            snapshot_downloader=snapshot_downloader,
            progress_callback=progress_callback,
        )

    _write_model_version(cache_dir, revision=revision)
    if not validate_asr_model_cache(cache_dir):
        raise ModelDownloadError(
            ARCHIVE_INVALID_ERROR_CODE,
            "Downloaded ASR model cache is incomplete.",
        )

    _emit(progress_callback, "completed", "SenseVoice Small 模型已下载完成。", 100)
    return cache_dir


def _download_from_modelscope(
    cache_dir: Path,
    revision: str | None,
    endpoint: str | None,
    snapshot_downloader: SnapshotDownloader,
    progress_callback: ModelDownloadEventCallback | None,
) -> None:
    sensevoice_revision = revision or DEFAULT_SENSEVOICE_REVISION
    _emit(progress_callback, "downloading", "正在从 ModelScope 下载 SenseVoice Small。", 8)
    snapshot_downloader(
        model_id=SENSEVOICE_MODEL_ID,
        revision=sensevoice_revision,
        cache_dir=cache_dir,
        endpoint=endpoint,
        progress_callbacks=[_make_modelscope_progress_callback(progress_callback, 10, 72)],
    )

    _emit(progress_callback, "downloading", "正在从 ModelScope 下载 VAD 伴随模型。", 82)
    snapshot_downloader(
        model_id=VAD_MODEL_ID,
        revision=DEFAULT_SENSEVOICE_REVISION,
        cache_dir=cache_dir,
        endpoint=endpoint,
        progress_callbacks=[_make_modelscope_progress_callback(progress_callback, 82, 14)],
    )


def _download_custom_archive(
    cache_dir: Path,
    download_url: str,
    expected_sha256: str | None,
    progress_callback: ModelDownloadEventCallback | None,
) -> None:
    with tempfile.TemporaryDirectory(prefix="frameq-asr-model-") as temp_dir_text:
        temp_dir = Path(temp_dir_text)
        archive_path = _resolve_archive(download_url, temp_dir, progress_callback)
        if expected_sha256:
            _verify_sha256(archive_path, expected_sha256)

        extract_dir = temp_dir / "extract"
        extract_dir.mkdir()
        _emit(progress_callback, "extracting", "正在解压 ASR 模型归档。", 76)
        _extract_archive_safely(archive_path, extract_dir)
        if not (extract_dir / "models" / "iic" / "SenseVoiceSmall" / "model.pt").is_file():
            raise ModelDownloadError(
                ARCHIVE_INVALID_ERROR_CODE,
                "Custom ASR archive must contain models/iic/SenseVoiceSmall/model.pt.",
            )
        if not (
            extract_dir
            / "models"
            / "iic"
            / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
            / "model.pt"
        ).is_file():
            raise ModelDownloadError(
                ARCHIVE_INVALID_ERROR_CODE,
                "Custom ASR archive must contain the SenseVoice VAD model cache.",
            )

        _copy_directory_contents(extract_dir, cache_dir)


def _resolve_archive(
    download_url: str,
    temp_dir: Path,
    progress_callback: ModelDownloadEventCallback | None,
) -> Path:
    local_path = Path(download_url)
    if local_path.is_file():
        _emit(progress_callback, "downloading", "正在读取本地 ASR 模型归档。", 20)
        return local_path

    archive_path = temp_dir / "model-archive"
    _emit(progress_callback, "downloading", "正在下载 ASR 模型归档。", 20)
    try:
        urllib.request.urlretrieve(download_url, archive_path)  # noqa: S310 - URL is release/user configured.
    except OSError as exc:
        raise ModelDownloadError(
            MODEL_DOWNLOAD_ERROR_CODE,
            f"Failed to download ASR model archive: {exc}",
        ) from exc
    return archive_path


def _verify_sha256(path: Path, expected_sha256: str) -> None:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)

    actual = digest.hexdigest().lower()
    if actual != expected_sha256.lower():
        raise ModelDownloadError(
            ARCHIVE_INVALID_ERROR_CODE,
            f"ASR model archive SHA256 mismatch: expected {expected_sha256}, got {actual}.",
        )


def _extract_archive_safely(archive_path: Path, destination: Path) -> None:
    if zipfile.is_zipfile(archive_path):
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                _ensure_safe_member_path(destination, member.filename)
                _ensure_supported_zip_member(member)
            archive.extractall(destination)
        return

    try:
        with tarfile.open(archive_path) as archive:
            for member in archive.getmembers():
                _ensure_safe_member_path(destination, member.name)
                _ensure_supported_tar_member(member)
            archive.extractall(destination)
    except tarfile.TarError as exc:
        raise ModelDownloadError(
            ARCHIVE_INVALID_ERROR_CODE,
            f"ASR model archive is not a supported zip/tar file: {exc}",
        ) from exc


def _ensure_safe_member_path(destination: Path, member_name: str) -> None:
    target = (destination / member_name).resolve()
    destination_root = destination.resolve()
    if destination_root != target and destination_root not in target.parents:
        raise ModelDownloadError(
            ARCHIVE_INVALID_ERROR_CODE,
            f"ASR model archive contains an unsafe path: {member_name}",
        )


def _ensure_supported_zip_member(member: zipfile.ZipInfo) -> None:
    mode = (member.external_attr >> 16) & 0xFFFF
    file_type = stat.S_IFMT(mode)
    if file_type in (0, stat.S_IFREG, stat.S_IFDIR):
        return

    raise ModelDownloadError(
        ARCHIVE_INVALID_ERROR_CODE,
        f"ASR model archive contains an unsupported zip member: {member.filename}",
    )


def _ensure_supported_tar_member(member: tarfile.TarInfo) -> None:
    if member.isfile() or member.isdir():
        return

    raise ModelDownloadError(
        ARCHIVE_INVALID_ERROR_CODE,
        f"ASR model archive contains an unsupported tar member: {member.name}",
    )


def _copy_directory_contents(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for source_path in source.iterdir():
        target_path = destination / source_path.name
        if source_path.is_dir():
            if target_path.exists():
                shutil.rmtree(target_path)
            shutil.copytree(source_path, target_path)
        else:
            shutil.copy2(source_path, target_path)


def _write_model_version(cache_dir: Path, revision: str | None) -> None:
    cache_dir.joinpath(MODEL_VERSION_FILE_NAME).write_text(
        "\n".join(
            [
                f"model={SENSEVOICE_MODEL_ID}",
                f"vad={VAD_MODEL_ID}",
                f"revision={revision or DEFAULT_SENSEVOICE_REVISION}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def _make_modelscope_progress_callback(
    progress_callback: ModelDownloadEventCallback | None,
    start: int,
    span: int,
) -> type[ModelScopeProgressCallback]:
    class FrameQModelScopeProgressCallback(ModelScopeProgressCallback):
        def __init__(self, filename: str, file_size: int) -> None:
            super().__init__(filename, file_size)
            self.downloaded = 0

        def update(self, size: int) -> None:
            self.downloaded += size
            if self.file_size > 0:
                file_progress = min(1.0, self.downloaded / self.file_size)
                progress = start + int(span * file_progress)
            else:
                progress = start
            _emit(
                progress_callback,
                "downloading",
                f"正在下载 {self.filename}",
                min(99, progress),
                current_file=self.filename,
            )

        def end(self) -> None:
            _emit(
                progress_callback,
                "downloading",
                f"{self.filename} 下载完成",
                min(99, start + span),
                current_file=self.filename,
            )

    return FrameQModelScopeProgressCallback


def _emit(
    callback: ModelDownloadEventCallback | None,
    status: str,
    message: str,
    progress: int,
    current_file: str | None = None,
) -> None:
    if callback is None:
        return
    event: dict[str, object] = {
        "status": status,
        "message": message,
        "progress": max(0, min(100, progress)),
    }
    if current_file:
        event["current_file"] = current_file
    callback(event)
