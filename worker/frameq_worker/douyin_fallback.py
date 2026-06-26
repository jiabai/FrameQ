from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass, field
from http.cookiejar import CookieJar
from pathlib import Path

from frameq_worker.download_reliability import SafeDownloadError, write_http_response_atomically

DOUYIN_MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"
)
PLAY_QUALITIES = ("1080p", "720p", "540p", "480p", "360p")
QUALITY_RANK = {quality: index for index, quality in enumerate(PLAY_QUALITIES)}
AWEME_ID_PATTERNS = (
    re.compile(r"[?&](?:modal_id|aweme_id)=(\d+)(?:[&#]|$)"),
    re.compile(r"(?:^|/)(?:video|note)/(\d+)(?:[/?#]|$)"),
    re.compile(r"(?:^|/)share/slides/(\d+)(?:[/?#]|$)"),
    re.compile(r"[?&]aweme_id=(\d+)(?:[&#]|$)"),
)
DOUYIN_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+")
DOUYIN_SHORT_HOSTS = {"v.douyin.com"}
CONTENT_RANGE_TOTAL_PATTERN = re.compile(r"/(\d+)\s*$")


class DouyinFallbackError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class DouyinStreamCandidate:
    quality: str
    url: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    url: str


class UrllibDouyinHttpClient:
    def __init__(self, cookie_jar: CookieJar | None = None) -> None:
        self._cookie_jar = cookie_jar or CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._cookie_jar)
        )

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse:
        request = urllib.request.Request(url, headers=headers or {}, method="GET")
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                return HttpResponse(
                    status=response.status,
                    headers=dict(response.headers.items()),
                    body=response.read(),
                    url=response.geturl(),
                )
        except urllib.error.HTTPError as exc:
            return HttpResponse(
                status=exc.code,
                headers=dict(exc.headers.items()),
                body=exc.read(),
                url=exc.geturl(),
            )
        except urllib.error.URLError as exc:
            raise DouyinFallbackError(
                "DOUYIN_SHARE_PAGE_UNAVAILABLE",
                "Douyin public share page request failed.",
            ) from exc


def extract_aweme_id(url: str) -> str | None:
    for pattern in AWEME_ID_PATTERNS:
        match = pattern.search(url)
        if match:
            return match.group(1)
    return None


def resolve_aweme_id_from_input(
    raw_input: str,
    http_client: UrllibDouyinHttpClient | None = None,
) -> str | None:
    direct_id = extract_aweme_id(raw_input)
    if direct_id:
        return direct_id

    client = http_client or UrllibDouyinHttpClient()
    for candidate_url in _extract_douyin_urls(raw_input):
        candidate_id = extract_aweme_id(candidate_url)
        if candidate_id:
            return candidate_id
        if not _is_douyin_short_link(candidate_url):
            continue
        try:
            response = client.get(
                candidate_url,
                headers=_public_headers(),
                timeout_seconds=10.0,
            )
        except DouyinFallbackError:
            continue
        resolved_id = extract_aweme_id(response.url)
        if resolved_id:
            return resolved_id
        body = response.body.decode("utf-8", errors="replace") if response.body else ""
        for embedded_url in _extract_douyin_urls(body):
            embedded_id = extract_aweme_id(embedded_url)
            if embedded_id:
                return embedded_id
    return None


def parse_share_page_router_data(html: str) -> dict[str, object]:
    marker_index = html.find("window._ROUTER_DATA")
    if marker_index < 0:
        raise DouyinFallbackError(
            "DOUYIN_ROUTER_DATA_MISSING",
            "Douyin share page did not include router data.",
        )

    equals_index = html.find("=", marker_index)
    json_start = html.find("{", equals_index)
    if equals_index < 0 or json_start < 0:
        raise DouyinFallbackError(
            "DOUYIN_ROUTER_DATA_MISSING",
            "Douyin share page router data was not parseable.",
        )

    try:
        router_data, _ = json.JSONDecoder().raw_decode(html[json_start:])
    except json.JSONDecodeError as exc:
        raise DouyinFallbackError(
            "DOUYIN_ROUTER_DATA_MALFORMED",
            "Douyin share page router data was malformed.",
        ) from exc

    video_info = _find_video_info_res(router_data)
    item_list = video_info.get("item_list") if isinstance(video_info, dict) else None
    if not isinstance(item_list, list) or not item_list or not isinstance(item_list[0], dict):
        raise DouyinFallbackError(
            "DOUYIN_ROUTER_DATA_MISSING",
            "Douyin share page did not include a playable item.",
        )
    return item_list[0]


