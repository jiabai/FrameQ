from __future__ import annotations

import importlib
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from frameq_worker.models import (
    GenerationPreferences,
    JobStage,
    PreferenceLabelSnapshot,
    PreferenceSnapshot,
    ProcessLocalMediaRequest,
    ProcessRequest,
    ProcessResult,
    TranscriptMetadata,
)
from frameq_worker.source_identity import SourceIdentity
from frameq_worker.task_store import (
    LocalFileTaskSource,
    TaskContext,
    TaskStoreFacade,
    UrlTaskSource,
    task_artifacts_for_existing_files,
)


def _create_store_context(tmp_path: Path) -> tuple[TaskStoreFacade, TaskContext]:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    store = TaskStoreFacade(output_root=output_root, cache_root=cache_root)
    identity = SourceIdentity(
        platform="youtube",
        stable_id="dQw4w9WgXcQ",
        canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    context = store.create(
        ProcessRequest(
            url=identity.canonical_url,
            asr_model="iic/SenseVoiceSmall",
        ),
        identity,
        now=datetime(2026, 7, 18, 12, 0, tzinfo=UTC),
    )
    return store, context


def _preference_snapshot() -> PreferenceSnapshot:
    return PreferenceSnapshot(
        profile=None,
        profile_skipped=True,
        generation_preferences=GenerationPreferences(
            goal="content_creation",
            scenario="short_video",
            angles=("topic_angle",),
            audience="fans_readers",
            styles=("grounded",),
        ),
        label_snapshot=PreferenceLabelSnapshot(
            profile=(),
            generation_preferences=(),
        ),
    )


def test_task_store_facade_owns_create_open_finalize_and_preference_snapshot(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    store = TaskStoreFacade(output_root=output_root, cache_root=cache_root)
    identity = SourceIdentity(
        platform="youtube",
        stable_id="dQw4w9WgXcQ",
        canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    context = store.create(
        ProcessRequest(
            url=identity.canonical_url,
            asr_model="iic/SenseVoiceSmall",
        ),
        identity,
        now=datetime(2026, 7, 18, 12, 0, tzinfo=UTC),
    )
    context.paths.transcript_txt_path.write_text(
        "facade transcript\n",
        encoding="utf-8",
    )
    snapshot = PreferenceSnapshot(
        profile=None,
        profile_skipped=True,
        generation_preferences=GenerationPreferences(
            goal="content_creation",
            scenario="short_video",
            angles=("topic_angle",),
            audience="fans_readers",
            styles=("grounded",),
        ),
        label_snapshot=PreferenceLabelSnapshot(
            profile=(),
            generation_preferences=(),
        ),
    )

    store.save_preference_snapshot(context, snapshot)
    finalized = store.finalize(
        context,
        ProcessResult(
            status=JobStage.COMPLETED,
            text="facade transcript",
            transcript=TranscriptMetadata(
                source="asr",
                engine="iic/SenseVoiceSmall",
            ),
        ),
    )
    opened = store.open(context.task_id)

    assert finalized.task_id == context.task_id
    assert finalized.artifacts == {
        "transcript_txt": "transcript/transcript.txt",
        "preference_snapshot": "ai/preference-snapshot.json",
    }
    assert opened.context == context
    assert opened.transcript == TranscriptMetadata(
        source="asr",
        engine="iic/SenseVoiceSmall",
    )
    assert not hasattr(opened, "manifest")
    manifest = json.loads(context.paths.manifest_path.read_text(encoding="utf-8"))
    assert manifest["task_id"] == context.task_id
    assert manifest["artifacts"] == finalized.artifacts
    assert "source_kind" not in manifest
    assert isinstance(opened.context.source, UrlTaskSource)


def test_local_task_source_is_closed_path_free_unique_and_reopenable(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    store = TaskStoreFacade(output_root=output_root, cache_root=cache_root)
    request = ProcessLocalMediaRequest(
        source_path=tmp_path / "review-secret" / "Interview.wmv",
        media_kind="video",
        safe_display_name="Interview.wmv",
        source_extension="wmv",
        asr_model="iic/SenseVoiceSmall",
    )

    context = store.create_local(
        request,
        now=datetime(2026, 7, 18, 12, 0, tzinfo=UTC),
        random_id="abc123",
    )
    second = store.create_local(
        request,
        now=datetime(2026, 7, 18, 12, 0, tzinfo=UTC),
        random_id="def456",
    )
    context.paths.video_path_for_extension("wmv").write_bytes(b"wmv")
    context.paths.audio_path.write_bytes(b"wav")
    finalized = store.finalize(
        context,
        ProcessResult(
            status=JobStage.COMPLETED,
            text="local transcript",
            transcript=TranscriptMetadata(
                source="asr",
                engine="iic/SenseVoiceSmall",
            ),
        ),
    )
    opened = store.open(context.task_id)
    manifest = json.loads(context.paths.manifest_path.read_text(encoding="utf-8"))
    serialized = json.dumps(manifest, ensure_ascii=False)

    assert context.task_id == "20260718-120000-local-abc123"
    assert second.task_id == "20260718-120000-local-def456"
    assert context.task_id != second.task_id
    assert isinstance(context.source, LocalFileTaskSource)
    assert context.source_identity is None
    assert opened.context == context
    assert finalized.task_id == context.task_id
    assert finalized.artifacts == {
        "video": "media/video.wmv",
        "audio": "media/audio.wav",
    }
    assert manifest["source_kind"] == "local_file"
    assert manifest["source_url"] == ""
    assert manifest["source_identity"] is None
    assert manifest["local_source"] == {
        "display_name": "Interview.wmv",
        "media_kind": "video",
        "extension": "wmv",
    }
    assert "review-secret" not in serialized
    assert str(request.source_path) not in serialized

    invalid_manifest = dict(manifest)
    invalid_manifest.pop("source_identity")
    context.paths.manifest_path.write_text(
        json.dumps(invalid_manifest),
        encoding="utf-8",
    )
    with pytest.raises(
        ValueError,
        match="Task is unavailable in the current history format.",
    ):
        store.open(context.task_id)


def test_task_store_facade_open_rejects_unsupported_task_without_raw_manifest(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    task_id = "legacy-task"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": task_id,
                "created_at": "2026-07-18T12:00:00Z",
                "status": "completed",
            }
        ),
        encoding="utf-8",
    )

    store = TaskStoreFacade(output_root=output_root, cache_root=tmp_path / "cache")

    try:
        store.open(task_id)
    except ValueError as error:
        assert str(error) == "Task is unavailable in the current history format."
    else:
        raise AssertionError("unsupported task must be rejected")


def test_finalize_preserves_previous_manifest_when_atomic_replace_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    atomic_files = importlib.import_module("frameq_worker.atomic_files")
    store, context = _create_store_context(tmp_path)
    previous_manifest = '{"status":"previous"}\n'
    context.paths.manifest_path.write_text(previous_manifest, encoding="utf-8")

    def fail_replace(_source: Path, destination: Path) -> None:
        assert destination == context.paths.manifest_path
        raise OSError("D:/private/output/frameq-task.json is locked")

    monkeypatch.setattr(atomic_files.os, "replace", fail_replace)

    with pytest.raises(atomic_files.AtomicFileCommitError) as captured:
        store.finalize(
            context,
            ProcessResult(status=JobStage.FAILED, text="failed task"),
        )

    assert str(captured.value) == "Atomic file commit failed."
    assert captured.value.__cause__ is None
    assert context.paths.manifest_path.read_text(encoding="utf-8") == previous_manifest
    assert not [
        path
        for path in context.paths.task_dir.iterdir()
        if path.name.startswith(".frameq-task.")
    ]


def test_preference_snapshot_preserves_previous_json_when_atomic_replace_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    atomic_files = importlib.import_module("frameq_worker.atomic_files")
    store, context = _create_store_context(tmp_path)
    previous_snapshot = '{"profile_skipped":false}\n'
    context.paths.preference_snapshot_path.write_text(
        previous_snapshot,
        encoding="utf-8",
    )

    def fail_replace(_source: Path, destination: Path) -> None:
        assert destination == context.paths.preference_snapshot_path
        raise OSError("D:/private/output/preference-snapshot.json is locked")

    monkeypatch.setattr(atomic_files.os, "replace", fail_replace)

    with pytest.raises(atomic_files.AtomicFileCommitError) as captured:
        store.save_preference_snapshot(context, _preference_snapshot())

    assert str(captured.value) == "Atomic file commit failed."
    assert captured.value.__cause__ is None
    assert (
        context.paths.preference_snapshot_path.read_text(encoding="utf-8")
        == previous_snapshot
    )
    assert not [
        path
        for path in context.paths.ai_dir.iterdir()
        if path.name.startswith(".preference-snapshot.")
    ]


def test_manifest_sync_failure_does_not_replace_previous_json(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    atomic_files = importlib.import_module("frameq_worker.atomic_files")
    store, context = _create_store_context(tmp_path)
    previous_manifest = '{"status":"previous"}\n'
    context.paths.manifest_path.write_text(previous_manifest, encoding="utf-8")

    def fail_sync(_descriptor: int) -> None:
        raise OSError("D:/private/output/frameq-task.json could not be synced")

    monkeypatch.setattr(atomic_files.os, "fsync", fail_sync)

    with pytest.raises(atomic_files.AtomicFileCommitError) as captured:
        store.finalize(context, ProcessResult(status=JobStage.FAILED))

    assert str(captured.value) == "Atomic file commit failed."
    assert captured.value.__cause__ is None
    assert context.paths.manifest_path.read_text(encoding="utf-8") == previous_manifest
    assert not list(context.paths.task_dir.glob(".frameq-task.*.part.json"))


def test_finalize_registers_only_known_committed_regular_files(tmp_path: Path) -> None:
    store, context = _create_store_context(tmp_path)
    context.paths.video_path.mkdir()
    context.paths.audio_path.write_bytes(b"committed audio")
    staging_path = context.paths.media_dir / ".audio.interrupted.part.wav"
    staging_path.write_bytes(b"partial audio")
    (context.paths.task_dir / ".frameq-artifact-transaction.json").write_text(
        "{}\n",
        encoding="utf-8",
    )
    (context.paths.ai_dir / ".frameq-artifact-aaaaaaaa-0.rollback").write_bytes(
        b"internal rollback"
    )

    assert task_artifacts_for_existing_files(context.paths) == {
        "audio": "media/audio.wav"
    }
    (context.paths.task_dir / ".frameq-artifact-transaction.json").unlink()

    finalized = store.finalize(
        context,
        ProcessResult(
            status=JobStage.FAILED,
            artifacts={
                "staging_audio": "media/.audio.interrupted.part.wav",
                "untrusted": "outside-task.txt",
            },
        ),
    )

    assert finalized.artifacts == {"audio": "media/audio.wav"}
