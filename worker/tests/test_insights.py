from __future__ import annotations

import hashlib
import json
import multiprocessing
import queue
import time
from pathlib import Path

import pytest
from worker_core.ai_prompts import (
    build_insights_agent_prompt,
    build_mindmap_prompt,
    build_summary_prompt,
    format_preference_snapshot_for_prompt,
)
from worker_core.insight_errors import InsightGenerationError
from worker_core.models import Insight
from worker_core.requests import parse_preference_snapshot
from worker_core.topic_agent import validate_insights_delivery, write_insight_files
from worker_core.transcript_chunks import MarkdownSplitter


def preference_snapshot():
    snapshot = parse_preference_snapshot(
        {
            "profile": {
                "role": "content_creator",
                "domain": "content_media",
                "stage": "experienced_professional",
                "cityContext": "new_tier1_city",
                "genderPerspective": "neutral_perspective",
                "platforms": ["douyin"],
            },
            "profileSkipped": False,
            "generationPreferences": {
                "goal": "content_creation",
                "scenario": "short_video",
                "angles": ["topic_angle"],
                "audience": "fans_readers",
                "styles": ["grounded"],
                "avoid": ["clickbait"],
            },
            "labelSnapshot": {
                "profile": [
                    {
                        "field": "role",
                        "label": "我的角色",
                        "values": [{"id": "content_creator", "label": "内容创作者"}],
                    }
                ],
                "generationPreferences": [
                    {
                        "field": "goal",
                        "label": "本次目标",
                        "values": [{"id": "content_creation", "label": "内容创作"}],
                    }
                ],
            },
        }
    )
    assert snapshot is not None
    return snapshot


# The spawn interpreter start is unrelated to the splitter's work: CI Windows runners have
# exceeded four seconds under load while local starts measured 0.19-0.27 seconds. The child
# publishes a "started" signal first, so only the second wait bounds the splitter itself.
SPLITTER_STARTUP_TIMEOUT_SECONDS = 30.0
SPLITTER_RESULT_TIMEOUT_SECONDS = 10.0


def _split_markdown_worker(markdown: str, max_length: int, result_queue) -> None:
    result_queue.put("started")
    chunks = MarkdownSplitter(max_length=max_length).split(markdown)
    result_queue.put([len(chunk.content) for chunk in chunks])


def _hanging_markdown_worker(result_queue) -> None:
    result_queue.put("started")
    time.sleep(30)


def _terminate_splitter_child(process) -> None:
    if process.is_alive():
        process.terminate()
    process.join(2)


def _run_splitter_child(target, args, startup_timeout: float, result_timeout: float):
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue()
    process = context.Process(target=target, args=(*args, result_queue))
    process.start()
    try:
        assert result_queue.get(timeout=startup_timeout) == "started"
    except queue.Empty as exc:
        _terminate_splitter_child(process)
        raise AssertionError("MarkdownSplitter child did not start within its budget.") from exc
    try:
        lengths = result_queue.get(timeout=result_timeout)
    except queue.Empty as exc:
        _terminate_splitter_child(process)
        raise AssertionError("MarkdownSplitter did not advance past the separator.") from exc
    process.join(result_timeout)
    if process.is_alive():
        _terminate_splitter_child(process)
        raise AssertionError("MarkdownSplitter child did not exit after publishing its result.")
    assert process.exitcode == 0
    return lengths


def test_markdown_splitter_preserves_heading_context() -> None:
    chunks = MarkdownSplitter(max_length=80).split(
        "# 总标题\n\n第一段内容。\n\n## 子标题\n\n第二段内容。" * 4
    )
    assert chunks
    assert chunks[0].content
    assert chunks[0].summary


def test_markdown_splitter_advances_past_sentence_separator() -> None:
    markdown = "# Transcript\n\n" + ("a" * 40) + "。" + ("b" * 180)
    lengths = _run_splitter_child(
        _split_markdown_worker,
        (markdown, 80),
        SPLITTER_STARTUP_TIMEOUT_SECONDS,
        SPLITTER_RESULT_TIMEOUT_SECONDS,
    )
    assert len(lengths) > 1
    assert all(length > 0 for length in lengths)


def test_markdown_splitter_child_stall_is_reported_and_terminated() -> None:
    with pytest.raises(AssertionError, match="did not advance past the separator"):
        _run_splitter_child(
            _hanging_markdown_worker,
            (),
            SPLITTER_STARTUP_TIMEOUT_SECONDS,
            0.2,
        )


