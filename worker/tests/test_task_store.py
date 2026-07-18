from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from frameq_worker.models import (
    GenerationPreferences,
    JobStage,
    PreferenceLabelSnapshot,
    PreferenceSnapshot,
    ProcessRequest,
    ProcessResult,
    TranscriptMetadata,
)
from frameq_worker.source_identity import SourceIdentity
from frameq_worker.task_store import TaskStoreFacade


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
