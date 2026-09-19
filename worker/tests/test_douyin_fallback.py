from pathlib import Path

import frameq_worker.douyin_fallback as douyin_fallback
import pytest
from frameq_worker.douyin_fallback import (
    DOUYIN_MOBILE_USER_AGENT,
    PLAY_QUALITIES,
    SHARE_PAGE_ATTEMPTS,
    DouyinFallbackError,
    DouyinStreamCandidate,
    HttpResponse,
    build_play_url,
    build_share_page_url,
    collect_stream_candidates,
    download_douyin_video,
    download_first_available_candidate,
    extract_aweme_id,
    parse_share_page_router_data,
    resolve_aweme_id_from_input,
    select_stream_candidates,
)

ROOT_COMPATIBILITY_SURFACE = {
    "DOUYIN_MOBILE_USER_AGENT",
    "PLAY_QUALITIES",
    "DouyinFallbackError",
    "DouyinStreamCandidate",
    "HttpResponse",
    "UrllibDouyinHttpClient",
    "extract_aweme_id",
    "resolve_aweme_id_from_input",
    "parse_share_page_router_data",
    "collect_stream_candidates",
    "select_stream_candidates",
    "download_first_available_candidate",
    "download_douyin_video",
    "build_share_page_url",
    "build_play_url",
}


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


DEGRADED_SHARE_PAGE_HTML = """
<script>window._ROUTER_DATA = {
  "loaderData": {"video_(id)/page": {"itemId": "7653372612151692594"}}
};</script>
"""


def share_page_html(aweme_id: str, video_uri: str) -> str:
    return f"""
    <script>window._ROUTER_DATA = {{
      "loaderData": {{"video_(id)/page": {{"videoInfoRes": {{"item_list": [{{
        "aweme_id": "{aweme_id}",
        "video": {{"play_addr": {{"uri": "{video_uri}"}}}}
      }}]}}}}}}
    }};</script>
    """


def html_response(html: str) -> HttpResponse:
    return HttpResponse(200, {"Content-Type": "text/html"}, html.encode(), "share")


def degraded_share_page_responses() -> list[HttpResponse]:
    return [
        html_response(DEGRADED_SHARE_PAGE_HTML)
        for _ in range(SHARE_PAGE_ATTEMPTS)
    ]


def successful_playback_responses(video_uri: str) -> dict[str, list[HttpResponse | Exception]]:
    responses: dict[str, list[HttpResponse | Exception]] = {
        "https://cdn.example/video.mp4": [
            HttpResponse(
                200,
                {"Content-Type": "video/mp4"},
                b"video",
                "https://cdn.example/video.mp4",
            )
        ]
    }
    for quality in PLAY_QUALITIES:
        play_url = build_play_url(video_uri, quality)
        if quality == "1080p":
            responses[play_url] = [
                HttpResponse(
                    206,
                    {
                        "Content-Type": "video/mp4",
                        "Content-Range": "bytes 0-1/5000",
                    },
                    b"ok",
                    "https://cdn.example/video.mp4",
                )
            ]
        else:
            responses[play_url] = [HttpResponse(404, {}, b"", play_url)]
    return responses


def test_root_exposes_the_repository_observed_compatibility_surface() -> None:
    assert ROOT_COMPATIBILITY_SURFACE <= vars(douyin_fallback).keys()


def test_direct_aweme_id_resolution_is_network_free() -> None:
    class NoRequestClient:
        def get(self, *args: object, **kwargs: object) -> HttpResponse:
            raise AssertionError("direct aweme ID must not make an HTTP request")

    assert (
        resolve_aweme_id_from_input(
            "https://www.douyin.com/video/7653372612151692594",
            http_client=NoRequestClient(),
        )
        == "7653372612151692594"
    )


