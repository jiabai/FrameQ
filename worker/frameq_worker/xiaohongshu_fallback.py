from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from frameq_worker.progress_events import build_worker_progress_event
from frameq_worker.xiaohongshu.page import (
    decode_response_body as _decode_response_body,
)
from frameq_worker.xiaohongshu.page import (
    extract_initial_state as _extract_initial_state,
)
from frameq_worker.xiaohongshu.page import (
    is_image_only_note as _is_image_only_note,
)
from frameq_worker.xiaohongshu.page import (
    lookup_note as _lookup_note,
)
from frameq_worker.xiaohongshu.page import (
    raise_for_page_response as _raise_for_page_response,
)
from frameq_worker.xiaohongshu.source import (
    build_explore_url,
    parse_xiaohongshu_source,
)
from frameq_worker.xiaohongshu.streams import (
    collect_download_urls as _collect_download_urls,
)
from frameq_worker.xiaohongshu.streams import (
    parse_video_streams,
)
from frameq_worker.xiaohongshu.transport import (
    XHS_DESKTOP_USER_AGENT as _XHS_DESKTOP_USER_AGENT,
)
from frameq_worker.xiaohongshu.transport import (
    XHS_REFERER as _XHS_REFERER,
)
from frameq_worker.xiaohongshu.transport import (
    UrllibXiaohongshuHttpClient,
    is_download_attempt_error,
)
from frameq_worker.xiaohongshu.transport import (
    download_stream_to_path as _download_stream_to_path,
)
from frameq_worker.xiaohongshu.transport import (
    map_download_error as _map_download_error,
)
from frameq_worker.xiaohongshu.transport import (
    media_headers as _media_headers,
)
from frameq_worker.xiaohongshu.transport import (
    page_headers as _page_headers,
)
from frameq_worker.xiaohongshu.types import (
    HttpResponse as _HttpResponse,
)
from frameq_worker.xiaohongshu.types import (
    XiaohongshuDownloadClient,
    XiaohongshuFallbackError,
    XiaohongshuHttpClient,
    XiaohongshuParseResult,
    XiaohongshuStreamCandidate,
)

XHS_DESKTOP_USER_AGENT = _XHS_DESKTOP_USER_AGENT
XHS_REFERER = _XHS_REFERER
HttpResponse = _HttpResponse


def parse_xiaohongshu_input(
    raw_input: str,
    http_client: XiaohongshuHttpClient | None = None,
) -> XiaohongshuParseResult:
    return parse_xiaohongshu_source(
        raw_input,
        http_client=http_client,
        client_factory=UrllibXiaohongshuHttpClient,
    )


def parse_video_stream_candidates(
    state: Mapping[str, object],
    note_id: str,
) -> list[XiaohongshuStreamCandidate]:
    note_obj = _lookup_note(state, note_id)
    return parse_video_streams(note_obj, candidate_headers=_media_headers())


def download_xiaohongshu_video(
    raw_input: str,
    output_dir: Path,
    http_client: XiaohongshuDownloadClient | None = None,
    progress_callback: object | None = None,
) -> Path:
    client = http_client or UrllibXiaohongshuHttpClient()
    parsed = parse_xiaohongshu_input(raw_input, http_client=client)

    _emit_progress(progress_callback, "xiaohongshu.page.resolving", 22)
    page_response = client.get(
        build_explore_url(parsed.note_id, parsed.xsec_token),
        headers=_page_headers(),
        timeout_seconds=10.0,
    )
    _raise_for_page_response(page_response)

    state = _extract_initial_state(_decode_response_body(page_response))
    note_obj = _lookup_note(state, parsed.note_id)
    candidates = parse_video_streams(note_obj, candidate_headers=_media_headers())
    if not candidates:
        if _is_image_only_note(note_obj):
            raise XiaohongshuFallbackError(
                "XHS_IMAGE_ONLY",
                "Xiaohongshu note is image-only and has no playable video.",
            )
        raise XiaohongshuFallbackError(
            "XHS_NO_PLAYABLE_STREAM",
            "Xiaohongshu public note returned no playable video stream.",
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{parsed.note_id}.mp4"
    _emit_progress(progress_callback, "xiaohongshu.video.saving", 30)
    return _download_first_available_stream(
        candidates,
        output_path=output_path,
        http_client=client,
        progress_callback=progress_callback,
    )


def _download_first_available_stream(
    candidates: list[XiaohongshuStreamCandidate],
    output_path: Path,
    http_client: XiaohongshuDownloadClient,
    progress_callback: object | None = None,
) -> Path:
    last_error: Exception | None = None
    for index, candidate in enumerate(candidates):
        for stream_url in _stream_urls(candidate):
            try:
                _download_stream_to_path(stream_url, output_path, http_client)
            except Exception as exc:
                if not is_download_attempt_error(exc):
                    raise
                last_error = exc
                continue
            return output_path
        _emit_stream_retry(progress_callback, index, candidates)

    raise _map_download_error(last_error) from last_error


def _stream_urls(candidate: XiaohongshuStreamCandidate) -> list[str]:
    return _collect_download_urls(candidate.url, candidate.backup_urls)


def _emit_progress(
    progress_callback: object | None,
    message_code: str,
    progress: int,
    message_args: dict[str, int] | None = None,
) -> None:
    if not callable(progress_callback):
        return
    event = build_worker_progress_event(
        message_code,
        stage="video_extracting",
        progress=progress,
        message_args=message_args,
    )
    progress_callback(event)


def _emit_stream_retry(
    progress_callback: object | None,
    failed_index: int,
    candidates: list[XiaohongshuStreamCandidate],
) -> None:
    if not callable(progress_callback) or failed_index >= len(candidates) - 1:
        return
    attempt = failed_index + 2
    total = len(candidates)
    if not 1 <= attempt <= total <= 100:
        return
    _emit_progress(
        progress_callback,
        "xiaohongshu.stream.retrying",
        30,
        message_args={"attempt": attempt, "total": total},
    )
