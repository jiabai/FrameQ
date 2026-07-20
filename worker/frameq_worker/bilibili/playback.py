from __future__ import annotations

import json
import urllib.parse
from collections.abc import Mapping

from frameq_worker.bilibili.transport import decode_response_body
from frameq_worker.bilibili.types import (
    BilibiliDashSelection,
    BilibiliFallbackError,
    BilibiliPage,
    BilibiliVideoInfo,
    HttpResponse,
)

BILIBILI_API_BASE_URL = "https://api.bilibili.com"
BILIBILI_CODEC_RANK = {13: 300, 12: 200, 7: 100}


def build_video_info_url(id_kind: str, video_id: str) -> str:
    query_key = "aid" if id_kind == "aid" else "bvid"
    encoded_id = urllib.parse.quote(str(video_id), safe="")
    return f"{BILIBILI_API_BASE_URL}/x/web-interface/view?{query_key}={encoded_id}"


def build_playurl_url(bvid: str, cid: int) -> str:
    encoded_bvid = urllib.parse.quote(bvid, safe="")
    return (
        f"{BILIBILI_API_BASE_URL}/x/player/playurl?"
        f"bvid={encoded_bvid}&cid={cid}&fnval=4048&fnver=0&fourk=1"
    )


def select_dash_stream_pair(
    data: Mapping[str, object],
    duration_seconds: int,
) -> BilibiliDashSelection:
    _raise_if_drm(data)
    dash = _as_mapping(data.get("dash"))
    if not dash:
        raise BilibiliFallbackError(
            "BILIBILI_NO_PLAYABLE_STREAM",
            "Bilibili playurl response did not include DASH streams.",
        )

    videos = dash.get("video")
    audios = dash.get("audio")
    if not isinstance(videos, list) or not isinstance(audios, list):
        raise BilibiliFallbackError(
            "BILIBILI_NO_PLAYABLE_STREAM",
            "Bilibili DASH response did not include video and audio streams.",
        )

    video_streams = [
        item for item in videos if isinstance(item, Mapping) and _collect_dash_urls(item)
    ]
    audio_streams = [
        item for item in audios if isinstance(item, Mapping) and _collect_dash_urls(item)
    ]
    for item in [*video_streams, *audio_streams]:
        _raise_if_drm(item)

    if not video_streams or not audio_streams:
        raise BilibiliFallbackError(
            "BILIBILI_NO_PLAYABLE_STREAM",
            "Bilibili DASH response returned no playable video/audio pair.",
        )

    best_video = max(video_streams, key=_video_stream_score)
    best_audio = max(audio_streams, key=_audio_stream_score)
    video_urls = _collect_dash_urls(best_video)
    audio_urls = _collect_dash_urls(best_audio)
    return BilibiliDashSelection(
        video_url=video_urls[0],
        audio_url=audio_urls[0],
        video_backup_urls=video_urls[1:],
        audio_backup_urls=audio_urls[1:],
        video_codec_id=_get_int(best_video, "codecid"),
        quality=_get_int(best_video, "id"),
        quality_name=_quality_name(data, _get_int(best_video, "id")),
    )


def parse_view_response(response: HttpResponse) -> BilibiliVideoInfo:
    payload = _json_response(response, unavailable_code="BILIBILI_VIDEO_INFO_UNAVAILABLE")
    data = _api_data(payload, unavailable_code="BILIBILI_VIDEO_INFO_UNAVAILABLE")
    if not isinstance(data, Mapping):
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili video information response was malformed.",
        )

    bvid = _get_str(data, "bvid")
    aid = _get_int(data, "aid")
    pages_obj = data.get("pages")
    pages: list[BilibiliPage] = []
    if isinstance(pages_obj, list):
        for raw_page in pages_obj:
            if not isinstance(raw_page, Mapping):
                continue
            cid = _get_int(raw_page, "cid")
            if cid <= 0:
                continue
            pages.append(
                BilibiliPage(
                    cid=cid,
                    page=_get_int(raw_page, "page") or len(pages) + 1,
                    part=_get_str(raw_page, "part"),
                    duration_seconds=_get_int(raw_page, "duration"),
                )
            )
    if not bvid or aid <= 0 or not pages:
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili video information was incomplete.",
        )
    return BilibiliVideoInfo(
        bvid=bvid,
        aid=aid,
        title=_get_str(data, "title"),
        pages=pages,
    )


