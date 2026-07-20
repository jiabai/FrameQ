from __future__ import annotations

import subprocess
from pathlib import Path

from frameq_worker.bilibili.transport import download_url_to_path
from frameq_worker.bilibili.types import (
    BilibiliFallbackError,
    BilibiliRequestClient,
    CommandResult,
)
from frameq_worker.download_reliability import SafeDownloadError


def cleanup_transient_artifacts(
    video_path: Path,
    audio_path: Path,
    merge_path: Path,
) -> None:
    merge_path.unlink(missing_ok=True)
    video_path.with_name(f"{video_path.name}.part").unlink(missing_ok=True)
    audio_path.with_name(f"{audio_path.name}.part").unlink(missing_ok=True)


def cleanup_completed_dash_files(video_path: Path, audio_path: Path) -> None:
    video_path.unlink(missing_ok=True)
    audio_path.unlink(missing_ok=True)


def download_first_available_url(
    urls: list[str],
    output_path: Path,
    http_client: BilibiliRequestClient,
) -> Path:
    last_error: Exception | None = None
    for url in urls:
        try:
            download_url_to_path(url, output_path, http_client)
        except (SafeDownloadError, BilibiliFallbackError, OSError) as exc:
            last_error = exc
            continue
        return output_path

    raise BilibiliFallbackError(
        "BILIBILI_DASH_DOWNLOAD_FAILED",
        "All Bilibili DASH media URLs failed to download.",
    ) from last_error


def merge_dash_files(
    video_path: Path,
    audio_path: Path,
    output_path: Path,
    command_runner: object,
) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path.as_posix(),
        "-i",
        audio_path.as_posix(),
        "-c",
        "copy",
        output_path.as_posix(),
    ]
    result = command_runner(command) if callable(command_runner) else run_command(command)
    if getattr(result, "returncode", 1) != 0:
        raise BilibiliFallbackError(
            "BILIBILI_FFMPEG_MERGE_FAILED",
            "ffmpeg exited with a non-zero status while merging Bilibili DASH streams.",
        )
    if not output_path.is_file() or output_path.stat().st_size <= 0:
        raise BilibiliFallbackError(
            "BILIBILI_FFMPEG_MERGE_FAILED",
            "ffmpeg did not produce a merged Bilibili MP4.",
        )


def run_command(command: list[str]) -> CommandResult:
    completed = subprocess.run(command, capture_output=True, check=False, text=True)
    return CommandResult(
        command=command,
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )
