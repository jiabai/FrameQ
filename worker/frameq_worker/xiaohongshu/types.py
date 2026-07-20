from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


class XiaohongshuFallbackError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    url: str


@dataclass(frozen=True)
class XiaohongshuParseResult:
    note_id: str
    full_url: str = ""
    xsec_token: str = ""


@dataclass(frozen=True)
class XiaohongshuStreamCandidate:
    quality_key: str
    url: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    backup_urls: list[str] = field(default_factory=list)
    video_codec: str = ""
    video_bitrate: int = 0
    stream_type: int = 0
    weight: int = 0
    default_stream: int = 0
    headers: dict[str, str] = field(default_factory=dict)


class XiaohongshuHttpClient(Protocol):
    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse: ...


class XiaohongshuDownloadClient(XiaohongshuHttpClient, Protocol):
    def download_to_path(
        self,
        url: str,
        destination: Path,
        *,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 30.0,
        max_bytes: int | None = None,
        no_progress_timeout_seconds: float | None = None,
    ) -> int: ...
