from pathlib import Path

import pytest
from frameq_worker.douyin_fallback import (
    DOUYIN_MOBILE_USER_AGENT,
    DouyinFallbackError,
    DouyinStreamCandidate,
    HttpResponse,
    collect_stream_candidates,
    download_first_available_candidate,
    extract_aweme_id,
    parse_share_page_router_data,
    select_stream_candidates,
)


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


def test_extract_aweme_id_accepts_canonical_video_and_aweme_query_links() -> None:
    assert (
        extract_aweme_id("https://www.douyin.com/video/7653372612151692594?from=copy")
        == "7653372612151692594"
    )
    assert (
        extract_aweme_id("https://www.iesdouyin.com/share/video/7653372612151692594/?app=aweme")
        == "7653372612151692594"
    )
    assert (
        extract_aweme_id("https://www.douyin.com/?aweme_id=7653372612151692594")
        == "7653372612151692594"
    )


def test_parse_share_page_router_data_returns_first_video_info_item() -> None:
    html = """
    <html><script>
      window._ROUTER_DATA = {
        "loaderData": {
          "video_(id)/page": {
            "videoInfoRes": {
              "item_list": [
                {
                  "aweme_id": "7653372612151692594",
                  "video": {"play_addr": {"uri": "v0200fg10000demo"}}
                }
              ]
            }
          }
        }
      };
    </script></html>
    """

    item = parse_share_page_router_data(html)

    assert item["aweme_id"] == "7653372612151692594"
    assert item["video"]["play_addr"]["uri"] == "v0200fg10000demo"


def test_parse_share_page_router_data_rejects_missing_router_data() -> None:
    with pytest.raises(DouyinFallbackError) as exc_info:
        parse_share_page_router_data("<html></html>")

    assert exc_info.value.code == "DOUYIN_ROUTER_DATA_MISSING"


def test_parse_share_page_router_data_rejects_malformed_router_data() -> None:
    with pytest.raises(DouyinFallbackError) as exc_info:
        parse_share_page_router_data("<script>window._ROUTER_DATA = {broken;</script>")

    assert exc_info.value.code == "DOUYIN_ROUTER_DATA_MALFORMED"


def test_collect_stream_candidates_probes_play_addr_uri_and_dedupes_sizes() -> None:
    item = {"video": {"play_addr": {"uri": "v0200fg10000demo"}}}
    responses = {
        "https://www.iesdouyin.com/aweme/v1/play/?video_id=v0200fg10000demo&ratio=1080p&line=0": [
            HttpResponse(
                status=206,
                headers={"Content-Range": "bytes 0-1/5000", "Content-Type": "video/mp4"},
                body=b"ok",
                url="https://cdn.example/video-1080.mp4",
            )
        ],
        "https://www.iesdouyin.com/aweme/v1/play/?video_id=v0200fg10000demo&ratio=720p&line=0": [
            HttpResponse(
                status=206,
                headers={"Content-Range": "bytes 0-1/3000", "Content-Type": "video/mp4"},
                body=b"ok",
                url="https://cdn.example/video-720.mp4",
            )
        ],
        "https://www.iesdouyin.com/aweme/v1/play/?video_id=v0200fg10000demo&ratio=540p&line=0": [
            HttpResponse(
                status=206,
                headers={"Content-Range": "bytes 0-1/3000", "Content-Type": "video/mp4"},
                body=b"ok",
                url="https://cdn.example/video-540.mp4",
            )
        ],
        "https://www.iesdouyin.com/aweme/v1/play/?video_id=v0200fg10000demo&ratio=480p&line=0": [
            HttpResponse(status=200, headers={}, body=b"", url="https://cdn.example/invalid")
        ],
        "https://www.iesdouyin.com/aweme/v1/play/?video_id=v0200fg10000demo&ratio=360p&line=0": [
            HttpResponse(
                status=206,
                headers={"Content-Range": "bytes 0-1/1000", "Content-Type": "text/html"},
                body=b"",
                url="https://cdn.example/html",
            )
        ],
    }
    client = FakeHttpClient(responses)

    candidates = collect_stream_candidates(item, http_client=client)

    assert [(candidate.quality, candidate.size_bytes) for candidate in candidates] == [
        ("1080p", 5000),
        ("720p", 3000),
    ]
    assert client.calls[0][1]["User-Agent"] == DOUYIN_MOBILE_USER_AGENT
    assert client.calls[0][1]["Range"] == "bytes=0-1"


def test_select_stream_candidates_prefers_largest_size_then_quality_rank() -> None:
    selected = select_stream_candidates(
        [
            DouyinStreamCandidate("540p", "https://cdn.example/540.mp4", 4000),
            DouyinStreamCandidate("720p", "https://cdn.example/720.mp4", 4000),
            DouyinStreamCandidate("1080p", "https://cdn.example/1080.mp4", 3000),
        ]
    )

    assert [candidate.quality for candidate in selected] == ["720p", "1080p"]


def test_download_first_available_candidate_retries_next_stream_on_failure(
    tmp_path: Path,
) -> None:
    first = DouyinStreamCandidate("1080p", "https://cdn.example/1080.mp4", 5000)
    second = DouyinStreamCandidate("720p", "https://cdn.example/720.mp4", 3000)
    client = FakeHttpClient(
        {
            first.url: [TimeoutError("timed out")],
            second.url: [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "video/mp4"},
                    body=b"mp4 bytes",
                    url=second.url,
                )
            ],
        }
    )
    events: list[dict[str, object]] = []

    path = download_first_available_candidate(
        aweme_id="7653372612151692594",
        candidates=[first, second],
        output_dir=tmp_path,
        http_client=client,
        progress_callback=events.append,
    )

    assert path == tmp_path / "7653372612151692594.mp4"
    assert path.read_bytes() == b"mp4 bytes"
    assert [call[0] for call in client.calls] == [first.url, second.url]
    assert {
        "stage": "video_extracting",
        "message": "最高质量视频流暂不可用，正在尝试另一个可用视频流。",
        "progress": 30,
    } in events
