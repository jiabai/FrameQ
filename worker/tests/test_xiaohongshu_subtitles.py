from __future__ import annotations

import json
from collections.abc import Mapping

import pytest
from frameq_worker.xiaohongshu.subtitles import (
    is_allowed_subtitle_url,
    select_preferred_subtitle_track,
)
from frameq_worker.xiaohongshu.types import XiaohongshuSubtitleTrack


def note_with_groups(groups: Mapping[str, object]) -> dict[str, object]:
    return {
        "video": {
            "mediaV2": json.dumps({"video": {"subtitles": dict(groups)}}),
        }
    }


def test_selects_source_track_before_language_groups() -> None:
    note = note_with_groups(
        {
            "en-US": [
                {
                    "language": "en-US",
                    "url": "https://sns-video-a.xhscdn.com/en.srt",
                }
            ],
            "source": [
                {
                    "language": "zh-CN",
                    "url": "https://sns-video-a.xhscdn.com/source.srt",
                }
            ],
            "zh-CN": [
                {
                    "language": "zh-CN",
                    "url": "https://sns-video-a.xhscdn.com/zh.srt",
                }
            ],
        }
    )

    assert select_preferred_subtitle_track(note) == XiaohongshuSubtitleTrack(
        language="zh-CN",
        url="https://sns-video-a.xhscdn.com/source.srt",
        suffix=".srt",
    )


def test_falls_back_to_preferred_language_group_and_normalizes_language() -> None:
    note = note_with_groups(
        {
            "source": [{"url": "https://sns-video-a.xhscdn.com/source.srt"}],
            "zh-CN": [
                {
                    "language": "zh_CN",
                    "url": "https://sns-video-a.xhscdn.com/zh.vtt",
                    "format": "vtt",
                }
            ],
        }
    )

    assert select_preferred_subtitle_track(note) == XiaohongshuSubtitleTrack(
        language="zh-CN",
        url="https://sns-video-a.xhscdn.com/zh.vtt",
        suffix=".vtt",
    )


def test_selects_platform_numeric_srt_format() -> None:
    note = note_with_groups(
        {
            "source": [
                {
                    "language": "zh-CN",
                    "url": (
                        "https://sns-subtitle-s1.xhscdn.com/source.srt"
                        "?sign=redacted"
                    ),
                    "format": 0,
                }
            ]
        }
    )

    assert select_preferred_subtitle_track(note) == XiaohongshuSubtitleTrack(
        language="zh-CN",
        url=(
            "https://sns-subtitle-s1.xhscdn.com/source.srt"
            "?sign=redacted"
        ),
        suffix=".srt",
    )


@pytest.mark.parametrize(
    "note",
    [
        {"video": {"mediaV2": "not-json"}},
        {"video": {"mediaV2": json.dumps([])}},
        {"video": {"mediaV2": json.dumps({"video": {"subtitles": []}})}},
        {
            "video": {
                "mediaV2": json.dumps({"video": {"subtitles": {"zh-CN": {}}}})
            }
        },
        {"video": {"mediaV2": json.dumps({"video": {"subtitles": {}}})}},
        {"video": {"mediaV2": ""}},
        {},
    ],
)
def test_malformed_media_v2_returns_none(note: dict[str, object]) -> None:
    assert select_preferred_subtitle_track(note) is None


@pytest.mark.parametrize(
    "track",
    [
        {"url": "http://sns-video-a.xhscdn.com/source.srt", "language": "zh-CN"},
        {
            "url": "https://user:password@sns-video-a.xhscdn.com/source.srt",
            "language": "zh-CN",
        },
        {"url": "https://cdn.example/source.srt", "language": "zh-CN"},
        {
            "url": "https://sns-video-a.xhscdn.com/source.ass",
            "language": "zh-CN",
            "format": "ass",
        },
        {
            "url": "https://sns-video-a.xhscdn.com/source.srt",
            "language": "not a language",
        },
        {
            "url": "https://sns-video-a.xhscdn.com/source.srt",
            "language": "zh-CN",
            "format": 1,
        },
        {"url": "https://sns-video-a.xhscdn.com/source.srt"},
    ],
)
def test_rejects_invalid_or_unsupported_tracks(track: dict[str, object]) -> None:
    assert select_preferred_subtitle_track(note_with_groups({"source": [track]})) is None


def test_skips_invalid_tracks_and_selects_first_valid_track() -> None:
    note = note_with_groups(
        {
            "source": [
                {"url": "https://cdn.example/blocked.srt", "language": "zh-CN"},
                {
                    "url": "https://sns-video-a.xhscdn.com/valid.srt",
                    "language": "zh-CN",
                },
                {
                    "url": "https://sns-video-a.xhscdn.com/later.srt",
                    "language": "zh-CN",
                },
            ]
        }
    )

    assert select_preferred_subtitle_track(note) == XiaohongshuSubtitleTrack(
        language="zh-CN",
        url="https://sns-video-a.xhscdn.com/valid.srt",
        suffix=".srt",
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://xhscdn.com/source.srt",
        "https://sns-video-a.xhscdn.com/source.srt?sign=redacted",
        "https://www.xiaohongshu.com/explore/source.srt",
    ],
)
def test_allows_https_xiaohongshu_subtitle_hosts(url: str) -> None:
    assert is_allowed_subtitle_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://xhscdn.com/source.srt",
        "https://user:x@sns-video-a.xhscdn.com/source.srt",
        "https://cdn.example/source.srt",
        "https://xhscdn.com.evil.example/source.srt",
    ],
)
def test_rejects_unsafe_subtitle_urls(url: str) -> None:
    assert not is_allowed_subtitle_url(url)
