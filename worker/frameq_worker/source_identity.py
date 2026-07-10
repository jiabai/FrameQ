from __future__ import annotations

import json
import os
import re
import tempfile
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from frameq_worker.bilibili_fallback import BilibiliFallbackError, parse_bilibili_input
from frameq_worker.douyin_fallback import resolve_aweme_id_from_input
from frameq_worker.xiaohongshu_fallback import (
    XiaohongshuFallbackError,
    parse_xiaohongshu_input,
)

SourcePlatform = Literal["douyin", "xiaohongshu", "bilibili", "youtube"]

SOURCE_IDENTITY_VERSION = 1
SOURCE_PRIVACY_MIGRATION_VERSION = 2
TASK_SCHEMA_VERSION_WITH_SOURCE_IDENTITY = 3
TASK_MANIFEST_FILE_NAME = "frameq-task.json"
SOURCE_URL_LINE_PREFIX = "- Source URL:"
METADATA_SECTION_HEADING = "## Metadata"
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_MIGRATABLE_TEXT_ARTIFACT_BYTES = 10 * 1024 * 1024
URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
URL_TRAILING_PUNCTUATION = " \t\r\n\"'<>[]{}()，。！？；：、,.;:!?"
XHS_NOTE_ID_PATTERN = re.compile(r"(?i)^[0-9a-f]{24}$")
LEGACY_XHS_TOKEN_PREFIX_PATTERN = re.compile(r"(?i)[0-9a-f]{24}")
BILIBILI_BVID_PATTERN = re.compile(r"(?i)^BV[0-9A-Za-z]{10}$")
BILIBILI_AVID_PATTERN = re.compile(r"(?i)^av(\d{1,20})$")
YOUTUBE_VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
DOUYIN_AWEME_ID_PATTERN = re.compile(r"^\d{15,24}$")
MAX_BILIBILI_PART_INDEX = 100_000
AI_ARTIFACT_KEYS = ("summary", "mindmap", "insights", "insights_md")
KNOWN_TASK_ARTIFACT_KEYS = frozenset(
    {
        "video",
        "audio",
        "transcript_txt",
        "transcript_md",
        "segments",
        "summary",
        "mindmap",
        "insights",
        "insights_md",
        "preference_snapshot",
    }
)
FIXED_AI_ARTIFACT_PATHS = (
    "ai/summary.md",
    "ai/mindmap.mmd",
    "ai/insights.json",
    "ai/insights.md",
)


class SourceIdentityError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class SourceIdentity:
    platform: SourcePlatform
    stable_id: str
    canonical_url: str
    effective_part: int | None = None
    version: int = SOURCE_IDENTITY_VERSION

    @property
    def equality_key(self) -> tuple[str, str, int | None]:
        return (self.platform, self.stable_id, self.effective_part)

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "version": self.version,
            "platform": self.platform,
            "stable_id": self.stable_id,
            "effective_part": self.effective_part,
            "canonical_url": self.canonical_url,
        }


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


@dataclass(frozen=True, slots=True)
class SourceMigrationReport:
    inspected_manifests: int = 0
    migrated_manifests: int = 0
    unavailable_manifests: int = 0
    migrated_transcripts: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "inspected_manifests": self.inspected_manifests,
            "migrated_manifests": self.migrated_manifests,
            "unavailable_manifests": self.unavailable_manifests,
            "migrated_transcripts": self.migrated_transcripts,
        }


@dataclass(frozen=True, slots=True)
class _SourcePrivacyMaterial:
    raw_source: str
    safe_source: str
    sensitive_keys: tuple[str, ...]
    sensitive_values: tuple[str, ...]
    identifier_values: tuple[str, ...]


def identify_source(
    raw_source: str,
    *,
    resolved_url: str | None = None,
    allow_network: bool = True,
) -> SourceIdentity:
    source = raw_source.strip()
    if not source:
        raise SourceIdentityError("Source URL cannot be empty.")

    if resolved_url:
        resolved = _identify_direct_source(resolved_url)
        if resolved is not None:
            return resolved

    direct = _identify_direct_source(source)
    if direct is not None:
        return direct

    if allow_network:
        resolved = _resolve_supported_short_source(source)
        if resolved is not None:
            return resolved

    raise SourceIdentityError("Source URL does not contain a supported stable video ID.")


