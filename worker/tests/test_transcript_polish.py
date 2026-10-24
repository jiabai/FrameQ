"""``transcript`` retry target: ASR transcript polishing.

Covers the polish step itself (chunking, failure codes, artifact writing) and the
``retry_insights_once`` branch contract: the official ``transcript/transcript.txt``
stays byte-identical, the polished copy lands in ``transcript/polished.txt``, and
the manifest keeps its ``text_preview``.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from frameq_worker.desktop_contract import CACHE_DIR_ENV, OUTPUT_DIR_ENV
from frameq_worker.progress_events import build_worker_progress_event
from frameq_worker.task_store import LocalFileTaskSource, TaskContext, TaskPaths
from frameq_worker.task_transaction import recover_task_artifacts
from frameq_worker.transcript_polish import (
    POLISH_MAX_CHUNKS,
    _polish_chunks,
    build_polish_prompt,
    chunk_transcript,
    run_transcript_polish_step,
    source_transcript_sha256,
)
from frameq_worker.worker_application.insight_retry import retry_insights_once

TASK_ID = "20260709-120000-douyin-demo"
OFFICIAL_BODY = "第一段语音识别结果，有一个同音错误。第二段内容。"
POLISHED_BODY = "第一段语音识别结果，有一个同音错别字。第二段内容。"


def _task_dir(tmp_path: Path) -> Path:
    return tmp_path / "outputs" / "tasks" / TASK_ID


def _write_official_transcript(tmp_path: Path, body: str = OFFICIAL_BODY) -> Path:
    transcript_path = _task_dir(tmp_path) / "transcript" / "transcript.txt"
    transcript_path.parent.mkdir(parents=True, exist_ok=True)
    transcript_path.write_text(f"{body}\n", encoding="utf-8")
    return transcript_path


def _task_context(tmp_path: Path) -> TaskContext:
    return TaskContext(
        paths=TaskPaths(
            output_root=tmp_path / "outputs",
            cache_root=tmp_path / "cache",
            task_id=TASK_ID,
        ),
        source=LocalFileTaskSource(
            display_name="demo.mp4",
            media_kind="video",
            extension="mp4",
        ),
        model="iic/SenseVoiceSmall",
        created_at="2026-07-09T12:00:00Z",
    )


def _fake_runner(result: str | None = POLISHED_BODY):
    calls: list[str] = []

    def runner(body: str, env, progress_callback=None) -> str:
        calls.append(body)
        if result is None:
            raise RuntimeError("boom")
        return result

    return runner, calls


def test_polish_step_writes_polished_copy_and_never_touches_the_official_body(
    tmp_path: Path,
) -> None:
    transcript_path = _write_official_transcript(tmp_path)
    before = transcript_path.read_bytes()
    runner, calls = _fake_runner()

    result = run_transcript_polish_step(
        task_context=_task_context(tmp_path),
        runtime_env={},
        polish_runner=runner,
    )

    assert result.status.value == "completed"
    assert result.error is None
    assert result.text == OFFICIAL_BODY
    assert calls == [OFFICIAL_BODY]
    # 原稿字节级未变。
    assert transcript_path.read_bytes() == before
    polished_path = _task_dir(tmp_path) / "transcript" / "polished.txt"
    assert polished_path.read_text(encoding="utf-8") == f"{POLISHED_BODY}\n"
    meta = json.loads(
        (_task_dir(tmp_path) / "transcript" / "polished.meta.json").read_text(encoding="utf-8")
    )
    assert meta["schemaVersion"] == 1
    assert meta["sourceTranscriptSha256"] == source_transcript_sha256(OFFICIAL_BODY)


def test_polish_step_rejects_missing_official_transcript(tmp_path: Path) -> None:
    runner, _ = _fake_runner()

    result = run_transcript_polish_step(
        task_context=_task_context(tmp_path),
        runtime_env={},
        polish_runner=runner,
    )

    assert result.error is not None
    assert result.error.code == "TRANSCRIPT_TEXT_NOT_FOUND"
    assert result.error.stage.value == "insights_generating"


def test_polish_step_rejects_empty_official_transcript(tmp_path: Path) -> None:
    _write_official_transcript(tmp_path, body="   ")
    runner, calls = _fake_runner()

    result = run_transcript_polish_step(
        task_context=_task_context(tmp_path),
        runtime_env={},
        polish_runner=runner,
    )

    assert result.error is not None
    assert result.error.code == "POLISH_EMPTY_TRANSCRIPT"
    assert calls == []


def test_polish_step_rejects_transcript_needing_too_many_chunks(tmp_path: Path) -> None:
    body = "这是一段很长的文字稿。" * (POLISH_MAX_CHUNKS * 600)
    _write_official_transcript(tmp_path, body=body)
    runner, calls = _fake_runner()

    result = run_transcript_polish_step(
        task_context=_task_context(tmp_path),
        runtime_env={},
        polish_runner=runner,
    )

    assert result.error is not None
    assert result.error.code == "POLISH_TRANSCRIPT_TOO_LONG"
    # 超长不触发任何 LLM 调用，也不消耗额度。
    assert calls == []


def test_polish_step_wraps_runner_failures(tmp_path: Path) -> None:
    _write_official_transcript(tmp_path)
    runner, _ = _fake_runner(result=None)

    result = run_transcript_polish_step(
        task_context=_task_context(tmp_path),
        runtime_env={},
        polish_runner=runner,
    )

    assert result.error is not None
    assert result.error.code == "POLISH_FAILED"
    assert result.text == OFFICIAL_BODY
    assert not (_task_dir(tmp_path) / "transcript" / "polished.txt").exists()


def test_polish_step_rejects_empty_llm_result(tmp_path: Path) -> None:
    _write_official_transcript(tmp_path)
    runner, _ = _fake_runner(result="   ")

    result = run_transcript_polish_step(
        task_context=_task_context(tmp_path),
        runtime_env={},
        polish_runner=runner,
    )

    assert result.error is not None
    assert result.error.code == "POLISH_LLM_EMPTY_RESULT"


def test_polish_step_forwards_progress_events_from_the_runner(tmp_path: Path) -> None:
    _write_official_transcript(tmp_path)
    events: list[dict] = []

    def runner(body: str, env, progress_callback=None) -> str:
        if progress_callback is not None:
            progress_callback(
                build_worker_progress_event(
                    "ai.generation.running",
                    stage="insights_generating",
                    progress=70,
                    message_args={"attempt": 1, "total": 3},
                )
            )
        return POLISHED_BODY

    run_transcript_polish_step(
        task_context=_task_context(tmp_path),
        runtime_env={},
        progress_callback=events.append,
        polish_runner=runner,
    )

    assert events and events[0]["message_code"] == "ai.generation.running"


def test_chunk_polish_normalizes_progress_attempts_into_the_safe_range() -> None:
    class _Response:
        completion_text = "修正后的句子。"

    class _Provider:
        async def text_chat(self, **_kwargs):
            return _Response()

    events: list[dict] = []
    chunks = ["句子。" for _ in range(120)]

    polished, empty_chunks = asyncio.run(
        _polish_chunks(chunks, _Provider(), events.append)
    )

    assert empty_chunks == 0
    assert polished.count("修正后的句子。") == 120
    attempts = [event["message_args"]["attempt"] for event in events]
    totals = {event["message_args"]["total"] for event in events}
    # registry 只接受 1 至 100 的 attempt / total，超长稿必须归一化。
    assert max(attempts) <= 100
    assert totals == {100}
    assert attempts == sorted(attempts)


def test_single_empty_chunk_falls_back_to_the_original_body() -> None:
    class _EmptyResponse:
        completion_text = ""

    class _Provider:
        async def text_chat(self, **_kwargs):
            return _EmptyResponse()

    polished, empty_chunks = asyncio.run(
        _polish_chunks(["原样句子。" for _ in range(2)], _Provider(), None)
    )

    assert empty_chunks == 2
    assert polished == "原样句子。\n原样句子。"


def test_polish_system_prompt_keeps_moderate_bounds() -> None:
    from frameq_worker.transcript_polish import POLISH_SYSTEM_PROMPT

    # 中度整理：既要求删除口头语与分段，也必须锁住不改事实、不换实词。
    assert "口头语" in POLISH_SYSTEM_PROMPT
    assert "自然段落" in POLISH_SYSTEM_PROMPT
    assert "不得改变原意" in POLISH_SYSTEM_PROMPT
    assert "不润色" in POLISH_SYSTEM_PROMPT


def test_chunk_transcript_and_prompt_carry_preceding_tail() -> None:
    body = "第一句内容。" * 600
    chunks = chunk_transcript(body, max_chars=1000)

    assert chunks
    first_prompt = build_polish_prompt(0, chunks)
    assert "第 1 段" in first_prompt
    assert "上一段的结尾" not in first_prompt

    second_prompt = build_polish_prompt(1, chunks)
    assert "上一段的结尾" in second_prompt
    assert chunks[0][-200:] in second_prompt


def test_retry_insights_transcript_branch_keeps_manifest_preview(tmp_path: Path) -> None:
    transcript_path = _write_official_transcript(tmp_path)
    before = transcript_path.read_bytes()
    output_root = tmp_path / "outputs"
    task_dir = _task_dir(tmp_path)
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "source_privacy_migration_version": 2,
                "source_privacy_quarantined": False,
                "task_id": TASK_ID,
                "created_at": "2026-07-09T12:00:00Z",
                "source_url": "https://www.douyin.com/video/7524373044106677544",
                "source_identity": {
                    "version": 1,
                    "platform": "douyin",
                    "stable_id": "7524373044106677544",
                    "effective_part": None,
                    "canonical_url": "https://www.douyin.com/video/7524373044106677544",
                },
                "platform": "douyin",
                "status": "completed",
                "app_version": "app",
                "worker_version": "app",
                "model": "iic/SenseVoiceSmall",
                "artifacts": {"transcript_txt": "transcript/transcript.txt"},
                "error": None,
                "text_preview": "preview",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    def fake_step(*, task_context, runtime_env, progress_callback=None, polish_runner=None):
        return run_transcript_polish_step(
            task_context=task_context,
            runtime_env=runtime_env,
            progress_callback=progress_callback,
            polish_runner=lambda body, env, cb=None: POLISHED_BODY,
        )
    with patch(
        "frameq_worker.worker_application.insight_retry.run_transcript_polish_step",
        side_effect=fake_step,
    ):
        result = retry_insights_once(
            json.dumps(
                {
                    "task_id": TASK_ID,
                    "target": "transcript",
                    "output_language": "zh-CN",
                },
                ensure_ascii=False,
            ),
            project_root=tmp_path,
            environ={
                OUTPUT_DIR_ENV: output_root.as_posix(),
                CACHE_DIR_ENV: (tmp_path / "cache").as_posix(),
            },
        )

    assert result["status"] == "completed"
    assert result["error"] is None
    assert transcript_path.read_bytes() == before
    manifest = json.loads((_task_dir(tmp_path) / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["text_preview"] == OFFICIAL_BODY[:180]
    assert manifest["artifacts"]["transcript_txt"] == "transcript/transcript.txt"
    # 事务恢复不会删掉没登记进白名单的整理稿。
    recover_task_artifacts(_task_dir(tmp_path))
    assert (_task_dir(tmp_path) / "transcript" / "polished.txt").exists()


@pytest.mark.parametrize("target", ["summary", "insights", "dissection", "draft", "transcript"])
def test_retry_target_whitelist_accepts_transcript(target: str) -> None:
    from frameq_worker.requests import parse_retry_insights_request

    payload: dict[str, object] = {
        "task_id": TASK_ID,
        "target": target,
        "output_language": "zh-CN",
    }
    if target == "draft":
        payload["insight_id"] = 1
        payload["platform"] = "douyin"

    request = parse_retry_insights_request(payload)

    assert request.target == target
