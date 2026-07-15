import json
import multiprocessing
import queue
from pathlib import Path

from frameq_worker.insightflow import (
    Insight,
    InsightGenerationError,
    MarkdownSplitter,
    generate_insights_from_markdown,
    generate_summary_from_markdown,
    write_insight_files,
    write_summary_files,
)
from frameq_worker.insightflow import prompt as prompt_module
from frameq_worker.insightflow.prompt import build_question_prompt
from frameq_worker.requests import parse_preference_snapshot


class FakeInsightClient:
    def __init__(self, responses: list[str] | None = None) -> None:
        self.prompts: list[str] = []
        self.responses = responses or [
            json.dumps(
                [
                    "企业级 AI 落地时，什么能力才是真正的价值分水岭？",
                    "为什么流程编排可能比单点模型能力更关键？",
                ],
                ensure_ascii=False,
            )
        ]

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if len(self.prompts) <= len(self.responses):
            return self.responses[len(self.prompts) - 1]
        return self.responses[-1]


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
                "defaultStyles": ["grounded"],
                "defaultAvoid": ["clickbait"],
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


def _split_markdown_worker(markdown: str, max_length: int, result_queue) -> None:
    chunks = MarkdownSplitter(max_length=max_length).split(markdown)
    result_queue.put([len(chunk.content) for chunk in chunks])


def test_markdown_splitter_preserves_heading_context() -> None:
    chunks = MarkdownSplitter(max_length=80).split(
        "# 总标题\n\n第一段内容。\n\n## 子标题\n\n第二段内容。" * 4
    )

    assert chunks
    assert chunks[0].content
    assert chunks[0].summary


def test_markdown_splitter_advances_past_sentence_separator() -> None:
    markdown = "# Transcript\n\n" + ("a" * 40) + "\u3002" + ("b" * 180)
    ctx = multiprocessing.get_context("spawn")
    result_queue = ctx.Queue()
    process = ctx.Process(
        target=_split_markdown_worker,
        args=(markdown, 80, result_queue),
    )

    process.start()
    process.join(2)
    if process.is_alive():
        process.terminate()
        process.join(2)
        raise AssertionError("MarkdownSplitter did not advance past the separator.")

    assert process.exitcode == 0
    try:
        chunk_lengths = result_queue.get_nowait()
    except queue.Empty as exc:
        raise AssertionError("MarkdownSplitter produced no result.") from exc
    assert len(chunk_lengths) > 1
    assert all(length > 0 for length in chunk_lengths)


def test_generate_insights_from_markdown_writes_json_and_markdown(tmp_path: Path) -> None:
    transcript = "# 视频文字稿\n\n这里是企业 AI 落地与流程编排相关的完整文字稿。"
    client = FakeInsightClient(
        responses=[
            json.dumps(
                [
                    {
                        "id": 1,
                        "title": "企业 AI 落地",
                        "summary": "讨论企业 AI 落地与流程编排的关系。",
                        "excerpt": "这里是企业 AI 落地与流程编排相关的完整文字稿。",
                        "question_count": 2,
                    }
                ],
                ensure_ascii=False,
            ),
            json.dumps(
                [
                    {
                        "topic": "企业级 AI 落地时，什么能力才是真正的价值分水岭？",
                        "matchReason": "文字稿讨论企业 AI 落地与流程编排的关系。",
                        "followUpQuestions": ["企业如何判断 AI 是否真正进入业务流程？"],
                        "suitableUse": "内容选题",
                    },
                    {
                        "topic": "为什么流程编排可能比单点模型能力更关键？",
                        "matchReason": "文字稿强调流程编排比单点模型能力更接近业务价值。",
                        "followUpQuestions": ["流程编排会如何改变 AI 项目的验收标准？"],
                        "suitableUse": "复盘拆解",
                    },
                ],
                ensure_ascii=False,
            ),
        ]
    )

    artifacts = generate_insights_from_markdown(
        markdown=transcript,
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        client=client,
        output_language="zh-CN",
    )

    assert [insight.topic for insight in artifacts.insights] == [
        "企业级 AI 落地时，什么能力才是真正的价值分水岭？",
        "为什么流程编排可能比单点模型能力更关键？",
    ]
    assert artifacts.json_path.exists()
    assert artifacts.md_path.exists()
    assert json.loads(artifacts.json_path.read_text(encoding="utf-8")) == {
        "schemaVersion": 1,
        "insights": [
            {
                "id": 1,
                "topic": "企业级 AI 落地时，什么能力才是真正的价值分水岭？",
                "matchReason": "文字稿讨论企业 AI 落地与流程编排的关系。",
                "followUpQuestions": ["企业如何判断 AI 是否真正进入业务流程？"],
                "suitableUse": "内容选题",
                "sourceChunkId": 1,
            },
            {
                "id": 2,
                "topic": "为什么流程编排可能比单点模型能力更关键？",
                "matchReason": "文字稿强调流程编排比单点模型能力更接近业务价值。",
                "followUpQuestions": ["流程编排会如何改变 AI 项目的验收标准？"],
                "suitableUse": "复盘拆解",
                "sourceChunkId": 1,
            },
        ],
    }
    assert "启发灵感" in artifacts.md_path.read_text(encoding="utf-8")
    assert "匹配理由" in artifacts.md_path.read_text(encoding="utf-8")
    assert "启发问题" in artifacts.md_path.read_text(encoding="utf-8")
    assert "适合用途" in artifacts.md_path.read_text(encoding="utf-8")
    assert "topic-segment planner" in client.prompts[0]
    assert "reflective reading partner and topic curator" in client.prompts[1]
    assert "natural, and easy to understand" in client.prompts[1]
    assert "Keep one main thought per question" in client.prompts[1]


