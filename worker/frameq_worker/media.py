from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from frameq_worker.bilibili_fallback import (
    BilibiliFallbackError,
    download_bilibili_video,
)
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
StrategyError = DouyinFallbackError | XiaohongshuFallbackError | BilibiliFallbackError
StrategyShouldAttempt = Callable[[str, str], bool]
StrategyDownload = Callable[[str, Path, CommandRunner, ProgressCallback | None], Path]
StrategyErrorMapper = Callable[[str, str, StrategyError], CommandResult]
DOUYIN_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
DOUYIN_HOST_SUFFIXES = ("douyin.com", "iesdouyin.com")
XIAOHONGSHU_HOST_SUFFIXES = ("xiaohongshu.com", "xhslink.com")
XIAOHONGSHU_NOTE_ID_PATTERN = re.compile(r"(?i)[0-9a-f]{24}")
BILIBILI_HOST_SUFFIXES = ("bilibili.com", "b23.tv")
YOUTUBE_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com")
YOUTUBE_SHORT_HOSTS = ("youtu.be", "www.youtu.be")
YOUTUBE_VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
YOUTUBE_FORMAT_SELECTOR = (
    "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/"
    "best[height<=720][ext=mp4]/"
    "bestvideo[height<=720]+bestaudio/"
    "best[height<=720]/best"
)
YOUTUBE_JS_RUNTIMES = ("deno", "node", "quickjs", "bun")
DOWNLOADED_MEDIA_SUFFIXES = (".mp4", ".mkv", ".webm", ".mov", ".m4v")
PLATFORM_SUBTITLE_ARGS = [
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "zh-Hans,zh-CN,zh-Hant,en,ja,ko",
    "--sub-format",
    "best",
]
YOUTUBE_MEDIA_URL_PATTERN = re.compile(
    r"https?://[^\s\"'<>]*(?:googlevideo\.com|videoplayback)[^\s\"'<>]*",
    re.IGNORECASE,
)
YOUTUBE_COOKIE_HINT_PATTERN = re.compile(
    r"\s*(?:use|using|try|pass)?\s*--cookies(?:-from-browser)?[^\.\n]*(?:\.|$)",
    re.IGNORECASE,
)
URL_TRAILING_PUNCTUATION = " \t\r\n\"'<>[]{}()，。！？；：、,.;:!?"


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


@dataclass(frozen=True)
class DownloadStrategy:
    name: str
    command_name: str
    should_attempt: StrategyShouldAttempt
    download: StrategyDownload
    error_type: type[Exception]
    map_error: StrategyErrorMapper


def extract_douyin_video_id(url: str) -> str | None:
    return extract_aweme_id(url)


def extract_xiaohongshu_note_id(source: str) -> str | None:
    match = XIAOHONGSHU_NOTE_ID_PATTERN.search(source)
    return match.group(0).lower() if match else None


def build_ytdlp_command(
    url: str,
    output_dir: Path,
    *,
    include_subtitles: bool = True,
) -> list[str]:
    output_template = (output_dir / "%(id)s.%(ext)s").as_posix()
    ytdlp_command = [sys.executable, "-m", "yt_dlp"]
    if should_attempt_youtube_processing(url):
        subtitle_args = PLATFORM_SUBTITLE_ARGS if include_subtitles else []
        return [
            *ytdlp_command,
            "--no-playlist",
            "-f",
            YOUTUBE_FORMAT_SELECTOR,
            "--merge-output-format",
            "mp4",
            *[
                value
                for runtime in YOUTUBE_JS_RUNTIMES
                for value in ("--js-runtimes", runtime)
            ],
            *subtitle_args,
            "-o",
            output_template,
            url,
        ]

    subtitle_args = (
        PLATFORM_SUBTITLE_ARGS
        if include_subtitles and _contains_supported_url(url, BILIBILI_HOST_SUFFIXES)
        else []
    )
    return [*ytdlp_command, "--no-playlist", *subtitle_args, "-o", output_template, url]


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
        failure_message = result.stderr or result.stdout
        is_youtube_video = should_attempt_youtube_processing(url)
        if is_youtube_video and _is_youtube_subtitle_download_failure(failure_message):
            downloaded_media = _find_downloaded_media_file(output_dir)
            if downloaded_media is not None:
                return CommandResult(
                    command=result.command,
                    returncode=0,
                    stdout=downloaded_media.as_posix(),
                    stderr=result.stderr,
                )
            result = runner(build_ytdlp_command(url, output_dir, include_subtitles=False))
            if result.returncode == 0:
                return result
            failure_message = result.stderr or result.stdout
        for strategy in FALLBACK_DOWNLOAD_STRATEGIES:
            if not strategy.should_attempt(url, failure_message):
                continue
            try:
                video_path = strategy.download(
                    url,
                    output_dir,
                    runner,
                    progress_callback,
                )
            except strategy.error_type as exc:
                fallback_result = strategy.map_error(strategy.command_name, url, exc)
                raise CommandExecutionError(fallback_result) from exc
            return CommandResult(
                command=[strategy.command_name, url],
                returncode=0,
                stdout=video_path.as_posix(),
                stderr="",
            )
        if is_youtube_video:
            raise CommandExecutionError(classify_youtube_download_failure(result))
        raise CommandExecutionError(result)
    return result