def test_splitter_source_chunks_preserve_exact_utf8_provenance() -> None:
    source = "# 中文主题\n\n流程编排需要清晰的责任边界。\n\n" * 8
    encoded = source.encode("utf-8")
    chunks = MarkdownSplitter(max_length=60).split(source)

    assert "".join(chunk.content for chunk in chunks) == source
    assert [chunk.id for chunk in chunks] == list(range(1, len(chunks) + 1))
    for chunk in chunks:
        data = encoded[chunk.start_byte:chunk.end_byte]
        assert data.decode("utf-8") == chunk.content
        assert hashlib.sha256(data).hexdigest() == chunk.sha256


@pytest.mark.parametrize("max_length", [0, -1])
def test_splitter_rejects_unusable_chunk_lengths(max_length: int) -> None:
    assert MarkdownSplitter(max_length=max_length).split("transcript") == []


def test_insights_prompt_carries_compact_preference_context() -> None:
    snapshot = preference_snapshot()
    prompt = build_insights_agent_prompt(
        MarkdownSplitter().split("流程编排需要清晰的责任边界。"), "zh-CN", snapshot
    )
    compact = format_preference_snapshot_for_prompt(snapshot)

    assert compact in prompt
    payload = json.loads(compact)
    assert payload["profile"]["role"] == "content_creator"
    assert payload["generationPreferences"]["scenario"] == "short_video"
    assert payload["labelSnapshot"]["profile"][0]["label"] == "我的角色"
    assert "Transcript evidence wins over all preferences" in prompt
    assert "current scenario" in prompt
    assert "Do not invent a role, audience, fact, or outcome" in prompt


def test_insights_prompt_omits_absent_preferences() -> None:
    prompt = build_insights_agent_prompt(MarkdownSplitter().split("Workflow ownership"), "en-US")

    assert "Personalization snapshot" not in prompt
    assert "profileSkipped" not in prompt


def test_summary_prompts_exclude_inspiration_preferences() -> None:
    source = "Workflow ownership"
    prompts = [
        build_mindmap_prompt(source, "en-US"),
        build_summary_prompt(source, "mindmap\n  root((Ownership))", "en-US"),
    ]
    assert all("generationPreferences" not in prompt for prompt in prompts)
    assert all("Personalization snapshot" not in prompt for prompt in prompts)


def test_insight_submission_preserves_all_required_structured_fields() -> None:
    payload = [
        {
            "topic": "团队应该怎样分配流程责任？",
            "matchReason": "原文强调责任归属。",
            "followUpQuestions": ["哪些节点需要明确负责人？", "怎样发现责任缺口？"],
            "suitableUse": "团队分享",
            "sourceChunkId": 12,
        }
    ]
    insights = validate_insights_delivery(payload, (12,))

    assert insights[0].to_dict() == {"id": 1, **payload[0]}


def test_write_insight_files_rejects_empty_insights(tmp_path: Path) -> None:
    with pytest.raises(InsightGenerationError) as captured:
        write_insight_files([], tmp_path / "outputs", "demo", "zh-CN")
    assert captured.value.code == "AI_EMPTY_RESULT"
    assert not (tmp_path / "outputs").exists()


def test_write_insight_files_serializes_existing_insights(tmp_path: Path) -> None:
    insight = Insight(
        id=1,
        topic="为什么流程编排可能比单点模型能力更关键？",
        match_reason="文字稿强调流程编排。",
        follow_up_questions=("团队应该先改哪条流程？",),
        suitable_use="团队分享",
        source_chunk_id=12,
    )
    artifacts = write_insight_files([insight], tmp_path / "outputs", "demo", "zh-CN")

    assert json.loads(artifacts.json_path.read_text(encoding="utf-8")) == {
        "schemaVersion": 1,
        "insights": [insight.to_dict()],
    }
    markdown = artifacts.md_path.read_text(encoding="utf-8")
    assert "## 灵感 1" in markdown
    assert "来源片段: 12" in markdown
    assert "### 匹配理由\n文字稿强调流程编排。" in markdown


def test_insight_file_transaction_replaces_complete_revision(tmp_path: Path) -> None:
    output_dir = tmp_path / "task" / "ai"
    first = Insight(1, "First topic", "Source context", ("First follow-up?",), "Review", 1)
    second = Insight(1, "Second topic", "New source context", ("Second follow-up?",), "Review", 2)
    write_insight_files([first], output_dir, "", "en-US")
    artifacts = write_insight_files([second], output_dir, "", "en-US")

    assert json.loads(artifacts.json_path.read_bytes())["insights"] == [second.to_dict()]
    assert "Second topic" in artifacts.md_path.read_text(encoding="utf-8")
    assert "First topic" not in artifacts.md_path.read_text(encoding="utf-8")