def collect_stream_candidates(
    item: Mapping[str, object],
    http_client: UrllibDouyinHttpClient,
    timeout_seconds: float = 10.0,
) -> list[DouyinStreamCandidate]:
    video = item.get("video")
    if not isinstance(video, Mapping):
        raise DouyinFallbackError("DOUYIN_NO_PLAYABLE_STREAM", "Douyin item has no video.")

    candidates = _collect_bit_rate_candidates(video)
    if not candidates:
        candidates = _probe_play_addr_candidates(video, http_client, timeout_seconds)

    return select_stream_candidates(candidates)


def select_stream_candidates(
    candidates: list[DouyinStreamCandidate],
) -> list[DouyinStreamCandidate]:
    sorted_candidates = sorted(
        candidates,
        key=lambda candidate: (
            -candidate.size_bytes,
            QUALITY_RANK.get(candidate.quality, len(QUALITY_RANK)),
        ),
    )
    deduped: list[DouyinStreamCandidate] = []
    seen_sizes: set[int] = set()
    for candidate in sorted_candidates:
        if candidate.size_bytes <= 0 or candidate.size_bytes in seen_sizes:
            continue
        seen_sizes.add(candidate.size_bytes)
        deduped.append(candidate)
    return deduped


def download_first_available_candidate(
    aweme_id: str,
    candidates: list[DouyinStreamCandidate],
    output_dir: Path,
    http_client: UrllibDouyinHttpClient,
    timeout_seconds: float = 30.0,
    progress_callback: object | None = None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{aweme_id}.mp4"
    last_error: Exception | None = None
    sorted_candidates = select_stream_candidates(candidates)

    for index, candidate in enumerate(sorted_candidates):
        try:
            response = http_client.get(
                candidate.url,
                headers=_without_range_header(candidate.headers),
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001 - try next public stream candidate
            last_error = exc
            _emit_stream_retry(progress_callback, index, sorted_candidates)
            continue

        try:
            write_http_response_atomically(response, output_path)
        except SafeDownloadError as exc:
            last_error = exc
            _emit_stream_retry(progress_callback, index, sorted_candidates)
            continue

        return output_path

    raise DouyinFallbackError(
        "DOUYIN_STREAM_DOWNLOAD_FAILED",
        "All Douyin fallback streams failed to download.",
    ) from last_error


def download_douyin_video(
    url: str,
    output_dir: Path,
    http_client: UrllibDouyinHttpClient | None = None,
    progress_callback: object | None = None,
) -> Path:
    client = http_client or UrllibDouyinHttpClient()
    aweme_id = resolve_aweme_id_from_input(url, http_client=client)
    if aweme_id is None:
        raise DouyinFallbackError(
            "DOUYIN_ID_PARSE_FAILED",
            "Could not extract Douyin video ID from URL.",
        )

    _emit_progress(progress_callback, "正在解析公开视频分享页。", 22)
    share_response = client.get(
        build_share_page_url(aweme_id),
        headers=_public_headers(),
        timeout_seconds=10.0,
    )
    if share_response.status != 200 or not share_response.body:
        raise DouyinFallbackError(
            "DOUYIN_SHARE_PAGE_UNAVAILABLE",
            "Douyin public share page was unavailable.",
        )

    item = parse_share_page_router_data(share_response.body.decode("utf-8", errors="replace"))
    _emit_progress(progress_callback, "正在探测可用视频流。", 26)
    candidates = collect_stream_candidates(item, http_client=client)
    if not candidates:
        raise DouyinFallbackError(
            "DOUYIN_NO_PLAYABLE_STREAM",
            "Douyin public share page returned no playable streams.",
        )

    _emit_progress(progress_callback, "正在保存最高质量视频。", 30)
    return download_first_available_candidate(
        aweme_id=aweme_id,
        candidates=candidates,
        output_dir=output_dir,
        http_client=client,
        progress_callback=progress_callback,
    )


def build_share_page_url(aweme_id: str) -> str:
    return f"https://www.iesdouyin.com/share/video/{aweme_id}/?app=aweme"


def build_play_url(uri: str, quality: str) -> str:
    video_id = urllib.parse.quote(uri, safe="")
    return f"https://www.iesdouyin.com/aweme/v1/play/?video_id={video_id}&ratio={quality}&line=0"


def _find_video_info_res(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        maybe_video_info = value.get("videoInfoRes")
        if isinstance(maybe_video_info, dict):
            return maybe_video_info
        for child in value.values():
            try:
                return _find_video_info_res(child)
            except DouyinFallbackError:
                continue
    elif isinstance(value, list):
        for child in value:
            try:
                return _find_video_info_res(child)
            except DouyinFallbackError:
                continue
    raise DouyinFallbackError(
        "DOUYIN_ROUTER_DATA_MISSING",
        "Douyin share page did not include videoInfoRes.",
    )


def _collect_bit_rate_candidates(video: Mapping[str, object]) -> list[DouyinStreamCandidate]:
    bit_rates = video.get("bit_rate")
    if not isinstance(bit_rates, list):
        return []

    candidates: list[DouyinStreamCandidate] = []
    for bit_rate in bit_rates:
        if not isinstance(bit_rate, Mapping):
            continue
        play_addr = bit_rate.get("play_addr")
        if not isinstance(play_addr, Mapping):
            continue
        url = _first_url(play_addr)
        size_bytes = _parse_int(
            bit_rate.get("data_size")
            or bit_rate.get("size")
            or play_addr.get("data_size")
            or play_addr.get("size")
        )
        if not url or not size_bytes:
            continue
        quality = str(
            bit_rate.get("gear_name")
            or bit_rate.get("quality")
            or bit_rate.get("quality_type")
            or "unknown"
        )
        candidates.append(
            DouyinStreamCandidate(
                quality=quality,
                url=url,
                size_bytes=size_bytes,
                width=_parse_int(play_addr.get("width") or bit_rate.get("width")),
                height=_parse_int(play_addr.get("height") or bit_rate.get("height")),
                headers=_public_headers(),
            )
        )
    return candidates


def _probe_play_addr_candidates(
    video: Mapping[str, object],
    http_client: UrllibDouyinHttpClient,
    timeout_seconds: float,
) -> list[DouyinStreamCandidate]:
    play_addr = video.get("play_addr")
    uri = play_addr.get("uri") if isinstance(play_addr, Mapping) else None
    if not isinstance(uri, str) or not uri.strip():
        return []

    candidates: list[DouyinStreamCandidate] = []
    for quality in PLAY_QUALITIES:
        probe_url = build_play_url(uri, quality)
        probe_headers = _public_headers({"Range": "bytes=0-1"})
        try:
            response = http_client.get(
                probe_url,
                headers=probe_headers,
                timeout_seconds=timeout_seconds,
            )
        except Exception:  # noqa: BLE001 - a failed probe just removes this candidate
            continue
        size_bytes = _parse_content_range_total(_header(response.headers, "Content-Range"))
        if (
            response.status != 206
            or not size_bytes
            or not _is_media_content_type(_header(response.headers, "Content-Type"))
        ):
            continue
        candidates.append(
            DouyinStreamCandidate(
                quality=quality,
                url=response.url,
                size_bytes=size_bytes,
                headers=_public_headers(),
            )
        )
    return candidates


def _public_headers(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": DOUYIN_MOBILE_USER_AGENT,
        "Accept": "*/*",
        "Referer": "https://www.iesdouyin.com/",
    }
    if extra:
        headers.update(extra)
    return headers


def _extract_douyin_urls(raw_input: str) -> list[str]:
    urls: list[str] = []
    for match in DOUYIN_URL_PATTERN.finditer(raw_input):
        candidate = match.group(0).rstrip("，。,.、!！?？)")
        parsed = urllib.parse.urlparse(candidate)
        if _is_douyin_host(parsed.hostname or ""):
            urls.append(candidate)
    return urls


def _is_douyin_short_link(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return (parsed.hostname or "").lower() in DOUYIN_SHORT_HOSTS


def _is_douyin_host(host: str) -> bool:
    host = host.strip().lower().rstrip(".")
    return (
        host == "douyin.com"
        or host.endswith(".douyin.com")
        or host == "iesdouyin.com"
        or host.endswith(".iesdouyin.com")
    )


def _without_range_header(headers: Mapping[str, str]) -> dict[str, str]:
    return {key: value for key, value in headers.items() if key.lower() != "range"}


def _first_url(play_addr: Mapping[str, object]) -> str | None:
    url_list = play_addr.get("url_list")
    if isinstance(url_list, list):
        for url in url_list:
            if isinstance(url, str) and url:
                return url
    url = play_addr.get("url")
    return url if isinstance(url, str) and url else None


def _parse_int(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _parse_content_range_total(content_range: str | None) -> int | None:
    if not content_range:
        return None
    match = CONTENT_RANGE_TOTAL_PATTERN.search(content_range)
    if not match:
        return None
    return _parse_int(match.group(1))


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _is_media_content_type(content_type: str | None) -> bool:
    if not content_type:
        return True
    normalized = content_type.split(";", 1)[0].strip().lower()
    return normalized.startswith("video/") or normalized == "application/octet-stream"


def _emit_progress(progress_callback: object | None, message: str, progress: int) -> None:
    if not callable(progress_callback):
        return
    progress_callback(
        {
            "stage": "video_extracting",
            "message": message,
            "progress": progress,
        }
    )


def _emit_stream_retry(
    progress_callback: object | None,
    failed_index: int,
    candidates: list[DouyinStreamCandidate],
) -> None:
    if failed_index >= len(candidates) - 1:
        return
    _emit_progress(
        progress_callback,
        "最高质量视频流暂不可用，正在尝试另一个可用视频流。",
        30,
    )
