from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Iterator, Mapping
from http.cookiejar import CookieJar
from pathlib import Path

from frameq_worker.download_reliability import (
    SafeDownloadError,
    write_http_response_atomically,
    write_http_stream_atomically,
)
from frameq_worker.xiaohongshu.types import (
    HttpResponse,
    XiaohongshuFallbackError,
    XiaohongshuHttpClient,
)

XHS_DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
XHS_REFERER = "https://www.xiaohongshu.com/"
XHS_MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
XHS_DOWNLOAD_CHUNK_BYTES = 256 * 1024
XHS_NO_PROGRESS_TIMEOUT_SECONDS = 120.0


class UrllibXiaohongshuHttpClient:
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
            raise XiaohongshuFallbackError(
                "XHS_PAGE_UNAVAILABLE",
                "Xiaohongshu public page request failed.",
            ) from exc

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
        request_headers = dict(headers or {})
        resume_from = _partial_file_size(destination)
        if resume_from > 0:
            request_headers["Range"] = f"bytes={resume_from}-"
        try:
            return self._download_request_to_path(
                url,
                destination,
                headers=request_headers,
                timeout_seconds=timeout_seconds,
                max_bytes=max_bytes,
                no_progress_timeout_seconds=no_progress_timeout_seconds,
                resume_from_bytes=resume_from,
            )
        except SafeDownloadError as exc:
            if resume_from <= 0 or exc.code != "DOWNLOAD_CONTENT_RANGE_INVALID":
                raise
            destination.with_name(f"{destination.name}.part").unlink(missing_ok=True)
            return self._download_request_to_path(
                url,
                destination,
                headers=dict(headers or {}),
                timeout_seconds=timeout_seconds,
                max_bytes=max_bytes,
                no_progress_timeout_seconds=no_progress_timeout_seconds,
                resume_from_bytes=0,
            )

    def _download_request_to_path(
        self,
        url: str,
        destination: Path,
        *,
        headers: dict[str, str],
        timeout_seconds: float,
        max_bytes: int | None,
        no_progress_timeout_seconds: float | None,
        resume_from_bytes: int,
    ) -> int:
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                return write_http_stream_atomically(
                    HttpResponse(
                        status=response.status,
                        headers=dict(response.headers.items()),
                        body=b"",
                        url=response.geturl(),
                    ),
                    _response_chunks(response),
                    destination,
                    max_bytes=max_bytes,
                    no_progress_timeout_seconds=no_progress_timeout_seconds,
                    resume_from_bytes=resume_from_bytes,
                )
        except urllib.error.HTTPError as exc:
            return write_http_stream_atomically(
                HttpResponse(
                    status=exc.code,
                    headers=dict(exc.headers.items()),
                    body=b"",
                    url=exc.geturl(),
                ),
                _response_chunks(exc),
                destination,
                max_bytes=max_bytes,
                no_progress_timeout_seconds=no_progress_timeout_seconds,
                resume_from_bytes=resume_from_bytes,
            )
        except urllib.error.URLError as exc:
            raise XiaohongshuFallbackError(
                "XHS_STREAM_DOWNLOAD_FAILED",
                "Xiaohongshu media stream request failed.",
            ) from exc


def download_stream_to_path(
    stream_url: str,
    output_path: Path,
    http_client: XiaohongshuHttpClient,
) -> int:
    downloader = getattr(http_client, "download_to_path", None)
    if callable(downloader):
        return int(
            downloader(
                stream_url,
                output_path,
                headers=media_headers(),
                timeout_seconds=30.0,
                max_bytes=XHS_MAX_VIDEO_BYTES,
                no_progress_timeout_seconds=XHS_NO_PROGRESS_TIMEOUT_SECONDS,
            )
        )

    response = http_client.get(
        stream_url,
        headers=media_headers(),
        timeout_seconds=30.0,
    )
    return write_http_response_atomically(
        response,
        output_path,
        max_bytes=XHS_MAX_VIDEO_BYTES,
    )


def map_download_error(error: Exception | None) -> XiaohongshuFallbackError:
    if isinstance(error, SafeDownloadError):
        if error.code == "DOWNLOAD_SIZE_EXCEEDED":
            return XiaohongshuFallbackError(
                "XHS_VIDEO_TOO_LARGE",
                "Xiaohongshu video exceeded the configured size limit.",
            )
        if error.code == "DOWNLOAD_STALLED":
            return XiaohongshuFallbackError(
                "XHS_DOWNLOAD_STALLED",
                "Xiaohongshu video download stalled.",
            )
    return XiaohongshuFallbackError(
        "XHS_STREAM_DOWNLOAD_FAILED",
        "All Xiaohongshu fallback streams failed to download.",
    )


def is_download_attempt_error(error: Exception) -> bool:
    return isinstance(error, (SafeDownloadError, XiaohongshuFallbackError, OSError))


def page_headers(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": XHS_DESKTOP_USER_AGENT,
        "Referer": XHS_REFERER,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
    }
    if extra:
        headers.update(extra)
    return headers


def media_headers() -> dict[str, str]:
    return {
        "User-Agent": XHS_DESKTOP_USER_AGENT,
        "Referer": XHS_REFERER,
        "Accept": "*/*",
    }


def header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _response_chunks(response: object) -> Iterator[bytes]:
    while True:
        chunk = response.read(XHS_DOWNLOAD_CHUNK_BYTES)
        if not chunk:
            break
        yield chunk


def _partial_file_size(destination: Path) -> int:
    part_path = destination.with_name(f"{destination.name}.part")
    try:
        return part_path.stat().st_size if part_path.is_file() else 0
    except OSError:
        return 0
