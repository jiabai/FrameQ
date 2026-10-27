from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from agent_runtime.core import SessionContext
from agent_runtime.core.run_context import ContextWrapper
from agent_runtime.core.tool import ToolSet
from agent_runtime.provider.entities import LLMResponse
from frameq_worker.ai_runtime import agent_error, build_insight_provider
from frameq_worker.insight_errors import InsightGenerationError
from frameq_worker.summary_agent import (
    SummaryDelivery,
    SummaryDeliveryHook,
    _build_mindmap_tool,
    _build_summary_tool,
    generate_summary_via_agent_runtime,
    normalize_mermaid_mindmap,
    normalize_summary_markdown,
    write_summary_files,
)


def test_summary_tools_validate_then_complete_delivery() -> None:
    delivery = SummaryDelivery()
    mindmap_tool = _build_mindmap_tool(delivery)
    summary_tool = _build_summary_tool(delivery, "en-US")

    assert "Invalid mindmap" in asyncio.run(mindmap_tool.handler(None, mermaid="graph TD"))
    assert not delivery.mindmap
    assert "accepted" in asyncio.run(mindmap_tool.handler(
        None, mermaid="```mermaid\nmindmap\n  root((Structure))\n```"
    ))
    assert "empty" in asyncio.run(summary_tool.handler(None, markdown=" "))
    assert not delivery.summary
    assert asyncio.run(summary_tool.handler(None, markdown="Clear structure.")) is None
    assert delivery.mindmap == "mindmap\n  root((Structure))\n"
    assert delivery.summary == "# Key Summary\n\nClear structure.\n"


@pytest.mark.parametrize("value", [None, 42, [], {}, True])
def test_summary_tools_reject_non_string_arguments_with_fixed_feedback(value: object) -> None:
    delivery = SummaryDelivery()
    mindmap_tool = _build_mindmap_tool(delivery)
    summary_tool = _build_summary_tool(delivery, "en-US")

    assert "Invalid mindmap" in asyncio.run(mindmap_tool.handler(None, mermaid=value))
    assert "Markdown string" in asyncio.run(summary_tool.handler(None, markdown=value))
    assert not delivery.mindmap
    assert not delivery.summary


def test_summary_tools_reject_missing_arguments_with_fixed_feedback() -> None:
    delivery = SummaryDelivery()

    assert "Invalid mindmap" in asyncio.run(_build_mindmap_tool(delivery).handler(None))
    assert "Markdown string" in asyncio.run(_build_summary_tool(delivery, "en-US").handler(None))
    assert not delivery.mindmap
    assert not delivery.summary


def test_insight_runner_has_one_attempt_per_step() -> None:
    from frameq_worker.ai_runtime import StrictInsightRunner

    assert StrictInsightRunner.EMPTY_OUTPUT_RETRY_ATTEMPTS == 1


def test_summary_hook_requires_both_tools_and_adds_grounded_summary_task() -> None:
    delivery = SummaryDelivery()
    tools = ToolSet()
    tool = _build_mindmap_tool(delivery)
    tools.add_tool(tool)
    hook = SummaryDeliveryHook(
        markdown="Official transcript.", output_language="en-US", delivery=delivery, tools=tools
    )
    context = ContextWrapper(context=SessionContext(session_id="summary-test"), messages=[])

    async def run() -> None:
        assert not await hook.on_before_complete(context, LLMResponse(role="assistant"))
        assert "submit_mindmap" in context.messages[-1].content
        await tool.handler(context, mermaid="mindmap\n  root((Structure))")
        await hook.on_tool_end(context, tool, {}, None)
        assert "Official transcript." in context.messages[-1].content
        assert delivery.mindmap.strip() in context.messages[-1].content
        count = len(context.messages)
        await hook.on_tool_end(context, tool, {}, None)
        assert len(context.messages) == count
        assert not await hook.on_before_complete(context, LLMResponse(role="assistant"))
        assert "submit_summary" in context.messages[-1].content
        await _build_summary_tool(delivery, "en-US").handler(context, markdown="Summary.")
        assert await hook.on_before_complete(context, LLMResponse(role="assistant"))

    asyncio.run(run())