def resolve_source_request(
    download_url: str,
    *,
    resolved_url: str | None = None,
    allow_network: bool = True,
) -> SourceRequest:
    normalized = download_url.strip()
    return SourceRequest(
        normalized,
        identify_source(
            normalized,
            resolved_url=resolved_url,
            allow_network=allow_network,
        ),
    )


def source_identity_from_manifest(value: object) -> SourceIdentity | None:
    if not isinstance(value, dict):
        return None
    version = value.get("version")
    platform = value.get("platform")
    stable_id = value.get("stable_id")
    canonical_url = value.get("canonical_url")
    effective_part = value.get("effective_part")
    if version != SOURCE_IDENTITY_VERSION:
        return None
    if platform not in {"douyin", "xiaohongshu", "bilibili", "youtube"}:
        return None
    if not isinstance(stable_id, str) or not stable_id:
        return None
    if not isinstance(canonical_url, str) or not canonical_url:
        return None
    if effective_part is not None and (
        not isinstance(effective_part, int) or isinstance(effective_part, bool)
    ):
        return None
    try:
        expected = identify_source(canonical_url, allow_network=False)
    except SourceIdentityError:
        return None
    identity = SourceIdentity(
        platform=platform,
        stable_id=stable_id,
        effective_part=effective_part,
        canonical_url=canonical_url,
    )
    return identity if identity == expected else None


def canonical_url_for_persistence(identity: SourceIdentity | None) -> str | None:
    if identity is None:
        return None
    validated = source_identity_from_manifest(identity.to_manifest_dict())
    if validated != identity:
        raise SourceIdentityError("Source identity is not safe for persistence.")
    return validated.canonical_url


