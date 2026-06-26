import json
from pathlib import Path

import pytest
from frameq_worker.xiaohongshu_fallback import (
    HttpResponse,
    XiaohongshuFallbackError,
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
