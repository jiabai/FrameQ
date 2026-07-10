from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from frameq_worker import source_identity as source_identity_module
from frameq_worker import task_store as task_store_module
from frameq_worker.models import JobStage, ProcessRequest, ProcessResult
from frameq_worker.source_identity import (
    SourceIdentity,
    SourceIdentityError,
    identify_source,
    migrate_legacy_source_data,
    resolve_source_request,
)
from frameq_worker.task_store import (
    TaskContext,
    TaskPaths,
    create_task_context,
    task_context_from_manifest,
    write_task_manifest,
)

XHS_NOTE_ID = "64a1b2c3d4e5f67890123456"


@pytest.mark.parametrize(
    ("source", "expected_platform", "expected_id", "expected_part", "expected_url"),
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
            "https://www.youtube.com/shorts/abcDEF_123-?feature=review-secret#chapter",
            "youtube",
            "abcDEF_123-",
            None,
            "https://www.youtube.com/watch?v=abcDEF_123-",
        ),
        (
            "https://www.bilibili.com/video/av170001?p=1&token=review-secret#reply",
            "bilibili",
            "av170001",
            1,
            "https://www.bilibili.com/video/av170001",
        ),
    ],
)
def test_identify_source_builds_allowlisted_canonical_identity(
    source: str,
    expected_platform: str,
    expected_id: str,
    expected_part: int | None,
    expected_url: str,
) -> None:
    identity = identify_source(source, allow_network=False)

    assert identity.platform == expected_platform
    assert identity.stable_id == expected_id
    assert identity.effective_part == expected_part
    assert identity.canonical_url == expected_url
    serialized = json.dumps(identity.to_manifest_dict(), ensure_ascii=False)
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
    identity = identify_source(
        short_url,
        resolved_url=resolved_url,
        allow_network=False,
    )

    assert identity.canonical_url == expected_url
    assert "review-secret" not in json.dumps(identity.to_manifest_dict())
    assert "resolved-secret" not in json.dumps(identity.to_manifest_dict())


def test_identify_source_rejects_unsupported_or_lookalike_hosts() -> None:
    with pytest.raises(SourceIdentityError):
        identify_source(
            f"https://www.xiaohongshu.com.evil/explore/{XHS_NOTE_ID}?token=review-secret",
            allow_network=False,
        )

    with pytest.raises(SourceIdentityError):
        identify_source(
            "https://www.xiaohongshu.com/explore"
            "?xsec_token=0123456789abcdef01234567",
            allow_network=False,
        )

    with pytest.raises(SourceIdentityError):
        identify_source(
            "https://www.xiaohongshu.com/login"
            "?signature=deadbeefdeadbeefdeadbeef",
            allow_network=False,
        )

    with pytest.raises(SourceIdentityError):
        identify_source(
            "https://[invalid-host/video/123?xsec_token=review-secret",
            allow_network=False,
        )


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
            video_id="untrusted",
            id_kind="bvid",
            part_index=part - 1,
            full_url=f"https://www.bilibili.com/video/BV1Aa411c7mD?p={part}",
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