def migrate_legacy_source_data(
    output_root: Path,
    *,
    task_id: str | None = None,
) -> SourceMigrationReport:
    tasks_root = output_root / "tasks"
    if task_id is not None:
        task_id_path = Path(task_id)
        if (
            task_id_path.is_absolute()
            or len(task_id_path.parts) != 1
            or task_id_path.name != task_id
            or task_id in {"", ".", ".."}
        ):
            return SourceMigrationReport()
    manifest_paths = (
        [tasks_root / task_id / TASK_MANIFEST_FILE_NAME]
        if task_id
        else sorted(tasks_root.glob(f"*/{TASK_MANIFEST_FILE_NAME}"))
    )
    inspected = migrated = unavailable = transcript_count = 0
    for manifest_path in manifest_paths:
        if not manifest_path.is_file():
            continue
        task_dir = manifest_path.parent
        if _is_link_or_junction(task_dir) or _is_link_or_junction(manifest_path):
            continue
        try:
            if not task_dir.resolve().is_relative_to(tasks_root.resolve()):
                continue
        except OSError:
            continue
        try:
            if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
                continue
        except OSError:
            continue
        inspected += 1
        try:
            original_manifest_text = manifest_path.read_text(encoding="utf-8")
            manifest = json.loads(original_manifest_text)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(manifest, dict):
            continue
        original_manifest = json.loads(original_manifest_text)
        if not isinstance(original_manifest, dict):
            continue

        schema_version = manifest.get("schema_version")
        is_legacy = schema_version in {1, 2, "1", "2"}
        is_current = schema_version in {3, "3"}
        if not is_legacy and not is_current:
            continue
        if str(manifest.get("task_id") or "") != task_dir.name:
            continue

        existing = source_identity_from_manifest(manifest.get("source_identity"))
        source_url = manifest.get("source_url")
        if (
            is_current
            and manifest.get("source_privacy_migration_version")
            == SOURCE_PRIVACY_MIGRATION_VERSION
            and (
                (existing is not None and source_url == existing.canonical_url)
                or (existing is None and source_url == "")
            )
        ):
            continue

        identity = None
        if isinstance(source_url, str) and source_url.strip():
            try:
                identity = identify_source(source_url, allow_network=False)
            except SourceIdentityError:
                identity = None
        elif source_url is None or (
            isinstance(source_url, str) and not source_url.strip()
        ):
            identity = existing

        raw_source = source_url if isinstance(source_url, str) else ""
        privacy_material = _collect_source_privacy_material(raw_source, identity)
        task_identifier = str(manifest.get("task_id") or "")
        quarantine_required = (
            manifest.get("source_privacy_quarantined") is True
            or _identifier_contains_source_secret(task_identifier, privacy_material)
            or _identifier_contains_source_secret(task_dir.name, privacy_material)
        )
        manifest["source_privacy_quarantined"] = quarantine_required

        if schema_version in {1, "1"} and not isinstance(manifest.get("transcript"), dict):
            model = manifest.get("model")
            manifest["transcript"] = {
                "source": "asr",
                "language": None,
                "engine": model if isinstance(model, str) and model.strip() else None,
            }
        manifest["schema_version"] = TASK_SCHEMA_VERSION_WITH_SOURCE_IDENTITY
        task_migrated = False
        task_unavailable = False
        if identity is None:
            manifest["source_url"] = ""
            manifest.pop("source_identity", None)
            if is_legacy:
                task_unavailable = True
        else:
            manifest["source_url"] = identity.canonical_url
            manifest["platform"] = identity.platform
            manifest["source_identity"] = identity.to_manifest_dict()
            if is_legacy:
                task_migrated = True

        _sanitize_legacy_error(manifest)
        text_preview = manifest.get("text_preview")
        if isinstance(text_preview, str):
            manifest["text_preview"] = _sanitize_legacy_source_text(
                text_preview,
                privacy_material,
            )
        _sanitize_manifest_supplemental_fields(manifest, privacy_material)
        transcript_safe, transcript_changed = _migrate_declared_transcript_source(
            task_dir,
            manifest,
            identity,
        )
        ai_artifacts_safe = _migrate_known_ai_artifacts(
            task_dir,
            manifest,
            privacy_material,
        )
        _sanitize_manifest_artifact_map(task_dir, manifest, privacy_material)
        if not transcript_safe or not ai_artifacts_safe:
            original_needs_update = (
                "source_privacy_migration_version" in original_manifest
                or (
                    quarantine_required
                    and original_manifest.get("source_privacy_quarantined") is not True
                )
            )
            original_manifest.pop("source_privacy_migration_version", None)
            if quarantine_required:
                original_manifest["source_privacy_quarantined"] = True
            if original_needs_update:
                _write_json_atomically(
                    manifest_path,
                    original_manifest,
                    expected_text=original_manifest_text,
                )
            continue
        manifest["source_privacy_migration_version"] = SOURCE_PRIVACY_MIGRATION_VERSION
        manifest_written = _write_json_atomically(
            manifest_path,
            manifest,
            expected_text=original_manifest_text,
        )
        if not manifest_written:
            continue
        if task_migrated:
            migrated += 1
        if task_unavailable:
            unavailable += 1
        if transcript_changed:
            transcript_count += 1

    return SourceMigrationReport(
        inspected_manifests=inspected,
        migrated_manifests=migrated,
        unavailable_manifests=unavailable,
        migrated_transcripts=transcript_count,
    )


def sanitize_source_text(text: str, source_request: SourceRequest) -> str:
    sanitized = text.replace(source_request.download_url, source_request.identity.canonical_url)
    for candidate in _extract_url_candidates(sanitized):
        try:
            replacement = identify_source(candidate, allow_network=False).canonical_url
        except SourceIdentityError:
            replacement = "[source URL removed]"
        sanitized = sanitized.replace(candidate, replacement)
    return sanitized


def _identify_direct_source(raw_source: str) -> SourceIdentity | None:
    normalized = raw_source.strip()
    if XHS_NOTE_ID_PATTERN.fullmatch(normalized):
        note_id = normalized.lower()
        return _xiaohongshu_identity(note_id)
    bilibili_direct = _normalize_bilibili_id(normalized)
    if bilibili_direct is not None:
        return _bilibili_identity(bilibili_direct, part_index=1)

    for candidate in _extract_url_candidates(normalized):
        try:
            parsed = urllib.parse.urlparse(candidate)
            host = (parsed.hostname or "").lower().rstrip(".")
        except ValueError:
            continue
        if parsed.scheme.lower() not in {"http", "https"}:
            continue
        if _host_matches(host, "xiaohongshu.com"):
            note_id = _find_xhs_note_id(parsed)
            if note_id:
                return _xiaohongshu_identity(note_id)
        if _host_matches(host, "douyin.com") or _host_matches(host, "iesdouyin.com"):
            aweme_id = _find_douyin_aweme_id(parsed)
            if aweme_id:
                return _douyin_identity(aweme_id)
        if _host_matches(host, "bilibili.com"):
            bilibili = _find_bilibili_video(parsed)
            if bilibili is not None:
                video_id, part_index = bilibili
                return _bilibili_identity(video_id, part_index)
        if host in {
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "youtu.be",
            "www.youtu.be",
        }:
            video_id = _find_youtube_video_id(parsed)
            if video_id:
                return _youtube_identity(video_id)
    return None


