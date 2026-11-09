import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from shutil import rmtree
from uuid import uuid4

import pytest
from worker_core.models import (
    JobStage,
    ProcessLocalMediaRequest,
    ProcessRequest,
    ProcessResult,
    TranscriptMetadata,
    WorkerError,
)
from worker_core.note_title_metadata import NoteTitleMetadata
from worker_core.source_identity import SourceIdentity
from worker_core.task_store import TaskContext, TaskStoreFacade, write_task_manifest


@pytest.fixture
def isolated_root() -> Iterator[Path]:
    fixture_root = (
        Path(__file__).resolve().parents[2] / "build" / "note-sidecar-tests" / uuid4().hex
    )
    fixture_root.mkdir(parents=True)
    yield fixture_root
    expected_parent = Path(__file__).resolve().parents[2] / "build" / "note-sidecar-tests"
    assert fixture_root.parent == expected_parent
    rmtree(fixture_root)


def saved_task(base: Path, kind: str) -> tuple[TaskStoreFacade, TaskContext]:
    store = TaskStoreFacade(base / "outputs", base / "cache")
    now = datetime(2026, 10, 31, 12, tzinfo=UTC)
    if kind == "local":
        context = store.create_local(
            ProcessLocalMediaRequest(
                base / "input.wav", "audio", "input.wav", "wav", "iic/SenseVoiceSmall-onnx",
            ),
            now=now,
            random_id="abcdef123456",
        )
    else:
        identity = SourceIdentity(
            platform="youtube",
            stable_id="dQw4w9WgXcQ",
            canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )
        context = store.create(
            ProcessRequest(identity.canonical_url, "iic/SenseVoiceSmall-onnx"), identity, now=now,
        )
    context.paths.transcript_txt_path.write_text(
        "真实保存在隔离任务目录的文字稿。", encoding="utf-8",
    )
    store.finalize(context, ProcessResult(
        status=JobStage.COMPLETED,
        text="真实保存在隔离任务目录的文字稿。",
        transcript=TranscriptMetadata("asr", "zh", "sensevoice_small"),
    ))
    return store, context


@pytest.mark.parametrize("kind", ["local", "url"])
@pytest.mark.parametrize("transactional", [False, True])
@pytest.mark.parametrize(
    "status", [JobStage.COMPLETED, JobStage.PARTIAL_COMPLETED, JobStage.FAILED],
)
def test_finalize_keeps_native_sidecar_bytes_and_excludes_it_from_artifacts(
    isolated_root: Path, kind: str, transactional: bool, status: JobStage,
) -> None:
    store, context = saved_task(isolated_root, kind)
    sidecar = context.paths.task_dir / "frameq-note-metadata.json"
    before = (json.dumps({
        "schema_version": 1, "task_id": context.task_id,
        "pinned": True, "display_title": "保留用户手动标题",
    }, ensure_ascii=False) + "\n").encode("utf-8")
    sidecar.write_bytes(before)
    transcript_before = context.paths.transcript_txt_path.read_bytes()
    result = store.finalize(context, ProcessResult(
        status=status,
        text="真实保存在隔离任务目录的文字稿。",
        summary="保存的总结",
        transcript=TranscriptMetadata("asr", "zh", "sensevoice_small"),
        error=(
            None if status == JobStage.COMPLETED
            else WorkerError("AI_LLM_REQUEST_FAILED", "Generation did not complete.",
                             JobStage.INSIGHTS_GENERATING)
        ),
        artifact_payloads={"ai/summary.md": b"# Saved summary"} if transactional else {},
    ))
    assert sidecar.read_bytes() == before
    assert context.paths.transcript_txt_path.read_bytes() == transcript_before
    assert store.open(context.task_id).context == context
    assert "frameq-note-metadata.json" not in result.artifacts.values()
    assert "display_title" not in result.to_dict()


@pytest.mark.parametrize("kind", ["local", "url"])
@pytest.mark.parametrize("status,code", [
    ("generating", None), ("completed", None),
    ("failed", "TITLE_OUTPUT_INVALID"), ("cancelled", "WORKER_CANCELLED"),
])
def test_title_state_and_direct_manifest_rebuild_preserve_native_sidecar(
    isolated_root: Path, kind: str, status: str, code: str | None,
) -> None:
    store, context = saved_task(isolated_root, kind)
    sidecar = context.paths.task_dir / "frameq-note-metadata.json"
    before = b"deliberately unreadable native settings stay untouched\n"
    sidecar.write_bytes(before)
    metadata = NoteTitleMetadata("已经提交的生成标题", status, "zh-CN", code)
    store.save_note_title(context, metadata)
    assert sidecar.read_bytes() == before
    assert store.open(context.task_id).note_title == metadata
    write_task_manifest(context, ProcessResult(
        status=JobStage.COMPLETED,
        text="保存的文字稿。",
        transcript=TranscriptMetadata("asr", "zh", "sensevoice_small"),
    ))
    assert sidecar.read_bytes() == before
    assert store.open(context.task_id).note_title == metadata