def test_migrate_legacy_source_data_rewrites_manifest_and_transcript_metadata(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "legacy-xhs"
    transcript_dir = task_dir / "transcript"
    transcript_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret&source=web#comments"
    )
    (transcript_dir / "transcript.txt").write_text("official body\n", encoding="utf-8")
    (transcript_dir / "transcript.md").write_text(
        "# 视频文字稿\n\n## Metadata\n\n"
        f"- Source URL: {raw_url}\n- Source URL: {raw_url}\n\n"
        "## Transcript\n\nofficial body\n"
        "- Source URL: user-authored body line\n",
        encoding="utf-8",
    )
    original_dir = transcript_dir / "original"
    original_dir.mkdir()
    (original_dir / "transcript.md").write_text(
        "# 视频文字稿\n\n## Metadata\n\n"
        f"- Source URL: {raw_url}\n\n## Transcript\n\noriginal body\n",
        encoding="utf-8",
    )
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": "legacy-xhs",
                "created_at": "2026-07-05T15:30:12Z",
                "source_url": raw_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "model": "iic/SenseVoiceSmall",
                "artifacts": {
                    "transcript_txt": "transcript/transcript.txt",
                    "transcript_md": "transcript/transcript.md",
                },
                "error": {
                    "code": "VIDEO_DOWNLOAD_FAILED",
                    "message": f"downloader echoed {raw_url}",
                    "stage": "video_extracting",
                },
                "text_preview": "official body",
                "insights_count": 0,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    report = migrate_legacy_source_data(output_root)

    assert report.migrated_manifests == 1
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    canonical = f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
    assert manifest["schema_version"] == 3
    assert manifest["source_url"] == canonical
    assert manifest["source_identity"]["canonical_url"] == canonical
    assert manifest["error"]["message"] == (
        "Previous task failed (VIDEO_DOWNLOAD_FAILED)."
    )
    assert "- Source URL: user-authored body line" in (
        transcript_dir / "transcript.md"
    ).read_text(encoding="utf-8")
    persisted = "\n".join(
        path.read_text(encoding="utf-8")
        for path in task_dir.rglob("*")
        if path.is_file()
    )
    assert "review-secret" not in persisted
    assert "xsec_token" not in persisted
    assert raw_url not in persisted


def test_migrate_legacy_source_data_removes_unrecognized_sensitive_url(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "legacy-unknown"
    task_dir.mkdir(parents=True)
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": "legacy-unknown",
                "created_at": "2026-07-05T15:30:12Z",
                "source_url": "https://user:password@example.test/video?token=review-secret#x",
                "platform": "source",
                "status": "completed",
                "artifacts": {},
                "error": None,
                "text_preview": "",
                "insights_count": 0,
            }
        ),
        encoding="utf-8",
    )

    report = migrate_legacy_source_data(output_root)

    assert report.unavailable_manifests == 1
    persisted = manifest_path.read_text(encoding="utf-8")
    assert '"source_url": ""' in persisted
    assert "source_identity" not in json.loads(persisted)
    assert "review-secret" not in persisted
    assert "password" not in persisted


def test_migrate_v1_manifest_preserves_legacy_asr_transcript_metadata(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "legacy-v1"
    task_dir.mkdir(parents=True)
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "task_id": "legacy-v1",
                "created_at": "2026-07-05T15:30:12Z",
                "source_url": "https://www.douyin.com/video/7524373044106677544",
                "platform": "douyin",
                "status": "completed",
                "model": "iic/SenseVoiceSmall",
                "artifacts": {},
                "error": None,
                "text_preview": "body",
                "insights_count": 0,
            }
        ),
        encoding="utf-8",
    )

    migrate_legacy_source_data(output_root)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 3
    assert manifest["transcript"] == {
        "source": "asr",
        "language": None,
        "engine": "iic/SenseVoiceSmall",
    }


def test_migration_scrubs_declared_and_fixed_ai_artifacts(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "legacy-ai"
    ai_dir = task_dir / "ai"
    custom_dir = task_dir / "custom"
    ai_dir.mkdir(parents=True)
    custom_dir.mkdir()
    raw_url = (
        f"https://alice:password@www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret&signature=signature-secret#comments"
    )
    artifact_payload = (
        f"source={raw_url}\n"
        "xsec_token=review-secret\n"
        "signature=signature-secret\n"
        "userinfo alice password\n"
    )
    (ai_dir / "summary.md").write_text(artifact_payload, encoding="utf-8")
    (custom_dir / "summary.md").write_text(artifact_payload, encoding="utf-8")
    (ai_dir / "mindmap.mmd").write_text(artifact_payload, encoding="utf-8")
    (ai_dir / "insights.json").write_text(
        json.dumps({"captured": artifact_payload}),
        encoding="utf-8",
    )
    (ai_dir / "insights.md").write_text(artifact_payload, encoding="utf-8")
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": "legacy-ai",
                "source_url": raw_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {
                    "summary": "custom/summary.md",
                    "mindmap": "ai/mindmap.mmd",
                    "insights": "ai/insights.json",
                    "insights_md": "ai/insights.md",
                    "debug_url": raw_url,
                },
                "error": None,
                "text_preview": raw_url,
            }
        ),
        encoding="utf-8",
    )

    migrate_legacy_source_data(output_root)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["source_privacy_migration_version"] == 2
    assert manifest["source_privacy_quarantined"] is False
    assert "debug_url" not in manifest["artifacts"]
    assert json.loads((ai_dir / "insights.json").read_text(encoding="utf-8"))
    persisted = "\n".join(
        path.read_text(encoding="utf-8")
        for path in task_dir.rglob("*")
        if path.is_file()
    ).lower()
    for secret in (
        raw_url.lower(),
        "review-secret",
        "signature-secret",
        "xsec_token",
        "password",
    ):
        assert secret not in persisted