def _resolve_supported_short_source(raw_source: str) -> SourceIdentity | None:
    candidates = _extract_url_candidates(raw_source)
    candidate_hosts: list[tuple[str, str]] = []
    for candidate in candidates:
        try:
            host = (urllib.parse.urlparse(candidate).hostname or "").lower().rstrip(".")
        except ValueError:
            continue
        candidate_hosts.append((host, candidate))
    hosts = {host for host, _candidate in candidate_hosts}
    if hosts & {"xhslink.com", "www.xhslink.com"}:
        try:
            parsed = parse_xiaohongshu_input(raw_source)
        except XiaohongshuFallbackError:
            return None
        resolved = _identify_direct_source(parsed.full_url)
        return resolved if resolved is not None and resolved.platform == "xiaohongshu" else None
    if hosts & {"b23.tv", "www.b23.tv"}:
        try:
            parsed = parse_bilibili_input(raw_source)
        except BilibiliFallbackError:
            return None
        resolved = _identify_direct_source(parsed.full_url)
        return resolved if resolved is not None and resolved.platform == "bilibili" else None
    if "v.douyin.com" in hosts:
        short_url = next(
            candidate for host, candidate in candidate_hosts if host == "v.douyin.com"
        )
        aweme_id = resolve_aweme_id_from_input(short_url)
        return (
            _douyin_identity(aweme_id)
            if aweme_id and DOUYIN_AWEME_ID_PATTERN.fullmatch(aweme_id)
            else None
        )
    return None


def _extract_url_candidates(raw_source: str) -> list[str]:
    return [
        match.group(0).rstrip(URL_TRAILING_PUNCTUATION)
        for match in URL_PATTERN.finditer(raw_source)
    ]


def _host_matches(host: str, suffix: str) -> bool:
    return host == suffix or host.endswith(f".{suffix}")


def _find_xhs_note_id(parsed: urllib.parse.ParseResult) -> str | None:
    segments = [segment for segment in parsed.path.split("/") if segment]
    candidate = ""
    if len(segments) == 2 and segments[0].lower() == "explore":
        candidate = segments[1]
    elif len(segments) == 3 and [part.lower() for part in segments[:2]] == [
        "discovery",
        "item",
    ]:
        candidate = segments[2]
    return candidate.lower() if XHS_NOTE_ID_PATTERN.fullmatch(candidate) else None


def _find_douyin_aweme_id(parsed: urllib.parse.ParseResult) -> str | None:
    query = urllib.parse.parse_qs(parsed.query)
    for key in ("modal_id", "aweme_id"):
        value = query.get(key, [""])[0]
        if DOUYIN_AWEME_ID_PATTERN.fullmatch(value):
            return value
    path_match = re.search(r"/(?:video|note|share/slides)/(\d+)(?:/|$)", parsed.path)
    if path_match and DOUYIN_AWEME_ID_PATTERN.fullmatch(path_match.group(1)):
        return path_match.group(1)
    return None


def _find_bilibili_video(
    parsed: urllib.parse.ParseResult,
) -> tuple[str, int] | None:
    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) < 2 or segments[0].lower() != "video":
        return None
    video_id = _normalize_bilibili_id(segments[1])
    if video_id is None:
        return None
    raw_part = urllib.parse.parse_qs(parsed.query).get("p", ["1"])[0]
    try:
        part_index = int(raw_part)
    except (TypeError, ValueError):
        part_index = 1
    if not 1 <= part_index <= MAX_BILIBILI_PART_INDEX:
        return None
    return video_id, part_index


