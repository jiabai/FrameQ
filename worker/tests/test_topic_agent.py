from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from agent_runtime.core import SessionContext
from agent_runtime.core.run_context import ContextWrapper
from frameq_worker.ai_prompts import build_insights_agent_prompt
from frameq_worker.insight_errors import InsightGenerationError
from frameq_worker.output_language import output_language_semantics
from frameq_worker.topic_agent import (
    InsightDelivery,
    InsightsDeliveryHook,
    _build_insights_tool,
    generate_insights_via_agent_runtime,
    validate_insights_delivery,
    write_insight_files,
)
from frameq_worker.transcript_chunks import MarkdownSplitter


def insight_item(**values: object) -> dict[str, object]:
    return {
        "topic": "How can teams make a workflow reusable?",
        "matchReason": "The transcript describes shared workflow ownership.",
        "followUpQuestions": ["Which responsibilities need explicit owners?"],
        "suitableUse": "Team discussion",
        "sourceChunkId": 1,
        **values,
    }


def test_insight_delivery_preserves_source_and_assigns_sequential_ids() -> None:
    insights = validate_insights_delivery(
        [insight_item(), insight_item(topic="What makes a workflow observable?", sourceChunkId=2)],
        (1, 2),
    )

    assert [item.id for item in insights] == [1, 2]
    assert [item.source_chunk_id for item in insights] == [1, 2]
    assert insights[0].follow_up_questions == ("Which responsibilities need explicit owners?",)


@pytest.mark.parametrize(
    "payload",
    [
        [],
        [insight_item(sourceChunkId=3)],
        [insight_item(sourceChunkId=True)],
        [insight_item(topic=" ")],
        [insight_item(matchReason="")],
        [insight_item(followUpQuestions=[])],
        [insight_item(followUpQuestions=["a", "b", "c", "d"])],
        [insight_item(followUpQuestions=[" "])],
        [insight_item(unexpected="not allowed")],
        [insight_item(), insight_item(topic="  How can teams make a workflow reusable?  ")],
        [insight_item(topic=str(index)) for index in range(13)],
    ],
)
def test_insight_delivery_rejects_invalid_complete_payload(payload: object) -> None:
    with pytest.raises(InsightGenerationError) as captured:
        validate_insights_delivery(payload, (1, 2))

    assert captured.value.code == "INSIGHTFLOW_INVALID_RESULT"


def test_insight_tool_accepts_complete_payload_and_finishes() -> None:
    delivery = InsightDelivery()
    tool = _build_insights_tool(delivery, (1,))
    context = ContextWrapper(context=SessionContext(session_id="delivery"), messages=[])

    result = asyncio.run(tool.handler(context, insights=[insight_item()]))

    assert result is None
    assert delivery.insights[0].source_chunk_id == 1
    assert tool.parameters["properties"]["insights"]["maxItems"] == 12


def test_insight_tool_returns_validation_feedback_without_partial_delivery() -> None:
    delivery = InsightDelivery()
    tool = _build_insights_tool(delivery, (1,))
    context = ContextWrapper(context=SessionContext(session_id="delivery"), messages=[])

    result = asyncio.run(
        tool.handler(
            context, insights=[insight_item(), insight_item(topic="other", sourceChunkId=7)]
        )
    )

    assert isinstance(result, str)
    assert "sourceChunkId" in result
    assert delivery.insights == []


@pytest.mark.parametrize("payload", [None, 42, {}, "invalid", True])
def test_insight_tool_rejects_non_list_arguments_with_feedback(payload: object) -> None:
    delivery = InsightDelivery()
    tool = _build_insights_tool(delivery, (1,))

    feedback = asyncio.run(tool.handler(None, insights=payload))

    assert "Invalid insight delivery" in feedback
    assert delivery.insights == []


def test_insight_tool_rejects_missing_arguments_with_feedback() -> None:
    delivery = InsightDelivery()
    feedback = asyncio.run(_build_insights_tool(delivery, (1,)).handler(None))

    assert "Invalid insight delivery" in feedback
    assert delivery.insights == []


def test_insight_hook_requires_tool_delivery() -> None:
    delivery = InsightDelivery()
    hook = InsightsDeliveryHook(delivery)
    context = ContextWrapper(context=SessionContext(session_id="delivery"), messages=[])

    assert asyncio.run(hook.on_before_complete(context, None)) is False
    assert "submit_insights" in context.messages[-1].content
    delivery.insights = validate_insights_delivery([insight_item()], (1,))
    assert asyncio.run(hook.on_before_complete(context, None)) is True


def test_inspiration_prompt_contains_numbered_source_and_language_contract() -> None:
    chunks = MarkdownSplitter(max_length=20).split(
        "Shared workflow ownership requires explicit responsibility."
    )
    prompt = build_insights_agent_prompt(chunks, "en-US")

    assert "submit_insights" in prompt
    assert "sourceChunkId" in prompt
    assert output_language_semantics("en-US").prompt_instruction in prompt
    assert "Shared workflow owne" in prompt
    assert "question_count" not in prompt


def test_topic_agent_rejects_empty_transcript_before_provider_configuration() -> None:
    with pytest.raises(InsightGenerationError) as captured:
        generate_insights_via_agent_runtime("  ", {}, "en-US")

    assert captured.value.code == "INSIGHTFLOW_EMPTY_TRANSCRIPT"


@pytest.mark.parametrize("max_turns", [-1, 0, 7, True, 1.0, "2"])
def test_topic_agent_rejects_invalid_turn_budget_before_provider_configuration(
    max_turns: object,
) -> None:
    with pytest.raises(ValueError, match="integer from 1 through 6"):
        generate_insights_via_agent_runtime("Transcript.", {}, "en-US", max_turns=max_turns)


def test_topic_agent_rejects_output_language_before_provider_configuration() -> None:
    with pytest.raises(KeyError):
        generate_insights_via_agent_runtime("Transcript.", {}, "unsupported")


def test_insight_files_preserve_schema_and_localized_headings(tmp_path: Path) -> None:
    insights = validate_insights_delivery([insight_item()], (1,))
    artifacts = write_insight_files(insights, tmp_path / "ai", "sample", "en-US")

    assert json.loads(artifacts.json_path.read_text(encoding="utf-8")) == {
        "schemaVersion": 1,
        "insights": [item.to_dict() for item in insights],
    }
    markdown = artifacts.md_path.read_text(encoding="utf-8")
    assert markdown.startswith("# Inspiration")
    assert "Source Segment: 1" in markdown


def test_insight_files_prepare_payload_without_writing(tmp_path: Path) -> None:
    insights = validate_insights_delivery([insight_item()], (1,))
    artifacts = write_insight_files(insights, tmp_path / "ai", "", "en-US", persist=False)

    assert artifacts.json_bytes
    assert artifacts.md_bytes
    assert not artifacts.json_path.exists()
    assert not artifacts.md_path.exists()
