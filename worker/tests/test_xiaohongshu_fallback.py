import gzip
import json
import zlib
from pathlib import Path

import brotli
import pytest
from frameq_worker import xiaohongshu_fallback
from frameq_worker.download_reliability import SafeDownloadError
from frameq_worker.xiaohongshu import source as private_source
from frameq_worker.xiaohongshu import transport as private_transport
from frameq_worker.xiaohongshu import types as private_types
from frameq_worker.xiaohongshu_fallback import (
    HttpResponse,
    XiaohongshuFallbackError,
    XiaohongshuStreamCandidate,
    _decode_response_body,
    _download_first_available_stream,
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
    assert candidates[0].headers == {
        "User-Agent": xiaohongshu_fallback.XHS_DESKTOP_USER_AGENT,
        "Referer": xiaohongshu_fallback.XHS_REFERER,
        "Accept": "*/*",
    }


def test_download_xiaohongshu_video_fetches_page_and_downloads_best_stream(
    tmp_path: Path,
) -> None:
    events: list[dict[str, object]] = []
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
        progress_callback=events.append,
    )

    assert path == tmp_path / f"{NOTE_ID}.mp4"
    assert path.read_bytes() == b"mp4 bytes"
    assert [call[0] for call in client.calls] == [
        f"https://www.xiaohongshu.com/explore/{NOTE_ID}?xsec_token=token123",
        "https://cdn.example/h265.mp4",
    ]
    assert events == [
        {
            "stage": "video_extracting",
            "progress": 22,
            "message_code": "xiaohongshu.page.resolving",
        },
        {
            "stage": "video_extracting",
            "progress": 30,
            "message_code": "xiaohongshu.video.saving",
        },
    ]
    assert all("message" not in event for event in events)


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


def test_download_xiaohongshu_video_emits_one_based_candidate_retry(
    tmp_path: Path,
) -> None:
    page_url = f"https://www.xiaohongshu.com/explore/{NOTE_ID}"
    blocked = lambda url: HttpResponse(  # noqa: E731 - compact fake response factory
        status=200,
        headers={"Content-Type": "text/html"},
        body=b"<html>blocked</html>",
        url=url,
    )
    client = FakeHttpClient(
        {
            page_url: [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=wrap_initial_state(video_state()),
                    url=page_url,
                )
            ],
            "https://cdn.example/h265.mp4": [
                blocked("https://cdn.example/h265.mp4")
            ],
            "https://cdn.example/h265-backup.mp4": [
                blocked("https://cdn.example/h265-backup.mp4")
            ],
            "https://cdn.example/h264.mp4": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "video/mp4"},
                    body=b"fallback candidate",
                    url="https://cdn.example/h264.mp4",
                )
            ],
        }
    )
    events: list[dict[str, object]] = []

    path = download_xiaohongshu_video(
        NOTE_ID,
        output_dir=tmp_path,
        http_client=client,
        progress_callback=events.append,
    )

    assert path.read_bytes() == b"fallback candidate"
    assert events[-1] == {
        "stage": "video_extracting",
        "progress": 30,
        "message_code": "xiaohongshu.stream.retrying",
        "message_args": {"attempt": 2, "total": 2},
    }


@pytest.mark.parametrize("with_callback", [False, True])
def test_xiaohongshu_retry_progress_does_not_interrupt_more_than_100_candidates(
    tmp_path: Path,
    with_callback: bool,
) -> None:
    candidates = [
        XiaohongshuStreamCandidate(
            quality_key=f"quality-{index}",
            url=f"https://cdn.example/{index}.mp4",
            size_bytes=10_000 - index,
        )
        for index in range(101)
    ]
    client = FakeHttpClient(
        {
            candidates[0].url: [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=b"<html>blocked</html>",
                    url=candidates[0].url,
                )
            ],
            candidates[1].url: [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "video/mp4"},
                    body=b"second candidate",
                    url=candidates[1].url,
                )
            ],
        }
    )
    events: list[dict[str, object]] = []
    output_path = tmp_path / "video.mp4"

    result = _download_first_available_stream(
        candidates,
        output_path=output_path,
        http_client=client,
        progress_callback=events.append if with_callback else None,
    )

    assert result.read_bytes() == b"second candidate"
    assert [call[0] for call in client.calls] == [candidates[0].url, candidates[1].url]
    assert events == []


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


