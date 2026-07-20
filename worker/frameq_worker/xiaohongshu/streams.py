from __future__ import annotations

import re
from collections.abc import Mapping

from frameq_worker.xiaohongshu.types import XiaohongshuStreamCandidate


def parse_video_streams(
    note_obj: Mapping[str, object],
    *,
    candidate_headers: Mapping[str, str],
) -> list[XiaohongshuStreamCandidate]:
    video = _as_mapping(note_obj.get("video"))
    media = _as_mapping(video.get("media") if video else None)
    stream = media.get("stream") if media else None
    raw_candidates: list[tuple[Mapping[str, object], str]] = []

    if isinstance(stream, list):
        raw_candidates.extend(
            (item, "") for item in stream if isinstance(item, Mapping)
        )
    elif isinstance(stream, Mapping):
        for codec_key, codec_streams in stream.items():
            if isinstance(codec_streams, list):
                raw_candidates.extend(
                    (item, str(codec_key))
                    for item in codec_streams
                    if isinstance(item, Mapping)
                )

    best_by_key: dict[str, XiaohongshuStreamCandidate] = {}
    for raw_candidate, codec_hint in raw_candidates:
        candidate = _parse_stream_candidate(
            raw_candidate,
            codec_hint,
            candidate_headers=candidate_headers,
        )
        if candidate is None:
            continue
        existing = best_by_key.get(candidate.quality_key)
        if existing is None or _stream_score(candidate) > _stream_score(existing):
            best_by_key[candidate.quality_key] = candidate

    return sorted(best_by_key.values(), key=_stream_score, reverse=True)


def collect_download_urls(primary_url: str, backup_urls: list[str]) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for raw_url in [primary_url, *backup_urls]:
        url = raw_url.strip()
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def _parse_stream_candidate(
    raw: Mapping[str, object],
    codec_hint: str,
    *,
    candidate_headers: Mapping[str, str],
) -> XiaohongshuStreamCandidate | None:
    urls = collect_download_urls(
        _get_str(raw, "masterUrl") or _get_str(raw, "url"),
        _get_strs(raw.get("backupUrls")),
    )
    if not urls:
        return None

    stream_type = _get_int(raw, "streamType")
    quality_name = _get_str(raw, "qualityType") or _get_str(raw, "quality")
    if not quality_name and stream_type > 0:
        quality_name = f"Stream {stream_type}"
    quality_key = _build_quality_key(quality_name, stream_type)

    return XiaohongshuStreamCandidate(
        quality_key=quality_key,
        url=urls[0],
        backup_urls=urls[1:],
        size_bytes=_get_int(raw, "size"),
        width=_optional_int(raw, "width"),
        height=_optional_int(raw, "height"),
        video_codec=_get_str(raw, "videoCodec") or codec_hint,
        video_bitrate=_get_int(raw, "videoBitrate"),
        stream_type=stream_type,
        weight=_get_int(raw, "weight"),
        default_stream=_get_int(raw, "defaultStream"),
        headers=dict(candidate_headers),
    )


def _stream_score(
    candidate: XiaohongshuStreamCandidate,
) -> tuple[int, int, int, int, int, int, int, int, int]:
    pixels = (candidate.width or 0) * (candidate.height or 0)
    return (
        1 if candidate.url.strip() else 0,
        _codec_rank(candidate.video_codec, candidate.stream_type),
        candidate.weight,
        _stream_type_rank(candidate.stream_type),
        candidate.default_stream,
        pixels,
        candidate.video_bitrate,
        candidate.size_bytes,
        len(candidate.backup_urls),
    )


def _codec_rank(codec: str, stream_type: int) -> int:
    normalized = codec.lower().replace(".", "").replace("-", "").replace("_", "").strip()
    if normalized in {"h265", "hevc"} or stream_type in {114, 115}:
        return 4
    if normalized in {"h264", "avc"} or stream_type == 259:
        return 3
    if normalized in {"av1", "h266", "vvc"}:
        return 2
    return 1


def _stream_type_rank(stream_type: int) -> int:
    if stream_type == 115:
        return 300
    if stream_type == 114:
        return 200
    if stream_type == 259:
        return 100
    return 0


def _build_quality_key(quality_name: str, stream_type: int) -> str:
    base = quality_name.strip().lower()
    if stream_type > 0:
        if not base or base.startswith("stream "):
            return f"stream_{stream_type}"
        base = re.sub(r"[\s/\\:]+", "_", base)
        return f"{base}_{stream_type}"
    return base or "default"


def _as_mapping(value: object) -> Mapping[str, object] | None:
    return value if isinstance(value, Mapping) else None


def _get_str(mapping: Mapping[str, object], key: str) -> str:
    value = mapping.get(key)
    return value.strip() if isinstance(value, str) else ""


def _get_strs(value: object) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]
    return []


def _get_int(mapping: Mapping[str, object], key: str) -> int:
    value = mapping.get(key)
    try:
        return int(value) if value is not None else 0
    except (TypeError, ValueError):
        return 0


def _optional_int(mapping: Mapping[str, object], key: str) -> int | None:
    value = _get_int(mapping, key)
    return value if value else None