def _find_youtube_video_id(parsed: urllib.parse.ParseResult) -> str | None:
    host = (parsed.hostname or "").lower().rstrip(".")
    segments = [segment for segment in parsed.path.split("/") if segment]
    if host in {"youtu.be", "www.youtu.be"}:
        candidate = segments[0] if len(segments) == 1 else ""
    elif parsed.path.rstrip("/") == "/watch":
        candidate = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
    elif len(segments) == 2 and segments[0].lower() == "shorts":
        candidate = segments[1]
    else:
        candidate = ""
    return candidate if YOUTUBE_VIDEO_ID_PATTERN.fullmatch(candidate) else None


def _normalize_bilibili_id(value: str) -> str | None:
    if BILIBILI_BVID_PATTERN.fullmatch(value):
        return _normalize_bvid(value)
    avid = BILIBILI_AVID_PATTERN.fullmatch(value)
    return f"av{avid.group(1)}" if avid else None


def _normalize_bvid(value: str) -> str:
    return f"BV{value[2:]}"


def _xiaohongshu_identity(note_id: str) -> SourceIdentity:
    normalized = note_id.lower()
    if not XHS_NOTE_ID_PATTERN.fullmatch(normalized):
        raise SourceIdentityError("Invalid Xiaohongshu note ID.")
    return SourceIdentity(
        platform="xiaohongshu",
        stable_id=normalized,
        canonical_url=f"https://www.xiaohongshu.com/explore/{normalized}",
    )


def _douyin_identity(aweme_id: str) -> SourceIdentity:
    if not DOUYIN_AWEME_ID_PATTERN.fullmatch(aweme_id):
        raise SourceIdentityError("Invalid Douyin work ID.")
    return SourceIdentity(
        platform="douyin",
        stable_id=aweme_id,
        canonical_url=f"https://www.douyin.com/video/{aweme_id}",
    )


def _bilibili_identity(video_id: str, part_index: int) -> SourceIdentity:
    normalized_video_id = _normalize_bilibili_id(video_id)
    if normalized_video_id is None:
        raise SourceIdentityError("Invalid Bilibili video ID.")
    if not 1 <= part_index <= MAX_BILIBILI_PART_INDEX:
        raise SourceIdentityError("Invalid Bilibili part index.")
    normalized_part = part_index
    suffix = f"?p={normalized_part}" if normalized_part > 1 else ""
    return SourceIdentity(
        platform="bilibili",
        stable_id=normalized_video_id,
        effective_part=normalized_part,
        canonical_url=(
            f"https://www.bilibili.com/video/{normalized_video_id}{suffix}"
        ),
    )


def _youtube_identity(video_id: str) -> SourceIdentity:
    if not YOUTUBE_VIDEO_ID_PATTERN.fullmatch(video_id):
        raise SourceIdentityError("Invalid YouTube video ID.")
    return SourceIdentity(
        platform="youtube",
        stable_id=video_id,
        canonical_url=f"https://www.youtube.com/watch?v={video_id}",
    )


def _migrate_declared_transcript_source(
    task_dir: Path,
    manifest: dict[str, object],
    identity: SourceIdentity | None,
) -> tuple[bool, bool]:
    raw_paths: list[str] = ["transcript/transcript.md"]
    paths_safe = True
    artifacts = manifest.get("artifacts")
    if isinstance(artifacts, dict) and "transcript_md" in artifacts:
        declared_path = artifacts.get("transcript_md")
        if isinstance(declared_path, str) and declared_path.strip():
            raw_paths.append(declared_path)
        else:
            paths_safe = False

    candidates: set[Path] = set()
    for raw_path in raw_paths:
        transcript_path = _resolve_bounded_task_file(task_dir, raw_path)
        if transcript_path is None:
            paths_safe = False
            continue
        candidates.add(transcript_path)
        relative = transcript_path.relative_to(task_dir.resolve())
        backup_relative = relative.parent / "original" / relative.name
        backup_path = _resolve_bounded_task_file(task_dir, backup_relative.as_posix())
        if backup_path is None:
            paths_safe = False
            continue
        candidates.add(backup_path)

    all_safe = paths_safe
    any_changed = False
    for candidate in sorted(candidates):
        safe, changed = _migrate_transcript_metadata_file(candidate, identity)
        all_safe = all_safe and safe
        any_changed = any_changed or changed
    return all_safe, any_changed


