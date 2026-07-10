import json
from pathlib import Path

import brotli
import pytest
from frameq_worker.xiaohongshu_fallback import (
    HttpResponse,
    XiaohongshuFallbackError,
    _decode_response_body,
    _page_headers,
    download_xiaohongshu_video,
    parse_video_stream_candidates,
    parse_xiaohongshu_input,
)

NOTE_ID = "0123456789abcdef01234568"


class FakeHttpClient:
    def __init__(self, responses: dict[str, list[HttpResponse | Exception]]) -> None:
        self.responses = {url: list(items) for url, items in responses.items()}
        self.calls: list[tuple[str, dict[str, str]]] = []

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse:
        self.calls.append((url, headers or {}))
        items = self.responses.get(url)
        if not items:
            raise AssertionError(f"Unexpected URL: {url}")
        item = items.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class StreamingFakeHttpClient(FakeHttpClient):
    def __init__(
        self,
        responses: dict[str, list[HttpResponse | Exception]],
        stream_bodies: dict[str, bytes],
    ) -> None:
        super().__init__(responses)
        self.stream_bodies = stream_bodies
        self.stream_calls: list[tuple[str, Path, dict[str, str]]] = []

    def download_to_path(
        self,
        url: str,
        destination: Path,
        *,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 30.0,
        max_bytes: int | None = None,
        no_progress_timeout_seconds: float | None = None,
    ) -> int:
        self.stream_calls.append((url, destination, headers or {}))
        body = self.stream_bodies.get(url)
        if body is None:
            raise AssertionError(f"Unexpected stream URL: {url}")
        destination.write_bytes(body)
        return len(body)


def wrap_initial_state(state: dict[str, object]) -> bytes:
    return (
        "<html><body><script>window.__INITIAL_STATE__ = "
        + json.dumps(state)
        + "</script></body></html>"
    ).encode()


def video_state(note_id: str = NOTE_ID) -> dict[str, object]:
    return {
        "note": {
            "noteDetailMap": {
                note_id: {
                    "note": {
                        "type": "video",
                        "title": "video-title",
                        "video": {
                            "media": {
                                "stream": {
                                    "h264": [
                                        {
                                            "qualityType": "HD",
                                            "masterUrl": "https://cdn.example/h264.mp4",
                                            "width": 1280,
                                            "height": 720,
                                            "size": 115000000,
                                            "videoCodec": "h264",
                                            "streamType": 259,
                                            "weight": 62,
                                        }
                                    ],
                                    "h265": [
                                        {
                                            "qualityType": "HD",
                                            "masterUrl": "https://cdn.example/h265.mp4",
                                            "backupUrls": ["https://cdn.example/h265-backup.mp4"],
                                            "width": 1920,
                                            "height": 1080,
                                            "size": 85000000,
                                            "videoCodec": "hevc",
                                            "streamType": 115,
                                            "weight": 70,
                                        }
                                    ],
                                }
                            }
                        },
                    }
                }
            }
        }
    }


def test_parse_xiaohongshu_input_accepts_short_link_share_text_and_xsec_token() -> None:
    client = FakeHttpClient(
        {
            "https://xhslink.com/demo": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=(
                        b'<a href="https://www.xiaohongshu.com/explore/'
                        + NOTE_ID.encode()
                        + b'?xsec_token=token123&amp;type=normal">Found</a>'
                    ),
                    url="https://xhslink.com/demo",
                )
            ]
        }
    )

    result = parse_xiaohongshu_input(
        "share text https://xhslink.com/demo more text",
        http_client=client,
    )

    assert result.note_id == NOTE_ID
    assert result.xsec_token == "token123"
    assert result.full_url.startswith("https://www.xiaohongshu.com/explore/")


def test_parse_xiaohongshu_input_accepts_3xx_location_and_https_retry() -> None:
    client = FakeHttpClient(
        {
            "http://xhslink.com/demo": [
                XiaohongshuFallbackError(
                    "XHS_PAGE_UNAVAILABLE",
                    "short link failed over http",
                )
            ],
            "https://xhslink.com/demo": [
                HttpResponse(
                    status=302,
                    headers={
                        "Location": (
                            f"//www.xiaohongshu.com/explore/{NOTE_ID}"
                            "?xsec_token=redirect-token"
                        )
                    },
                    body=b"",
                    url="https://xhslink.com/demo",
                )
            ],
        }
    )

    result = parse_xiaohongshu_input(
        "copy http://xhslink.com/demo",
        http_client=client,
    )

    assert result.note_id == NOTE_ID
    assert result.xsec_token == "redirect-token"
    assert [call[0] for call in client.calls] == [
        "http://xhslink.com/demo",
        "https://xhslink.com/demo",
    ]


def test_parse_xiaohongshu_short_link_rejects_token_only_resolved_url() -> None:
    token_value = "0123456789abcdef01234567"
    short_url = "https://xhslink.com/token-only"
    client = FakeHttpClient(
        {
            short_url: [
                HttpResponse(
                    status=302,
                    headers={
                        "Location": (
                            "https://www.xiaohongshu.com/explore"
                            f"?xsec_token={token_value}"
                        )
                    },
                    body=b"",
                    url=short_url,
                )
            ]
        }
    )

    with pytest.raises(XiaohongshuFallbackError) as exc_info:
        parse_xiaohongshu_input(short_url, http_client=client)

    assert exc_info.value.code == "XHS_ID_PARSE_FAILED"
    assert token_value not in str(exc_info.value)


