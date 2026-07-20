from __future__ import annotations

import re
import urllib.parse

from frameq_worker.douyin.transport import UrllibDouyinHttpClient, public_headers
from frameq_worker.douyin.types import DouyinFallbackError, DouyinHttpClient

AWEME_ID_PATTERNS = (
    re.compile(r"[?&](?:modal_id|aweme_id)=(\d+)(?:[&#]|$)"),
    re.compile(r"(?:^|/)(?:video|note)/(\d+)(?:[/?#]|$)"),
    re.compile(r"(?:^|/)share/slides/(\d+)(?:[/?#]|$)"),
    re.compile(r"[?&]aweme_id=(\d+)(?:[&#]|$)"),
)
DOUYIN_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+")
DOUYIN_SHORT_HOSTS = {"v.douyin.com"}


def extract_aweme_id(url: str) -> str | None:
    for pattern in AWEME_ID_PATTERNS:
        match = pattern.search(url)
        if match:
            return match.group(1)
    return None


def resolve_aweme_id_from_input(
    raw_input: str,
    http_client: DouyinHttpClient | None = None,
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
                headers=public_headers(),
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


def build_share_page_url(aweme_id: str) -> str:
    return f"https://www.iesdouyin.com/share/video/{aweme_id}/?app=aweme"


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
