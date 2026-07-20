from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from http.cookiejar import CookieJar
from pathlib import Path

from frameq_worker.douyin.types import (
    DouyinFallbackError,
    DouyinHttpClient,
    DouyinStreamCandidate,
    HttpResponse,
)
from frameq_worker.download_reliability import (
    SafeDownloadError,
    write_http_response_atomically,
)

DOUYIN_MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"
)

CandidateFailed = Callable[[int, int], None]


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


def public_headers(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": DOUYIN_MOBILE_USER_AGENT,
        "Accept": "*/*",
        "Referer": "https://www.iesdouyin.com/",
    }
    if extra:
        headers.update(extra)
    return headers


def download_ordered_candidates(
    aweme_id: str,
    candidates: Sequence[DouyinStreamCandidate],
    output_dir: Path,
    http_client: DouyinHttpClient,
    timeout_seconds: float = 30.0,
    on_candidate_failed: CandidateFailed | None = None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{aweme_id}.mp4"
    last_error: Exception | None = None
    total = len(candidates)

    for index, candidate in enumerate(candidates):
        try:
            response = http_client.get(
                candidate.url,
                headers=_without_range_header(candidate.headers),
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001 - try next public stream candidate
            last_error = exc
            if on_candidate_failed is not None and index < total - 1:
                on_candidate_failed(index, total)
            continue

        try:
            write_http_response_atomically(response, output_path)
        except SafeDownloadError as exc:
            last_error = exc
            if on_candidate_failed is not None and index < total - 1:
                on_candidate_failed(index, total)
            continue

        return output_path

    raise DouyinFallbackError(
        "DOUYIN_STREAM_DOWNLOAD_FAILED",
        "All Douyin fallback streams failed to download.",
    ) from last_error


def _without_range_header(headers: Mapping[str, str]) -> dict[str, str]:
    return {key: value for key, value in headers.items() if key.lower() != "range"}