def test_extract_aweme_id_accepts_canonical_video_and_aweme_query_links() -> None:
    assert (
        extract_aweme_id("https://www.douyin.com/video/7653372612151692594?from=copy")
        == "7653372612151692594"
    )
    assert (
        extract_aweme_id("https://www.douyin.com/note/7653372612151692594")
        == "7653372612151692594"
    )
    assert (
        extract_aweme_id("https://www.douyin.com/share/slides/7653372612151692594")
        == "7653372612151692594"
    )
    assert (
        extract_aweme_id("https://www.douyin.com/note/123?modal_id=7653372612151692594")
        == "7653372612151692594"
    )


def test_resolve_aweme_id_from_input_accepts_share_text_and_short_link() -> None:
    client = FakeHttpClient(
        {
            "https://v.douyin.com/abc123/": [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "text/html"},
                    body=b"",
                    url="https://www.douyin.com/video/7653372612151692594",
                )
            ]
        }
    )

    assert (
        resolve_aweme_id_from_input(
            "复制打开抖音，看看这个视频 https://v.douyin.com/abc123/ 更多内容",
            http_client=client,
        )
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


def test_collect_stream_candidates_prefers_declared_bit_rates_without_probing() -> None:
    client = FakeHttpClient({})
    item = {
        "video": {
            "bit_rate": [
                {
                    "gear_name": "720p",
                    "data_size": 4000,
                    "play_addr": {
                        "url_list": ["https://cdn.example/720.mp4"],
                        "width": 1280,
                        "height": 720,
                    },
                },
                {
                    "gear_name": "540p",
                    "data_size": 4000,
                    "play_addr": {"url_list": ["https://cdn.example/540.mp4"]},
                },
                {
                    "gear_name": "1080p",
                    "data_size": 5000,
                    "play_addr": {"url_list": ["https://cdn.example/1080.mp4"]},
                },
            ]
        }
    }

    candidates = collect_stream_candidates(item, http_client=client)

    assert client.calls == []
    assert [(candidate.quality, candidate.size_bytes) for candidate in candidates] == [
        ("1080p", 5000),
        ("720p", 4000),
    ]
    assert candidates[1].width == 1280
    assert candidates[1].height == 720
    assert candidates[1].headers["User-Agent"] == DOUYIN_MOBILE_USER_AGENT


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
        "progress": 30,
        "message_code": "douyin.stream.retrying",
        "message_args": {"attempt": 2, "total": 2},
    } in events


def test_download_first_available_candidate_removes_probe_range_header(
    tmp_path: Path,
) -> None:
    candidate = DouyinStreamCandidate(
        "1080p",
        "https://cdn.example/1080.mp4",
        5000,
        headers={"Range": "bytes=0-1", "X-Test": "preserved"},
    )
    client = FakeHttpClient(
        {
            candidate.url: [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "video/mp4"},
                    body=b"complete media",
                    url=candidate.url,
                )
            ]
        }
    )

    result = download_first_available_candidate(
        aweme_id="7653372612151692594",
        candidates=[candidate],
        output_dir=tmp_path,
        http_client=client,
    )

    assert result.read_bytes() == b"complete media"
    assert client.calls == [(candidate.url, {"X-Test": "preserved"})]


