from __future__ import annotations

import asyncio
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from agent_runtime.core import FunctionToolExecutor, SessionContext
from agent_runtime.core.hooks import BaseAgentRunHooks
from agent_runtime.core.message import Message
from agent_runtime.core.run_context import ContextWrapper
from agent_runtime.core.tool import FunctionTool, ToolSet
from agent_runtime.provider.entities import ProviderRequest
from agent_runtime.provider.provider import Provider

from frameq_worker.ai_artifacts import commit_insight_payloads
from frameq_worker.ai_prompts import build_mindmap_prompt, build_summary_prompt
from frameq_worker.ai_runtime import StrictInsightRunner, agent_error, build_insight_provider
from frameq_worker.atomic_files import platform_text_bytes
from frameq_worker.insight_errors import InsightGenerationError
from frameq_worker.output_language import OutputLanguage, output_language_semantics

SUMMARY_AGENT_MAX_TURNS = 6


@dataclass(frozen=True)
class SummaryArtifacts:
    summary: str
    mindmap: str
    summary_path: Path
    mindmap_path: Path
    summary_bytes: bytes
    mindmap_bytes: bytes


def write_summary_files(
    summary: str,
    mindmap: str,
    output_dir: Path,
    output_stem: str,
    output_language: OutputLanguage,
    persist: bool = True,
) -> SummaryArtifacts:
    normalized_summary = normalize_summary_markdown(summary, output_language)
    normalized_mindmap = normalize_mermaid_mindmap(mindmap)
    if not normalized_summary:
        raise InsightGenerationError(
            "AI_EMPTY_SUMMARY",
            "Summary agent returned an empty summary.",
        )
    if not normalized_mindmap:
        raise InsightGenerationError(
            "AI_INVALID_MINDMAP",
            "Summary agent returned an invalid Mermaid mindmap.",
        )

    if output_stem:
        summary_path = output_dir / f"{output_stem}_summary.md"
        mindmap_path = output_dir / f"{output_stem}_mindmap.mmd"
    else:
        summary_path = output_dir / "summary.md"
        mindmap_path = output_dir / "mindmap.mmd"
    summary_bytes = platform_text_bytes(normalized_summary)
    mindmap_bytes = platform_text_bytes(normalized_mindmap)
    if persist:
        commit_insight_payloads(
            output_dir,
            output_stem,
            {
                summary_path: summary_bytes,
                mindmap_path: mindmap_bytes,
            },
        )

    return SummaryArtifacts(
        summary=normalized_summary,
        mindmap=normalized_mindmap,
        summary_path=summary_path,
        mindmap_path=mindmap_path,
        summary_bytes=summary_bytes,
        mindmap_bytes=mindmap_bytes,
    )


def normalize_summary_markdown(
    raw_summary: str,
    output_language: OutputLanguage,
) -> str:
    summary = _strip_code_fence(raw_summary).strip()
    if not summary:
        return ""
    if not summary.startswith("#"):
        title = output_language_semantics(output_language).summary_title
        summary = f"# {title}\n\n{summary}"
    return f"{summary.rstrip()}\n"


def normalize_mermaid_mindmap(raw_mindmap: str) -> str:
    mindmap = _strip_code_fence(raw_mindmap).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not mindmap:
        return ""

    lines = [line.rstrip() for line in mindmap.split("\n") if line.strip()]
    start_index = next(
        (index for index, line in enumerate(lines) if line.strip() == "mindmap"),
        None,
    )
    if start_index is None:
        return ""

    normalized = "\n".join(lines[start_index:]).strip()
    return f"{normalized}\n" if normalized else ""


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped

    lines = stripped.splitlines()
    if len(lines) >= 2 and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]).strip()
    return stripped

SummaryRunner = Callable[[str, Mapping[str, str], OutputLanguage], tuple[str, str]]

@dataclass
class SummaryDelivery:
    mindmap: str = ""
    summary: str = ""


def _build_mindmap_tool(delivery: SummaryDelivery) -> FunctionTool:
    async def handler(_run_context, mermaid: object = None) -> str:
        if not isinstance(mermaid, str):
            return "Invalid mindmap: submit a non-empty Mermaid mindmap string."
        normalized = normalize_mermaid_mindmap(mermaid)
        if not normalized:
            return (
                "Invalid mindmap: submit non-empty Mermaid mindmap source containing a "
                "standalone mindmap root line."
            )
        delivery.mindmap = normalized
        return (
            "Mindmap accepted. The system will next provide the summary task "
            "and submit_summary tool."
        )

    return FunctionTool(
        name="submit_mindmap",
        description="Submit the complete Mermaid mindmap source derived from the transcript.",
        parameters={
            "type": "object",
            "properties": {
                "mermaid": {
                    "type": "string",
                    "description": "Complete Mermaid source beginning with the mindmap root line",
                }
            },
            "required": ["mermaid"],
        },
        handler=handler,
    )


