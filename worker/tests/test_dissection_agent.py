from __future__ import annotations

import asyncio
import hashlib

import pytest
from agent_runtime.core import SessionContext
from agent_runtime.core.run_context import ContextWrapper
from agent_runtime.provider.entities import LLMResponse
from frameq_worker.dissection_agent import (
    DissectionDelivery,
    DissectionDeliveryHook,
    build_dissection_tool,
    generate_dissection_via_agent_runtime,
)
from frameq_worker.dissection_report import DissectionGenerationError
from frameq_worker.transcript_chunks import MarkdownSplitter


def semantic_report() -> dict[str, object]:
    return {
        "overallNarrative": {
            "openingHook": "A question",
            "structureType": "Problem and solution",
            "turningPoint": None,
            "closingType": None,
        },
        "segments": [{
            "id": 1,
            "title": "Opening",
            "sourceChunkIds": [1],
            "coreClaim": "The first paragraph introduces the problem.",
            "supportingPoints": [],
            "rhetoricalDevices": ["Question"],
            "rhythmNote": "Short introduction",
            "reusablePattern": "Introduce [problem], then explain [evidence].",
            "riskFlags": [],
        }],
        "highlights": ["First paragraph."],
        "reusableTemplate": {
            "name": "Problem and solution",
            "skeleton": ["Introduce [problem]", "Explain [evidence]", "Offer [action]"],
        },
        "audienceFit": [{"audience": "Beginners", "fit": "high", "note": "Clear structure"}],
        "strengths": ["Clear introduction"],
        "weaknesses": [],
    }


def test_delivery_tool_accepts_report_and_generates_exact_provenance() -> None:
    transcript = "First paragraph.\r\n第二段🙂。\r\n"
    delivery = DissectionDelivery()
    tool = build_dissection_tool(
        transcript=transcript,
        chunks=MarkdownSplitter().split(transcript),
        source_language="en-US",
        delivery=delivery,
    )

    result = asyncio.run(tool.handler(None, report=semantic_report()))

    assert result is None
    assert delivery.report is not None
    payload = delivery.report.to_dict()
    assert payload["sourceTranscriptSha256"] == hashlib.sha256(transcript.encode()).hexdigest()
    assert payload["sourceChunks"][0]["endByte"] == len(transcript.encode())
    assert payload["sourceLanguage"] == "en-US"


@pytest.mark.parametrize(
    ("field", "value", "category"),
    [
        ("highlights", ["Invented quotation"], "quotation_provenance"),
        ("strengths", ["Point"] * 7, "collection_limits"),
        ("segments", [], "schema_shape"),
    ],
)
def test_delivery_tool_returns_validation_feedback_without_accepting_report(
    field: str, value: object, category: str,
) -> None:
    transcript = "First paragraph."
    delivery = DissectionDelivery()
    tool = build_dissection_tool(
        transcript=transcript,
        chunks=MarkdownSplitter().split(transcript),
        source_language=None,
        delivery=delivery,
    )
    payload = semantic_report()
    payload[field] = value

    feedback = asyncio.run(tool.handler(None, report=payload))

    assert category in feedback
    assert delivery.report is None
    assert asyncio.run(tool.handler(None, report=semantic_report())) is None
    assert delivery.report is not None


def test_delivery_tool_rejects_missing_report_with_feedback() -> None:
    delivery = DissectionDelivery()
    tool = build_dissection_tool(
        transcript="First paragraph.",
        chunks=MarkdownSplitter().split("First paragraph."),
        source_language=None,
        delivery=delivery,
    )

    assert "schema_shape" in asyncio.run(tool.handler(None))
    assert delivery.report is None


def test_hook_requires_tool_delivery_and_emits_progress_for_each_call() -> None:
    events: list[dict[str, object]] = []
    delivery = DissectionDelivery()
    hook = DissectionDeliveryHook(delivery, 6, events.append)
    context = ContextWrapper(context=SessionContext(session_id="dissection-test"), messages=[])

    async def check() -> None:
        assert not await hook.on_before_complete(context, LLMResponse(role="assistant"))
        await hook.on_llm_request(context)
        await hook.on_llm_request(context)

    asyncio.run(check())

    assert "submit_dissection" in context.messages[-1].content
    assert [event["message_args"] for event in events] == [
        {"attempt": 1, "total": 6}, {"attempt": 2, "total": 6},
    ]
    assert all(event["message_code"] == "ai.generation.running" for event in events)


@pytest.mark.parametrize(
    ("transcript", "code"),
    [(" \n", "DISSECTION_EMPTY_TRANSCRIPT"), ("x" * 32001, "DISSECTION_TRANSCRIPT_TOO_LARGE")],
)
def test_agent_rejects_invalid_transcript_before_provider_configuration(
    transcript: str, code: str,
) -> None:
    with pytest.raises(DissectionGenerationError) as captured:
        generate_dissection_via_agent_runtime(transcript, {}, "en-US")

    assert captured.value.code == code


@pytest.mark.parametrize("max_turns", [-1, 0, 7, True, 1.0, "2"])
def test_agent_rejects_turn_limit_outside_the_fixed_budget(max_turns: object) -> None:
    with pytest.raises(ValueError):
        generate_dissection_via_agent_runtime("First paragraph.", {}, "en-US", max_turns=max_turns)


def test_dissection_agent_rejects_output_language_before_provider_configuration() -> None:
    with pytest.raises(KeyError):
        generate_dissection_via_agent_runtime("First paragraph.", {}, "unsupported")