def test_migration_short_token_does_not_corrupt_ordinary_ai_text(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "legacy-short-token"
    ai_dir = task_dir / "ai"
    ai_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}?xsec_token=x"
    )
    (ai_dir / "summary.md").write_text(
        f"source={raw_url}\nx ray example\nxsec_token=x\n",
        encoding="utf-8",
    )
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": "legacy-short-token",
                "source_url": raw_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {"summary": "ai/summary.md"},
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    migrate_legacy_source_data(output_root)

    summary = (ai_dir / "summary.md").read_text(encoding="utf-8")
    assert "x ray example" in summary
    assert "xsec_token=x" not in summary
    assert json.loads(manifest_path.read_text(encoding="utf-8"))[
        "source_privacy_migration_version"
    ] == 2


def test_migration_checks_fixed_transcript_paths_without_manifest_declaration(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "legacy-fixed-transcript"
    transcript_dir = task_dir / "transcript"
    original_dir = transcript_dir / "original"
    original_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret"
    )
    transcript = f"## Metadata\n\n- Source URL: {raw_url}\n\n## Transcript\n\nbody\n"
    (transcript_dir / "transcript.md").write_text(transcript, encoding="utf-8")
    (original_dir / "transcript.md").write_text(transcript, encoding="utf-8")
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": "legacy-fixed-transcript",
                "source_url": raw_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {},
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    report = migrate_legacy_source_data(output_root)

    canonical = f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
    assert report.migrated_transcripts == 1
    for path in (transcript_dir / "transcript.md", original_dir / "transcript.md"):
        content = path.read_text(encoding="utf-8")
        assert f"- Source URL: {canonical}" in content
        assert "review-secret" not in content
    assert json.loads(manifest_path.read_text(encoding="utf-8"))[
        "source_privacy_migration_version"
    ] == 2


@pytest.mark.parametrize("include_identity", [False, True])
def test_schema_v3_missing_or_mismatched_identity_is_migrated_instead_of_skipped(
    tmp_path: Path,
    include_identity: bool,
) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "v3-mismatch"
    task_dir.mkdir(parents=True)
    canonical = f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
    raw_url = f"{canonical}?xsec_token=review-secret"
    manifest_path = task_dir / "frameq-task.json"
    payload: dict[str, object] = {
        "schema_version": 3,
        "source_privacy_migration_version": 1,
        "task_id": "v3-mismatch",
        "source_url": raw_url,
        "platform": "xiaohongshu",
        "status": "completed",
        "artifacts": {},
        "error": None,
    }
    if include_identity:
        payload["source_identity"] = identify_source(
            canonical,
            allow_network=False,
        ).to_manifest_dict()
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")

    migrate_legacy_source_data(output_root)

    persisted = manifest_path.read_text(encoding="utf-8")
    manifest = json.loads(persisted)
    assert manifest["source_url"] == canonical
    assert manifest["source_identity"]["canonical_url"] == canonical
    assert manifest["source_privacy_migration_version"] == 2
    assert "review-secret" not in persisted
    assert "xsec_token" not in persisted