def parse_playurl_response(response: HttpResponse) -> Mapping[str, object]:
    payload = _json_response(response, unavailable_code="BILIBILI_NO_PLAYABLE_STREAM")
    data = _api_data(payload, unavailable_code="BILIBILI_NO_PLAYABLE_STREAM")
    if not isinstance(data, Mapping):
        raise BilibiliFallbackError(
            "BILIBILI_NO_PLAYABLE_STREAM",
            "Bilibili playurl response was malformed.",
        )
    return data


def _json_response(response: HttpResponse, *, unavailable_code: str) -> Mapping[str, object]:
    if response.status in {401, 403}:
        raise BilibiliFallbackError(
            "BILIBILI_LOGIN_REQUIRED",
            "Bilibili video requires login or account authorization.",
        )
    if response.status < 200 or response.status >= 300 or not response.body:
        raise BilibiliFallbackError(unavailable_code, "Bilibili API response was unavailable.")

    body = decode_response_body(response)
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise BilibiliFallbackError(
            unavailable_code,
            "Bilibili API response was not JSON.",
        ) from exc
    if not isinstance(payload, Mapping):
        raise BilibiliFallbackError(unavailable_code, "Bilibili API response was malformed.")
    return payload


def _api_data(payload: Mapping[str, object], *, unavailable_code: str) -> object:
    code = _get_int(payload, "code")
    if code != 0:
        message = _get_str(payload, "message") or _get_str(payload, "msg")
        lowered = message.lower()
        if code in {-101, -102, -104, -404, -403} or any(
            marker in lowered for marker in ("login", "登录", "权限", "会员", "vip")
        ):
            raise BilibiliFallbackError(
                "BILIBILI_LOGIN_REQUIRED",
                "Bilibili video requires login or account authorization.",
            )
        raise BilibiliFallbackError(unavailable_code, "Bilibili API returned an error.")
    return payload.get("data")


def _video_stream_score(item: Mapping[str, object]) -> tuple[int, int, int, int, int]:
    codecid = _get_int(item, "codecid")
    pixels = _get_int(item, "width") * _get_int(item, "height")
    return (
        BILIBILI_CODEC_RANK.get(codecid, 0),
        _get_int(item, "bandwidth"),
        pixels,
        _get_int(item, "id"),
        len(_collect_dash_urls(item)),
    )


def _audio_stream_score(item: Mapping[str, object]) -> tuple[int, int, int]:
    return (
        _get_int(item, "bandwidth"),
        _get_int(item, "id"),
        len(_collect_dash_urls(item)),
    )


def _collect_dash_urls(item: Mapping[str, object]) -> list[str]:
    primary = _get_str(item, "baseUrl") or _get_str(item, "base_url")
    backups = _get_strs(item.get("backupUrl")) + _get_strs(item.get("backup_url"))
    return _collect_download_urls(primary, backups)


def _collect_download_urls(primary_url: str, backup_urls: list[str]) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for raw_url in [primary_url, *backup_urls]:
        url = raw_url.strip()
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def _raise_if_drm(item: Mapping[str, object]) -> None:
    if _get_int(item, "drm_tech_type") > 0 or _get_str(item, "bilidrm_uri"):
        raise BilibiliFallbackError(
            "BILIBILI_DRM_PROTECTED",
            "Selected Bilibili DASH stream is DRM protected.",
        )


def _quality_name(data: Mapping[str, object], quality_id: int) -> str:
    formats = data.get("support_formats")
    if isinstance(formats, list):
        for item in formats:
            if not isinstance(item, Mapping) or _get_int(item, "quality") != quality_id:
                continue
            return (
                _get_str(item, "new_description")
                or _get_str(item, "display_desc")
                or _get_str(item, "description")
            )
    return ""


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