def test_page_headers_request_brotli_navigation_compatibility() -> None:
    headers = _page_headers()

    assert headers["Accept-Encoding"] == "gzip, deflate, br"
    assert headers["Upgrade-Insecure-Requests"] == "1"
    assert headers["Sec-Fetch-Mode"] == "navigate"


def test_decode_response_body_supports_brotli_initial_state() -> None:
    html = wrap_initial_state(video_state())
    response = HttpResponse(
        status=200,
        headers={"Content-Encoding": "br"},
        body=brotli.compress(html),
        url=f"https://www.xiaohongshu.com/explore/{NOTE_ID}",
    )

    decoded = _decode_response_body(response)

    assert "window.__INITIAL_STATE__" in decoded
    assert NOTE_ID in decoded


def test_parse_video_stream_candidates_prefers_best_transcription_stream() -> None:
    candidates = parse_video_stream_candidates(video_state(), NOTE_ID)

    assert [candidate.quality_key for candidate in candidates] == ["hd_115", "hd_259"]
    assert candidates[0].url == "https://cdn.example/h265.mp4"
    assert candidates[0].backup_urls == ["https://cdn.example/h265-backup.mp4"]


def test_download_xiaohongshu_video_fetches_page_and_downloads_best_stream(
    tmp_path: Path,
) -> None:
    client = FakeHttpClient(
        {
            f"https://www.xiaohongshu.com/explore/{NOTE_ID}?xsec_token=token123": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=wrap_initial_state(video_state()),
                    url=f"https://www.xiaohongshu.com/explore/{NOTE_ID}?xsec_token=token123",
                )
            ],
            "https://cdn.example/h265.mp4": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "video/mp4"},
                    body=b"mp4 bytes",
                    url="https://cdn.example/h265.mp4",
                )
            ],
        }
    )

    path = download_xiaohongshu_video(
        f"https://www.xiaohongshu.com/explore/{NOTE_ID}?xsec_token=token123",
        output_dir=tmp_path,
        http_client=client,
    )

    assert path == tmp_path / f"{NOTE_ID}.mp4"
    assert path.read_bytes() == b"mp4 bytes"
    assert [call[0] for call in client.calls] == [
        f"https://www.xiaohongshu.com/explore/{NOTE_ID}?xsec_token=token123",
        "https://cdn.example/h265.mp4",
    ]


def test_download_xiaohongshu_video_uses_streaming_download_when_available(
    tmp_path: Path,
) -> None:
    client = StreamingFakeHttpClient(
        responses={
            f"https://www.xiaohongshu.com/explore/{NOTE_ID}": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=wrap_initial_state(video_state()),
                    url=f"https://www.xiaohongshu.com/explore/{NOTE_ID}",
                )
            ]
        },
        stream_bodies={"https://cdn.example/h265.mp4": b"streamed mp4"},
    )

    path = download_xiaohongshu_video(NOTE_ID, output_dir=tmp_path, http_client=client)

    assert path.read_bytes() == b"streamed mp4"
    assert len(client.stream_calls) == 1
    stream_url, destination, headers = client.stream_calls[0]
    assert stream_url == "https://cdn.example/h265.mp4"
    assert destination == tmp_path / f"{NOTE_ID}.mp4"
    assert headers["Referer"] == "https://www.xiaohongshu.com/"
    assert headers["Accept"] == "*/*"


def test_download_xiaohongshu_video_retries_backup_stream(tmp_path: Path) -> None:
    client = FakeHttpClient(
        {
            f"https://www.xiaohongshu.com/explore/{NOTE_ID}": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=wrap_initial_state(video_state()),
                    url=f"https://www.xiaohongshu.com/explore/{NOTE_ID}",
                )
            ],
            "https://cdn.example/h265.mp4": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=b"<html>blocked</html>",
                    url="https://cdn.example/h265.mp4",
                )
            ],
            "https://cdn.example/h265-backup.mp4": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "video/mp4"},
                    body=b"backup mp4",
                    url="https://cdn.example/h265-backup.mp4",
                )
            ],
        }
    )

    path = download_xiaohongshu_video(NOTE_ID, output_dir=tmp_path, http_client=client)

    assert path.read_bytes() == b"backup mp4"


def test_download_xiaohongshu_video_rejects_image_only_note(tmp_path: Path) -> None:
    state = {
        "note": {
            "noteDetailMap": {
                NOTE_ID: {
                    "note": {
                        "type": "image",
                        "title": "album",
                        "imageList": [{"urlDefault": "https://cdn.example/image.jpg"}],
                    }
                }
            }
        }
    }
    client = FakeHttpClient(
        {
            f"https://www.xiaohongshu.com/explore/{NOTE_ID}": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=wrap_initial_state(state),
                    url=f"https://www.xiaohongshu.com/explore/{NOTE_ID}",
                )
            ]
        }
    )

    with pytest.raises(XiaohongshuFallbackError) as exc_info:
        download_xiaohongshu_video(NOTE_ID, output_dir=tmp_path, http_client=client)

    assert exc_info.value.code == "XHS_IMAGE_ONLY"