def test_build_topic_plan_prompt_requests_structured_topic_plan() -> None:
    assert hasattr(prompt_module, "build_topic_plan_prompt")
    prompt = prompt_module.build_topic_plan_prompt(
        "这是一段没有分段的 ASR 文字稿。",
        output_language="zh-CN",
    )

    assert "topic-segment planner" in prompt
    assert "semantic topic segments suitable for later inspiration" in prompt
    assert "Ignore greetings, repetition, filler" in prompt
    assert '"title"' in prompt
    assert '"summary"' in prompt
    assert '"excerpt"' in prompt
    assert '"question_count"' in prompt


def test_generate_insights_uses_topic_planner_before_question_generation(
    tmp_path: Path,
) -> None:
    client = FakeInsightClient(
        responses=[
            json.dumps(
                [
                    {
                        "id": 1,
                        "title": "组织流程",
                        "summary": "企业 AI 落地需要流程编排。",
                        "excerpt": "企业 AI 落地时，流程编排比单点能力更关键。",
                        "question_count": 2,
                    },
                    {
                        "id": 2,
                        "title": "上下文能力",
                        "summary": "上下文能力影响 Agent 可用性。",
                        "excerpt": "上下文能力决定 Agent 能否理解任务背景。",
                        "question_count": 1,
                    },
                ],
                ensure_ascii=False,
            ),
            json.dumps(
                [
                    "为什么流程编排可能比单点模型能力更关键？",
                    "企业应该如何判断 AI 是否真正进入业务流程？",
                ],
                ensure_ascii=False,
            ),
            json.dumps(["上下文能力为什么会影响 Agent 的可用性？"], ensure_ascii=False),
        ]
    )

    artifacts = generate_insights_from_markdown(
        markdown=(
            "企业 AI 落地时，流程编排比单点能力更关键。"
            "上下文能力决定 Agent 能否理解任务背景。"
        ),
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        client=client,
        output_language="zh-CN",
    )

    assert len(client.prompts) == 3
    assert "topic-segment planner" in client.prompts[0]
    assert "组织流程" in client.prompts[1]
    assert "Generate at least 2 high-quality questions" in client.prompts[1]
    assert "上下文能力" in client.prompts[2]
    assert [insight.source_chunk_id for insight in artifacts.insights] == [1, 1, 2]
    assert [insight.topic for insight in artifacts.insights] == [
        "为什么流程编排可能比单点模型能力更关键？",
        "企业应该如何判断 AI 是否真正进入业务流程？",
        "上下文能力为什么会影响 Agent 的可用性？",
    ]


