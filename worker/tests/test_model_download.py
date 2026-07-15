from __future__ import annotations

import io
import stat
import tarfile
import zipfile
from pathlib import Path

import frameq_worker.model_download as model_download
import pytest
from frameq_worker.model_download import (
    ARCHIVE_INVALID_ERROR_CODE,
    DEFAULT_SENSEVOICE_REVISION,
    SENSEVOICE_MODEL_ID,
    VAD_MODEL_ID,
    ModelDownloadError,
    download_asr_model_cache,
    normalize_asr_model_cache_layout,
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


def create_valid_legacy_cache(root: Path) -> None:
    sensevoice_dir = root / "iic" / "SenseVoiceSmall"
    vad_dir = root / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
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


def test_validate_asr_model_cache_accepts_modelscope_snapshot_layout(tmp_path: Path) -> None:
    create_valid_legacy_cache(tmp_path)

    assert validate_asr_model_cache(tmp_path)


def test_download_asr_model_cache_uses_modelscope_snapshot_download(tmp_path: Path) -> None:
    calls: list[dict[str, object]] = []
    events: list[dict[str, object]] = []

    def fake_snapshot_download(**kwargs: object) -> str:
        calls.append(kwargs)
        if kwargs["model_id"] == SENSEVOICE_MODEL_ID:
            model_dir = Path(kwargs["cache_dir"]) / "iic" / "SenseVoiceSmall"
        else:
            model_dir = (
                Path(kwargs["cache_dir"])
                / "iic"
                / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
            )
        model_dir.mkdir(parents=True, exist_ok=True)
        (model_dir / "model.pt").write_bytes(b"model")
        callback_type = kwargs["progress_callbacks"][0]
        filename = (
            r"C:\review-secret\model.pt"
            if kwargs["model_id"] == SENSEVOICE_MODEL_ID
            else "secret=review-secret.bin"
        )
        callback = callback_type(filename, 10)
        callback.update(5)
        callback.end()
        return str(kwargs["cache_dir"])

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
            "cache_dir": tmp_path / "models",
            "endpoint": "https://modelscope.example",
            "progress_callbacks": calls[0]["progress_callbacks"],
        },
        {
            "model_id": VAD_MODEL_ID,
            "revision": DEFAULT_SENSEVOICE_REVISION,
            "cache_dir": tmp_path / "models",
            "endpoint": "https://modelscope.example",
            "progress_callbacks": calls[1]["progress_callbacks"],
        },
    ]
    assert validate_asr_model_cache(tmp_path)
    assert not (tmp_path / "iic" / "SenseVoiceSmall").exists()
    assert not (tmp_path / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch").exists()
    assert [event["message_code"] for event in events] == [
        "model.download.preparing",
        "model.primary.downloading",
        "model.file.downloading",
        "model.file.completed",
        "model.vad.downloading",
        "model.file.downloading",
        "model.file.completed",
        "model.download.completed",
    ]
    assert events[0] == {
        "status": "started",
        "progress": 0,
        "message_code": "model.download.preparing",
        "message_args": {"model": SENSEVOICE_MODEL_ID},
    }
    assert events[-1] == {
        "status": "completed",
        "progress": 100,
        "message_code": "model.download.completed",
        "message_args": {"model": SENSEVOICE_MODEL_ID},
    }
    assert [
        event["current_file"] for event in events if "current_file" in event
    ] == ["model.pt", "model.pt", "model-file", "model-file"]
    assert all("message" not in event for event in events)
    assert "review-secret" not in repr(events)


def test_normalize_asr_model_cache_layout_migrates_legacy_only_cache(
    tmp_path: Path,
) -> None:
    create_valid_legacy_cache(tmp_path)

    normalize_asr_model_cache_layout(tmp_path)

    assert (tmp_path / "MODEL_VERSION.txt").is_file()
    assert validate_asr_model_cache(tmp_path)
    assert (tmp_path / "models" / "iic" / "SenseVoiceSmall" / "model.pt").is_file()
    assert (
        tmp_path
        / "models"
        / "iic"
        / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
        / "model.pt"
    ).is_file()
    assert not (tmp_path / "iic" / "SenseVoiceSmall").exists()
    assert not (tmp_path / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch").exists()


def test_normalize_asr_model_cache_layout_removes_duplicate_known_legacy_dirs(
    tmp_path: Path,
) -> None:
    create_valid_cache(tmp_path)
    legacy_sensevoice = tmp_path / "iic" / "SenseVoiceSmall"
    legacy_vad = tmp_path / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
    unknown_legacy = tmp_path / "iic" / "custom-model"
    legacy_sensevoice.mkdir(parents=True)
    legacy_vad.mkdir(parents=True)
    unknown_legacy.mkdir(parents=True)
    (legacy_sensevoice / "model.pt").write_bytes(b"duplicate-sensevoice")
    (legacy_vad / "model.pt").write_bytes(b"duplicate-vad")
    (unknown_legacy / "model.pt").write_bytes(b"keep-me")
    stale_temp = tmp_path / "._____temp"
    stale_temp.mkdir()
    (stale_temp / "partial.bin").write_bytes(b"not-a-model")

    normalize_asr_model_cache_layout(tmp_path)

    assert validate_asr_model_cache(tmp_path)
    assert not legacy_sensevoice.exists()
    assert not legacy_vad.exists()
    assert (unknown_legacy / "model.pt").read_bytes() == b"keep-me"
    assert not stale_temp.exists()


def test_download_asr_model_cache_extracts_custom_archive_layout(tmp_path: Path) -> None:
    archive_root = tmp_path / "archive-root"
    create_valid_cache(archive_root)
    archive_path = tmp_path / "sensevoice-cache.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        for file_path in archive_root.rglob("*"):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(archive_root))

    target = tmp_path / "target-cache"
    events: list[dict[str, object]] = []
    result = download_asr_model_cache(
        cache_dir=target,
        download_url=str(archive_path),
        progress_callback=events.append,
    )

    assert result == target
    assert validate_asr_model_cache(target)
    sensevoice_model = target / "models" / "iic" / "SenseVoiceSmall" / "model.pt"
    assert sensevoice_model.read_bytes() == b"sensevoice"
    assert [event["message_code"] for event in events] == [
        "model.download.preparing",
        "model.archive.reading",
        "model.archive.extracting",
        "model.download.completed",
    ]
    assert all("message" not in event for event in events)


def test_download_asr_model_cache_emits_remote_archive_code_without_url(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive_root = tmp_path / "archive-root"
    create_valid_cache(archive_root)
    archive_path = tmp_path / "sensevoice-cache.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        for file_path in archive_root.rglob("*"):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(archive_root))

    def fake_urlretrieve(url: str, destination: Path) -> tuple[str, None]:
        assert url == "https://models.example/cache.zip?token=review-secret"
        Path(destination).write_bytes(archive_path.read_bytes())
        return str(destination), None

    monkeypatch.setattr(model_download.urllib.request, "urlretrieve", fake_urlretrieve)
    events: list[dict[str, object]] = []

    download_asr_model_cache(
        cache_dir=tmp_path / "target-cache",
        download_url="https://models.example/cache.zip?token=review-secret",
        progress_callback=events.append,
    )

    assert [event["message_code"] for event in events] == [
        "model.download.preparing",
        "model.archive.downloading",
        "model.archive.extracting",
        "model.download.completed",
    ]
    assert "review-secret" not in repr(events)


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


def test_model_emit_without_callback_returns_before_event_validation() -> None:
    model_download._emit(
        None,
        "not.a.registered-code",
        "not-a-status",
        -1,
        current_file="C:unsafe.pt",
    )


def test_modelscope_callback_without_consumer_skips_filename_sanitizing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_sanitized(filename: object) -> str:
        raise AssertionError(f"must not sanitize without a consumer: {filename!r}")

    monkeypatch.setattr(model_download, "safe_current_file_basename", fail_if_sanitized)
    callback_type = model_download._make_modelscope_progress_callback(None, 10, 72)
    callback = callback_type("malformed-model-name", 10)

    callback.update(5)
    callback.end()
