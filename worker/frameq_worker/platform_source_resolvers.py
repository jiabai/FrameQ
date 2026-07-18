from __future__ import annotations

from frameq_worker.bilibili_fallback import BilibiliFallbackError, parse_bilibili_input
from frameq_worker.douyin_fallback import DouyinFallbackError, resolve_aweme_id_from_input
from frameq_worker.source_resolution import ShortLinkAdapter, SourceResolver
from frameq_worker.xiaohongshu_fallback import (
    XiaohongshuFallbackError,
    parse_xiaohongshu_input,
)


def build_default_source_resolver() -> SourceResolver:
    return SourceResolver(
        (
            ShortLinkAdapter(
                platform="xiaohongshu",
                hosts=frozenset({"xhslink.com", "www.xhslink.com"}),
                resolve=_resolve_xiaohongshu_short_url,
            ),
            ShortLinkAdapter(
                platform="bilibili",
                hosts=frozenset({"b23.tv", "www.b23.tv"}),
                resolve=_resolve_bilibili_short_url,
            ),
            ShortLinkAdapter(
                platform="douyin",
                hosts=frozenset({"v.douyin.com"}),
                resolve=_resolve_douyin_short_url,
            ),
        )
    )


def _resolve_xiaohongshu_short_url(short_url: str) -> str | None:
    try:
        return parse_xiaohongshu_input(short_url).full_url or None
    except XiaohongshuFallbackError:
        return None


def _resolve_bilibili_short_url(short_url: str) -> str | None:
    try:
        return parse_bilibili_input(short_url).full_url or None
    except BilibiliFallbackError:
        return None


def _resolve_douyin_short_url(short_url: str) -> str | None:
    try:
        aweme_id = resolve_aweme_id_from_input(short_url)
    except DouyinFallbackError:
        return None
    return f"https://www.douyin.com/video/{aweme_id}" if aweme_id else None
