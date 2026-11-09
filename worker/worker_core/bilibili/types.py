from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol


class BilibiliFallbackError(RuntimeError):
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
class CommandResult:
    command: list[str]
    returncode: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class BilibiliParseResult:
    video_id: str
    id_kind: str
    part_index: int = 0
    full_url: str = ""


@dataclass(frozen=True)
class BilibiliPage:
    cid: int
    page: int
    part: str = ""
    duration_seconds: int = 0


@dataclass(frozen=True)
class BilibiliVideoInfo:
    bvid: str
    aid: int
    title: str
    pages: list[BilibiliPage] = field(default_factory=list)


@dataclass(frozen=True)
class BilibiliDashSelection:
    video_url: str
    audio_url: str
    video_backup_urls: list[str] = field(default_factory=list)
    audio_backup_urls: list[str] = field(default_factory=list)
    video_codec_id: int = 0
    quality: int = 0
    quality_name: str = ""


class BilibiliRequestClient(Protocol):
    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse: ...