def test_download_first_available_candidate_preserves_completed_output_when_all_fail(
    tmp_path: Path,
) -> None:
    aweme_id = "7653372612151692594"
    output_path = tmp_path / f"{aweme_id}.mp4"
    output_path.write_bytes(b"existing completed video")
    request_failure = DouyinStreamCandidate(
        "1080p",
        "https://cdn.example/request-failure.mp4",
        5000,
    )
    invalid_response = DouyinStreamCandidate(
        "720p",
        "https://cdn.example/empty-response.mp4",
        3000,
    )
    client = FakeHttpClient(
        {
            request_failure.url: [TimeoutError("timed out")],
            invalid_response.url: [
                HttpResponse(
                    status=200,
                    headers={"Content-Type": "video/mp4"},
                    body=b"",
                    url=invalid_response.url,
                )
            ],
        }
    )
    events: list[dict[str, object]] = []

    with pytest.raises(DouyinFallbackError) as exc_info:
        download_first_available_candidate(
            aweme_id=aweme_id,
            candidates=[request_failure, invalid_response],
            output_dir=tmp_path,
            http_client=client,
            progress_callback=events.append,
        )

    assert exc_info.value.code == "DOUYIN_STREAM_DOWNLOAD_FAILED"
    assert str(exc_info.value) == "All Douyin fallback streams failed to download."
    assert output_path.read_bytes() == b"existing completed video"
    assert not output_path.with_name(f"{output_path.name}.part").exists()
    assert events == [
        {
            "stage": "video_extracting",
            "progress": 30,
            "message_code": "douyin.stream.retrying",
            "message_args": {"attempt": 2, "total": 2},
        }
    ]