@pytest.mark.parametrize("language,title", [
    ("zh-CN", "要点总结"), ("zh-TW", "重點摘要"), ("en-US", "Key Summary"),
])
def test_summary_normalization_preserves_body_and_localizes_title(language, title) -> None:
    assert normalize_summary_markdown("Body", language) == f"# {title}\n\nBody\n"
    assert normalize_summary_markdown("# Existing\n\nBody", language) == "# Existing\n\nBody\n"
    assert normalize_summary_markdown("```markdown\n# Heading\n```", language) == "# Heading\n"


@pytest.mark.parametrize("raw", ["", " ", "graph TD\n A-->B"])
def test_invalid_mindmap_is_rejected(raw) -> None:
    assert normalize_mermaid_mindmap(raw) == ""


@pytest.mark.parametrize("max_turns", [-1, 0, 7, True, 1.0, "2"])
def test_summary_agent_rejects_invalid_turn_budget_before_provider_configuration(
    max_turns: object,
) -> None:
    with pytest.raises(ValueError, match="integer from 1 through 6"):
        generate_summary_via_agent_runtime("Transcript.", {}, "en-US", max_turns=max_turns)


def test_summary_agent_rejects_output_language_before_provider_configuration() -> None:
    with pytest.raises(KeyError):
        generate_summary_via_agent_runtime("Transcript.", {}, "unsupported")


@pytest.mark.parametrize("env", [
    {}, {"FRAMEQ_LLM_API_KEY": "key"}, {"FRAMEQ_LLM_MODEL": "model"},
    {"FRAMEQ_LLM_SOURCE": "server"},
    {"FRAMEQ_LLM_API_KEY": "key", "FRAMEQ_LLM_MODEL": "model", "FRAMEQ_LLM_PROVIDER": "unknown"},
])
def test_provider_configuration_fails_before_network(env) -> None:
    with pytest.raises(InsightGenerationError, match="not configured") as error:
        build_insight_provider(env)
    assert error.value.code == "AI_CONFIG_MISSING"


@pytest.mark.parametrize("code", [
    "AI_CONFIG_MISSING",
    "AI_LLM_AUTH_REQUIRED", "AI_LLM_QUOTA_UNAVAILABLE",
    "AI_LLM_CONFIG_MISSING", "AI_LLM_CHECKOUT_TIMEOUT",
    "AI_LLM_CHECKOUT_FAILED", "AI_LLM_CHECKOUT_INVALID_RESPONSE",
])
def test_agent_error_preserves_checkout_code(code) -> None:
    assert agent_error(LLMResponse(role="err", completion_text=code), "Summary").code == code


def test_agent_error_does_not_echo_provider_secrets() -> None:
    error = agent_error(LLMResponse(role="err", completion_text="token=private"), "Summary")
    assert error.code == "AI_LLM_REQUEST_FAILED"
    assert "private" not in str(error)


def test_summary_artifacts_commit_both_files(tmp_path: Path) -> None:
    artifacts = write_summary_files(
        "# Summary\n\nBody", "mindmap\n  root((Structure))", tmp_path, "example", "en-US"
    )
    assert artifacts.summary_path.read_bytes() == artifacts.summary_bytes
    assert artifacts.mindmap_path.read_bytes() == artifacts.mindmap_bytes


def test_summary_payloads_remain_unwritten_until_transaction(tmp_path: Path) -> None:
    artifacts = write_summary_files(
        "Body", "mindmap\n  root((Structure))", tmp_path / "ai", "", "en-US", persist=False
    )
    assert not artifacts.summary_path.exists()
    assert not artifacts.mindmap_path.exists()
    assert artifacts.summary_bytes
    assert artifacts.mindmap_bytes


@pytest.mark.parametrize("summary,mindmap,code", [
    (" ", "mindmap\n  root((Structure))", "AI_EMPTY_SUMMARY"),
    ("Body", "graph TD", "AI_INVALID_MINDMAP"),
])
def test_invalid_summary_artifacts_preserve_existing_files(tmp_path, summary, mindmap, code):
    path = tmp_path / "summary.md"
    path.write_text("Existing", encoding="utf-8")
    with pytest.raises(InsightGenerationError) as error:
        write_summary_files(summary, mindmap, tmp_path, "", "en-US")
    assert error.value.code == code
    assert path.read_text(encoding="utf-8") == "Existing"