def test_migration_scrubs_standalone_credentials_without_source_url(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    task_id = "legacy-missing-source"
    task_dir = output_root / "tasks" / task_id
    transcript_dir = task_dir / "transcript"
    ai_dir = task_dir / "ai"
    transcript_dir.mkdir(parents=True)
    ai_dir.mkdir(parents=True)
    (transcript_dir / "transcript.md").write_text(
        "## Metadata\n\n- xsec_token=review-secret\n\n## Transcript\n\nbody\n",
        encoding="utf-8",
    )
    (ai_dir / "summary.md").write_text(
        "legacy echo xsec_token=review-secret\n",
        encoding="utf-8",
    )
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": task_id,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {
                    "transcript_md": "transcript/transcript.md",
                    "summary": "ai/summary.md",
                    "video": "media/xsec_token=review-secret.mp4",
                },
                "text_preview": "preview xsec_token=review-secret",
                "debug_url": (
                    "https://example.test/video?xsec_token=review-secret"
                ),
                "legacy_metadata": {
                    "xsec_token": "review-secret",
                    "note": "authorization=review-secret",
                },
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    first_report = migrate_legacy_source_data(output_root)
    first_snapshot = {
        path.relative_to(task_dir).as_posix(): path.read_text(encoding="utf-8")
        for path in task_dir.rglob("*")
        if path.is_file()
    }
    second_report = migrate_legacy_source_data(output_root)
    second_snapshot = {
        path.relative_to(task_dir).as_posix(): path.read_text(encoding="utf-8")
        for path in task_dir.rglob("*")
        if path.is_file()
    }

    persisted = "\n".join(second_snapshot.values())
    manifest = json.loads(second_snapshot["frameq-task.json"])
    assert first_report.unavailable_manifests == 1
    assert second_report.migrated_manifests == 0
    assert first_snapshot == second_snapshot
    assert manifest["source_privacy_migration_version"] == 2
    assert manifest["source_url"] == ""
    assert manifest["artifacts"]["summary"] == "ai/summary.md"
    assert "video" not in manifest["artifacts"]
    assert "xsec_token" not in manifest["legacy_metadata"]
    assert "review-secret" not in persisted
    assert "xsec_token" not in persisted


def test_schema_v3_unrecognized_nonempty_source_does_not_trust_stale_identity(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "v3-conflict"
    task_dir.mkdir(parents=True)
    canonical = f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
    raw_url = "https://example.test/video?xsec_token=review-secret"
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 3,
                "source_privacy_migration_version": 1,
                "task_id": "v3-conflict",
                "source_url": raw_url,
                "source_identity": identify_source(
                    canonical,
                    allow_network=False,
                ).to_manifest_dict(),
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {},
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    migrate_legacy_source_data(output_root)

    persisted = manifest_path.read_text(encoding="utf-8")
    manifest = json.loads(persisted)
    assert manifest["source_url"] == ""
    assert "source_identity" not in manifest
    assert manifest["source_privacy_migration_version"] == 2
    assert "review-secret" not in persisted
    assert "xsec_token" not in persisted


def test_migration_failure_does_not_mark_manifest_complete(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "legacy-write-failure"
    transcript_dir = task_dir / "transcript"
    transcript_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret"
    )
    (transcript_dir / "transcript.md").write_text(
        f"## Metadata\n\n- Source URL: {raw_url}\n\n## Transcript\n\nbody\n",
        encoding="utf-8",
    )
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": "legacy-write-failure",
                "source_url": raw_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {},
                "error": None,
            }
        ),
        encoding="utf-8",
    )
    real_write = source_identity_module._write_text_atomically

    def fail_transcript_write(
        path: Path,
        content: str,
        *,
        expected_text: str | None = None,
    ) -> bool:
        if path.name == "transcript.md":
            return False
        return real_write(path, content, expected_text=expected_text)

    monkeypatch.setattr(
        source_identity_module,
        "_write_text_atomically",
        fail_transcript_write,
    )

    migrate_legacy_source_data(output_root)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert "source_privacy_migration_version" not in manifest
    assert "review-secret" in (transcript_dir / "transcript.md").read_text(
        encoding="utf-8"
    )
    with pytest.raises(ValueError, match="migration is incomplete"):
        task_context_from_manifest(
            output_root,
            tmp_path / "cache",
            "legacy-write-failure",
        )