def test_build_question_prompt_accepts_additional_constraints() -> None:
    prompt = build_question_prompt(
        "这里是一段待处理文本。",
        number=1,
        output_language="zh-CN",
        global_prompt="只关注商业决策。",
        question_prompt="避免技术细节题。",
    )

    assert "## Additional global constraints" in prompt
    assert "只关注商业决策。" in prompt
    assert "## Additional constraints for this request" in prompt
    assert "避免技术细节题。" in prompt


def test_build_question_prompt_includes_compact_preference_context() -> None:
    prompt = build_question_prompt(
        "这里是一段待处理文本。",
        number=1,
        output_language="zh-CN",
        preference_snapshot=preference_snapshot(),
    )

    assert "## Personalization snapshot" in prompt
    assert "Use this JSON only to generate inspiration" in prompt
    assert "content_creation" in prompt
    assert "内容创作" in prompt
    assert "profileSkipped" in prompt
    assert (
        '"topic": "为什么流程编排可能比单点模型能力更关键？"'
        in prompt
    )
    assert '"topic": "启发话题点"' not in prompt


def test_generate_insights_applies_preferences_to_planner_and_question_prompts(
    tmp_path: Path,
) -> None:
    client = FakeInsightClient(
        responses=[
            json.dumps(
                [
                    {
                        "title": "内容创作",
                        "summary": "适合做短视频选题。",
                        "excerpt": "这段文字讨论内容创作。",
                        "question_count": 1,
                    }
                ],
                ensure_ascii=False,
            ),
            json.dumps(
                [
                    {
                        "topic": "这段内容可以如何拆成短视频选题？",
                        "matchReason": "符合内容创作目标。",
                        "followUpQuestions": ["怎样开头更适合粉丝读者？"],
                        "suitableUse": "短视频选题",
                    }
                ],
                ensure_ascii=False,
            ),
        ]
    )

    generate_insights_from_markdown(
        markdown="# 文字稿\n\n这段文字讨论内容创作。",
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        client=client,
        output_language="zh-CN",
        preference_snapshot=preference_snapshot(),
    )

    assert "content_creation" in client.prompts[0]
    assert "内容创作" in client.prompts[0]
    assert "content_creation" in client.prompts[1]
    assert "内容创作" in client.prompts[1]


def test_planner_fallback_uses_one_question_per_thousand_chars(
    tmp_path: Path,
) -> None:
    class SingleLargeChunkSplitter:
        def split(self, markdown: str):
            from frameq_worker.insightflow import MarkdownChunk

            return [
                MarkdownChunk(id=1, summary="large", content="内容" * 1300),
            ]

    client = FakeInsightClient(
        responses=[
            "not json",
            json.dumps(["为什么流程编排可能比单点模型能力更关键？"], ensure_ascii=False),
        ]
    )

    generate_insights_from_markdown(
        markdown="ignored",
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        client=client,
        output_language="zh-CN",
        splitter=SingleLargeChunkSplitter(),
    )

    assert "topic-segment planner" in client.prompts[0]
    assert "Generate at least 2 high-quality questions" in client.prompts[1]


def test_topic_planner_failure_falls_back_to_direct_generation(tmp_path: Path) -> None:
    client = FakeInsightClient(
        responses=[
            "planner failed",
            json.dumps(["为什么重试应该保留已有文字稿？"], ensure_ascii=False),
        ]
    )

    artifacts = generate_insights_from_markdown(
        markdown="# 视频文字稿\n\n这是一段用于重试的话题文字稿。",
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        client=client,
        output_language="zh-CN",
    )

    assert len(client.prompts) == 2
    assert "topic-segment planner" in client.prompts[0]
    assert "reflective reading partner and topic curator" in client.prompts[1]
    assert [insight.topic for insight in artifacts.insights] == [
        "为什么重试应该保留已有文字稿？"
    ]
    assert artifacts.insights[0].suitable_use == "灵感延展"