def _is_youtube_subtitle_download_failure(message: str) -> bool:
    return "unable to download video subtitles" in message.lower()


def _find_downloaded_media_file(output_dir: Path) -> Path | None:
    candidates = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.suffix.lower() in DOWNLOADED_MEDIA_SUFFIXES
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


def should_attempt_douyin_fallback(url: str, failure_message: str) -> bool:
    if not _contains_supported_url(url, DOUYIN_HOST_SUFFIXES):
        return False

    if _contains_supported_douyin_aweme_id(url):
        return True

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


def _contains_supported_douyin_aweme_id(raw_input: str) -> bool:
    for match in DOUYIN_URL_PATTERN.finditer(raw_input):
        candidate = match.group(0).rstrip(URL_TRAILING_PUNCTUATION)
        host = (urllib.parse.urlparse(candidate).hostname or "").lower().rstrip(".")
        if not any(
            host == suffix or host.endswith(f".{suffix}")
            for suffix in DOUYIN_HOST_SUFFIXES
        ):
            continue
        if extract_aweme_id(candidate):
            return True
    return False


def should_attempt_xiaohongshu_fallback(url: str, failure_message: str) -> bool:
    return bool(failure_message.strip()) and _contains_supported_url(
        url,
        XIAOHONGSHU_HOST_SUFFIXES,
    )


def should_attempt_bilibili_fallback(url: str, failure_message: str) -> bool:
    return bool(failure_message.strip()) and _contains_supported_url(
        url,
        BILIBILI_HOST_SUFFIXES,
    )


def _download_douyin_strategy(
    url: str,
    output_dir: Path,
    _runner: CommandRunner,
    progress_callback: ProgressCallback | None,
) -> Path:
    return download_douyin_video(
        url,
        output_dir=output_dir,
        progress_callback=progress_callback,
    )


def _download_xiaohongshu_strategy(
    url: str,
    output_dir: Path,
    _runner: CommandRunner,
    progress_callback: ProgressCallback | None,
) -> Path:
    return download_xiaohongshu_video(
        url,
        output_dir=output_dir,
        progress_callback=progress_callback,
    )


def _download_bilibili_strategy(
    url: str,
    output_dir: Path,
    runner: CommandRunner,
    progress_callback: ProgressCallback | None,
) -> Path:
    return download_bilibili_video(
        url,
        output_dir=output_dir,
        command_runner=runner,
        progress_callback=progress_callback,
    )


def _map_fallback_error(command_name: str, url: str, exc: StrategyError) -> CommandResult:
    return CommandResult(
        command=[command_name, url],
        returncode=1,
        stdout="",
        stderr=f"{exc.code}: {exc}",
    )