def test_migration_read_failure_preserves_manifest_and_retries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_root = tmp_path / "outputs"
    task_id = "legacy-read-failure"
    task_dir = output_root / "tasks" / task_id
    ai_dir = task_dir / "ai"
    ai_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret"
    )
    summary_path = ai_dir / "summary.md"
    summary_path.write_text("echo review-secret\n", encoding="utf-8")
    manifest_path = task_dir / "frameq-task.json"
    original_manifest = json.dumps(
        {
            "schema_version": 2,
            "task_id": task_id,
            "source_url": raw_url,
            "platform": "xiaohongshu",
            "status": "completed",
            "artifacts": {"summary": "ai/summary.md"},
            "error": None,
        }
    )
    manifest_path.write_text(original_manifest, encoding="utf-8")
    real_read_text = Path.read_text

    def fail_summary_read(path: Path, *args: object, **kwargs: object) -> str:
        if path == summary_path:
            raise OSError("simulated read failure")
        return real_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", fail_summary_read)
    first_report = migrate_legacy_source_data(output_root)

    assert first_report.migrated_manifests == 0
    assert real_read_text(manifest_path, encoding="utf-8") == original_manifest
    with pytest.raises(ValueError, match="migration is incomplete"):
        task_context_from_manifest(output_root, tmp_path / "cache", task_id)

    monkeypatch.setattr(Path, "read_text", real_read_text)
    second_report = migrate_legacy_source_data(output_root)
    persisted = manifest_path.read_text(encoding="utf-8")

    assert second_report.migrated_manifests == 1
    assert "review-secret" not in persisted
    assert "review-secret" not in summary_path.read_text(encoding="utf-8")


def test_manifest_write_failure_and_interruption_preserve_retryable_original(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_root = tmp_path / "outputs"
    task_id = "legacy-manifest-write-failure"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret"
    )
    manifest_path = task_dir / "frameq-task.json"
    original_manifest = json.dumps(
        {
            "schema_version": 2,
            "task_id": task_id,
            "source_url": raw_url,
            "platform": "xiaohongshu",
            "status": "completed",
            "artifacts": {},
            "error": None,
        }
    )
    manifest_path.write_text(original_manifest, encoding="utf-8")
    real_replace = source_identity_module.os.replace

    def fail_manifest_replace(source: object, destination: object) -> None:
        if Path(destination) == manifest_path:
            raise OSError("simulated manifest replace failure")
        real_replace(source, destination)

    monkeypatch.setattr(source_identity_module.os, "replace", fail_manifest_replace)
    failed_report = migrate_legacy_source_data(output_root)

    assert failed_report.migrated_manifests == 0
    assert manifest_path.read_text(encoding="utf-8") == original_manifest
    assert not list(task_dir.glob(".*.tmp"))

    def interrupt_manifest_replace(source: object, destination: object) -> None:
        if Path(destination) == manifest_path:
            raise KeyboardInterrupt("simulated interruption")
        real_replace(source, destination)

    monkeypatch.setattr(source_identity_module.os, "replace", interrupt_manifest_replace)
    with pytest.raises(KeyboardInterrupt, match="simulated interruption"):
        migrate_legacy_source_data(output_root)

    assert manifest_path.read_text(encoding="utf-8") == original_manifest
    assert not list(task_dir.glob(".*.tmp"))

    monkeypatch.setattr(source_identity_module.os, "replace", real_replace)
    retry_report = migrate_legacy_source_data(output_root)
    persisted = manifest_path.read_text(encoding="utf-8")

    assert retry_report.migrated_manifests == 1
    assert "review-secret" not in persisted


