from __future__ import annotations

import importlib
import importlib.util
from types import ModuleType, SimpleNamespace

import pytest
from frameq_worker import platform_source_resolvers as platform_resolvers_module
from frameq_worker.platform_source_resolvers import build_default_source_resolver
from frameq_worker.source_identity import SourceIdentityError


def _resolution_module() -> ModuleType:
    spec = importlib.util.find_spec("frameq_worker.source_resolution")
    assert spec is not None, "source_resolution application boundary is missing"
    return importlib.import_module("frameq_worker.source_resolution")


def test_direct_source_resolution_does_not_call_short_link_adapter() -> None:
    resolution = _resolution_module()
    received: list[str] = []
    adapter = resolution.ShortLinkAdapter(
        platform="bilibili",
        hosts=frozenset({"b23.tv"}),
        resolve=lambda value: received.append(value),
    )
    resolver = resolution.SourceResolver((adapter,))

    request = resolver.resolve_request(
        "https://www.bilibili.com/video/BV1Aa411c7mD?p=2&token=secret"
    )

    assert request.download_url.endswith("token=secret")
    assert request.identity.canonical_url == (
        "https://www.bilibili.com/video/BV1Aa411c7mD?p=2"
    )
    assert received == []


def test_source_resolution_preserves_the_direct_parser_error() -> None:
    resolution = _resolution_module()

    with pytest.raises(SourceIdentityError, match="Source URL cannot be empty"):
        resolution.SourceResolver().resolve_request("   ")


def test_source_text_sanitization_removes_secrets_and_untrusted_urls() -> None:
    resolution = _resolution_module()
    source = resolution.resolve_source_request(
        "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
        "?xsec_token=review-secret"
    )

    sanitized = resolution.sanitize_source_text(
        f"download failed: {source.download_url}; mirror: https://example.test/private",
        source,
    )

    assert source.identity.canonical_url in sanitized
    assert "review-secret" not in sanitized
    assert "example.test" not in sanitized
    assert "[source URL removed]" in sanitized


def test_short_link_resolution_dispatches_only_the_exact_safe_host() -> None:
    resolution = _resolution_module()
    received: list[str] = []

    def resolve_short_url(value: str) -> str:
        received.append(value)
        return "https://www.bilibili.com/video/BV1Aa411c7mD?p=3"

    resolver = resolution.SourceResolver(
        (
            resolution.ShortLinkAdapter(
                platform="bilibili",
                hosts=frozenset({"b23.tv", "www.b23.tv"}),
                resolve=resolve_short_url,
            ),
        )
    )

    request = resolver.resolve_request(
        "https://b23.tv.evil/video/BV1Aa411c7mD https://b23.tv/safe-code"
    )

    assert received == ["https://b23.tv/safe-code"]
    assert request.identity.canonical_url == (
        "https://www.bilibili.com/video/BV1Aa411c7mD?p=3"
    )


def test_short_link_resolution_revalidates_adapter_output() -> None:
    resolution = _resolution_module()
    resolver = resolution.SourceResolver(
        (
            resolution.ShortLinkAdapter(
                platform="bilibili",
                hosts=frozenset({"b23.tv"}),
                resolve=lambda _value: (
                    "https://www.bilibili.com.evil/video/BV1Aa411c7mD"
                ),
            ),
        )
    )

    with pytest.raises(SourceIdentityError):
        resolver.resolve_request("https://b23.tv/safe-code")


def test_short_link_resolution_rejects_missing_adapter_result() -> None:
    resolution = _resolution_module()
    resolver = resolution.SourceResolver(
        (
            resolution.ShortLinkAdapter(
                platform="xiaohongshu",
                hosts=frozenset({"xhslink.com"}),
                resolve=lambda _value: None,
            ),
        )
    )

    with pytest.raises(SourceIdentityError):
        resolver.resolve_request("https://xhslink.com/safe-code")


def test_short_link_resolution_rejects_a_different_platform_identity() -> None:
    resolution = _resolution_module()
    resolver = resolution.SourceResolver(
        (
            resolution.ShortLinkAdapter(
                platform="bilibili",
                hosts=frozenset({"b23.tv"}),
                resolve=lambda _value: "https://youtu.be/dQw4w9WgXcQ",
            ),
        )
    )

    with pytest.raises(SourceIdentityError):
        resolver.resolve_request("https://b23.tv/safe-code")


@pytest.mark.parametrize(
    ("part", "expected_url"),
    [
        (1, "https://www.bilibili.com/video/BV1Aa411c7mD"),
        (2, "https://www.bilibili.com/video/BV1Aa411c7mD?p=2"),
        (3, "https://www.bilibili.com/video/BV1Aa411c7mD?p=3"),
    ],
)
def test_bilibili_short_link_revalidates_resolved_full_url(
    monkeypatch: pytest.MonkeyPatch,
    part: int,
    expected_url: str,
) -> None:
    monkeypatch.setattr(
        platform_resolvers_module,
        "parse_bilibili_input",
        lambda _source: SimpleNamespace(
            full_url=f"https://www.bilibili.com/video/BV1Aa411c7mD?p={part}"
        ),
    )

    identity = build_default_source_resolver().identify(
        "https://b23.tv/review-short"
    )

    assert identity.canonical_url == expected_url


def test_short_link_rejects_parser_id_without_safe_resolved_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        platform_resolvers_module,
        "parse_xiaohongshu_input",
        lambda _source: SimpleNamespace(
            note_id="64a1b2c3d4e5f67890123456",
            full_url=(
                "https://www.xiaohongshu.com/login"
                "?xsec_token=0123456789abcdef01234567"
            ),
        ),
    )

    with pytest.raises(SourceIdentityError):
        build_default_source_resolver().identify(
            "https://xhslink.com/review-short"
        )


def test_douyin_short_resolution_ignores_lookalike_direct_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: list[str] = []

    def fake_resolver(value: str) -> str:
        received.append(value)
        return "7524373044106677544"

    monkeypatch.setattr(
        platform_resolvers_module,
        "resolve_aweme_id_from_input",
        fake_resolver,
    )

    identity = build_default_source_resolver().identify(
        "https://douyin.com.evil/video/1111111111111111111 "
        "https://v.douyin.com/safe-code",
    )

    assert identity.stable_id == "7524373044106677544"
    assert received == ["https://v.douyin.com/safe-code"]