FALLBACK_DOWNLOAD_STRATEGIES: tuple[DownloadStrategy, ...] = (
    DownloadStrategy(
        name="douyin",
        command_name="douyin-fallback",
        should_attempt=should_attempt_douyin_fallback,
        download=_download_douyin_strategy,
        error_type=DouyinFallbackError,
        map_error=_map_fallback_error,
    ),
    DownloadStrategy(
        name="xiaohongshu",
        command_name="xiaohongshu-fallback",
        should_attempt=should_attempt_xiaohongshu_fallback,
        download=_download_xiaohongshu_strategy,
        error_type=XiaohongshuFallbackError,
        map_error=_map_fallback_error,
    ),
    DownloadStrategy(
        name="bilibili",
        command_name="bilibili-fallback",
        should_attempt=should_attempt_bilibili_fallback,
        download=_download_bilibili_strategy,
        error_type=BilibiliFallbackError,
        map_error=_map_fallback_error,
    ),
)


def should_attempt_youtube_processing(url: str) -> bool:
    return any(
        _is_supported_youtube_video_url(candidate)
        for candidate in _iter_url_candidates(url)
    )


def classify_youtube_download_failure(result: CommandResult) -> CommandResult:
    raw_message = result.stderr or result.stdout or "yt-dlp failed to download the YouTube video."
    normalized = raw_message.lower()
    if any(
        marker in normalized
        for marker in (
            "age-restricted",
            "age restricted",
            "confirm your age",
            "age verification",
        )
    ):
        code = "YOUTUBE_AGE_RESTRICTED"
    elif any(
        marker in normalized
        for marker in (
            "sign in",
            "login",
            "logged in",
            "not a bot",
            "captcha",
            "cookie",
            "cookies",
            "authentication",
            "verify you are",
        )
    ):
        code = "YOUTUBE_LOGIN_REQUIRED"
    elif any(
        marker in normalized
        for marker in (
            "no video formats",
            "no formats found",
            "no playable",
            "requested format is not available",
            "format is not available",
        )
    ):
        code = "YOUTUBE_NO_PLAYABLE_STREAM"
    elif any(
        marker in normalized
        for marker in (
            "private video",
            "video unavailable",
            "unavailable",
            "has been removed",
            "members-only",
            "member-only",
            "not available",
        )
    ):
        code = "YOUTUBE_PRIVATE_OR_UNAVAILABLE"
    else:
        code = "YOUTUBE_DOWNLOAD_FAILED"

    sanitized = sanitize_youtube_error(raw_message)
    if not sanitized:
        sanitized = "yt-dlp failed to download the YouTube video."

    return CommandResult(
        command=result.command,
        returncode=result.returncode,
        stdout=result.stdout,
        stderr=f"{code}: {sanitized}",
    )


def sanitize_youtube_error(message: str) -> str:
    without_media_urls = YOUTUBE_MEDIA_URL_PATTERN.sub(
        "[youtube media url removed]",
        message,
    )
    without_cookie_hints = YOUTUBE_COOKIE_HINT_PATTERN.sub(" ", without_media_urls)
    return re.sub(r"\s+", " ", without_cookie_hints).strip()


def _is_supported_youtube_video_url(candidate: str) -> bool:
    parsed = urllib.parse.urlparse(candidate)
    if parsed.scheme.lower() not in {"http", "https"}:
        return False

    host = (parsed.hostname or "").lower().rstrip(".")
    normalized_path = parsed.path.rstrip("/")
    if host in YOUTUBE_SHORT_HOSTS:
        segments = [segment for segment in normalized_path.split("/") if segment]
        return len(segments) == 1 and _is_youtube_video_id(segments[0])

    if host not in YOUTUBE_HOSTS:
        return False

    if normalized_path == "/watch":
        video_id = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
        return _is_youtube_video_id(video_id)

    segments = [segment for segment in normalized_path.split("/") if segment]
    if len(segments) == 2 and segments[0] == "shorts":
        return _is_youtube_video_id(segments[1])

    return False


def _is_youtube_video_id(value: str) -> bool:
    return bool(value) and bool(YOUTUBE_VIDEO_ID_PATTERN.fullmatch(value))


def _iter_url_candidates(raw_input: str) -> list[str]:
    return [
        match.group(0).rstrip("，。,.、!！?？)").rstrip(URL_TRAILING_PUNCTUATION)
        for match in DOUYIN_URL_PATTERN.finditer(raw_input)
    ]


def _contains_supported_url(raw_input: str, host_suffixes: tuple[str, ...]) -> bool:
    for candidate in _iter_url_candidates(raw_input):
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
