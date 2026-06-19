from __future__ import annotations

import io
import stat
import tarfile
import zipfile
from pathlib import Path

import pytest
from frameq_worker.model_download import (
    ARCHIVE_INVALID_ERROR_CODE,
    DEFAULT_SENSEVOICE_REVISION,
    SENSEVOICE_MODEL_ID,
    VAD_MODEL_ID,
    ModelDownloadError,
    download_asr_model_cache,
    validate_asr_model_cache,
)


def create_valid_cache(root: Path) -> None:
    sensevoice_dir = root / "models" / "iic" / "SenseVoiceSmall"
    vad_dir = root / "models" / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
    sensevoice_dir.mkdir(parents=True)
    vad_dir.mkdir(parents=True)
    (sensevoice_dir / "model.pt").write_bytes(b"sensevoice")
    (vad_dir / "model.pt").write_bytes(b"vad")
    (root / "MODEL_VERSION.txt").write_text(
        "model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n",
        encoding="utf-8",
    )


def test_validate_asr_model_cache_requires_marker_and_model_files(tmp_path: Path) -> None:
    assert not validate_asr_model_cache(tmp_path)

    (tmp_path / "MODEL_VERSION.txt").write_text("model=iic/SenseVoiceSmall\n", encoding="utf-8")
    assert not validate_asr_model_cache(tmp_path)

    create_valid_cache(tmp_path)
    assert validate_asr_model_cache(tmp_path)


def test_download_asr_model_cache_uses_modelscope_snapshot_download(tmp_path: Path) -> None:
    calls: list[dict[str, object]] = []
    events: list[dict[str, object]] = []

    def fake_snapshot_download(**kwargs: object) -> str:
        calls.append(kwargs)
        if kwargs["model_id"] == SENSEVOICE_MODEL_ID:
            model_dir = tmp_path / "models" / "iic" / "SenseVoiceSmall"
        else:
            model_dir = tmp_path / "models" / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
        model_dir.mkdir(parents=True, exist_ok=True)
        (model_dir / "model.pt").write_bytes(b"model")
        return str(tmp_path / "models")

    result = download_asr_model_cache(
        cache_dir=tmp_path,
        revision="v1.2.3",
        endpoint="https://modelscope.example",
        snapshot_downloader=fake_snapshot_download,
        progress_callback=events.append,
    )

    assert result == tmp_path
    assert calls == [
        {
            "model_id": SENSEVOICE_MODEL_ID,
            "revision": "v1.2.3",
            "cache_dir": tmp_path,
            "endpoint": "https://modelscope.example",
            "progress_callbacks": calls[0]["progress_callbacks"],
        },
        {
            "model_id": VAD_MODEL_ID,
            "revision": DEFAULT_SENSEVOICE_REVISION,
            "cache_dir": tmp_path,
            "endpoint": "https://modelscope.example",
            "progress_callbacks": calls[1]["progress_callbacks"],
        },
    ]
    assert validate_asr_model_cache(tmp_path)
    assert events[0]["status"] == "started"
    assert events[-1]["status"] == "completed"


def test_download_asr_model_cache_extracts_custom_archive_layout(tmp_path: Path) -> None:
    archive_root = tmp_path / "archive-root"
    create_valid_cache(archive_root)
    archive_path = tmp_path / "sensevoice-cache.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        for file_path in archive_root.rglob("*"):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(archive_root))

    target = tmp_path / "target-cache"
    result = download_asr_model_cache(
        cache_dir=target,
        download_url=str(archive_path),
        progress_callback=lambda event: None,
    )

    assert result == target
    assert validate_asr_model_cache(target)
    sensevoice_model = target / "models" / "iic" / "SenseVoiceSmall" / "model.pt"
    assert sensevoice_model.read_bytes() == b"sensevoice"


def test_download_asr_model_cache_rejects_tar_symlink_members(tmp_path: Path) -> None:
    archive_path = tmp_path / "sensevoice-cache.tar"
    with tarfile.open(archive_path, "w") as archive:
        marker = b"model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n"
        marker_info = tarfile.TarInfo("MODEL_VERSION.txt")
        marker_info.size = len(marker)
        archive.addfile(marker_info, io.BytesIO(marker))

        model_link = tarfile.TarInfo("models/iic/SenseVoiceSmall/model.pt")
        model_link.type = tarfile.SYMTYPE
        model_link.linkname = "../../outside/model.pt"
        archive.addfile(model_link)

        vad_bytes = b"vad"
        vad_info = tarfile.TarInfo(
            "models/iic/speech_fsmn_vad_zh-cn-16k-common-pytorch/model.pt"
        )
        vad_info.size = len(vad_bytes)
        archive.addfile(vad_info, io.BytesIO(vad_bytes))

    with pytest.raises(ModelDownloadError) as exc_info:
        download_asr_model_cache(cache_dir=tmp_path / "target", download_url=str(archive_path))

    assert exc_info.value.code == ARCHIVE_INVALID_ERROR_CODE
    assert "unsupported" in exc_info.value.message


def test_download_asr_model_cache_rejects_zip_symlink_members(tmp_path: Path) -> None:
    archive_path = tmp_path / "sensevoice-cache.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(
            "MODEL_VERSION.txt",
            "model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n",
        )
        symlink_info = zipfile.ZipInfo("models/iic/SenseVoiceSmall/model.pt")
        symlink_info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(symlink_info, "../../outside/model.pt")
        archive.writestr(
            "models/iic/speech_fsmn_vad_zh-cn-16k-common-pytorch/model.pt",
            b"vad",
        )

    with pytest.raises(ModelDownloadError) as exc_info:
        download_asr_model_cache(cache_dir=tmp_path / "target", download_url=str(archive_path))

    assert exc_info.value.code == ARCHIVE_INVALID_ERROR_CODE
    assert "unsupported" in exc_info.value.message
