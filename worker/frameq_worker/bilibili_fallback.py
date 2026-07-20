from __future__ import annotations

import os
from pathlib import Path

from frameq_worker.bilibili.artifacts import (
    cleanup_completed_dash_files,
    cleanup_transient_artifacts,
    download_first_available_url,
    merge_dash_files,
    run_command,
)
from frameq_worker.bilibili.playback import (
    build_playurl_url,
    build_video_info_url,
    parse_playurl_response,
    parse_view_response,
    select_dash_stream_pair,
)
from frameq_worker.bilibili.source import (
    _parse_direct_id,
)
from frameq_worker.bilibili.source import (
    parse_bilibili_input as _parse_bilibili_input,
)
from frameq_worker.bilibili.transport import UrllibBilibiliHttpClient, api_headers
from frameq_worker.bilibili.types import (
    BilibiliDashSelection,
    BilibiliFallbackError,
    BilibiliPage,
    BilibiliParseResult,
    BilibiliVideoInfo,
    CommandResult,
    HttpResponse,
)
from frameq_worker.progress_events import build_worker_progress_event

__all__ = [
    "BilibiliFallbackError",
    "HttpResponse",
    "CommandResult",
    "BilibiliParseResult",
    "BilibiliPage",
    "BilibiliVideoInfo",
    "BilibiliDashSelection",
    "UrllibBilibiliHttpClient",
    "parse_bilibili_input",
    "build_video_info_url",
    "build_playurl_url",
    "select_dash_stream_pair",
    "download_bilibili_video",
]


def parse_bilibili_input(
    raw_input: str,
    http_client: UrllibBilibiliHttpClient | None = None,
) -> BilibiliParseResult:
    direct = _parse_direct_id(raw_input.strip())
    if direct is not None:
        return direct
    client = http_client or UrllibBilibiliHttpClient()
    return _parse_bilibili_input(raw_input, http_client=client)


def download_bilibili_video(
    raw_input: str,
    output_dir: Path,
    command_runner: object | None = None,
    http_client: UrllibBilibiliHttpClient | None = None,
    progress_callback: object | None = None,
) -> Path:
    client = http_client or UrllibBilibiliHttpClient()
    runner = command_runner or run_command
    parsed = parse_bilibili_input(raw_input, http_client=client)

    _emit_progress(progress_callback, "bilibili.metadata.resolving", 22)
    view_response = client.get(
        build_video_info_url(parsed.id_kind, parsed.video_id),
        headers=api_headers(),
        timeout_seconds=10.0,
    )
    video_info = parse_view_response(view_response)
    if not video_info.pages or parsed.part_index >= len(video_info.pages):
        raise BilibiliFallbackError(
            "BILIBILI_PART_NOT_FOUND",
            "Requested Bilibili part does not exist.",
        )
    selected_page = video_info.pages[parsed.part_index]

    _emit_progress(progress_callback, "bilibili.stream.probing", 26)
    playurl_response = client.get(
        build_playurl_url(video_info.bvid, selected_page.cid),
        headers=api_headers(),
        timeout_seconds=10.0,
    )
    playurl_data = parse_playurl_response(playurl_response)
    selection = select_dash_stream_pair(
        playurl_data,
        duration_seconds=selected_page.duration_seconds,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    stem = (
        video_info.bvid
        if selected_page.page <= 1
        else f"{video_info.bvid}_p{selected_page.page}"
    )
    output_path = output_dir / f"{stem}.mp4"
    video_temp_path = output_dir / f"{stem}_video.m4s"
    audio_temp_path = output_dir / f"{stem}_audio.m4s"
    merge_temp_path = output_dir / f"{stem}.merge.mp4"

    try:
        _emit_progress(progress_callback, "bilibili.video.downloading", 30)
        download_first_available_url(
            [selection.video_url, *selection.video_backup_urls],
            video_temp_path,
            client,
        )
        _emit_progress(progress_callback, "bilibili.audio.downloading", 32)
        download_first_available_url(
            [selection.audio_url, *selection.audio_backup_urls],
            audio_temp_path,
            client,
        )
        _emit_progress(progress_callback, "bilibili.media.merging", 34)
        merge_dash_files(video_temp_path, audio_temp_path, merge_temp_path, runner)
        os.replace(merge_temp_path, output_path)
    except BilibiliFallbackError:
        raise
    finally:
        cleanup_transient_artifacts(video_temp_path, audio_temp_path, merge_temp_path)
    cleanup_completed_dash_files(video_temp_path, audio_temp_path)
    return output_path


def _emit_progress(
    progress_callback: object | None,
    message_code: str,
    progress: int,
) -> None:
    event = build_worker_progress_event(
        message_code,
        stage="video_extracting",
        progress=progress,
    )
    if not callable(progress_callback):
        return
    progress_callback(event)
