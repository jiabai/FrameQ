from __future__ import annotations

import re
import urllib.parse
from collections.abc import Mapping

from frameq_worker.douyin.transport import public_headers
from frameq_worker.douyin.types import (
    DouyinFallbackError,
    DouyinHttpClient,
    DouyinStreamCandidate,
)

PLAY_QUALITIES = ("1080p", "720p", "540p", "480p", "360p")
QUALITY_RANK = {quality: index for index, quality in enumerate(PLAY_QUALITIES)}
CONTENT_RANGE_TOTAL_PATTERN = re.compile(r"/(\d+)\s*$")


def build_play_url(uri: str, quality: str) -> str:
    video_id = urllib.parse.quote(uri, safe="")
    return (
        "https://www.iesdouyin.com/aweme/v1/play/"
        f"?video_id={video_id}&ratio={quality}&line=0"
    )


def collect_stream_candidates(
    item: Mapping[str, object],
    http_client: DouyinHttpClient,
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


def _collect_bit_rate_candidates(
    video: Mapping[str, object],
) -> list[DouyinStreamCandidate]:
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
                headers=public_headers(),
            )
        )
    return candidates


def _probe_play_addr_candidates(
    video: Mapping[str, object],
    http_client: DouyinHttpClient,
    timeout_seconds: float,
) -> list[DouyinStreamCandidate]:
    play_addr = video.get("play_addr")
    uri = play_addr.get("uri") if isinstance(play_addr, Mapping) else None
    if not isinstance(uri, str) or not uri.strip():
        return []

    candidates: list[DouyinStreamCandidate] = []
    for quality in PLAY_QUALITIES:
        probe_url = build_play_url(uri, quality)
        probe_headers = public_headers({"Range": "bytes=0-1"})
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
                headers=public_headers(),
            )
        )
    return candidates


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
