from __future__ import annotations

import os
import re
import time
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Protocol

CONTENT_RANGE_PATTERN = re.compile(r"^bytes\s+(\d+)-(\d+)/(\d+|\*)\s*$", re.IGNORECASE)
CONTENT_RANGE_TOTAL_PATTERN = re.compile(r"/(\d+)\s*$")
VIDEO_CONTENT_TYPES = ("video/", "application/octet-stream")
# 断流与提前结束都会留下有效的部分字节，供同一路径的续传重试复用。
RESUMABLE_DOWNLOAD_ERROR_CODES = frozenset(
    {"DOWNLOAD_STALLED", "DOWNLOAD_INCOMPLETE"}
)


class SafeDownloadError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class HttpDownloadResponse(Protocol):
    status: int
    headers: Mapping[str, str]
    body: bytes
    url: str


def write_http_response_atomically(
    response: HttpDownloadResponse,
    destination: Path,
    *,
    max_bytes: int | None = None,
    allowed_content_types: tuple[str, ...] = VIDEO_CONTENT_TYPES,
) -> int:
    _validate_response(response, max_bytes=max_bytes, allowed_content_types=allowed_content_types)

    destination.parent.mkdir(parents=True, exist_ok=True)
    part_path = destination.with_name(f"{destination.name}.part")
    try:
        part_path.unlink(missing_ok=True)
        part_path.write_bytes(response.body)
        os.replace(part_path, destination)
    except Exception:
        part_path.unlink(missing_ok=True)
        raise
    return len(response.body)


def write_http_stream_atomically(
    response: HttpDownloadResponse,
    chunks: Iterable[bytes],
    destination: Path,
    *,
    max_bytes: int | None = None,
    allowed_content_types: tuple[str, ...] = VIDEO_CONTENT_TYPES,
    no_progress_timeout_seconds: float | None = None,
    monotonic: object = time.monotonic,
    resume_from_bytes: int = 0,
) -> int:
    _validate_response_headers(
        response,
        max_bytes=max_bytes,
        allowed_content_types=allowed_content_types,
        resume_from_bytes=resume_from_bytes,
    )

    destination.parent.mkdir(parents=True, exist_ok=True)
    part_path = destination.with_name(f"{destination.name}.part")
    written = resume_from_bytes
    last_progress_at = _call_monotonic(monotonic)
    try:
        mode = "wb"
        if resume_from_bytes > 0:
            if not part_path.is_file() or part_path.stat().st_size != resume_from_bytes:
                raise SafeDownloadError(
                    "DOWNLOAD_RESUME_INVALID",
                    "Partial download file does not match the expected resume offset.",
                )
            mode = "ab"
        else:
            part_path.unlink(missing_ok=True)
        with part_path.open(mode) as output:
            for chunk in chunks:
                now = _call_monotonic(monotonic)
                if (
                    no_progress_timeout_seconds is not None
                    and no_progress_timeout_seconds > 0
                    and now - last_progress_at > no_progress_timeout_seconds
                ):
                    raise SafeDownloadError(
                        "DOWNLOAD_STALLED",
                        "Download made no progress before the timeout.",
                    )
                if not chunk:
                    continue
                written += len(chunk)
                if max_bytes is not None and max_bytes > 0 and written > max_bytes:
                    raise SafeDownloadError(
                        "DOWNLOAD_SIZE_EXCEEDED",
                        "Download response exceeds the configured size limit.",
                    )
                output.write(chunk)
                last_progress_at = now
        if written <= resume_from_bytes:
            raise SafeDownloadError("DOWNLOAD_EMPTY_BODY", "Download response body is empty.")
        declared_size = _declared_size(response.headers)
        if declared_size is not None and written != declared_size:
            raise SafeDownloadError(
                "DOWNLOAD_INCOMPLETE",
                "Download response ended before the declared size.",
            )
        os.replace(part_path, destination)
    except SafeDownloadError as exc:
        if exc.code not in RESUMABLE_DOWNLOAD_ERROR_CODES:
            part_path.unlink(missing_ok=True)
        raise
    except Exception:
        part_path.unlink(missing_ok=True)
        raise
    return written


