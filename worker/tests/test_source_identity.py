from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from frameq_worker import source_identity as source_identity_module
from frameq_worker import task_store as task_store_module
from frameq_worker.models import ProcessRequest
from frameq_worker.source_identity import (
    SourceIdentity,
    SourceIdentityError,
    identify_source,
    resolve_source_request,
)
from frameq_worker.task_store import create_task_context, task_context_from_manifest

XHS_NOTE_ID = "64a1b2c3d4e5f67890123456"


@pytest.mark.parametrize(
    ("source", "platform", "stable_id", "part", "canonical_url"),
    [
        (
            "https://alice:password@www.xiaohongshu.com/explore/"
            f"{XHS_NOTE_ID}?xsec_token=review-secret&source=web#comments",
            "xiaohongshu",
            XHS_NOTE_ID,
            None,
            f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}",
        ),
        (
            "https://user:password@www.douyin.com/video/7524373044106677544"
            "?token=review-secret#detail",
            "douyin",
            "7524373044106677544",
            None,
            "https://www.douyin.com/video/7524373044106677544",
        ),
        (
            "https://www.douyin.com/note/123?modal_id=7524373044106677544"
            "&token=review-secret#detail",
            "douyin",
            "7524373044106677544",
            None,
            "https://www.douyin.com/video/7524373044106677544",
        ),
        (
            "https://user:password@www.bilibili.com/video/BV1Aa411c7mD"
            "?p=3&spm_id_from=review-secret#reply",
            "bilibili",
            "BV1Aa411c7mD",
            3,
            "https://www.bilibili.com/video/BV1Aa411c7mD?p=3",
        ),
        (
            "https://user:password@www.bilibili.com/video/BV1Aa411c7mD"
            "?p=1&token=review-secret#reply",
            "bilibili",
            "BV1Aa411c7mD",
            1,
            "https://www.bilibili.com/video/BV1Aa411c7mD",
        ),
        (
            "https://user:password@www.youtube.com/watch"
            "?v=dQw4w9WgXcQ&list=review-secret#chapter",
            "youtube",
            "dQw4w9WgXcQ",
            None,
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        ),
        (
            "https://youtu.be/dQw4w9WgXcQ?si=review-secret#chapter",
            "youtube",
            "dQw4w9WgXcQ",
            None,
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        ),
        (
            "https://www.youtube.com/shorts/abcDEF_123-"
            "?feature=review-secret#chapter",
            "youtube",
            "abcDEF_123-",
            None,
            "https://www.youtube.com/watch?v=abcDEF_123-",
        ),
        (
            "https://www.bilibili.com/video/av170001"
            "?p=1&token=review-secret#reply",
            "bilibili",
            "av170001",
            1,
            "https://www.bilibili.com/video/av170001",
        ),
    ],
)
def test_identify_source_builds_allowlisted_canonical_identity(
    source: str,
    platform: str,
    stable_id: str,
    part: int | None,
    canonical_url: str,
) -> None:
    identity = identify_source(source, allow_network=False)

    assert identity.platform == platform
    assert identity.stable_id == stable_id
    assert identity.effective_part == part
    assert identity.canonical_url == canonical_url
    serialized = json.dumps(identity.to_manifest_dict())
    assert "review-secret" not in serialized
    assert "password" not in serialized
    assert "xsec_token" not in serialized


@pytest.mark.parametrize(
    ("short_url", "resolved_url", "expected_url"),
    [
        (
            "https://xhslink.com/o/demo?xsec_token=review-secret#share",
            f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}?xsec_token=resolved-secret",
            f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}",
        ),
        (
            "https://b23.tv/demo?token=review-secret#share",
            "https://www.bilibili.com/video/BV1Aa411c7mD?p=2&spm_id_from=resolved-secret",
            "https://www.bilibili.com/video/BV1Aa411c7mD?p=2",
        ),
        (
            "https://v.douyin.com/demo?token=review-secret#share",
            "https://www.douyin.com/video/7524373044106677544?previous_page=resolved-secret",
            "https://www.douyin.com/video/7524373044106677544",
        ),
    ],
)
def test_identify_source_prefers_resolved_short_link_identity(
    short_url: str,
    resolved_url: str,
    expected_url: str,
) -> None:
    identity = identify_source(short_url, resolved_url=resolved_url, allow_network=False)
    assert identity.canonical_url == expected_url