def test_migration_rejects_linked_transcript_directory_without_touching_target(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    task_id = "legacy-linked-transcript"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    outside_dir = tmp_path / "outside-transcript"
    outside_dir.mkdir()
    outside_transcript = outside_dir / "transcript.md"
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret"
    )
    outside_original = f"## Metadata\n\n- Source URL: {raw_url}\n"
    outside_transcript.write_text(outside_original, encoding="utf-8")
    linked_dir = task_dir / "transcript"
    if os.name == "nt":
        created = subprocess.run(
            ["cmd", "/d", "/c", "mklink", "/J", str(linked_dir), str(outside_dir)],
            capture_output=True,
            text=True,
            check=False,
        )
        if created.returncode != 0:
            pytest.skip("Windows junction creation is unavailable")
    else:
        linked_dir.symlink_to(outside_dir, target_is_directory=True)
    manifest_path = task_dir / "frameq-task.json"
    original_manifest = json.dumps(
        {
            "schema_version": 2,
            "task_id": task_id,
            "source_url": raw_url,
            "platform": "xiaohongshu",
            "status": "completed",
            "artifacts": {"transcript_md": "transcript/transcript.md"},
            "error": None,
        }
    )
    manifest_path.write_text(original_manifest, encoding="utf-8")

    report = migrate_legacy_source_data(output_root)

    assert report.migrated_manifests == 0
    assert manifest_path.read_text(encoding="utf-8") == original_manifest
    assert outside_transcript.read_text(encoding="utf-8") == outside_original
    if os.name == "nt":
        os.rmdir(linked_dir)


def test_corrupt_manifest_and_artifact_fail_closed_without_mutation(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    corrupt_task_dir = output_root / "tasks" / "corrupt-manifest"
    corrupt_task_dir.mkdir(parents=True)
    corrupt_manifest = corrupt_task_dir / "frameq-task.json"
    corrupt_manifest.write_bytes(b"{not-json")

    artifact_task_id = "corrupt-artifact"
    artifact_task_dir = output_root / "tasks" / artifact_task_id
    ai_dir = artifact_task_dir / "ai"
    ai_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
        "?xsec_token=review-secret"
    )
    corrupt_artifact = ai_dir / "summary.md"
    corrupt_artifact.write_bytes(b"\xff\xfe\x00")
    artifact_manifest = artifact_task_dir / "frameq-task.json"
    artifact_manifest_original = json.dumps(
        {
            "schema_version": 2,
            "task_id": artifact_task_id,
            "source_url": raw_url,
            "platform": "xiaohongshu",
            "status": "completed",
            "artifacts": {"summary": "ai/summary.md"},
            "error": None,
        }
    )
    artifact_manifest.write_text(artifact_manifest_original, encoding="utf-8")

    report = migrate_legacy_source_data(output_root)

    assert report.inspected_manifests == 2
    assert report.migrated_manifests == 0
    assert corrupt_manifest.read_bytes() == b"{not-json"
    assert artifact_manifest.read_text(encoding="utf-8") == artifact_manifest_original
    assert corrupt_artifact.read_bytes() == b"\xff\xfe\x00"
    with pytest.raises(ValueError, match="migration is incomplete"):
        task_context_from_manifest(output_root, tmp_path / "cache", artifact_task_id)


def test_second_migration_uses_preserved_raw_source_to_finish_redaction(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / "legacy-transient-failure"
    ai_dir = task_dir / "ai"
    ai_dir.mkdir(parents=True)
    canonical = f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
    raw_url = f"{canonical}?xsec_token=review-secret"
    summary_path = ai_dir / "summary.md"
    summary_path.write_text(
        "standalone credential value: review-secret\n",
        encoding="utf-8",
    )
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": "legacy-transient-failure",
                "source_url": raw_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {"summary": "ai/summary.md"},
                "error": None,
            }
        ),
        encoding="utf-8",
    )
    real_write = source_identity_module._write_text_atomically
    failed_once = False

    def fail_summary_once(
        path: Path,
        content: str,
        *,
        expected_text: str | None = None,
    ) -> bool:
        nonlocal failed_once
        if path == summary_path and not failed_once:
            failed_once = True
            return False
        return real_write(path, content, expected_text=expected_text)

    monkeypatch.setattr(
        source_identity_module,
        "_write_text_atomically",
        fail_summary_once,
    )

    first_report = migrate_legacy_source_data(output_root)

    first = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert first_report.migrated_manifests == 0
    assert first["schema_version"] == 2
    assert first["source_url"] == raw_url
    assert "source_privacy_migration_version" not in first
    assert "review-secret" in summary_path.read_text(encoding="utf-8")

    second_report = migrate_legacy_source_data(output_root)

    second = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert second_report.migrated_manifests == 1
    assert second["schema_version"] == 3
    assert second["source_url"] == canonical
    assert second["source_privacy_migration_version"] == 2
    assert "review-secret" not in summary_path.read_text(encoding="utf-8")


