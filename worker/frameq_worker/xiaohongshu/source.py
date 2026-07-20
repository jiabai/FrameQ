from __future__ import annotations

import html
import re
import urllib.parse
from collections.abc import Callable

from frameq_worker.xiaohongshu.page import decode_response_body
from frameq_worker.xiaohongshu.transport import (
    header,
    is_download_attempt_error,
    page_headers,
)
from frameq_worker.xiaohongshu.types import (
    XiaohongshuFallbackError,
    XiaohongshuHttpClient,
    XiaohongshuParseResult,
)

XHS_BASE_URL = "https://www.xiaohongshu.com"
XHS_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
XHS_NOTE_ID_EXACT_PATTERN = re.compile(r"(?i)^[0-9a-f]{24}$")
XHS_NOTE_ID_PATTERN = re.compile(r"(?i)[0-9a-f]{24}")
XHS_SHORT_HOSTS = {"xhslink.com", "www.xhslink.com"}
XHS_SHORT_LINK_BODY_BYTES = 256 * 1024
XHS_MAX_REDIRECT_DEPTH = 5
XHS_TRAILING_URL_PUNCTUATION = " \t\r\n\"'<>[]{}()，。！？；：、,.;:!?"


def parse_xiaohongshu_source(
    raw_input: str,
    *,
    http_client: XiaohongshuHttpClient | None,
    client_factory: Callable[[], XiaohongshuHttpClient],
) -> XiaohongshuParseResult:
    normalized = raw_input.strip()
    if XHS_NOTE_ID_EXACT_PATTERN.fullmatch(normalized):
        return XiaohongshuParseResult(note_id=normalized.lower())

    client = http_client or client_factory()
    last_error: XiaohongshuFallbackError | None = None
    for candidate_url in _extract_xhs_urls(normalized):
        try:
            return _parse_xhs_url_candidate(candidate_url, client, depth=0)
        except XiaohongshuFallbackError as exc:
            last_error = exc
            continue

    raise last_error or XiaohongshuFallbackError(
        "XHS_ID_PARSE_FAILED",
        "Could not extract Xiaohongshu note ID from input.",
    )


def build_explore_url(
    note_id: str,
    xsec_token: str = "",
    base_url: str = XHS_BASE_URL,
) -> str:
    base = base_url.rstrip("/")
    note_url = f"{base}/explore/{urllib.parse.quote(note_id, safe='')}"
    if xsec_token.strip():
        note_url = (
            f"{note_url}?xsec_token={urllib.parse.quote(xsec_token.strip(), safe='')}"
        )
    return note_url


def _parse_xhs_url_candidate(
    raw_url: str,
    http_client: XiaohongshuHttpClient,
    *,
    depth: int,
) -> XiaohongshuParseResult:
    if depth > XHS_MAX_REDIRECT_DEPTH:
        raise XiaohongshuFallbackError(
            "XHS_SHORT_LINK_RESOLUTION_FAILED",
            "Xiaohongshu short link redirected too many times.",
        )

    parsed = _parse_xhs_note_url(raw_url)
    if parsed is not None:
        return parsed
    if not _is_xhs_short_link(raw_url):
        raise XiaohongshuFallbackError(
            "XHS_ID_PARSE_FAILED",
            "Could not extract Xiaohongshu note ID from URL.",
        )

    resolved_url = _resolve_short_link(raw_url, http_client)
    return _parse_xhs_url_candidate(resolved_url, http_client, depth=depth + 1)


def _resolve_short_link(
    short_url: str,
    http_client: XiaohongshuHttpClient,
) -> str:
    last_error: Exception | None = None
    for attempt_url in _short_link_attempts(short_url):
        try:
            return _resolve_short_link_once(attempt_url, http_client)
        except Exception as exc:
            if not is_download_attempt_error(exc):
                raise
            last_error = exc
            continue
    raise XiaohongshuFallbackError(
        "XHS_SHORT_LINK_RESOLUTION_FAILED",
        "Xiaohongshu short link could not be resolved.",
    ) from last_error


