from __future__ import annotations

import gzip
import urllib.error
import urllib.request
import zlib
from collections.abc import Iterator, Mapping
from pathlib import Path

import brotli

from frameq_worker.bilibili.types import (
    BilibiliFallbackError,
    BilibiliRequestClient,
    HttpResponse,
)
from frameq_worker.download_reliability import (
    SafeDownloadError,
    write_http_response_atomically,
    write_http_stream_atomically,
)

BILIBILI_DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
BILIBILI_REFERER = "https://www.bilibili.com/"
BILIBILI_ORIGIN = "https://www.bilibili.com"
BILIBILI_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
BILIBILI_MAX_STREAM_BYTES = 2 * 1024 * 1024 * 1024
BILIBILI_DOWNLOAD_CHUNK_BYTES = 256 * 1024
BILIBILI_NO_PROGRESS_TIMEOUT_SECONDS = 120.0


class UrllibBilibiliHttpClient:
    def __init__(self) -> None:
        self._opener = urllib.request.build_opener()

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse:
        request = urllib.request.Request(url, headers=headers or {}, method="GET")
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                body = response.read(BILIBILI_MAX_RESPONSE_BYTES + 1)
                return HttpResponse(
                    status=response.status,
                    headers=dict(response.headers.items()),
                    body=body,
                    url=response.geturl(),
                )
        except urllib.error.HTTPError as exc:
            return HttpResponse(
                status=exc.code,
                headers=dict(exc.headers.items()),
                body=exc.read(BILIBILI_MAX_RESPONSE_BYTES + 1),
                url=exc.geturl(),
            )
        except urllib.error.URLError as exc:
            raise BilibiliFallbackError(
                "BILIBILI_VIDEO_INFO_UNAVAILABLE",
                "Bilibili public API request failed.",
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
            raise BilibiliFallbackError(
                "BILIBILI_DASH_DOWNLOAD_FAILED",
                "Bilibili DASH media request failed.",
            ) from exc


def decode_response_body(
    response: HttpResponse,
    max_bytes: int = BILIBILI_MAX_RESPONSE_BYTES,
) -> str:
    body = response.body
    _require_bounded_response_body(body, max_bytes)
    encoding = (
        (header(response.headers, "Content-Encoding") or "")
        .split(",", 1)[0]
        .strip()
        .lower()
    )
    try:
        if encoding == "gzip":
            body = gzip.decompress(body)
        elif encoding == "br":
            body = brotli.decompress(body)
        elif encoding == "deflate":
            try:
                body = zlib.decompress(body)
            except zlib.error:
                body = zlib.decompress(body, -zlib.MAX_WBITS)
    except (OSError, brotli.error, zlib.error) as exc:
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili response body could not be decoded.",
        ) from exc
    _require_bounded_response_body(body, max_bytes)
    return body.decode("utf-8", errors="replace")


def page_headers(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": BILIBILI_DESKTOP_USER_AGENT,
        "Referer": BILIBILI_REFERER,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }
    if extra:
        headers.update(extra)
    return headers


def api_headers(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": BILIBILI_DESKTOP_USER_AGENT,
        "Referer": BILIBILI_REFERER,
        "Origin": BILIBILI_ORIGIN,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
    }
    if extra:
        headers.update(extra)
    return headers


def media_headers() -> dict[str, str]:
    return {
        "User-Agent": BILIBILI_DESKTOP_USER_AGENT,
        "Referer": BILIBILI_REFERER,
        "Origin": BILIBILI_ORIGIN,
        "Accept": "*/*",
    }


def download_url_to_path(
    url: str,
    output_path: Path,
    http_client: BilibiliRequestClient,
) -> int:
    downloader = getattr(http_client, "download_to_path", None)
    if callable(downloader):
        return int(
            downloader(
                url,
                output_path,
                headers=media_headers(),
                timeout_seconds=30.0,
                max_bytes=BILIBILI_MAX_STREAM_BYTES,
                no_progress_timeout_seconds=BILIBILI_NO_PROGRESS_TIMEOUT_SECONDS,
            )
        )

    response = http_client.get(
        url,
        headers=media_headers(),
        timeout_seconds=30.0,
    )
    return write_http_response_atomically(
        response,
        output_path,
        max_bytes=BILIBILI_MAX_STREAM_BYTES,
    )


def header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _require_bounded_response_body(body: bytes, max_bytes: int) -> None:
    if len(body) > max_bytes:
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili response exceeded the safety limit.",
        )


def _response_chunks(response: object) -> Iterator[bytes]:
    while True:
        chunk = response.read(BILIBILI_DOWNLOAD_CHUNK_BYTES)
        if not chunk:
            break
        yield chunk


def _partial_file_size(destination: Path) -> int:
    part_path = destination.with_name(f"{destination.name}.part")
    try:
        return part_path.stat().st_size if part_path.is_file() else 0
    except OSError:
        return 0