def test_xiaohongshu_root_compatibility_surface_is_stable() -> None:
    expected = {
        "XiaohongshuFallbackError",
        "HttpResponse",
        "XiaohongshuParseResult",
        "XiaohongshuStreamCandidate",
        "UrllibXiaohongshuHttpClient",
        "XHS_DESKTOP_USER_AGENT",
        "XHS_REFERER",
        "parse_xiaohongshu_input",
        "build_explore_url",
        "parse_video_stream_candidates",
        "download_xiaohongshu_video",
        "_decode_response_body",
        "_download_first_available_stream",
        "_page_headers",
        "_raise_for_page_response",
    }

    assert expected <= set(dir(xiaohongshu_fallback))


def test_root_reexports_shared_xiaohongshu_type_identities() -> None:
    assert (
        xiaohongshu_fallback.XiaohongshuFallbackError
        is private_types.XiaohongshuFallbackError
    )
    assert xiaohongshu_fallback.HttpResponse is private_types.HttpResponse
    assert (
        xiaohongshu_fallback.XiaohongshuParseResult
        is private_types.XiaohongshuParseResult
    )
    assert (
        xiaohongshu_fallback.XiaohongshuStreamCandidate
        is private_types.XiaohongshuStreamCandidate
    )
    assert (
        xiaohongshu_fallback.UrllibXiaohongshuHttpClient
        is private_transport.UrllibXiaohongshuHttpClient
    )
    assert xiaohongshu_fallback.build_explore_url is private_source.build_explore_url


def test_direct_note_id_does_not_construct_http_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedClient:
        def __init__(self) -> None:
            raise AssertionError("direct note ID must not construct a client")

    monkeypatch.setattr(
        xiaohongshu_fallback,
        "UrllibXiaohongshuHttpClient",
        UnexpectedClient,
    )

    assert xiaohongshu_fallback.parse_xiaohongshu_input(NOTE_ID).note_id == NOTE_ID


@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (404, b"x", "XHS_NOTE_NOT_FOUND"),
        (401, b"x", "XHS_NOTE_BLOCKED"),
        (403, b"x", "XHS_NOTE_BLOCKED"),
        (429, b"x", "XHS_RATE_LIMITED"),
        (500, b"x", "XHS_PAGE_UNAVAILABLE"),
        (200, b"", "XHS_PAGE_UNAVAILABLE"),
    ],
)
def test_page_status_mapping_is_fixed(status: int, body: bytes, code: str) -> None:
    response = HttpResponse(
        status=status,
        headers={},
        body=body,
        url="https://example.invalid/private?xsec_token=secret",
    )

    with pytest.raises(XiaohongshuFallbackError) as exc_info:
        xiaohongshu_fallback._raise_for_page_response(response)

    assert exc_info.value.code == code
    assert "example.invalid" not in str(exc_info.value)
    assert "secret" not in str(exc_info.value)


def _raw_deflate(payload: bytes) -> bytes:
    compressor = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    return compressor.compress(payload) + compressor.flush()


@pytest.mark.parametrize(
    ("encoding", "encoded"),
    [
        ("gzip", gzip.compress(b"decoded")),
        ("br", brotli.compress(b"decoded")),
        ("deflate", zlib.compress(b"decoded")),
        ("deflate", _raw_deflate(b"decoded")),
    ],
)
def test_decode_response_body_preserves_supported_compression(
    encoding: str,
    encoded: bytes,
) -> None:
    response = HttpResponse(
        status=200,
        headers={"Content-Encoding": encoding},
        body=encoded,
        url="https://example.invalid/page",
    )

    assert _decode_response_body(response) == "decoded"


@pytest.mark.parametrize(
    ("headers", "body", "expected_code"),
    [
        ({"Content-Encoding": "gzip"}, b"not-gzip", "XHS_RESPONSE_DECODE_FAILED"),
        ({}, b"12345", "XHS_RESPONSE_TOO_LARGE"),
        ({"Content-Encoding": "gzip"}, gzip.compress(b"12345"), "XHS_RESPONSE_TOO_LARGE"),
    ],
)
def test_decode_response_body_uses_fixed_safe_failures(
    headers: dict[str, str],
    body: bytes,
    expected_code: str,
) -> None:
    response = HttpResponse(
        status=200,
        headers=headers,
        body=body,
        url="https://example.invalid/page?xsec_token=secret",
    )

    with pytest.raises(XiaohongshuFallbackError) as exc_info:
        _decode_response_body(response, max_bytes=4)

    assert exc_info.value.code == expected_code
    assert "example.invalid" not in str(exc_info.value)
    assert "secret" not in str(exc_info.value)