def test_topic_planner_caps_total_question_count(tmp_path: Path) -> None:
    topic_plan = [
        {
            "id": index,
            "title": f"话题 {index}",
            "summary": f"第 {index} 个话题摘要。",
            "excerpt": f"第 {index} 个话题原文片段。",
            "question_count": 3,
        }
        for index in range(1, 7)
    ]
    question_responses = [
        json.dumps(
            [f"话题 {topic_index} 的问题 {question_index}？" for question_index in range(1, 4)],
            ensure_ascii=False,
        )
        for topic_index in range(1, 7)
    ]
    client = FakeInsightClient(
        responses=[json.dumps(topic_plan, ensure_ascii=False), *question_responses]
    )

    artifacts = generate_insights_from_markdown(
        markdown="这是一段用于测试总量上限的文字稿。",
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        client=client,
        output_language="zh-CN",
    )

    assert len(artifacts.insights) == 12
    assert len(client.prompts) == 5
    assert "话题 4" in client.prompts[-1]


def test_write_insight_files_rejects_empty_insights(tmp_path: Path) -> None:
    try:
        write_insight_files(
            [],
            output_dir=tmp_path / "outputs",
            output_stem="demo",
            output_language="zh-CN",
        )
    except InsightGenerationError as error:
        assert error.code == "INSIGHTFLOW_EMPTY_RESULT"
    else:
        raise AssertionError("Expected InsightGenerationError")


def test_write_insight_files_serializes_existing_insights(tmp_path: Path) -> None:
    artifacts = write_insight_files(
        [
            Insight(
                id=1,
                topic="为什么流程编排可能比单点模型能力更关键？",
                match_reason="文字稿强调流程编排。",
                follow_up_questions=("团队应该先改哪条流程？",),
                suitable_use="团队分享",
                source_chunk_id=12,
            )
        ],
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        output_language="zh-CN",
    )

    assert json.loads(artifacts.json_path.read_text(encoding="utf-8"))["schemaVersion"] == 1
    assert "## 灵感 1" in artifacts.md_path.read_text(encoding="utf-8")


def test_generate_summary_from_markdown_writes_summary_and_mermaid_mindmap(
    tmp_path: Path,
) -> None:
    client = FakeInsightClient(
        responses=[
            "```mermaid\nmindmap\n  root((企业 AI 落地))\n    流程编排\n    上下文能力\n```",
            (
                "# 要点总结\n\n## 总览\n企业 AI 落地需要把流程编排和上下文能力结合起来。"
                "\n\n## 关键要点\n- 流程编排决定 AI 能否进入业务现场。"
            ),
        ]
    )

    artifacts = generate_summary_from_markdown(
        markdown="# 视频文字稿\n\n企业 AI 落地时，流程编排和上下文能力都很关键。",
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        client=client,
        output_language="zh-CN",
    )

    assert artifacts.summary.startswith("# 要点总结")
    assert artifacts.mindmap.startswith("mindmap\n")
    assert artifacts.summary_path == tmp_path / "outputs" / "demo_summary.md"
    assert artifacts.mindmap_path == tmp_path / "outputs" / "demo_mindmap.mmd"
    assert artifacts.summary_path.read_text(encoding="utf-8") == artifacts.summary
    assert artifacts.mindmap_path.read_text(encoding="utf-8") == artifacts.mindmap
    assert "organize logical mindmaps" in client.prompts[0]
    assert "Mermaid mindmap" in client.prompts[0]
    assert "Create a Key Summary from the source Transcript" in client.prompts[1]


def test_write_summary_files_rejects_empty_outputs(tmp_path: Path) -> None:
    try:
        write_summary_files(
            summary=" ",
            mindmap="mindmap\n  root((主题))",
            output_dir=tmp_path / "outputs",
            output_stem="demo",
            output_language="zh-CN",
        )
    except InsightGenerationError as error:
        assert error.code == "INSIGHTFLOW_EMPTY_SUMMARY"
    else:
        raise AssertionError("Expected InsightGenerationError")

    try:
        write_summary_files(
            summary="# 要点总结",
            mindmap="graph TD\n  A-->B",
            output_dir=tmp_path / "outputs",
            output_stem="demo",
            output_language="zh-CN",
        )
    except InsightGenerationError as error:
        assert error.code == "INSIGHTFLOW_INVALID_MINDMAP"
    else:
        raise AssertionError("Expected InsightGenerationError")
