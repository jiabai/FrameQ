from __future__ import annotations

import inspect
import json
import re
from pathlib import Path

import pytest
from frameq_worker.ai_prompts import (
    build_dissection_agent_prompt,
    build_insights_agent_prompt,
    build_mindmap_prompt,
    build_summary_prompt,
)
from frameq_worker.models import Insight
from frameq_worker.output_language import output_language_semantics
from frameq_worker.requests import parse_retry_insights_request
from frameq_worker.summary_agent import (
    normalize_mermaid_mindmap,
    normalize_summary_markdown,
    write_summary_files,
)
from frameq_worker.topic_agent import write_insight_files
from frameq_worker.transcript_chunks import MarkdownSplitter
from frameq_worker.worker_service import retry_insights_once

SUPPORTED_OUTPUT_LANGUAGES = ("zh-CN", "zh-TW", "en-US")

EXPECTED_LANGUAGE_INSTRUCTIONS = {
    "zh-CN": (
        "Use Simplified Chinese for every user-visible generated value, Markdown "
        "heading/body, and Mermaid node label."
    ),
    "zh-TW": (
        "Use Traditional Chinese (Taiwan) for every user-visible generated value, "
        "Markdown heading/body, and Mermaid node label; never convert it to "
        "Simplified Chinese."
    ),
    "en-US": (
        "Use clear US English for every user-visible generated value, Markdown "
        "heading/body, and Mermaid node label."
    ),
}


@pytest.mark.parametrize("output_language", SUPPORTED_OUTPUT_LANGUAGES)
def test_retry_request_requires_and_preserves_supported_output_language(
    output_language: str,
) -> None:
    request = parse_retry_insights_request(
        {"task_id": "safe-task", "target": "summary", "output_language": output_language}
    )
    assert request.output_language == output_language


@pytest.mark.parametrize(
    "payload",
    [
        {"task_id": "safe-task", "target": "summary"},
        {"task_id": "safe-task", "target": "summary", "output_language": "review-secret"},
        {"task_id": "safe-task", "target": "summary", "output_language": 7},
        {
            "task_id": "safe-task", "target": "summary", "output_language": "en-US",
            "unexpected": "review-secret",
        },
        {
            "task_id": "safe-task", "target": "summary", "output_language": "en-US",
            "preference_snapshot": None,
        },
        {
            "task_id": "safe-task", "target": "insights", "output_language": "en-US",
            "preference_snapshot": None,
        },
        {
            "task_id": "safe-task", "target": "insights", "output_language": "en-US",
            "preference_snapshot": "review-secret",
        },
    ],
)
def test_retry_payload_failures_are_fixed_and_do_not_echo_values(
    payload: dict[str, object], tmp_path: Path
) -> None:
    result = retry_insights_once(json.dumps(payload), project_root=tmp_path, environ={})

    assert result["error"] == {
        "code": "INVALID_RETRY_PAYLOAD",
        "message": "Retry request payload was invalid.",
        "stage": "insights_generating",
    }
    assert "review-secret" not in json.dumps(result)


@pytest.mark.parametrize(
    "builder", [build_insights_agent_prompt, build_mindmap_prompt, build_summary_prompt]
)
def test_prompt_builders_have_no_output_language_default(builder: object) -> None:
    parameter = inspect.signature(builder).parameters["output_language"]
    assert parameter.default is inspect.Parameter.empty


@pytest.mark.parametrize("output_language", SUPPORTED_OUTPUT_LANGUAGES)
def test_all_ai_prompts_include_the_fixed_output_language_semantics(output_language: str) -> None:
    chunks = MarkdownSplitter().split("Workflow ownership depends on clear responsibilities.")
    prompts = [
        build_insights_agent_prompt(chunks, output_language),
        build_dissection_agent_prompt(chunks, output_language),
        build_mindmap_prompt("transcript", output_language),
        build_summary_prompt("transcript", "mindmap\n  root((topic))", output_language),
    ]
    for prompt in prompts:
        assert EXPECTED_LANGUAGE_INSTRUCTIONS[output_language] in prompt
        assert "Do not change JSON keys, artifact schemas, or Mermaid syntax." in prompt
    if output_language == "en-US":
        assert re.search(r"[\u3400-\u9fff]", "\n".join(prompts)) is None
    if output_language == "zh-TW":
        assert "启发" not in "\n".join(prompts)


@pytest.mark.parametrize("output_language", SUPPORTED_OUTPUT_LANGUAGES)
def test_serialized_ai_artifacts_use_localized_headings(
    tmp_path: Path, output_language: str
) -> None:
    semantics = output_language_semantics(output_language)
    summary = write_summary_files(
        "Source-grounded summary", "mindmap\n  root((topic))", tmp_path, "demo", output_language
    )
    insight = Insight(1, "Topic question?", "Source evidence", ("Follow-up?",), "Discussion", 1)
    inspiration = write_insight_files([insight], tmp_path, "demo", output_language)

    assert summary.summary.startswith(f"# {semantics.summary_title}")
    markdown = inspiration.md_path.read_text(encoding="utf-8")
    assert markdown.startswith(f"# {semantics.insights_title}")
    assert f"### {semantics.match_reason_heading}" in markdown
    assert f"{semantics.source_chunk_label}: 1" in markdown


def test_normalization_preserves_provider_language_without_translation() -> None:
    assert normalize_summary_markdown("# 中文总结\n\n原文观点。", "en-US").startswith("# 中文总结")
    assert "中文主题" in normalize_mermaid_mindmap("mindmap\n  root((中文主题))")
