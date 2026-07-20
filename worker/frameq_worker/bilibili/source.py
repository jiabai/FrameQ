from __future__ import annotations

import re
import urllib.parse

from frameq_worker.bilibili.transport import decode_response_body, header, page_headers
from frameq_worker.bilibili.types import (
    BilibiliFallbackError,
    BilibiliParseResult,
    BilibiliRequestClient,
)
from frameq_worker.download_reliability import SafeDownloadError

BILIBILI_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
BILIBILI_BVID_PATTERN = re.compile(r"(?i)^BV[0-9A-Za-z]{10,}$")
BILIBILI_AVID_PATTERN = re.compile(r"(?i)^av(\d+)$")
BILIBILI_SHORT_HOSTS = {"b23.tv", "www.b23.tv"}
BILIBILI_MAX_REDIRECT_DEPTH = 5
BILIBILI_TRAILING_URL_PUNCTUATION = " \t\r\n\"'<>[]{}()，。！？；：、,.;:!?"


def parse_bilibili_input(
    raw_input: str,
    http_client: BilibiliRequestClient,
) -> BilibiliParseResult:
    normalized = raw_input.strip()
    direct = _parse_direct_id(normalized)
    if direct is not None:
        return direct

    last_error: BilibiliFallbackError | None = None
    for candidate_url in _extract_bilibili_urls(normalized):
        try:
            return _parse_bilibili_url_candidate(candidate_url, http_client, depth=0)
        except BilibiliFallbackError as exc:
            last_error = exc
            continue

    raise last_error or BilibiliFallbackError(
        "BILIBILI_ID_PARSE_FAILED",
        "Could not extract Bilibili BV or av ID from input.",
    )


def _parse_direct_id(value: str) -> BilibiliParseResult | None:
    if BILIBILI_BVID_PATTERN.fullmatch(value):
        return BilibiliParseResult(video_id=value, id_kind="bvid")
    avid = BILIBILI_AVID_PATTERN.fullmatch(value)
    if avid:
        return BilibiliParseResult(video_id=avid.group(1), id_kind="aid")
    return None


def _parse_bilibili_url_candidate(
    raw_url: str,
    http_client: BilibiliRequestClient,
    *,
    depth: int,
) -> BilibiliParseResult:
    if depth > BILIBILI_MAX_REDIRECT_DEPTH:
        raise BilibiliFallbackError(
            "BILIBILI_SHORT_LINK_RESOLVE_FAILED",
            "Bilibili short link redirected too many times.",
        )

    parsed = _parse_bilibili_video_url(raw_url)
    if parsed is not None:
        return parsed
    if not _is_bilibili_short_link(raw_url):
        raise BilibiliFallbackError(
            "BILIBILI_ID_PARSE_FAILED",
            "Could not extract Bilibili BV or av ID from URL.",
        )

    resolved_url = _resolve_short_link(raw_url, http_client)
    return _parse_bilibili_url_candidate(resolved_url, http_client, depth=depth + 1)


def _parse_bilibili_video_url(raw_url: str) -> BilibiliParseResult | None:
    raw_url = raw_url.strip().strip("\"'<>[]{}()")
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise BilibiliFallbackError(
            "BILIBILI_ID_PARSE_FAILED",
            "Bilibili URL must use http or https.",
        )

    host = (parsed.hostname or "").lower().rstrip(".")
    if _is_bilibili_short_host(host):
        return None
    if not _is_bilibili_host(host):
        raise BilibiliFallbackError("BILIBILI_ID_PARSE_FAILED", "Unsupported Bilibili host.")

    lowered_path = parsed.path.lower()
    if any(
        lowered_path.startswith(prefix)
        for prefix in ("/bangumi/", "/movie/", "/cheese/", "/festival/")
    ):
        raise BilibiliFallbackError(
            "BILIBILI_UNSUPPORTED_CONTENT",
            "Only ordinary public Bilibili videos are supported.",
        )

    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) < 2 or segments[0].lower() != "video":
        raise BilibiliFallbackError(
            "BILIBILI_ID_PARSE_FAILED",
            "Could not extract Bilibili BV or av ID from URL.",
        )

    video_segment = segments[1]
    direct = _parse_direct_id(video_segment)
    if direct is None:
        raise BilibiliFallbackError(
            "BILIBILI_ID_PARSE_FAILED",
            "Could not extract Bilibili BV or av ID from URL.",
        )

    query = urllib.parse.parse_qs(parsed.query)
    part_index = _parse_part_index(query.get("p", ["1"])[0])
    return BilibiliParseResult(
        video_id=direct.video_id,
        id_kind=direct.id_kind,
        part_index=part_index,
        full_url=parsed.geturl(),
    )


def _parse_part_index(value: object) -> int:
    try:
        page = int(value)
    except (TypeError, ValueError):
        page = 1
    return max(0, page - 1)


def _resolve_short_link(
    short_url: str,
    http_client: BilibiliRequestClient,
) -> str:
    last_error: Exception | None = None
    for attempt_url in _short_link_attempts(short_url):
        try:
            return _resolve_short_link_once(attempt_url, http_client)
        except (SafeDownloadError, BilibiliFallbackError, OSError) as exc:
            last_error = exc
            continue
    raise BilibiliFallbackError(
        "BILIBILI_SHORT_LINK_RESOLVE_FAILED",
        "Bilibili short link could not be resolved.",
    ) from last_error


def _resolve_short_link_once(
    short_url: str,
    http_client: BilibiliRequestClient,
) -> str:
    response = http_client.get(short_url, headers=page_headers(), timeout_seconds=10.0)
    location = header(response.headers, "Location")
    if 300 <= response.status < 400 and location:
        return urllib.parse.urljoin(response.url or short_url, location.strip())

    if _parse_bilibili_video_url(response.url) is not None:
        return response.url

    body = decode_response_body(response, max_bytes=256 * 1024)
    for embedded_url in _extract_bilibili_urls(body):
        if _parse_bilibili_video_url(embedded_url) is not None:
            return embedded_url

    raise BilibiliFallbackError(
        "BILIBILI_SHORT_LINK_RESOLVE_FAILED",
        "Bilibili short link response did not contain an ordinary video URL.",
    )


def _short_link_attempts(short_url: str) -> list[str]:
    attempts = [short_url]
    parsed = urllib.parse.urlparse(short_url)
    if parsed.scheme.lower() == "http":
        secure_url = parsed._replace(scheme="https").geturl()
        if secure_url not in attempts:
            attempts.append(secure_url)
    return attempts


def _extract_bilibili_urls(raw_input: str) -> list[str]:
    urls: list[str] = []
    for match in BILIBILI_URL_PATTERN.finditer(raw_input):
        candidate = match.group(0).rstrip(BILIBILI_TRAILING_URL_PUNCTUATION)
        parsed = urllib.parse.urlparse(candidate)
        if _is_acceptable_bilibili_host(parsed.hostname or ""):
            urls.append(candidate)
    return urls


def _is_bilibili_short_link(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return _is_bilibili_short_host(parsed.hostname or "")


def _is_bilibili_short_host(host: str) -> bool:
    return host.lower().rstrip(".") in BILIBILI_SHORT_HOSTS


def _is_acceptable_bilibili_host(host: str) -> bool:
    normalized = host.lower().rstrip(".")
    return _is_bilibili_host(normalized) or _is_bilibili_short_host(normalized)


def _is_bilibili_host(host: str) -> bool:
    normalized = host.lower().rstrip(".")
    return normalized == "bilibili.com" or normalized.endswith(".bilibili.com")
