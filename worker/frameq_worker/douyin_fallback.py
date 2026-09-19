from __future__ import annotations

import random
import time
from collections.abc import Callable
from pathlib import Path

from frameq_worker.douyin.page import parse_share_page_router_data
from frameq_worker.douyin.source import build_share_page_url, resolve_aweme_id_from_input
from frameq_worker.douyin.source import extract_aweme_id as extract_aweme_id
from frameq_worker.douyin.streams import PLAY_QUALITIES as PLAY_QUALITIES
from frameq_worker.douyin.streams import build_play_url as build_play_url
from frameq_worker.douyin.streams import (
    collect_stream_candidates,
    select_stream_candidates,
)
from frameq_worker.douyin.transport import (
    DOUYIN_MOBILE_USER_AGENT as DOUYIN_MOBILE_USER_AGENT,
)
from frameq_worker.douyin.transport import (
    UrllibDouyinHttpClient,
    download_ordered_candidates,
    public_headers,
)
from frameq_worker.douyin.types import (
    DouyinFallbackError,
    DouyinStreamCandidate,
)
from frameq_worker.douyin.types import HttpResponse as HttpResponse
from frameq_worker.progress_events import build_worker_progress_event

SHARE_PAGE_ATTEMPTS = 3
SHARE_PAGE_RETRY_DELAY_RANGE_SECONDS = (3.0, 10.0)
SHARE_PAGE_RETRYABLE_ERROR_CODES = frozenset(
    {
        "DOUYIN_ROUTER_DATA_MISSING",
        "DOUYIN_ROUTER_DATA_MALFORMED",
        "DOUYIN_SHARE_PAGE_UNAVAILABLE",
    }
)


def download_first_available_candidate(
    aweme_id: str,
    candidates: list[DouyinStreamCandidate],
    output_dir: Path,
    http_client: UrllibDouyinHttpClient,
    timeout_seconds: float = 30.0,
    progress_callback: object | None = None,
) -> Path:
    sorted_candidates = select_stream_candidates(candidates)
    return download_ordered_candidates(
        aweme_id=aweme_id,
        candidates=sorted_candidates,
        output_dir=output_dir,
        http_client=http_client,
        timeout_seconds=timeout_seconds,
        on_candidate_failed=lambda failed_index, total: _emit_stream_retry(
            progress_callback,
            failed_index,
            total,
        ),
    )


def resolve_share_page_item(
    aweme_id: str,
    http_client: UrllibDouyinHttpClient,
    progress_callback: object | None = None,
    sleeper: Callable[[float], None] | None = None,
) -> dict[str, object]:
    """Fetch and parse the public share page, retrying transient SSR degradation.

    The Douyin share page intermittently serves a slimmed-down document without
    ``videoInfoRes``. That is a transient server-side variant, so the same
    request is retried after a randomized delay instead of failing the task.
    """
    sleep = sleeper or time.sleep
    last_error: DouyinFallbackError | None = None

    for attempt in range(1, SHARE_PAGE_ATTEMPTS + 1):
        try:
            return _fetch_share_page_item(aweme_id, http_client)
        except DouyinFallbackError as exc:
            if exc.code not in SHARE_PAGE_RETRYABLE_ERROR_CODES:
                raise
            last_error = exc
            next_attempt = attempt + 1
            if next_attempt > SHARE_PAGE_ATTEMPTS:
                break
            _emit_progress(
                progress_callback,
                "douyin.page.retrying",
                22,
                {"attempt": next_attempt, "total": SHARE_PAGE_ATTEMPTS},
            )
            sleep(random.uniform(*SHARE_PAGE_RETRY_DELAY_RANGE_SECONDS))

    assert last_error is not None
    raise last_error


def _fetch_share_page_item(
    aweme_id: str,
    http_client: UrllibDouyinHttpClient,
) -> dict[str, object]:
    share_response = http_client.get(
        build_share_page_url(aweme_id),
        headers=public_headers(),
        timeout_seconds=10.0,
    )
    if share_response.status != 200 or not share_response.body:
        raise DouyinFallbackError(
            "DOUYIN_SHARE_PAGE_UNAVAILABLE",
            "Douyin public share page was unavailable.",
        )

    return parse_share_page_router_data(
        share_response.body.decode("utf-8", errors="replace")
    )


def download_douyin_video(
    url: str,
    output_dir: Path,
    http_client: UrllibDouyinHttpClient | None = None,
    progress_callback: object | None = None,
    sleeper: Callable[[float], None] | None = None,
) -> Path:
    client = http_client or UrllibDouyinHttpClient()
    aweme_id = resolve_aweme_id_from_input(url, http_client=client)
    if aweme_id is None:
        raise DouyinFallbackError(
            "DOUYIN_ID_PARSE_FAILED",
            "Could not extract Douyin video ID from URL.",
        )

    _emit_progress(progress_callback, "douyin.page.resolving", 22)
    item = resolve_share_page_item(
        aweme_id,
        http_client=client,
        progress_callback=progress_callback,
        sleeper=sleeper,
    )

    _emit_progress(progress_callback, "douyin.stream.probing", 26)
    candidates = collect_stream_candidates(item, http_client=client)
    if not candidates:
        raise DouyinFallbackError(
            "DOUYIN_NO_PLAYABLE_STREAM",
            "Douyin public share page returned no playable streams.",
        )

    _emit_progress(progress_callback, "douyin.video.saving", 30)
    return download_first_available_candidate(
        aweme_id=aweme_id,
        candidates=candidates,
        output_dir=output_dir,
        http_client=client,
        progress_callback=progress_callback,
    )


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
    total: int,
) -> None:
    if not callable(progress_callback) or failed_index >= total - 1:
        return
    attempt = failed_index + 2
    if not 1 <= attempt <= total <= 100:
        return
    _emit_progress(
        progress_callback,
        "douyin.stream.retrying",
        30,
        message_args={"attempt": attempt, "total": total},
    )