def _validate_response(
    response: HttpDownloadResponse,
    *,
    max_bytes: int | None,
    allowed_content_types: tuple[str, ...],
) -> None:
    if response.status not in {200, 206}:
        raise SafeDownloadError(
            "DOWNLOAD_HTTP_STATUS_INVALID",
            f"Unexpected HTTP status: {response.status}",
        )

    _validate_response_headers(
        response,
        max_bytes=max_bytes,
        allowed_content_types=allowed_content_types,
        resume_from_bytes=0,
    )

    if not response.body:
        raise SafeDownloadError("DOWNLOAD_EMPTY_BODY", "Download response body is empty.")

    total_size = _declared_size(response.headers) or len(response.body)
    if total_size <= 0:
        raise SafeDownloadError("DOWNLOAD_SIZE_INVALID", "Download response size is invalid.")

    if max_bytes is not None and max_bytes > 0:
        if total_size > max_bytes or len(response.body) > max_bytes:
            raise SafeDownloadError(
                "DOWNLOAD_SIZE_EXCEEDED",
                "Download response exceeds the configured size limit.",
            )


def _validate_response_headers(
    response: HttpDownloadResponse,
    *,
    max_bytes: int | None,
    allowed_content_types: tuple[str, ...],
    resume_from_bytes: int = 0,
) -> None:
    if response.status not in {200, 206}:
        raise SafeDownloadError(
            "DOWNLOAD_HTTP_STATUS_INVALID",
            f"Unexpected HTTP status: {response.status}",
        )

    if response.status == 206 and _content_range_total(response.headers) is None:
        raise SafeDownloadError(
            "DOWNLOAD_CONTENT_RANGE_INVALID",
            "Partial download response must include a valid Content-Range total.",
        )
    if resume_from_bytes > 0:
        if response.status != 206 or _content_range_start(response.headers) != resume_from_bytes:
            raise SafeDownloadError(
                "DOWNLOAD_CONTENT_RANGE_INVALID",
                "Resume response must start at the existing partial file size.",
            )

    content_type = _header(response.headers, "Content-Type")
    if content_type and not _is_allowed_content_type(content_type, allowed_content_types):
        raise SafeDownloadError(
            "DOWNLOAD_CONTENT_TYPE_INVALID",
            "Download response returned a non-media content type.",
        )

    declared_size = _declared_size(response.headers)
    if declared_size is not None and max_bytes is not None and max_bytes > 0:
        if declared_size > max_bytes:
            raise SafeDownloadError(
                "DOWNLOAD_SIZE_EXCEEDED",
                "Download response exceeds the configured size limit.",
            )


def _declared_size(headers: Mapping[str, str]) -> int | None:
    return _content_range_total(headers) or _parse_int(_header(headers, "Content-Length"))


def _content_range_total(headers: Mapping[str, str]) -> int | None:
    content_range = _header(headers, "Content-Range")
    if not content_range:
        return None
    match = CONTENT_RANGE_TOTAL_PATTERN.search(content_range)
    if not match:
        return None
    return _parse_int(match.group(1))


def _content_range_start(headers: Mapping[str, str]) -> int | None:
    content_range = _header(headers, "Content-Range")
    if not content_range:
        return None
    match = CONTENT_RANGE_PATTERN.match(content_range.strip())
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _is_allowed_content_type(content_type: str, allowed_content_types: tuple[str, ...]) -> bool:
    normalized = content_type.split(";", 1)[0].strip().lower()
    return any(
        normalized.startswith(allowed[:-1]) if allowed.endswith("/") else normalized == allowed
        for allowed in allowed_content_types
    )


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _parse_int(value: object) -> int | None:
    try:
        parsed = int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
    return parsed if parsed is not None and parsed > 0 else None


def _call_monotonic(monotonic: object) -> float:
    if not callable(monotonic):
        return time.monotonic()
    return float(monotonic())
