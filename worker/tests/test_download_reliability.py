from pathlib import Path

import pytest
from frameq_worker.douyin_fallback import HttpResponse
from frameq_worker.download_reliability import (
    SafeDownloadError,
    write_http_response_atomically,
    write_http_stream_atomically,
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


def test_write_http_stream_atomically_streams_chunks_to_part_file(tmp_path: Path) -> None:
    destination = tmp_path / "video.mp4"
    response = HttpResponse(
        status=200,
        headers={"Content-Type": "video/mp4", "Content-Length": "10"},
        body=b"",
        url="https://cdn.example/video.mp4",
    )

    written = write_http_stream_atomically(
        response,
        [b"stream", b" mp4"],
        destination,
        max_bytes=16,
    )

    assert written == 10
    assert destination.read_bytes() == b"stream mp4"
    assert not (tmp_path / "video.mp4.part").exists()


def test_write_http_stream_atomically_appends_valid_range_part(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "video.mp4"
    part_path = tmp_path / "video.mp4.part"
    part_path.write_bytes(b"old")
    response = HttpResponse(
        status=206,
        headers={
            "Content-Type": "video/mp4",
            "Content-Range": "bytes 3-6/7",
        },
        body=b"",
        url="https://cdn.example/video.mp4",
    )

    written = write_http_stream_atomically(
        response,
        [b"data"],
        destination,
        max_bytes=16,
        resume_from_bytes=3,
    )

    assert written == 7
    assert destination.read_bytes() == b"olddata"
    assert not part_path.exists()


def test_write_http_stream_atomically_rejects_stalled_download(tmp_path: Path) -> None:
    destination = tmp_path / "video.mp4"
    destination.write_bytes(b"existing")
    response = HttpResponse(
        status=200,
        headers={"Content-Type": "video/mp4", "Content-Length": "4"},
        body=b"",
        url="https://cdn.example/video.mp4",
    )
    ticks = iter([0.0, 5.0])

    with pytest.raises(SafeDownloadError) as exc_info:
        write_http_stream_atomically(
            response,
            [b"data"],
            destination,
            no_progress_timeout_seconds=1.0,
            monotonic=lambda: next(ticks),
        )

    assert exc_info.value.code == "DOWNLOAD_STALLED"
    assert destination.read_bytes() == b"existing"
    part_path = tmp_path / "video.mp4.part"
    assert part_path.exists()
    assert part_path.read_bytes() == b""


def test_write_http_stream_atomically_rejects_incomplete_stream(tmp_path: Path) -> None:
    destination = tmp_path / "video.mp4"
    response = HttpResponse(
        status=200,
        headers={"Content-Type": "video/mp4", "Content-Length": "10"},
        body=b"",
        url="https://cdn.example/video.mp4",
    )

    with pytest.raises(SafeDownloadError) as exc_info:
        write_http_stream_atomically(
            response,
            [b"stream"],
            destination,
        )

    assert exc_info.value.code == "DOWNLOAD_INCOMPLETE"
    assert not destination.exists()
    assert (tmp_path / "video.mp4.part").read_bytes() == b"stream"


def test_write_http_stream_atomically_accepts_undeclared_complete_stream(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "video.mp4"
    response = HttpResponse(
        status=200,
        headers={"Content-Type": "video/mp4"},
        body=b"",
        url="https://cdn.example/video.mp4",
    )

    written = write_http_stream_atomically(
        response,
        [b"chunked", b" media"],
        destination,
    )

    assert written == 13
    assert destination.read_bytes() == b"chunked media"


def test_write_http_stream_atomically_deletes_part_on_validation_failure(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "video.mp4"
    response = HttpResponse(
        status=200,
        headers={"Content-Type": "text/html", "Content-Length": "5"},
        body=b"",
        url="https://cdn.example/video.mp4",
    )

    with pytest.raises(SafeDownloadError) as exc_info:
        write_http_stream_atomically(
            response,
            [b"data"],
            destination,
        )

    assert exc_info.value.code == "DOWNLOAD_CONTENT_TYPE_INVALID"
    assert not (tmp_path / "video.mp4.part").exists()
