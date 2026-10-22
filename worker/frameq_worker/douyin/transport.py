from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Callable, Iterator, Mapping, Sequence
from http.cookiejar import CookieJar
from pathlib import Path

from frameq_worker.douyin.types import (
    DouyinFallbackError,
    DouyinStreamCandidate,
    HttpResponse,
)
from frameq_worker.download_reliability import (
    RESUMABLE_DOWNLOAD_ERROR_CODES,
    SafeDownloadError,
    write_http_stream_atomically,
)

DOUYIN_MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"
)

DOUYIN_DOWNLOAD_CHUNK_BYTES = 256 * 1024
DOUYIN_NO_PROGRESS_TIMEOUT_SECONDS = 60.0
DOUYIN_STREAM_SOCKET_TIMEOUT_SECONDS = 15.0

CandidateFailed = Callable[[int, int], None]
DownloadProgress = Callable[[int, int], None]


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

    def download_to_path(
        self,
        url: str,
        destination: Path,
        *,
        headers: Mapping[str, str] | None = None,
        timeout_seconds: float = DOUYIN_STREAM_SOCKET_TIMEOUT_SECONDS,
        no_progress_timeout_seconds: float = DOUYIN_NO_PROGRESS_TIMEOUT_SECONDS,
        resume_from_bytes: int = 0,
        total_bytes: int | None = None,
        on_progress: DownloadProgress | None = None,
    ) -> int:
        request_headers = dict(headers or {})
        if resume_from_bytes > 0:
            request_headers["Range"] = f"bytes={resume_from_bytes}-"
        request = urllib.request.Request(url, headers=request_headers, method="GET")
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                return write_http_stream_atomically(
                    HttpResponse(
                        status=response.status,
                        headers=dict(response.headers.items()),
                        body=b"",
                        url=response.geturl(),
                    ),
                    _response_chunks(response, resume_from_bytes, total_bytes, on_progress),
                    destination,
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
                _response_chunks(exc, resume_from_bytes, total_bytes, on_progress),
                destination,
                no_progress_timeout_seconds=no_progress_timeout_seconds,
                resume_from_bytes=resume_from_bytes,
            )
        except urllib.error.URLError as exc:
            raise DouyinFallbackError(
                "DOUYIN_STREAM_DOWNLOAD_FAILED",
                "Douyin media stream request failed.",
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
    http_client: UrllibDouyinHttpClient,
    timeout_seconds: float = DOUYIN_STREAM_SOCKET_TIMEOUT_SECONDS,
    on_candidate_failed: CandidateFailed | None = None,
    on_progress: DownloadProgress | None = None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{aweme_id}.mp4"
    part_path = output_path.with_name(f"{output_path.name}.part")
    last_error: Exception | None = None
    total = len(candidates)

    for index, candidate in enumerate(candidates):
        failed = False
        # 每个候选最多两次尝试：第一次原始下载，第二次利用留下的部分文件续传。
        for attempt in (1, 2):
            try:
                http_client.download_to_path(
                    candidate.url,
                    output_path,
                    headers=candidate.headers,
                    timeout_seconds=timeout_seconds,
                    no_progress_timeout_seconds=DOUYIN_NO_PROGRESS_TIMEOUT_SECONDS,
                    resume_from_bytes=_resumable_part_size(part_path, candidate.size_bytes),
                    total_bytes=candidate.size_bytes,
                    on_progress=on_progress,
                )
                return output_path
            except SafeDownloadError as exc:
                last_error = exc
                if attempt == 1 and exc.code in RESUMABLE_DOWNLOAD_ERROR_CODES:
                    continue
                part_path.unlink(missing_ok=True)
                failed = True
                break
            except Exception as exc:  # noqa: BLE001 - 传输层异常直接换下一个候选
                last_error = exc
                part_path.unlink(missing_ok=True)
                failed = True
                break
        if failed and on_candidate_failed is not None and index < total - 1:
            on_candidate_failed(index, total)

    raise DouyinFallbackError(
        "DOUYIN_STREAM_DOWNLOAD_FAILED",
        "All Douyin fallback streams failed to download.",
    ) from last_error


def _response_chunks(
    response: object,
    resume_from_bytes: int,
    total_bytes: int | None,
    on_progress: DownloadProgress | None,
) -> Iterator[bytes]:
    emitted = resume_from_bytes
    while True:
        chunk = response.read(DOUYIN_DOWNLOAD_CHUNK_BYTES)
        if not chunk:
            return
        emitted += len(chunk)
        if on_progress is not None:
            on_progress(emitted, total_bytes if total_bytes is not None else emitted)
        yield chunk


def _resumable_part_size(part_path: Path, declared_total: int) -> int:
    try:
        size = part_path.stat().st_size if part_path.is_file() else 0
    except OSError:
        return 0
    if size <= 0 or size >= declared_total:
        if size > 0:
            part_path.unlink(missing_ok=True)
        return 0
    return size