def test_initial_state_conversion_preserves_supported_javascript_values() -> None:
    state = xiaohongshu_fallback._extract_initial_state(
        '<script>window.__INITIAL_STATE__ = {"missing": undefined, '
        '"alsoMissing": void 0,}</script>'
    )

    assert state == {"missing": None, "alsoMissing": None}


def test_initial_state_maps_public_page_block_marker() -> None:
    with pytest.raises(XiaohongshuFallbackError) as exc_info:
        xiaohongshu_fallback._extract_initial_state("当前笔记暂时无法浏览")

    assert exc_info.value.code == "XHS_NOTE_BLOCKED"


def test_failed_nested_stream_attempts_preserve_existing_output(
    tmp_path: Path,
) -> None:
    candidates = [
        XiaohongshuStreamCandidate(
            quality_key="primary",
            url="https://cdn.example/primary.mp4",
            backup_urls=["https://cdn.example/backup.mp4"],
            size_bytes=10,
        ),
        XiaohongshuStreamCandidate(
            quality_key="secondary",
            url="https://cdn.example/secondary.mp4",
            size_bytes=9,
        ),
    ]
    responses = {
        url: [
            HttpResponse(
                status=200,
                headers={"Content-Type": "text/html"},
                body=b"blocked",
                url=url,
            )
        ]
        for url in (
            "https://cdn.example/primary.mp4",
            "https://cdn.example/backup.mp4",
            "https://cdn.example/secondary.mp4",
        )
    }
    client = FakeHttpClient(responses)
    output_path = tmp_path / "video.mp4"
    output_path.write_bytes(b"previous mp4")

    with pytest.raises(XiaohongshuFallbackError) as exc_info:
        _download_first_available_stream(
            candidates,
            output_path=output_path,
            http_client=client,
        )

    assert [url for url, _headers in client.calls] == [
        "https://cdn.example/primary.mp4",
        "https://cdn.example/backup.mp4",
        "https://cdn.example/secondary.mp4",
    ]
    assert output_path.read_bytes() == b"previous mp4"
    assert not output_path.with_name(f"{output_path.name}.part").exists()
    assert exc_info.value.code == "XHS_STREAM_DOWNLOAD_FAILED"


def test_invalid_resume_response_restarts_without_range(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "video.mp4"
    part_path = destination.with_name(f"{destination.name}.part")
    part_path.write_bytes(b"partial")
    calls: list[tuple[dict[str, str], int, bool]] = []
    client = xiaohongshu_fallback.UrllibXiaohongshuHttpClient()

    def fake_download_request(
        url: str,
        path: Path,
        *,
        headers: dict[str, str],
        timeout_seconds: float,
        max_bytes: int | None,
        no_progress_timeout_seconds: float | None,
        resume_from_bytes: int,
    ) -> int:
        del url, timeout_seconds, max_bytes, no_progress_timeout_seconds
        calls.append((dict(headers), resume_from_bytes, part_path.exists()))
        if len(calls) == 1:
            raise SafeDownloadError(
                "DOWNLOAD_CONTENT_RANGE_INVALID",
                "invalid range",
            )
        path.write_bytes(b"fresh")
        return 5

    monkeypatch.setattr(client, "_download_request_to_path", fake_download_request)

    written = client.download_to_path(
        "https://cdn.example/video.mp4",
        destination,
        headers={"Referer": "https://www.xiaohongshu.com/"},
    )

    assert written == 5
    assert destination.read_bytes() == b"fresh"
    assert calls == [
        (
            {
                "Referer": "https://www.xiaohongshu.com/",
                "Range": "bytes=7-",
            },
            7,
            True,
        ),
        (
            {"Referer": "https://www.xiaohongshu.com/"},
            0,
            False,
        ),
    ]