def test_identify_source_rejects_unsupported_or_lookalike_hosts() -> None:
    for source in [
        f"https://www.xiaohongshu.com.evil/explore/{XHS_NOTE_ID}",
        "https://www.xiaohongshu.com/explore"
        "?xsec_token=0123456789abcdef01234567",
        "https://www.xiaohongshu.com/login"
        "?signature=deadbeefdeadbeefdeadbeef",
        "https://[invalid-host/video/123?xsec_token=review-secret",
    ]:
        with pytest.raises(SourceIdentityError):
            identify_source(source, allow_network=False)


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
        source_identity_module,
        "parse_bilibili_input",
        lambda _source: SimpleNamespace(
            full_url=f"https://www.bilibili.com/video/BV1Aa411c7mD?p={part}"
        ),
    )
    identity = identify_source("https://b23.tv/review-short")
    assert identity.canonical_url == expected_url


def test_short_link_rejects_parser_id_without_safe_resolved_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        source_identity_module,
        "parse_xiaohongshu_input",
        lambda _source: SimpleNamespace(
            note_id=XHS_NOTE_ID,
            full_url=(
                "https://www.xiaohongshu.com/login"
                "?xsec_token=0123456789abcdef01234567"
            ),
        ),
    )

    with pytest.raises(SourceIdentityError):
        identify_source("https://xhslink.com/review-short")


def test_douyin_short_resolution_ignores_lookalike_direct_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: list[str] = []

    def fake_resolver(value: str) -> str:
        received.append(value)
        return "7524373044106677544"

    monkeypatch.setattr(
        source_identity_module,
        "resolve_aweme_id_from_input",
        fake_resolver,
    )

    identity = identify_source(
        "https://douyin.com.evil/video/1111111111111111111 "
        "https://v.douyin.com/safe-code",
    )

    assert identity.stable_id == "7524373044106677544"
    assert received == ["https://v.douyin.com/safe-code"]


@pytest.mark.parametrize(
    "source",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQx",
        "https://www.bilibili.com/video/BV1Aa411c7mDx",
        "https://www.douyin.com/video/7524373044106677544123456",
        "https://www.bilibili.com/video/BV1Aa411c7mD?p=100001",
    ],
)
def test_identify_source_rejects_oversized_stable_ids_and_part(source: str) -> None:
    with pytest.raises(SourceIdentityError):
        identify_source(source, allow_network=False)


def test_source_request_keeps_download_url_process_local_only() -> None:
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret&source=web"
    )
    source = resolve_source_request(raw_url, allow_network=False)
    assert source.download_url == raw_url
    assert source.identity.canonical_url == (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
    )
    assert "review-secret" not in repr(source)
    with pytest.raises(TypeError):
        json.dumps(source)


def test_legacy_manifest_is_rejected_without_mutation(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    task_id = "legacy-task"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    manifest_path = task_dir / "frameq-task.json"
    original = json.dumps(
        {
            "schema_version": 2,
            "task_id": task_id,
            "source_url": "https://example.test/?xsec_token=review-secret",
            "status": "completed",
        }
    )
    manifest_path.write_text(original, encoding="utf-8")

    with pytest.raises(ValueError, match="current history format"):
        task_context_from_manifest(output_root, tmp_path / "cache", task_id)

    assert manifest_path.read_text(encoding="utf-8") == original


def test_retry_context_rejects_linked_task_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task_id = "linked-task"
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    canonical = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "source_privacy_migration_version": 2,
                "source_privacy_quarantined": False,
                "task_id": task_id,
                "source_url": canonical,
                "source_identity": identify_source(
                    canonical, allow_network=False
                ).to_manifest_dict(),
                "status": "completed",
                "artifacts": {},
            }
        ),
        encoding="utf-8",
    )
    real_is_link = task_store_module._is_link_or_junction
    monkeypatch.setattr(
        task_store_module,
        "_is_link_or_junction",
        lambda path: path == task_dir or real_is_link(path),
    )

    with pytest.raises(ValueError, match="linked"):
        task_context_from_manifest(output_root, tmp_path / "cache", task_id)


def test_task_manifest_writer_rejects_unvalidated_source_identity(tmp_path: Path) -> None:
    unsafe_identity = SourceIdentity(
        platform="xiaohongshu",
        stable_id=XHS_NOTE_ID,
        canonical_url=(
            f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
            "?xsec_token=review-secret"
        ),
    )
    with pytest.raises(SourceIdentityError):
        create_task_context(
            ProcessRequest(url="https://example.test"),
            unsafe_identity,
            tmp_path / "outputs",
            tmp_path / "cache",
        )
