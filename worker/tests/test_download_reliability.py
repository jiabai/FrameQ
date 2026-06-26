from pathlib import Path

import pytest
from frameq_worker.douyin_fallback import HttpResponse
from frameq_worker.download_reliability import (
    SafeDownloadError,
    write_http_response_atomically,
)


def test_write_http_response_atomically_promotes_part_file(tmp_path: Path) -> None:
    destination = tmp_path / "video.mp4"
    response = HttpResponse(
        status=206,
        headers={"Content-Range": "bytes 0-3/4", "Content-Type": "video/mp4"},
        body=b"data",
        url="https://cdn.example/video.mp4",
    )

    written = write_http_response_atomically(response, destination)

    assert written == 4
    assert destination.read_bytes() == b"data"
    assert not (tmp_path / "video.mp4.part").exists()


def test_write_http_response_atomically_preserves_existing_file_on_failure(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "video.mp4"
    destination.write_bytes(b"existing")
    response = HttpResponse(
        status=200,
        headers={"Content-Type": "text/html", "Content-Length": "12"},
        body=b"<html></html>",
        url="https://cdn.example/error",
    )

    with pytest.raises(SafeDownloadError) as exc_info:
        write_http_response_atomically(response, destination)

    assert exc_info.value.code == "DOWNLOAD_CONTENT_TYPE_INVALID"
    assert destination.read_bytes() == b"existing"
    assert not (tmp_path / "video.mp4.part").exists()


def test_write_http_response_atomically_rejects_partial_response_without_total(
    tmp_path: Path,
) -> None:
    response = HttpResponse(
        status=206,
        headers={"Content-Type": "video/mp4"},
        body=b"data",
        url="https://cdn.example/video.mp4",
    )

    with pytest.raises(SafeDownloadError) as exc_info:
        write_http_response_atomically(response, tmp_path / "video.mp4")

    assert exc_info.value.code == "DOWNLOAD_CONTENT_RANGE_INVALID"


def test_write_http_response_atomically_rejects_oversized_response(tmp_path: Path) -> None:
    response = HttpResponse(
        status=200,
        headers={"Content-Type": "video/mp4", "Content-Length": "5"},
        body=b"12345",
        url="https://cdn.example/video.mp4",
    )

    with pytest.raises(SafeDownloadError) as exc_info:
        write_http_response_atomically(response, tmp_path / "video.mp4", max_bytes=4)

    assert exc_info.value.code == "DOWNLOAD_SIZE_EXCEEDED"
    assert not (tmp_path / "video.mp4").exists()
