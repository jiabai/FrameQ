from __future__ import annotations

import inspect
import json
import re
from pathlib import Path

import pytest
from frameq_worker.insightflow.generator import generate_insights_from_markdown
from frameq_worker.insightflow.prompt import (
    build_mindmap_prompt,
    build_question_prompt,
    build_summary_prompt,
    build_topic_plan_prompt,
)
from frameq_worker.insightflow.summary import generate_summary_from_markdown
from frameq_worker.requests import parse_retry_insights_request
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
        {
            "task_id": "safe-task",
            "target": "summary",
            "output_language": output_language,
        }
    )

    assert request.output_language == output_language


@pytest.mark.parametrize(
    "payload",
    [
        {"task_id": "safe-task", "target": "summary"},
        {
            "task_id": "safe-task",
            "target": "summary",
            "output_language": "review-secret",
        },
        {
            "task_id": "safe-task",
            "target": "summary",
            "output_language": 7,
        },
        {
            "task_id": "safe-task",
            "target": "summary",
            "output_language": "en-US",
            "unexpected": "review-secret",
        },
        {
            "task_id": "safe-task",
            "target": "summary",
            "output_language": "en-US",
            "preference_snapshot": None,
        },
        {
            "task_id": "safe-task",
            "target": "insights",
            "output_language": "en-US",
            "preference_snapshot": None,
        },
        {
            "task_id": "safe-task",
            "target": "insights",
            "output_language": "en-US",
            "preference_snapshot": "review-secret",
        },
    ],
)
def test_retry_payload_failures_are_fixed_and_do_not_echo_values(
    payload: dict[str, object],
    tmp_path: Path,
) -> None:
    result = retry_insights_once(
        json.dumps(payload),
        project_root=tmp_path,
        insight_client=None,
        environ={},
    )

    assert result["error"] == {
        "code": "INVALID_RETRY_PAYLOAD",
        "message": "Retry request payload was invalid.",
        "stage": "insights_generating",
    }
    assert "review-secret" not in json.dumps(result)


@pytest.mark.parametrize(
    "builder_name,builder",
    [
        ("topic planner", build_topic_plan_prompt),
        ("question", build_question_prompt),
        ("mindmap", build_mindmap_prompt),
        ("summary", build_summary_prompt),
    ],
)
def test_prompt_builders_have_no_output_language_default(
    builder_name: str,
    builder: object,
) -> None:
    parameter = inspect.signature(builder).parameters["output_language"]

    assert parameter.default is inspect.Parameter.empty, builder_name


@pytest.mark.parametrize("output_language", SUPPORTED_OUTPUT_LANGUAGES)
def test_all_ai_prompts_include_the_fixed_output_language_semantics(
    output_language: str,
) -> None:
    prompts = [
        build_topic_plan_prompt("transcript", output_language=output_language),
        build_question_prompt("topic", number=1, output_language=output_language),
        build_mindmap_prompt("transcript", output_language=output_language),
        build_summary_prompt(
            "transcript",
            "mindmap\n  root((topic))",
            output_language=output_language,
        ),
    ]

    for prompt in prompts:
        assert EXPECTED_LANGUAGE_INSTRUCTIONS[output_language] in prompt
        assert "Do not change JSON keys, artifact schemas, or Mermaid syntax." in prompt


class CapturingClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.responses[len(self.prompts) - 1]


@pytest.mark.parametrize(
    "output_language,summary_title,topic_heading,insights_title,match_heading",
    [
        ("zh-CN", "# 要点总结", "## 话题摘要", "# 启发灵感", "### 匹配理由"),
        ("zh-TW", "# 重點摘要", "## 話題摘要", "# 靈感啟發", "### 匹配理由"),
        ("en-US", "# Key Summary", "## Topic Summary", "# Inspiration", "### Match Reason"),
    ],
)
def test_fake_clients_capture_locale_for_all_four_generation_prompts(
    tmp_path: Path,
    output_language: str,
    summary_title: str,
    topic_heading: str,
    insights_title: str,
    match_heading: str,
) -> None:
    summary_client = CapturingClient(
        [
            "mindmap\n  root((provider topic))",
            "provider summary without a heading",
        ]
    )
    summary = generate_summary_from_markdown(
        markdown="provider transcript",
        output_dir=tmp_path / "summary",
        output_stem="demo",
        client=summary_client,
        output_language=output_language,
    )
    insight_client = CapturingClient(
        [
            json.dumps(
                [
                    {
                        "title": "provider segment",
                        "summary": "provider segment summary",
                        "excerpt": "provider passage",
                        "question_count": 1,
                    }
                ]
            ),
            json.dumps(["provider question"]),
        ]
    )
    insights = generate_insights_from_markdown(
        markdown="provider transcript",
        output_dir=tmp_path / "insights",
        output_stem="demo",
        client=insight_client,
        output_language=output_language,
    )

    prompts = [*summary_client.prompts, *insight_client.prompts]
    assert len(prompts) == 4
    assert "organize logical mindmaps" in prompts[0]
    assert "You are a summary editor" in prompts[1]
    assert "topic-segment planner" in prompts[2]
    assert "reflective reading partner and topic curator" in prompts[3]
    assert all(EXPECTED_LANGUAGE_INSTRUCTIONS[output_language] in prompt for prompt in prompts)
    assert topic_heading in prompts[3]
    assert summary.summary.startswith(summary_title)
    insight_markdown = insights.md_path.read_text(encoding="utf-8")
    assert insight_markdown.startswith(insights_title)
    assert match_heading in insight_markdown
    if output_language == "en-US":
        assert re.search(r"[\u3400-\u9fff]", "\n".join(prompts)) is None
    if output_language == "zh-TW":
        assert "启发" not in "\n".join(prompts)


def test_provider_language_noncompliance_is_kept_without_an_extra_call(
    tmp_path: Path,
) -> None:
    client = CapturingClient(
        [
            "mindmap\n  root((中文主题))",
            "# 中文总结\n\n供应商没有遵循英文要求。",
        ]
    )

    result = generate_summary_from_markdown(
        markdown="transcript",
        output_dir=tmp_path,
        output_stem="demo",
        client=client,
        output_language="en-US",
    )

    assert result.summary.startswith("# 中文总结")
    assert len(client.prompts) == 2


@pytest.mark.parametrize(
    "output_language,expected_title,expected_default_reason,expected_default_use",
    [
        ("zh-CN", "# 启发灵感", "来自文字稿相关片段。", "灵感延展"),
        ("zh-TW", "# 靈感啟發", "來自逐字稿的相關片段。", "靈感延伸"),
        ("en-US", "# Inspiration", "Based on a relevant transcript passage.", "Idea development"),
    ],
)
def test_insight_fallbacks_and_markdown_chrome_follow_output_language(
    tmp_path: Path,
    output_language: str,
    expected_title: str,
    expected_default_reason: str,
    expected_default_use: str,
) -> None:
    client = CapturingClient(
        [
            "not json",
            json.dumps(["provider topic"], ensure_ascii=False),
        ]
    )

    artifacts = generate_insights_from_markdown(
        markdown="transcript",
        output_dir=tmp_path,
        output_stem="demo",
        client=client,
        output_language=output_language,
    )

    assert artifacts.insights[0].match_reason == expected_default_reason
    assert artifacts.insights[0].suitable_use == expected_default_use
    assert artifacts.md_path.read_text(encoding="utf-8").startswith(expected_title)
    assert len(client.prompts) == 2