def _build_summary_tool(
    delivery: SummaryDelivery,
    output_language: OutputLanguage,
) -> FunctionTool:
    async def handler(_run_context, markdown: object = None) -> str | None:
        if not isinstance(markdown, str):
            return "The summary must be a non-empty Markdown string."
        normalized = normalize_summary_markdown(markdown, output_language)
        if not normalized:
            return "The summary is empty: submit the complete Markdown key summary."
        delivery.summary = normalized
        # agent_runtime 将 None 识别为直接完成信号，避免额外的收尾 LLM 调用。
        return None

    return FunctionTool(
        name="submit_summary",
        description=(
            "Submit the final Markdown key summary; a valid submission finishes this run."
        ),
        parameters={
            "type": "object",
            "properties": {
                "markdown": {
                    "type": "string",
                    "description": "Complete Markdown key summary ready for direct display",
                }
            },
            "required": ["markdown"],
        },
        handler=handler,
    )


class SummaryDeliveryHook(BaseAgentRunHooks[SessionContext]):
    def __init__(
        self,
        *,
        markdown: str,
        output_language: OutputLanguage,
        delivery: SummaryDelivery,
        tools: ToolSet,
    ) -> None:
        self._markdown = markdown
        self._output_language = output_language
        self._delivery = delivery
        self._tools = tools
        self._summary_prompt_added = False

    async def on_tool_end(self, run_context, tool, tool_args, tool_result) -> None:
        if (
            tool.name != "submit_mindmap"
            or not self._delivery.mindmap
            or self._summary_prompt_added
        ):
            return
        self._summary_prompt_added = True
        self._tools.remove_tool("submit_mindmap")
        self._tools.add_tool(_build_summary_tool(self._delivery, self._output_language))
        run_context.messages.append(
            Message(
                role="user",
                content=build_summary_prompt(
                    self._markdown,
                    self._delivery.mindmap,
                    output_language=self._output_language,
                ),
            )
        )

    async def on_before_complete(self, run_context, llm_response) -> bool:
        if self._delivery.mindmap and self._delivery.summary:
            return True
        required_tool = "submit_summary" if self._delivery.mindmap else "submit_mindmap"
        run_context.messages.append(
            Message(
                role="user",
                content=(
                    f"Delivery is incomplete. Call the {required_tool} tool to submit "
                    "the artifact. Do not finish with a plain reply."
                ),
            )
        )
        return False


async def _generate_summary(
    markdown: str,
    output_language: OutputLanguage,
    provider: Provider,
    max_turns: int,
) -> tuple[str, str]:
    delivery = SummaryDelivery()
    tools = ToolSet()
    tools.add_tool(_build_mindmap_tool(delivery))
    session_id = uuid4().hex
    request = ProviderRequest(
        prompt=build_mindmap_prompt(markdown, output_language=output_language),
        system_prompt=(
            "You are the key summary agent. First call submit_mindmap to deliver the "
            "mindmap; after the follow-up summary task arrives, call submit_summary to "
            "deliver the summary. Deliver artifacts only through the currently provided "
            "tool. Do not put artifacts in a plain reply or finish early."
        ),
        func_tool=tools,
        session_id=session_id,
        contexts=[],
    )
    run_context: ContextWrapper[SessionContext] = ContextWrapper(
        context=SessionContext(session_id=session_id),
        messages=[],
    )
    runner = StrictInsightRunner()
    await runner.reset(
        provider=provider,
        request=request,
        run_context=run_context,
        tool_executor=FunctionToolExecutor(provider),
        agent_hooks=SummaryDeliveryHook(
            markdown=markdown,
            output_language=output_language,
            delivery=delivery,
            tools=tools,
        ),
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
        raise agent_error(final_response, "Summary")
    if not delivery.mindmap:
        raise InsightGenerationError(
            "AI_INVALID_MINDMAP",
            "Summary agent did not deliver a valid Mermaid mindmap.",
        )
    if not delivery.summary:
        raise InsightGenerationError(
            "AI_EMPTY_SUMMARY",
            "Summary agent did not deliver a summary.",
        )
    return delivery.summary, delivery.mindmap


def generate_summary_via_agent_runtime(
    markdown: str,
    env: Mapping[str, str] | None = None,
    output_language: OutputLanguage = "zh-CN",
    *,
    provider: Provider | None = None,
    max_turns: int = SUMMARY_AGENT_MAX_TURNS,
) -> tuple[str, str]:
    if not markdown.strip():
        raise InsightGenerationError("AI_EMPTY_TRANSCRIPT", "Transcript is empty.")
    if type(max_turns) is not int or not 1 <= max_turns <= SUMMARY_AGENT_MAX_TURNS:
        raise ValueError("Summary max_turns must be an integer from 1 through 6.")
    output_language_semantics(output_language)
    resolved_env = os.environ if env is None else env
    active_provider = provider or build_insight_provider(resolved_env)

    async def run() -> tuple[str, str]:
        try:
            return await _generate_summary(
                markdown,
                output_language,
                active_provider,
                max_turns,
            )
        finally:
            if provider is None:
                await active_provider.terminate()

    return asyncio.run(run())