def _migrate_transcript_metadata_file(
    transcript_path: Path,
    identity: SourceIdentity | None,
) -> tuple[bool, bool]:
    if not transcript_path.exists():
        return True, False
    if _is_link_or_junction(transcript_path) or not transcript_path.is_file():
        return False, False
    try:
        if transcript_path.stat().st_size > MAX_MIGRATABLE_TEXT_ARTIFACT_BYTES:
            return False, False
        original = transcript_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return False, False
    replacement = identity.canonical_url if identity is not None else "unavailable"
    lines = original.splitlines(keepends=True)
    metadata_start = next(
        (
            index
            for index, line in enumerate(lines)
            if line.strip() == METADATA_SECTION_HEADING
        ),
        None,
    )
    if metadata_start is None:
        return True, False
    metadata_end = next(
        (
            index
            for index in range(metadata_start + 1, len(lines))
            if lines[index].strip().startswith("## ")
        ),
        len(lines),
    )
    changed = False
    for index in range(metadata_start + 1, metadata_end):
        line = lines[index]
        if line.lstrip().startswith(SOURCE_URL_LINE_PREFIX):
            newline = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
            lines[index] = f"{SOURCE_URL_LINE_PREFIX} {replacement}{newline}"
            changed = (lines[index] != line) or changed
        redacted_line = _redact_sensitive_assignments(lines[index])
        changed = (redacted_line != lines[index]) or changed
        lines[index] = redacted_line
    metadata_text = "".join(lines[metadata_start + 1 : metadata_end])
    if _text_contains_source_credentials(metadata_text):
        return False, False
    if not changed:
        return True, False
    if not _write_text_atomically(
        transcript_path,
        "".join(lines),
        expected_text=original,
    ):
        return False, False
    return True, True


def _migrate_known_ai_artifacts(
    task_dir: Path,
    manifest: dict[str, object],
    privacy_material: _SourcePrivacyMaterial,
) -> bool:
    raw_paths = list(FIXED_AI_ARTIFACT_PATHS)
    paths_safe = True
    artifacts = manifest.get("artifacts")
    if isinstance(artifacts, dict):
        for key in AI_ARTIFACT_KEYS:
            if key not in artifacts:
                continue
            raw_path = artifacts.get(key)
            if isinstance(raw_path, str) and raw_path.strip():
                raw_paths.append(raw_path)
            else:
                paths_safe = False

    candidates: set[Path] = set()
    for raw_path in raw_paths:
        candidate = _resolve_bounded_task_file(task_dir, raw_path)
        if candidate is None:
            paths_safe = False
            continue
        candidates.add(candidate)

    all_safe = paths_safe
    for candidate in sorted(candidates):
        all_safe = _migrate_ai_artifact(candidate, privacy_material) and all_safe
    return all_safe


def _sanitize_manifest_artifact_map(
    task_dir: Path,
    manifest: dict[str, object],
    privacy_material: _SourcePrivacyMaterial,
) -> None:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        manifest["artifacts"] = {}
        return

    safe_artifacts: dict[str, str] = {}
    for key, raw_path in artifacts.items():
        if (
            key not in KNOWN_TASK_ARTIFACT_KEYS
            or not isinstance(raw_path, str)
            or not raw_path.strip()
            or URL_PATTERN.search(raw_path)
            or _text_contains_source_credentials(raw_path)
            or _contains_source_privacy_material(raw_path, privacy_material)
            or _resolve_bounded_task_file(task_dir, raw_path) is None
        ):
            continue
        safe_artifacts[key] = raw_path
    manifest["artifacts"] = safe_artifacts


def _sanitize_manifest_supplemental_fields(
    manifest: dict[str, object],
    privacy_material: _SourcePrivacyMaterial,
) -> None:
    protected_fields = {"task_id", "source_url", "source_identity", "artifacts"}
    for key in list(manifest):
        if key in protected_fields:
            continue
        if _is_sensitive_source_parameter(key):
            manifest.pop(key, None)
            continue
        manifest[key] = _sanitize_manifest_value(manifest[key], privacy_material)


def _sanitize_manifest_value(
    value: object,
    privacy_material: _SourcePrivacyMaterial,
) -> object:
    if isinstance(value, str):
        return _sanitize_legacy_source_text(value, privacy_material)
    if isinstance(value, list):
        return [_sanitize_manifest_value(item, privacy_material) for item in value]
    if isinstance(value, dict):
        return {
            key: _sanitize_manifest_value(item, privacy_material)
            for key, item in value.items()
            if isinstance(key, str) and not _is_sensitive_source_parameter(key)
        }
    return value


