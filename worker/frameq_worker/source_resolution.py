from __future__ import annotations

import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from frameq_worker.source_identity import (
    SourceIdentity,
    SourceIdentityError,
    SourcePlatform,
    extract_url_candidates,
    identify_source,
)

ShortLinkResolve = Callable[[str], str | None]


class SourceRequest:
    __slots__ = ("_download_url", "identity")

    def __init__(self, download_url: str, identity: SourceIdentity) -> None:
        self._download_url = download_url
        self.identity = identity

    @property
    def download_url(self) -> str:
        return self._download_url

    def __repr__(self) -> str:
        return f"SourceRequest(identity={self.identity!r})"


class SourceRequestResolver(Protocol):
    def __call__(self, download_url: str) -> SourceRequest: ...


@dataclass(frozen=True, slots=True)
class ShortLinkAdapter:
    platform: SourcePlatform
    hosts: frozenset[str]
    resolve: ShortLinkResolve


@dataclass(frozen=True, slots=True)
class SourceResolver:
    short_link_adapters: tuple[ShortLinkAdapter, ...] = ()

    def resolve_request(
        self,
        download_url: str,
        *,
        resolved_url: str | None = None,
    ) -> SourceRequest:
        normalized = download_url.strip()
        return SourceRequest(
            normalized,
            self.identify(normalized, resolved_url=resolved_url),
        )

    def identify(
        self,
        raw_source: str,
        *,
        resolved_url: str | None = None,
    ) -> SourceIdentity:
        source = raw_source.strip()
        try:
            return identify_source(source, resolved_url=resolved_url)
        except SourceIdentityError as exc:
            direct_error = exc

        candidates = extract_url_candidates(source)
        for adapter in self.short_link_adapters:
            for candidate in candidates:
                if _source_host(candidate) not in adapter.hosts:
                    continue
                resolved = adapter.resolve(candidate)
                if not resolved:
                    continue
                try:
                    identity = identify_source(resolved)
                except SourceIdentityError:
                    continue
                if identity.platform == adapter.platform:
                    return identity

        raise direct_error


DIRECT_SOURCE_RESOLVER = SourceResolver()


def resolve_source_request(
    download_url: str,
    *,
    resolved_url: str | None = None,
) -> SourceRequest:
    return DIRECT_SOURCE_RESOLVER.resolve_request(
        download_url,
        resolved_url=resolved_url,
    )


def sanitize_source_text(text: str, source_request: SourceRequest) -> str:
    sanitized = text.replace(
        source_request.download_url,
        source_request.identity.canonical_url,
    )
    for candidate in extract_url_candidates(sanitized):
        try:
            replacement = identify_source(candidate).canonical_url
        except SourceIdentityError:
            replacement = "[source URL removed]"
        sanitized = sanitized.replace(candidate, replacement)
    return sanitized


def _source_host(raw_url: str) -> str:
    try:
        return (urllib.parse.urlparse(raw_url).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""