def test_sensitive_value_in_legacy_task_id_quarantines_task(tmp_path: Path) -> None:
    secret = "0123456789abcdef01234567"
    task_id = f"legacy-{secret}"
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}?xsec_token={secret}"
    )
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": task_id,
                "source_url": raw_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {},
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    migrate_legacy_source_data(output_root)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["source_privacy_quarantined"] is True
    with pytest.raises(ValueError, match="quarantined"):
        task_context_from_manifest(output_root, tmp_path / "cache", task_id)


def test_legacy_xhs_token_prefix_in_task_id_is_quarantined(tmp_path: Path) -> None:
    token_prefix = "0123456789abcdef01234567"
    token = f"{token_prefix}-extra-secret"
    task_id = f"legacy-xiaohongshu-{token_prefix}"
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": task_id,
                "source_url": f"https://xhslink.com/demo?xsec_token={token}",
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {},
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    migrate_legacy_source_data(output_root)

    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["source_privacy_quarantined"] is True
    with pytest.raises(ValueError, match="quarantined"):
        task_context_from_manifest(output_root, tmp_path / "cache", task_id)


def test_legacy_xhs_userinfo_identifier_in_task_id_is_quarantined(
    tmp_path: Path,
) -> None:
    username = "0123456789abcdef01234567"
    task_id = f"legacy-xiaohongshu-{username}"
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    source_url = (
        f"https://{username}:password@www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
    )
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": task_id,
                "source_url": source_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {},
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    migrate_legacy_source_data(output_root)

    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["source_privacy_quarantined"] is True


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
                    canonical,
                    allow_network=False,
                ).to_manifest_dict(),
                "platform": "youtube",
                "status": "completed",
                "artifacts": {"transcript_txt": "transcript/transcript.txt"},
                "error": None,
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


def test_quarantine_is_sticky_when_incomplete_migration_runs_again(tmp_path: Path) -> None:
    secret = "0123456789abcdef01234567"
    task_id = f"legacy-{secret}"
    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}?xsec_token={secret}"
    )
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": task_id,
                "source_url": raw_url,
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {"summary": "../outside.md"},
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    migrate_legacy_source_data(output_root)
    first = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert first["source_privacy_quarantined"] is True
    assert "source_privacy_migration_version" not in first

    migrate_legacy_source_data(output_root)
    second = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert second["source_url"] == raw_url
    assert second["source_privacy_quarantined"] is True
    assert "source_privacy_migration_version" not in second


def test_task_manifest_writer_rejects_unvalidated_source_identity(tmp_path: Path) -> None:
    unsafe_identity = SourceIdentity(
        platform="xiaohongshu",
        stable_id=XHS_NOTE_ID,
        canonical_url=(
            f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}"
            "?xsec_token=review-secret"
        ),
    )
    request = ProcessRequest(url="https://example.test")
    with pytest.raises(SourceIdentityError):
        create_task_context(
            request,
            unsafe_identity,
            tmp_path / "outputs",
            tmp_path / "cache",
        )

    paths = TaskPaths(
        output_root=tmp_path / "outputs",
        cache_root=tmp_path / "cache",
        task_id="unsafe-writer",
    )
    context = TaskContext(
        paths=paths,
        source_identity=unsafe_identity,
        platform="xiaohongshu",
        model=request.model,
        created_at="2026-07-10T00:00:00Z",
    )
    with pytest.raises(SourceIdentityError):
        write_task_manifest(context, ProcessResult(status=JobStage.COMPLETED))
    assert not paths.manifest_path.exists()

    safe_context = create_task_context(
        request,
        identify_source(
            f"https://www.xiaohongshu.com/explore/{XHS_NOTE_ID}",
            allow_network=False,
        ),
        tmp_path / "safe-outputs",
        tmp_path / "safe-cache",
    )
    write_task_manifest(safe_context, ProcessResult(status=JobStage.COMPLETED))
    safe_manifest = json.loads(
        safe_context.paths.manifest_path.read_text(encoding="utf-8")
    )
    assert safe_manifest["source_privacy_quarantined"] is False