def _migrate_ai_artifact(
    artifact_path: Path,
    privacy_material: _SourcePrivacyMaterial,
) -> bool:
    if not artifact_path.exists():
        return True
    if _is_link_or_junction(artifact_path) or not artifact_path.is_file():
        return False
    try:
        if artifact_path.stat().st_size > MAX_MIGRATABLE_TEXT_ARTIFACT_BYTES:
            return False
        original = artifact_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return False

    sanitized = _sanitize_legacy_source_text(original, privacy_material)
    if _contains_source_privacy_material(sanitized, privacy_material):
        return False
    if sanitized == original:
        return True
    return _write_text_atomically(
        artifact_path,
        sanitized,
        expected_text=original,
    )


def _resolve_bounded_task_file(task_dir: Path, raw_path: str) -> Path | None:
    relative = Path(raw_path)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        return None
    try:
        task_root = task_dir.resolve()
    except OSError:
        return None

    current = task_dir
    for part in relative.parts:
        current = current / part
        try:
            if current.exists() and _is_link_or_junction(current):
                return None
        except OSError:
            return None
    try:
        candidate = (task_dir / relative).resolve()
    except OSError:
        return None
    return candidate if candidate.is_relative_to(task_root) else None


def _collect_source_privacy_material(
    raw_source: str,
    identity: SourceIdentity | None,
) -> _SourcePrivacyMaterial:
    sensitive_keys: set[str] = set()
    sensitive_values: set[str] = set()
    identifier_values: set[str] = set()
    for candidate in _extract_url_candidates(raw_source):
        try:
            parsed = urllib.parse.urlparse(candidate)
            if parsed.username:
                username = urllib.parse.unquote(parsed.username)
                if len(username) >= 4:
                    identifier_values.add(username)
            if parsed.password:
                password = urllib.parse.unquote(parsed.password)
                if len(password) >= 4:
                    sensitive_values.add(password)
                    identifier_values.add(password)
            for key, value in urllib.parse.parse_qsl(
                parsed.query,
                keep_blank_values=True,
            ):
                if _is_sensitive_source_parameter(key):
                    sensitive_keys.add(key)
                    if len(value) >= 4:
                        sensitive_values.add(value)
                        identifier_values.add(value)
        except (TypeError, ValueError):
            continue
    return _SourcePrivacyMaterial(
        raw_source=raw_source,
        safe_source=identity.canonical_url if identity is not None else "[source URL removed]",
        sensitive_keys=tuple(sorted(sensitive_keys, key=len, reverse=True)),
        sensitive_values=tuple(
            sorted((value for value in sensitive_values if value), key=len, reverse=True)
        ),
        identifier_values=tuple(
            sorted((value for value in identifier_values if value), key=len, reverse=True)
        ),
    )


