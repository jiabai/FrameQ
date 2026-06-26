from __future__ import annotations

import json
import re
import subprocess
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from frameq_worker.douyin_fallback import (
    DouyinFallbackError,
    download_douyin_video,
    extract_aweme_id,
)
from frameq_worker.xiaohongshu_fallback import (
    XiaohongshuFallbackError,
    download_xiaohongshu_video,
)


@dataclass(frozen=True)
class CommandResult:
    command: list[str]
    returncode: int
    stdout: str
    stderr: str


CommandRunner = Callable[[list[str]], CommandResult]
ProgressCallback = Callable[[dict[str, object]], None]
DOUYIN_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
DOUYIN_HOST_SUFFIXES = ("douyin.com", "iesdouyin.com")
XIAOHONGSHU_HOST_SUFFIXES = ("xiaohongshu.com", "xhslink.com")


class CommandExecutionError(RuntimeError):
    def __init__(self, result: CommandResult) -> None:
        super().__init__(result.stderr or f"Command failed with exit code {result.returncode}")
        self.result = result


@dataclass(frozen=True)
class MediaInfo:
    has_video: bool
    has_audio: bool
    video_codec: str | None
    audio_codec: str | None
    width: int | None
    height: int | None
    duration_seconds: float | None
    size_bytes: int | None

    @property
    def is_valid(self) -> bool:
        return (
            self.has_video
            and self.is_valid_audio
        )

    @property
    def is_valid_audio(self) -> bool:
        return (
            self.has_audio
            and self.duration_seconds is not None
            and self.duration_seconds > 0
            and self.size_bytes is not None
            and self.size_bytes > 0
        )


def extract_douyin_video_id(url: str) -> str | None:
    return extract_aweme_id(url)


def build_ytdlp_command(url: str, output_dir: Path) -> list[str]:
    output_template = (output_dir / "%(id)s.%(ext)s").as_posix()
    return ["yt-dlp", "--no-playlist", "-o", output_template, url]


def build_ffprobe_command(media_path: Path) -> list[str]:
    return [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,size:stream=index,codec_type,codec_name,width,height",
        "-of",
        "json",
        media_path.as_posix(),
    ]


def build_audio_extract_command(input_path: Path, output_path: Path) -> list[str]:
    return [
        "ffmpeg",
        "-y",
        "-i",
        input_path.as_posix(),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        output_path.as_posix(),
    ]


def run_command(command: list[str]) -> CommandResult:
    completed = subprocess.run(command, capture_output=True, check=False, text=True)
    return CommandResult(
        command=command,
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def download_video(
    url: str,
    output_dir: Path,
    runner: CommandRunner = run_command,
    progress_callback: ProgressCallback | None = None,
) -> CommandResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    result = runner(build_ytdlp_command(url, output_dir))
    if result.returncode != 0:
        if should_attempt_douyin_fallback(url, result.stderr or result.stdout):
            try:
                video_path = download_douyin_video(
                    url,
                    output_dir=output_dir,
                    progress_callback=progress_callback,
                )
            except DouyinFallbackError as exc:
                fallback_result = CommandResult(
                    command=["douyin-fallback", url],
                    returncode=1,
                    stdout="",
                    stderr=f"{exc.code}: {exc}",
                )
                raise CommandExecutionError(fallback_result) from exc
            return CommandResult(
                command=["douyin-fallback", url],
                returncode=0,
                stdout=video_path.as_posix(),
                stderr="",
            )
        if should_attempt_xiaohongshu_fallback(url, result.stderr or result.stdout):
            try:
                video_path = download_xiaohongshu_video(
                    url,
                    output_dir=output_dir,
                    progress_callback=progress_callback,
                )
            except XiaohongshuFallbackError as exc:
                fallback_result = CommandResult(
                    command=["xiaohongshu-fallback", url],
                    returncode=1,
                    stdout="",
                    stderr=f"{exc.code}: {exc}",
                )
                raise CommandExecutionError(fallback_result) from exc
            return CommandResult(
                command=["xiaohongshu-fallback", url],
                returncode=0,
                stdout=video_path.as_posix(),
                stderr="",
            )
        raise CommandExecutionError(result)
    return result


def should_attempt_douyin_fallback(url: str, failure_message: str) -> bool:
    if not _contains_supported_url(url, DOUYIN_HOST_SUFFIXES):
        return False

    normalized = failure_message.lower()
    fallback_markers = (
        "expecting value",
        "fresh cookies",
        "aweme/v1/web/aweme/detail",
        "web detail",
        "webpage detail",
        "empty",
        "json",
    )
    return any(marker in normalized for marker in fallback_markers)


def should_attempt_xiaohongshu_fallback(url: str, failure_message: str) -> bool:
    return bool(failure_message.strip()) and _contains_supported_url(
        url,
        XIAOHONGSHU_HOST_SUFFIXES,
    )


def _contains_supported_url(raw_input: str, host_suffixes: tuple[str, ...]) -> bool:
    for match in DOUYIN_URL_PATTERN.finditer(raw_input):
        candidate = match.group(0).rstrip("，。,.、!！?？)")
        host = (urllib.parse.urlparse(candidate).hostname or "").lower().rstrip(".")
        if any(host == suffix or host.endswith(f".{suffix}") for suffix in host_suffixes):
            return True
    return False


def probe_media_file(
    media_path: Path,
    runner: CommandRunner = run_command,
) -> MediaInfo:
    result = runner(build_ffprobe_command(media_path))
    if result.returncode != 0:
        raise CommandExecutionError(result)
    return parse_ffprobe_json(result.stdout)


def extract_audio(
    input_path: Path,
    output_path: Path,
    runner: CommandRunner = run_command,
) -> CommandResult:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = runner(build_audio_extract_command(input_path, output_path))
    if result.returncode != 0:
        raise CommandExecutionError(result)
    return result


def parse_ffprobe_json(raw_json: str) -> MediaInfo:
    payload = json.loads(raw_json)
    streams = payload.get("streams", [])
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    media_format = payload.get("format", {})

    return MediaInfo(
        has_video=video_stream is not None,
        has_audio=audio_stream is not None,
        video_codec=video_stream.get("codec_name") if video_stream else None,
        audio_codec=audio_stream.get("codec_name") if audio_stream else None,
        width=video_stream.get("width") if video_stream else None,
        height=video_stream.get("height") if video_stream else None,
        duration_seconds=_parse_float(media_format.get("duration")),
        size_bytes=_parse_int(media_format.get("size")),
    )


def _parse_float(value: object) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _parse_int(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
