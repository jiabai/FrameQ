from __future__ import annotations

import errno
import io
import urllib.error
from pathlib import Path
from types import SimpleNamespace

import frameq_worker.model_download as model_download
import pytest
from frameq_worker.model_download import (
    MIN_MODEL_DOWNLOAD_FREE_BYTES,
    MODEL_DOWNLOAD_ERROR_CODE,
    ModelDownloadError,
    _download_url_to_file,
    _ensure_model_disk_space,
    _make_modelscope_progress_callback,
    _remove_stale_onnx_staging_dirs,
    download_asr_model_cache,
)

TORCH_MAGIC = b"PK\x03\x04"


class FakeResponse:
    def __init__(self, body: bytes, content_length: int | None = None) -> None:
        self._body = body
        self._offset = 0
        self.headers = (
            {"Content-Length": str(content_length)} if content_length is not None else {}
        )
        self.closed = False

    def read(self, size: int = -1) -> bytes:
        if self._offset >= len(self._body):
            return b""
        chunk = self._body[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk

    def close(self) -> None:
        self.closed = True


class FakeUrlopen:
    def __init__(self, responses: list[object]) -> None:
        self._responses = list(responses)
        self.calls = 0

    def __call__(self, url: str, timeout: int) -> object:
        self.calls += 1
        response = self._responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


def test_remove_stale_onnx_staging_dirs_cleans_leftovers(tmp_path: Path) -> None:
    stale_staging = tmp_path / ".onnx-staging-deadbeef"
    stale_backup = tmp_path / ".onnx-backup-cafebabe"
    unrelated = tmp_path / "models"
    stale_staging.mkdir()
    stale_backup.mkdir()
    unrelated.mkdir()
    (stale_staging / "model_quant.onnx").write_bytes(b"stale")
    (stale_backup / "model_quant.onnx").write_bytes(b"stale")
    (unrelated / "keep.txt").write_text("keep", encoding="utf-8")

    _remove_stale_onnx_staging_dirs(tmp_path)

    assert not stale_staging.exists()
    assert not stale_backup.exists()
    assert unrelated.exists()
    assert (unrelated / "keep.txt").read_text(encoding="utf-8") == "keep"


def test_remove_stale_onnx_staging_dirs_tolerates_files_with_matching_prefix(
    tmp_path: Path,
) -> None:
    matching_file = tmp_path / ".onnx-staging-not-a-dir"
    matching_file.write_bytes(b"file")
    _remove_stale_onnx_staging_dirs(tmp_path)
    assert matching_file.exists()


def test_ensure_model_disk_space_fails_fast_with_enospc(tmp_path: Path) -> None:
    def low_space(_path: Path) -> SimpleNamespace:
        return SimpleNamespace(free=MIN_MODEL_DOWNLOAD_FREE_BYTES - 1)

    with pytest.raises(OSError) as exc_info:
        _ensure_model_disk_space(tmp_path, disk_usage=low_space)
    assert exc_info.value.errno == errno.ENOSPC


def test_ensure_model_disk_space_passes_with_headroom(tmp_path: Path) -> None:
    def enough_space(_path: Path) -> SimpleNamespace:
        return SimpleNamespace(free=MIN_MODEL_DOWNLOAD_FREE_BYTES + 1)

    _ensure_model_disk_space(tmp_path, disk_usage=enough_space)


def test_ensure_model_disk_space_tolerates_unreadable_usage(tmp_path: Path) -> None:
    def broken_usage(_path: Path) -> object:
        raise OSError(errno.EACCES, "denied")

    _ensure_model_disk_space(tmp_path, disk_usage=broken_usage)


def test_download_url_to_file_streams_with_progress_and_closes_response(
    tmp_path: Path,
) -> None:
    body = b"archive-bytes-" * 2000
    urlopen = FakeUrlopen([FakeResponse(body, content_length=len(body))])
    destination = tmp_path / "model-archive"
    events: list[dict[str, object]] = []

    _download_url_to_file(
        "https://mirror.example/model.tar",
        destination,
        progress_callback=events.append,
        urlopen=urlopen,
    )

    assert destination.read_bytes() == body
    assert urlopen.calls == 1
    assert events[0]["message_code"] == "model.archive.downloading"
    assert events[0]["status"] == "downloading"
    assert events[-1]["progress"] == 75
    assert all(20 <= int(event["progress"]) <= 75 for event in events)


def test_download_url_to_file_retries_transient_os_errors(tmp_path: Path) -> None:
    body = b"archive-after-retry"
    urlopen = FakeUrlopen(
        [
            OSError(errno.ECONNRESET, "connection reset"),
            FakeResponse(body, content_length=len(body)),
        ]
    )
    destination = tmp_path / "model-archive"

    _download_url_to_file(
        "https://mirror.example/model.tar",
        destination,
        progress_callback=None,
        urlopen=urlopen,
    )

    assert destination.read_bytes() == body
    assert urlopen.calls == 2


def test_download_url_to_file_fails_after_exhausting_attempts(tmp_path: Path) -> None:
    urlopen = FakeUrlopen(
        [OSError(errno.ETIMEDOUT, "timed out"), OSError(errno.ETIMEDOUT, "timed out")]
    )

    with pytest.raises(OSError):
        _download_url_to_file(
            "https://mirror.example/model.tar",
            tmp_path / "model-archive",
            progress_callback=None,
            urlopen=urlopen,
            attempts=2,
        )

    assert urlopen.calls == 2


def test_download_url_to_file_enforces_size_cap(tmp_path: Path) -> None:
    body = b"x" * (1024 * 1024 + 1)
    urlopen = FakeUrlopen([FakeResponse(body, content_length=len(body))])
    destination = tmp_path / "model-archive"

    with pytest.raises(ModelDownloadError) as exc_info:
        _download_url_to_file(
            "https://mirror.example/model.tar",
            destination,
            progress_callback=None,
            urlopen=urlopen,
            max_bytes=1024 * 1024,
        )

    assert exc_info.value.code == MODEL_DOWNLOAD_ERROR_CODE
    assert not destination.exists()


def test_download_url_to_file_propagates_http_errors_without_retry(tmp_path: Path) -> None:
    urlopen = FakeUrlopen([urllib.error.HTTPError("https://x", 403, "Forbidden", {}, io.BytesIO())])

    with pytest.raises(urllib.error.HTTPError):
        _download_url_to_file(
            "https://mirror.example/model.tar",
            tmp_path / "model-archive",
            progress_callback=None,
            urlopen=urlopen,
        )

    assert urlopen.calls == 1


def test_modelscope_progress_callback_throttles_high_frequency_updates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = [0.0]

    def fake_monotonic() -> float:
        return now[0]

    monkeypatch.setattr(model_download.time, "monotonic", fake_monotonic)
    events: list[dict[str, object]] = []
    callback_type = _make_modelscope_progress_callback(events.append, 10, 50)
    callback = callback_type("model.pt", 1000)

    # First update emits immediately.
    callback.update(100)
    assert len(events) == 1

    # Rapid updates below the 1% step are suppressed.
    callback.update(1)
    callback.update(1)
    assert len(events) == 1

    # Crossing a full percent emits.
    callback.update(20)
    assert len(events) == 2

    # After the time window elapses, a small update emits again.
    now[0] = 1.0
    callback.update(1)
    assert len(events) == 3


def test_modelscope_progress_callback_end_always_emits(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[dict[str, object]] = []
    callback_type = _make_modelscope_progress_callback(events.append, 10, 50)
    callback = callback_type("model.pt", 1000)
    callback.update(10)
    callback.end()

    assert [event["message_code"] for event in events] == [
        "model.file.downloading",
        "model.file.completed",
    ]


def test_download_asr_model_cache_cleans_stale_onnx_dirs_before_downloading(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stale = tmp_path / ".onnx-staging-abc"
    stale.mkdir()
    (stale / "model_quant.onnx").write_bytes(b"stale")
    monkeypatch.setattr(model_download, "_ensure_model_disk_space", lambda _cache_dir: None)

    # An unsupported model id fails after the cleanup step, proving leftovers
    # are removed before any download work starts.
    with pytest.raises(ModelDownloadError):
        download_asr_model_cache(cache_dir=tmp_path, model_name="invalid/model")

    assert not stale.exists()
