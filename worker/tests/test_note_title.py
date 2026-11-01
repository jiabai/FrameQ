from __future__ import annotations

import json
import os
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from frameq_worker.models import JobStage, ProcessLocalMediaRequest, ProcessResult
from frameq_worker.note_title import (
    build_title_prompt,
    parse_title_response,
    run_note_title_step,
    sample_transcript,
)
from frameq_worker.note_title_metadata import NoteTitleMetadata, parse_note_title_metadata
from frameq_worker.requests import parse_retry_insights_request
from frameq_worker.task_store import TaskStoreFacade, load_task_manifest
from frameq_worker.task_transaction import TaskArtifactCommitError, recover_task_artifacts
from frameq_worker.worker_application.insight_retry import retry_insights_once


def test_title_sample_covers_beginning_middle_and_end_with_a_fixed_budget() -> None:
    body = "开始" + "甲" * 15000 + "中间" + "乙" * 15000 + "结尾"
    sample = sample_transcript(body)
    assert len(sample) <= 12000
    assert sample.startswith("开始")
    assert "中间" in sample
    assert sample.endswith("结尾")
    assert sample == sample_transcript(body)
    parts = sample.split("\n\n")
    assert len(parts) == 3
    assert len(parts[0]) == len(parts[1]) == len(parts[2])
    assert parts[0] == body[:len(parts[0])]
    assert parts[1] == body[(len(body) - len(parts[1])) // 2:][:len(parts[1])]
    assert parts[2] == body[-len(parts[2]):]
    assert sample_transcript("完整短文") == "完整短文"


@pytest.mark.parametrize("language", ["zh-CN", "zh-TW", "en-US"])
def test_title_prompt_contains_only_sample_and_captured_language(language: str) -> None:
    prompt = build_title_prompt("谈论人工智能与沟通。", language)
    assert "谈论人工智能与沟通。" in prompt
    assert language in prompt
    assert "title" in prompt


@pytest.mark.parametrize(
    "title", ["", "  ", "甲" * 61, "one\ntwo", "one\ttwo", "a\u202eb", "a\u200bb", "\nvalid\n"],
)
def test_invalid_title_response_fails_without_a_repair_call(title: str) -> None:
    with pytest.raises(ValueError):
        parse_title_response(json.dumps({"title": title}))


def test_title_response_uses_a_closed_json_schema_and_trimmed_unicode_value() -> None:
    title = "理解人工智能时代的沟通能力"
    assert parse_title_response(json.dumps({"title": f"  {title}  "})) == title
    assert parse_title_response(json.dumps({"title": "😀" * 60})) == "😀" * 60
    for value in [
        '{"title":"valid","extra":true}', '["title"]', '"title"',
        '```json\n{"title":"valid"}\n```', '{"title":"a","title":"b"}',
    ]:
        with pytest.raises(ValueError):
            parse_title_response(value)


def test_english_generated_title_has_at_most_ten_words_without_a_repair_call() -> None:
    title = "one two three four five six seven eight nine ten"
    assert parse_title_response(json.dumps({"title": title}), "en-US") == title
    with pytest.raises(ValueError):
        parse_title_response(json.dumps({"title": title + " more"}), "en-US")


@pytest.mark.parametrize("field,value", [
    ("platform", None), ("platform", "xiaohongshu"),
    ("insight_id", None), ("insight_id", 7),
    ("preference_snapshot", None), ("preference_snapshot", {}),
])
def test_title_request_rejects_other_generation_parameters_before_checkout(
    field: str, value: object,
) -> None:
    with pytest.raises(ValueError, match="^Retry request payload was invalid\\.$"):
        parse_retry_insights_request({
            "task_id": "20261031-local-abcdef", "target": "title", "output_language": "zh-CN",
            field: value,
        })


def _saved_task(base: Path):
    store = TaskStoreFacade(base / "outputs", base / "cache")
    context = store.create_local(
        ProcessLocalMediaRequest(
            base / "speech.wav", "audio", "speech.wav", "wav", "iic/SenseVoiceSmall-onnx",
        ),
        now=datetime(2026, 10, 31, tzinfo=UTC), random_id="abcdef123456",
    )
    context.paths.transcript_txt_path.write_text("已经保存在本机的文字稿。\n", encoding="utf-8")
    context.paths.audio_path.write_bytes(b"local audio bytes")
    store.finalize(context, ProcessResult(
        status=JobStage.COMPLETED, text="已经保存在本机的文字稿。",
    ))
    return store, context


def test_legacy_manifest_and_title_preservation_on_unrelated_finalization(tmp_path: Path) -> None:
    store, context = _saved_task(tmp_path)
    assert store.open(context.task_id).note_title is None
    metadata = NoteTitleMetadata("人工智能时代的沟通能力", "completed", "zh-CN", None)
    store.save_note_title(context, metadata)
    before = context.paths.transcript_txt_path.read_bytes()
    finalized = store.finalize(context, ProcessResult(
        status=JobStage.COMPLETED, summary="保存摘要",
    ))
    assert finalized.note_title == metadata
    assert store.open(context.task_id).note_title == metadata
    assert context.paths.transcript_txt_path.read_bytes() == before
    manifest = load_task_manifest(store.output_root, context.task_id)
    assert manifest["note_title"] == metadata.to_dict()


@pytest.mark.parametrize("status,code", [
    ("generating", None), ("failed", "TITLE_OUTPUT_INVALID"), ("cancelled", "WORKER_CANCELLED"),
])
def test_title_state_update_preserves_manifest_fields_and_artifact_bytes(
    tmp_path: Path, status: str, code: str | None,
) -> None:
    store, context = _saved_task(tmp_path)
    original = load_task_manifest(store.output_root, context.task_id)
    original["custom_local_field"] = {"preserved": True}
    context.paths.manifest_path.write_text(json.dumps(original), encoding="utf-8")
    transcript = context.paths.transcript_txt_path.read_bytes()
    audio = context.paths.audio_path.read_bytes()
    metadata = NoteTitleMetadata("已有标题", status, "en-US", code)
    store.save_note_title(context, metadata)
    updated = load_task_manifest(store.output_root, context.task_id)
    assert updated["custom_local_field"] == {"preserved": True}
    assert updated["note_title"] == metadata.to_dict()
    assert context.paths.transcript_txt_path.read_bytes() == transcript
    assert context.paths.audio_path.read_bytes() == audio


def test_invalid_present_title_metadata_is_rejected_before_rewriting(tmp_path: Path) -> None:
    store, context = _saved_task(tmp_path)
    payload = load_task_manifest(store.output_root, context.task_id)
    payload["note_title"] = None
    context.paths.manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    before = context.paths.manifest_path.read_bytes()
    with pytest.raises(ValueError):
        store.open(context.task_id)
    with pytest.raises(ValueError):
        store.finalize(context, ProcessResult(status=JobStage.COMPLETED))
    assert context.paths.manifest_path.read_bytes() == before


def test_stale_context_cannot_rename_task(tmp_path: Path) -> None:
    store, context = _saved_task(tmp_path)
    before = context.paths.manifest_path.read_bytes()
    with pytest.raises(ValueError):
        store.save_note_title(
            replace(context, model="different-model"),
            NoteTitleMetadata("标题", "completed", "zh-CN", None),
        )
    assert context.paths.manifest_path.read_bytes() == before


@pytest.mark.parametrize("payload", [
    None, {},
    {"text": "标题", "status": "completed", "output_language": "fr-FR", "error_code": None},
    {"text": None, "status": "completed", "output_language": "zh-CN", "error_code": None},
])
def test_metadata_is_closed_and_consistent(payload: object) -> None:
    with pytest.raises(ValueError):
        parse_note_title_metadata(payload)


@pytest.mark.parametrize("event", ["after_journal_prepared", "after_replace:frameq-task.json"])
def test_failed_title_publication_restores_previous_metadata_and_all_files(
    tmp_path: Path, event: str,
) -> None:
    store, context = _saved_task(tmp_path)
    previous = NoteTitleMetadata("旧标题", "completed", "zh-CN", None)
    store.save_note_title(context, previous)
    before = context.paths.manifest_path.read_bytes()
    transcript = context.paths.transcript_txt_path.read_bytes()
    audio = context.paths.audio_path.read_bytes()

    def interrupt(current: str) -> None:
        if current == event:
            raise OSError("Publication was interrupted.")

    with pytest.raises(TaskArtifactCommitError):
        store.save_note_title(
            context, NoteTitleMetadata("新标题", "completed", "zh-CN", None),
            _fault_hook=interrupt,
        )
    assert context.paths.manifest_path.read_bytes() == before
    assert context.paths.transcript_txt_path.read_bytes() == transcript
    assert context.paths.audio_path.read_bytes() == audio
    assert store.open(context.task_id).note_title == previous


class PublicationInterrupted(BaseException):
    pass


def test_crash_recovery_keeps_prior_title_until_manifest_commit(tmp_path: Path) -> None:
    store, context = _saved_task(tmp_path)
    previous = NoteTitleMetadata("持久标题", "completed", "zh-TW", None)
    store.save_note_title(context, previous)
    transcript = context.paths.transcript_txt_path.read_bytes()

    def interrupt(event: str) -> None:
        if event == "after_replace:frameq-task.json":
            raise PublicationInterrupted()

    with pytest.raises(PublicationInterrupted):
        store.save_note_title(
            context, NoteTitleMetadata("未提交标题", "completed", "zh-CN", None),
            _fault_hook=interrupt,
        )
    recover_task_artifacts(context.paths.task_dir)
    assert store.open(context.task_id).note_title == previous
    assert context.paths.transcript_txt_path.read_bytes() == transcript


def test_linked_transcript_cannot_be_sent_or_renamed(tmp_path: Path) -> None:
    store, context = _saved_task(tmp_path)
    outside = tmp_path / "private-transcript.txt"
    outside.write_text("Private outside transcript", encoding="utf-8")
    context.paths.transcript_txt_path.unlink()
    try:
        os.symlink(outside, context.paths.transcript_txt_path)
    except OSError:
        pytest.skip("Native symlink creation is unavailable.")
    before = context.paths.manifest_path.read_bytes()
    with pytest.raises(ValueError):
        store.read_note_title_transcript(context)
    with pytest.raises(ValueError):
        store.save_note_title(context, NoteTitleMetadata("越界标题", "completed", "zh-CN", None))
    assert context.paths.manifest_path.read_bytes() == before
    assert outside.read_text(encoding="utf-8") == "Private outside transcript"


def test_hardlinked_transcript_is_rejected_without_reading_or_sending(tmp_path: Path) -> None:
    store, context = _saved_task(tmp_path)
    outside = tmp_path / "private-transcript.txt"
    outside.write_text("Private hardlinked transcript", encoding="utf-8")
    context.paths.transcript_txt_path.unlink()
    os.link(outside, context.paths.transcript_txt_path)
    before = context.paths.manifest_path.read_bytes()
    result = run_note_title_step(
        store=store, context=context, runtime_env={}, output_language="zh-CN",
    )
    assert result.error is not None
    assert result.error.code == "TITLE_TRANSCRIPT_UNAVAILABLE"
    assert result.text == ""
    assert context.paths.manifest_path.read_bytes() == before
    assert outside.read_text(encoding="utf-8") == "Private hardlinked transcript"


def test_actual_unconfigured_provider_preserves_transcript_and_exposes_retry_state(
    tmp_path: Path,
) -> None:
    store, context = _saved_task(tmp_path)
    transcript = context.paths.transcript_txt_path.read_bytes()
    previous = NoteTitleMetadata("已保存标题", "completed", "zh-CN", None)
    store.save_note_title(context, previous)
    events: list[dict[str, object]] = []
    result = run_note_title_step(
        store=store, context=context, runtime_env={}, output_language="en-US",
        progress_callback=events.append,
    )
    assert result.status == JobStage.PARTIAL_COMPLETED
    assert result.error is not None
    assert result.error.code == "AI_CONFIG_MISSING"
    assert result.error.stage == JobStage.TITLE_GENERATING
    assert result.note_title == NoteTitleMetadata(
        "已保存标题", "failed", "en-US", "AI_CONFIG_MISSING",
    )
    assert store.open(context.task_id).note_title == result.note_title
    assert context.paths.transcript_txt_path.read_bytes() == transcript
    assert [event["message_code"] for event in events] == ["title.generation.running"]


def test_title_retry_path_keeps_identity_and_unknown_manifest_fields_without_cloud_config(
    tmp_path: Path,
) -> None:
    store, context = _saved_task(tmp_path)
    manifest = load_task_manifest(store.output_root, context.task_id)
    manifest["local_custom_metadata"] = {"keep": True}
    context.paths.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    result = retry_insights_once(
        json.dumps({"task_id": context.task_id, "target": "title", "output_language": "zh-TW"}),
        project_root=tmp_path,
        environ={
            "FRAMEQ_OUTPUT_DIR": str(store.output_root),
            "FRAMEQ_CACHE_DIR": str(store.cache_root),
        },
    )
    assert result["task_id"] == context.task_id
    assert result["artifacts"]["transcript_txt"] == "transcript/transcript.txt"
    assert result["error"]["code"] == "AI_CONFIG_MISSING"
    assert result["note_title"]["status"] == "failed"
    assert result["note_title"]["output_language"] == "zh-TW"
    updated = load_task_manifest(store.output_root, context.task_id)
    assert updated["local_custom_metadata"] == {"keep": True}
