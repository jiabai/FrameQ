from __future__ import annotations

import os
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Protocol

CONTENT_RANGE_TOTAL_PATTERN = re.compile(r"/(\d+)\s*$")
VIDEO_CONTENT_TYPES = ("video/", "application/octet-stream")


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

    if response.status == 206 and _content_range_total(response.headers) is None:
        raise SafeDownloadError(
            "DOWNLOAD_CONTENT_RANGE_INVALID",
            "Partial download response must include a valid Content-Range total.",
        )

    if not response.body:
        raise SafeDownloadError("DOWNLOAD_EMPTY_BODY", "Download response body is empty.")

    content_type = _header(response.headers, "Content-Type")
    if content_type and not _is_allowed_content_type(content_type, allowed_content_types):
        raise SafeDownloadError(
            "DOWNLOAD_CONTENT_TYPE_INVALID",
            "Download response returned a non-media content type.",
        )

    total_size = _declared_size(response.headers) or len(response.body)
    if total_size <= 0:
        raise SafeDownloadError("DOWNLOAD_SIZE_INVALID", "Download response size is invalid.")

    if max_bytes is not None and max_bytes > 0:
        if total_size > max_bytes or len(response.body) > max_bytes:
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