@pytest.mark.parametrize("with_callback", [False, True])
def test_retry_progress_never_interrupts_more_than_100_real_candidates(
    tmp_path: Path,
    with_callback: bool,
) -> None:
    candidates = [
        DouyinStreamCandidate(
            "1080p",
            f"https://cdn.example/{index}.mp4",
            10_000 - index,
        )
        for index in range(101)
    ]
    client = FakeHttpClient(
        {
            candidates[0].url: [TimeoutError("timed out")],
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

    path = download_first_available_candidate(
        aweme_id="7653372612151692594",
        candidates=candidates,
        output_dir=tmp_path,
        http_client=client,
        progress_callback=events.append if with_callback else None,
    )

    assert path.read_bytes() == b"second candidate"
    assert [call[0] for call in client.calls] == [candidates[0].url, candidates[1].url]
    assert events == []


def test_download_douyin_video_emits_closed_structured_progress(tmp_path: Path) -> None:
    aweme_id = "7653372612151692594"
    video_uri = "v0200fg10000demo"
    responses = successful_playback_responses(video_uri)
    responses[build_share_page_url(aweme_id)] = [
        html_response(share_page_html(aweme_id, video_uri))
    ]
    client = FakeHttpClient(responses)
    events: list[dict[str, object]] = []

    result = download_douyin_video(
        f"https://www.douyin.com/video/{aweme_id}",
        output_dir=tmp_path,
        http_client=client,
        progress_callback=events.append,
    )

    assert result.read_bytes() == b"video"
    assert events == [
        {
            "stage": "video_extracting",
            "progress": 22,
            "message_code": "douyin.page.resolving",
        },
        {
            "stage": "video_extracting",
            "progress": 26,
            "message_code": "douyin.stream.probing",
        },
        {
            "stage": "video_extracting",
            "progress": 30,
            "message_code": "douyin.video.saving",
        },
    ]
    assert all("message" not in event for event in events)
    assert [url for url, _headers in client.calls] == [
        build_share_page_url(aweme_id),
        *(build_play_url(video_uri, quality) for quality in PLAY_QUALITIES),
        "https://cdn.example/video.mp4",
    ]


def test_share_page_retry_recovers_from_a_degraded_page_after_a_random_delay(
    tmp_path: Path,
) -> None:
    aweme_id = "7653372612151692594"
    video_uri = "v0200fg10000demo"
    share_url = build_share_page_url(aweme_id)
    responses = successful_playback_responses(video_uri)
    responses[share_url] = [
        html_response(DEGRADED_SHARE_PAGE_HTML),
        html_response(share_page_html(aweme_id, video_uri)),
    ]
    client = FakeHttpClient(responses)
    events: list[dict[str, object]] = []
    delays: list[float] = []
    events_emitted_before_waiting: list[int] = []

    def record_sleep(seconds: float) -> None:
        delays.append(seconds)
        events_emitted_before_waiting.append(len(events))

    result = download_douyin_video(
        f"https://www.douyin.com/video/{aweme_id}",
        output_dir=tmp_path,
        http_client=client,
        progress_callback=events.append,
        sleeper=record_sleep,
    )

    assert result.read_bytes() == b"video"
    assert len(delays) == 1
    assert 3.0 <= delays[0] <= 10.0
    assert events_emitted_before_waiting == [2]
    assert [event["message_code"] for event in events] == [
        "douyin.page.resolving",
        "douyin.page.retrying",
        "douyin.stream.probing",
        "douyin.video.saving",
    ]
    assert events[1]["message_args"] == {"attempt": 2, "total": 3}
    assert [url for url, _headers in client.calls if url == share_url] == [
        share_url,
        share_url,
    ]


def test_share_page_retry_gives_up_after_the_declared_attempts(
    tmp_path: Path,
) -> None:
    aweme_id = "7653372612151692594"
    share_url = build_share_page_url(aweme_id)
    client = FakeHttpClient(
        {
            share_url: degraded_share_page_responses()
        }
    )
    events: list[dict[str, object]] = []
    delays: list[float] = []

    with pytest.raises(DouyinFallbackError) as exc_info:
        download_douyin_video(
            f"https://www.douyin.com/video/{aweme_id}",
            output_dir=tmp_path,
            http_client=client,
            progress_callback=events.append,
            sleeper=delays.append,
        )

    assert exc_info.value.code == "DOUYIN_ROUTER_DATA_MISSING"
    assert len(delays) == SHARE_PAGE_ATTEMPTS - 1
    assert all(3.0 <= delay <= 10.0 for delay in delays)
    assert [url for url, _headers in client.calls] == [share_url] * SHARE_PAGE_ATTEMPTS
    assert [
        event["message_args"]
        for event in events
        if event["message_code"] == "douyin.page.retrying"
    ] == [{"attempt": 2, "total": 3}, {"attempt": 3, "total": 3}]
    assert not (tmp_path / f"{aweme_id}.mp4").exists()


def test_share_page_retry_delay_varies_between_three_and_ten_seconds(
    tmp_path: Path,
) -> None:
    aweme_id = "7653372612151692594"
    share_url = build_share_page_url(aweme_id)
    observed: set[float] = set()

    for _ in range(25):
        client = FakeHttpClient(
            {
                share_url: degraded_share_page_responses()
            }
        )
        delays: list[float] = []
        with pytest.raises(DouyinFallbackError):
            download_douyin_video(
                f"https://www.douyin.com/video/{aweme_id}",
                output_dir=tmp_path,
                http_client=client,
                sleeper=delays.append,
            )
        assert len(delays) == SHARE_PAGE_ATTEMPTS - 1
        assert all(3.0 <= delay <= 10.0 for delay in delays)
        observed.update(delays)

    assert len(observed) > 1


def test_share_page_retry_does_not_cover_stream_failures(tmp_path: Path) -> None:
    aweme_id = "7653372612151692594"
    video_uri = "v0200fg10000demo"
    share_url = build_share_page_url(aweme_id)
    client = FakeHttpClient(
        {
            share_url: [html_response(share_page_html(aweme_id, video_uri))],
            **{
                build_play_url(video_uri, quality): [
                    HttpResponse(404, {}, b"", build_play_url(video_uri, quality))
                ]
                for quality in PLAY_QUALITIES
            },
        }
    )
    events: list[dict[str, object]] = []
    delays: list[float] = []

    with pytest.raises(DouyinFallbackError) as exc_info:
        download_douyin_video(
            f"https://www.douyin.com/video/{aweme_id}",
            output_dir=tmp_path,
            http_client=client,
            progress_callback=events.append,
            sleeper=delays.append,
        )

    assert exc_info.value.code == "DOUYIN_NO_PLAYABLE_STREAM"
    assert delays == []
    assert [url for url, _headers in client.calls].count(share_url) == 1
    assert [event["message_code"] for event in events] == [
        "douyin.page.resolving",
        "douyin.stream.probing",
    ]