def _is_sensitive_source_parameter(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")
    if not normalized:
        return False
    if any(
        marker in normalized
        for marker in (
            "auth",
            "cookie",
            "credential",
            "password",
            "passwd",
            "secret",
            "session",
            "signature",
            "token",
        )
    ):
        return True
    return normalized in {"key", "sig"} or normalized.endswith(("_key", "_sig"))


def _sanitize_legacy_source_text(
    text: str,
    privacy_material: _SourcePrivacyMaterial,
) -> str:
    sanitized = text
    raw_source = privacy_material.raw_source
    if raw_source and raw_source != privacy_material.safe_source:
        sanitized = sanitized.replace(raw_source, privacy_material.safe_source)

    for candidate in _extract_url_candidates(sanitized):
        if not _url_contains_source_credentials(candidate):
            continue
        try:
            replacement = identify_source(candidate, allow_network=False).canonical_url
        except SourceIdentityError:
            replacement = "[source URL removed]"
        sanitized = sanitized.replace(candidate, replacement)

    sanitized = _redact_sensitive_assignments(sanitized)

    for key in privacy_material.sensitive_keys:
        sanitized = re.sub(
            rf"{re.escape(key)}\s*[=:]\s*[^\\\s&;,\"']+",
            "[redacted-source-credential]",
            sanitized,
            flags=re.IGNORECASE,
        )
    for value in privacy_material.sensitive_values:
        sanitized = sanitized.replace(value, "[redacted-source-value]")
        encoded = urllib.parse.quote(value, safe="")
        if encoded != value:
            sanitized = sanitized.replace(encoded, "[redacted-source-value]")
    for key in privacy_material.sensitive_keys:
        sanitized = re.sub(
            re.escape(key),
            "[redacted-source-key]",
            sanitized,
            flags=re.IGNORECASE,
        )
    return sanitized


def _contains_source_privacy_material(
    text: str,
    privacy_material: _SourcePrivacyMaterial,
) -> bool:
    if _text_contains_source_credentials(text):
        return True
    if (
        privacy_material.raw_source
        and privacy_material.raw_source != privacy_material.safe_source
        and privacy_material.raw_source in text
    ):
        return True
    lowered = text.lower()
    if any(value.lower() in lowered for value in privacy_material.sensitive_values):
        return True
    for key in privacy_material.sensitive_keys:
        if re.search(
            re.escape(key),
            text,
            flags=re.IGNORECASE,
        ):
            return True
    return any(
        _url_contains_source_credentials(candidate)
        for candidate in _extract_url_candidates(text)
    )


def _redact_sensitive_assignments(text: str) -> str:
    assignment_pattern = re.compile(
        r"(?i)(?<![a-z0-9_.\\-])([a-z][a-z0-9_.-]{1,64})"
        r"\s*[=:]\s*[^\\\s&;,\"']+"
    )

    def replace(match: re.Match[str]) -> str:
        return (
            "[redacted-source-credential]"
            if _is_sensitive_source_parameter(match.group(1))
            else match.group(0)
        )

    return assignment_pattern.sub(replace, text)


def _url_contains_source_credentials(candidate: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(candidate)
        if parsed.username or parsed.password:
            return True
        return any(
            _is_sensitive_source_parameter(key)
            for key, _value in urllib.parse.parse_qsl(
                parsed.query,
                keep_blank_values=True,
            )
        )
    except (TypeError, ValueError):
        return True


def _text_contains_source_credentials(text: str) -> bool:
    if any(
        _url_contains_source_credentials(candidate)
        for candidate in _extract_url_candidates(text)
    ):
        return True
    for match in re.finditer(
        r"(?i)([a-z][a-z0-9_.-]{1,64})\s*[=:]",
        text,
    ):
        if _is_sensitive_source_parameter(match.group(1)):
            return True
    return False


def _identifier_contains_source_secret(
    identifier: str,
    privacy_material: _SourcePrivacyMaterial,
) -> bool:
    lowered = identifier.lower()
    value_matches = any(
        value.lower() in lowered for value in privacy_material.identifier_values
    ) or any(
        match.group(0).lower() in lowered
        for value in privacy_material.identifier_values
        for match in LEGACY_XHS_TOKEN_PREFIX_PATTERN.finditer(value)
    )
    return value_matches or any(
        len(key) >= 4 and key.lower() in lowered
        for key in privacy_material.sensitive_keys
    )


def _write_json_atomically(
    path: Path,
    payload: dict[str, object],
    *,
    expected_text: str | None = None,
) -> bool:
    return _write_text_atomically(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        expected_text=expected_text,
    )


def _write_text_atomically(
    path: Path,
    content: str,
    *,
    expected_text: str | None = None,
) -> bool:
    temporary_path: Path | None = None
    try:
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(content)
                temporary.flush()
                os.fsync(temporary.fileno())
            if expected_text is not None:
                try:
                    if path.read_text(encoding="utf-8") != expected_text:
                        return False
                except (OSError, UnicodeError):
                    return False
            os.replace(temporary_path, path)
            return True
        except OSError:
            return False
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _sanitize_legacy_error(manifest: dict[str, object]) -> None:
    error = manifest.get("error")
    if not isinstance(error, dict):
        return
    message = error.get("message")
    if not isinstance(message, str) or not message:
        return
    code = error.get("code")
    safe_code = (
        code
        if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code)
        else "TASK_FAILED"
    )
    error["code"] = safe_code
    error["message"] = f"Previous task failed ({safe_code})."


def _is_link_or_junction(path: Path) -> bool:
    is_junction = getattr(os.path, "isjunction", lambda _path: False)
    return path.is_symlink() or bool(is_junction(path))
