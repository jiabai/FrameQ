from __future__ import annotations

import asyncio
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

from agent_runtime.core import FunctionToolExecutor, SessionContext
from agent_runtime.core.hooks import BaseAgentRunHooks
from agent_runtime.core.message import Message
from agent_runtime.core.run_context import ContextWrapper
from agent_runtime.core.tool import FunctionTool, ToolSet
from agent_runtime.provider.entities import ProviderRequest
from agent_runtime.provider.provider import Provider

from frameq_worker.ai_prompts import build_dissection_agent_prompt
from frameq_worker.ai_runtime import StrictInsightRunner, agent_error, build_insight_provider
from frameq_worker.desktop_contract import ProgressCallback
from frameq_worker.dissection_report import (
    DissectionGenerationError,
    TranscriptDissection,
    parse_dissection_report,
)
from frameq_worker.output_language import OutputLanguage, output_language_semantics
from frameq_worker.progress_events import build_worker_progress_event
from frameq_worker.transcript_chunks import MarkdownChunk, MarkdownSplitter

DISSECTION_AGENT_MAX_TURNS = 6
MAX_DISSECTION_CHUNKS = 16


class DissectionRunner(Protocol):
    def __call__(
        self,
        transcript: str,
        env: Mapping[str, str],
        output_language: OutputLanguage,
        source_language: str | None = None,
        *,
        progress_callback: ProgressCallback | None = None,
    ) -> TranscriptDissection: ...


@dataclass
class DissectionDelivery:
    report: TranscriptDissection | None = None


def build_dissection_tool(
    *,
    transcript: str,
    chunks: list[MarkdownChunk],
    source_language: str | None,
    delivery: DissectionDelivery,
) -> FunctionTool:
    async def handler(_run_context, report: object = None) -> str | None:
        try:
            accepted = parse_dissection_report(
                report,
                transcript=transcript,
                chunks=chunks,
                source_language=source_language,
            )
        except DissectionGenerationError as exc:
            category = exc.validation_category or "schema_shape"
            return (
                f"Report rejected. Validation category: {category}. Submit the complete "
                "report with exactly the required fields, valid sourceChunkIds and "
                "verbatim transcript quotations. Use only supplied transcript evidence."
            )
        delivery.report = accepted
        return None

    report_properties = {
        "overallNarrative": {"type": "object"},
        "segments": {"type": "array", "items": {"type": "object"}, "minItems": 1},
        "highlights": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "reusableTemplate": {"type": "object"},
        "audienceFit": {"type": "array", "items": {"type": "object"}},
        "strengths": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        "weaknesses": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
    }
    return FunctionTool(
        name="submit_dissection",
        description=(
            "Submit the complete transcript dissection report; acceptance finishes this run."
        ),
        parameters={
            "type": "object",
            "properties": {
                "report": {
                    "type": "object",
                    "properties": report_properties,
                    "required": list(report_properties),
                    "additionalProperties": False,
                    "description": "Complete semantic report following the exact prompt schema.",
                },
            },
            "required": ["report"],
            "additionalProperties": False,
        },
        handler=handler,
    )


class DissectionDeliveryHook(BaseAgentRunHooks[SessionContext]):
    def __init__(
        self,
        delivery: DissectionDelivery,
        max_turns: int,
        progress_callback: ProgressCallback | None,
    ) -> None:
        self._delivery = delivery
        self._max_turns = max_turns
        self._progress_callback = progress_callback
        self._attempt = 0

    async def on_llm_request(self, run_context) -> None:
        self._attempt += 1
        if self._progress_callback is not None:
            self._progress_callback(
                build_worker_progress_event(
                    "ai.generation.running",
                    stage="insights_generating",
                    progress=70 + ((self._attempt - 1) * 20 // self._max_turns),
                    message_args={"attempt": self._attempt, "total": self._max_turns},
                )
            )

    async def on_before_complete(self, run_context, llm_response) -> bool:
        if self._delivery.report is not None:
            return True
        run_context.messages.append(
            Message(
                role="user",
                content="Delivery is incomplete. Call submit_dissection with the complete report.",
            )
        )
        return False


async def _generate_dissection(
    transcript: str,
    chunks: list[MarkdownChunk],
    output_language: OutputLanguage,
    source_language: str | None,
    provider: Provider,
    max_turns: int,
    progress_callback: ProgressCallback | None,
) -> TranscriptDissection:
    delivery = DissectionDelivery()
    tools = ToolSet()
    tools.add_tool(build_dissection_tool(
        transcript=transcript,
        chunks=chunks,
        source_language=source_language,
        delivery=delivery,
    ))
    session_id = uuid4().hex
    request = ProviderRequest(
        prompt=build_dissection_agent_prompt(chunks, output_language),
        system_prompt=(
            "You are the transcript dissection agent. Analyze the supplied transcript and "
            "deliver the complete report using submit_dissection. Resolve any validation "
            "feedback using the transcript, then resubmit. Plain replies do not deliver a report."
        ),
        func_tool=tools,
        session_id=session_id,
        contexts=[],
    )
    run_context: ContextWrapper[SessionContext] = ContextWrapper(
        context=SessionContext(session_id=session_id), messages=[],
    )
    runner = StrictInsightRunner()
    await runner.reset(
        provider=provider,
        request=request,
        run_context=run_context,
        tool_executor=FunctionToolExecutor(provider),
        agent_hooks=DissectionDeliveryHook(delivery, max_turns, progress_callback),
        enforce_max_turns=max_turns,
        streaming=False,
    )
    for _turn in range(max_turns):
        async for _response in runner.step():
            pass
        if runner.done():
            break
    final_response = runner.get_final_llm_resp()
    if final_response is not None and final_response.role == "err":
        raise agent_error(final_response, "Transcript dissection")
    if delivery.report is None:
        raise DissectionGenerationError(
            "DISSECTION_INVALID_RESULT",
            "The transcript dissection agent did not deliver a valid report within its budget.",
        )
    return delivery.report


def generate_dissection_via_agent_runtime(
    transcript: str,
    env: Mapping[str, str] | None = None,
    output_language: OutputLanguage = "zh-CN",
    source_language: str | None = None,
    *,
    provider: Provider | None = None,
    max_turns: int = DISSECTION_AGENT_MAX_TURNS,
    progress_callback: ProgressCallback | None = None,
) -> TranscriptDissection:
    if type(max_turns) is not int or not 1 <= max_turns <= DISSECTION_AGENT_MAX_TURNS:
        raise ValueError("Dissection max_turns must be an integer from 1 through 6.")
    if not transcript.strip():
        raise DissectionGenerationError(
            "DISSECTION_EMPTY_TRANSCRIPT", "The saved transcript is empty.",
        )
    output_language_semantics(output_language)
    chunks = MarkdownSplitter().split(transcript)
    if len(chunks) > MAX_DISSECTION_CHUNKS:
        raise DissectionGenerationError(
            "DISSECTION_TRANSCRIPT_TOO_LARGE",
            "The saved transcript exceeds the dissection source limit.",
        )
    resolved_env = os.environ if env is None else env
    active_provider = provider or build_insight_provider(resolved_env)

    async def run() -> TranscriptDissection:
        try:
            return await _generate_dissection(
                transcript, chunks, output_language, source_language,
                active_provider, max_turns, progress_callback,
            )
        finally:
            if provider is None:
                await active_provider.terminate()

    return asyncio.run(run())
