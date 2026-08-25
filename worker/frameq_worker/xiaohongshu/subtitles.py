from __future__ import annotations

import json
import re
from collections.abc import Mapping
from urllib.parse import urlsplit

from frameq_worker.xiaohongshu.types import XiaohongshuSubtitleTrack

PREFERRED_SUBTITLE_GROUPS = (
    "source",
    "zh-Hans",
    "zh-CN",
    "zh-Hant",
    "zh",
    "en-US",
    "en",
    "ja",
    "ko",
)
SUBTITLE_HOST_SUFFIXES = ("xhscdn.com", "xiaohongshu.com")
_LANGUAGE_TAG = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){0,3}$")
_SUPPORTED_SUFFIXES = {".srt", ".vtt"}


def _mapping(value: object) -> Mapping[str, object] | None:
    return value if isinstance(value, Mapping) else None


def _normalise_language(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    language = value.strip().replace("_", "-")
    if not _LANGUAGE_TAG.fullmatch(language):
        return None
    parts = language.split("-")
    normalized = [parts[0].lower()]
    for part in parts[1:]:
        if len(part) == 4 and part.isalpha():
            normalized.append(part.title())
        elif len(part) in {2, 3}:
            normalized.append(part.upper())
        else:
            normalized.append(part)
    return "-".join(normalized)


def is_allowed_subtitle_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname
    except ValueError:
        return False
    if parsed.scheme.lower() != "https" or not hostname:
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    normalized_host = hostname.rstrip(".").lower()
    return any(
        normalized_host == suffix or normalized_host.endswith(f".{suffix}")
        for suffix in SUBTITLE_HOST_SUFFIXES
    )


def _suffix_for_track(track: Mapping[str, object], url: str) -> str | None:
    explicit_format = track.get("format")
    if explicit_format is not None:
        if not isinstance(explicit_format, str):
            return None
        format_name = explicit_format.strip().lower().lstrip(".")
        if format_name not in {"srt", "vtt"}:
            return None
        return f".{format_name}"

    path = urlsplit(url).path.lower()
    for suffix in _SUPPORTED_SUFFIXES:
        if path.endswith(suffix):
            return suffix
    last_segment = path.rsplit("/", 1)[-1]
    if "." in last_segment:
        return None
    return ".srt"


def _parse_track(
    raw_track: object,
    group_name: str,
) -> XiaohongshuSubtitleTrack | None:
    track = _mapping(raw_track)
    if track is None:
        return None
    raw_url = track.get("url")
    if not isinstance(raw_url, str) or not raw_url.strip():
        return None
    url = raw_url.strip()
    if not is_allowed_subtitle_url(url):
        return None

    raw_language = track.get("language")
    if raw_language is None and group_name != "source":
        raw_language = group_name
    language = _normalise_language(raw_language)
    if language is None:
        return None
    suffix = _suffix_for_track(track, url)
    if suffix is None:
        return None
    return XiaohongshuSubtitleTrack(language=language, url=url, suffix=suffix)


def select_preferred_subtitle_track(
    note_obj: Mapping[str, object],
) -> XiaohongshuSubtitleTrack | None:
    video = _mapping(note_obj.get("video"))
    raw_media_v2 = video.get("mediaV2") if video else None
    if not isinstance(raw_media_v2, str) or not raw_media_v2.strip():
        return None
    try:
        media_v2 = json.loads(raw_media_v2)
    except json.JSONDecodeError:
        return None
    media_video = _mapping(media_v2.get("video")) if isinstance(media_v2, Mapping) else None
    groups = _mapping(media_video.get("subtitles")) if media_video else None
    if groups is None:
        return None
    for group_name in PREFERRED_SUBTITLE_GROUPS:
        raw_tracks = groups.get(group_name)
        if not isinstance(raw_tracks, list):
            continue
        for raw_track in raw_tracks:
            track = _parse_track(raw_track, group_name)
            if track is not None:
                return track
    return None
