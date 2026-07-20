from __future__ import annotations

import json

from frameq_worker.douyin.types import DouyinFallbackError


def parse_share_page_router_data(html: str) -> dict[str, object]:
    marker_index = html.find("window._ROUTER_DATA")
    if marker_index < 0:
        raise DouyinFallbackError(
            "DOUYIN_ROUTER_DATA_MISSING",
            "Douyin share page did not include router data.",
        )

    equals_index = html.find("=", marker_index)
    json_start = html.find("{", equals_index)
    if equals_index < 0 or json_start < 0:
        raise DouyinFallbackError(
            "DOUYIN_ROUTER_DATA_MISSING",
            "Douyin share page router data was not parseable.",
        )

    try:
        router_data, _ = json.JSONDecoder().raw_decode(html[json_start:])
    except json.JSONDecodeError as exc:
        raise DouyinFallbackError(
            "DOUYIN_ROUTER_DATA_MALFORMED",
            "Douyin share page router data was malformed.",
        ) from exc

    video_info = _find_video_info_res(router_data)
    item_list = video_info.get("item_list") if isinstance(video_info, dict) else None
    if not isinstance(item_list, list) or not item_list or not isinstance(item_list[0], dict):
        raise DouyinFallbackError(
            "DOUYIN_ROUTER_DATA_MISSING",
            "Douyin share page did not include a playable item.",
        )
    return item_list[0]


def _find_video_info_res(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        maybe_video_info = value.get("videoInfoRes")
        if isinstance(maybe_video_info, dict):
            return maybe_video_info
        for child in value.values():
            try:
                return _find_video_info_res(child)
            except DouyinFallbackError:
                continue
    elif isinstance(value, list):
        for child in value:
            try:
                return _find_video_info_res(child)
            except DouyinFallbackError:
                continue
    raise DouyinFallbackError(
        "DOUYIN_ROUTER_DATA_MISSING",
        "Douyin share page did not include videoInfoRes.",
    )