def _resolve_short_link_once(
    short_url: str,
    http_client: XiaohongshuHttpClient,
) -> str:
    response = http_client.get(short_url, headers=page_headers(), timeout_seconds=10.0)
    location = header(response.headers, "Location")
    if 300 <= response.status < 400 and location:
        return urllib.parse.urljoin(response.url or short_url, location.strip())

    resolved = _parse_xhs_note_url(response.url)
    if resolved is not None:
        return response.url

    body = decode_response_body(response, max_bytes=XHS_SHORT_LINK_BODY_BYTES)
    for embedded_url in _extract_xhs_urls(body):
        if _parse_xhs_note_url(embedded_url) is not None:
            return embedded_url

    raise XiaohongshuFallbackError(
        "XHS_SHORT_LINK_RESOLUTION_FAILED",
        "Xiaohongshu short link response did not contain a note URL.",
    )


def _short_link_attempts(short_url: str) -> list[str]:
    attempts = [short_url]
    parsed = urllib.parse.urlparse(short_url)
    if parsed.scheme.lower() == "http":
        secure_url = parsed._replace(scheme="https").geturl()
        if secure_url not in attempts:
            attempts.append(secure_url)
    return attempts


def _extract_xhs_urls(raw_input: str) -> list[str]:
    urls: list[str] = []
    for match in XHS_URL_PATTERN.finditer(html.unescape(raw_input)):
        candidate = match.group(0).rstrip(XHS_TRAILING_URL_PUNCTUATION)
        parsed = urllib.parse.urlparse(candidate)
        if _is_acceptable_xhs_host(parsed.hostname or ""):
            urls.append(candidate)
    return urls


def _parse_xhs_note_url(raw_url: str) -> XiaohongshuParseResult | None:
    raw_url = html.unescape(raw_url.strip().strip("\"'<>[]{}()"))
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise XiaohongshuFallbackError(
            "XHS_URL_INVALID",
            "Xiaohongshu URL must use http or https.",
        )

    host = (parsed.hostname or "").lower().rstrip(".")
    if _is_xhs_short_host(host):
        return None
    if not _is_acceptable_xhs_host(host):
        raise XiaohongshuFallbackError(
            "XHS_URL_INVALID",
            "Unsupported Xiaohongshu host.",
        )

    note_id = _note_id_from_path(parsed.path)
    query = urllib.parse.parse_qs(parsed.query)
    if note_id is None:
        raise XiaohongshuFallbackError(
            "XHS_ID_PARSE_FAILED",
            "Could not extract Xiaohongshu note ID from URL.",
        )

    xsec_token = query.get("xsec_token", [""])[0]
    return XiaohongshuParseResult(
        note_id=note_id.lower(),
        full_url=parsed.geturl(),
        xsec_token=xsec_token,
    )


def _note_id_from_path(path: str) -> str | None:
    segments = [segment for segment in path.split("/") if segment]
    candidate = ""
    if len(segments) == 2 and segments[0].lower() == "explore":
        candidate = segments[1]
    elif len(segments) == 3 and [part.lower() for part in segments[:2]] == [
        "discovery",
        "item",
    ]:
        candidate = segments[2]
    return candidate.lower() if XHS_NOTE_ID_PATTERN.fullmatch(candidate) else None


def _is_xhs_short_link(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return _is_xhs_short_host(parsed.hostname or "")


def _is_xhs_short_host(host: str) -> bool:
    return host.lower().rstrip(".") in XHS_SHORT_HOSTS


def _is_acceptable_xhs_host(host: str) -> bool:
    normalized = host.strip().lower().rstrip(".")
    return (
        normalized == "xiaohongshu.com"
        or normalized.endswith(".xiaohongshu.com")
        or _is_xhs_short_host(normalized)
    )
