from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from frameq_worker.insightflow.prompt import build_question_prompt, build_topic_plan_prompt
from frameq_worker.insightflow.splitter import MarkdownSplitter
from frameq_worker.insightflow.utils import extract_json_from_llm_output

QUESTION_GENERATION_LENGTH = 1000
MAX_TOPIC_PLANS = 8
MAX_INSIGHTS = 12
MIN_QUESTIONS_PER_TOPIC = 1
MAX_QUESTIONS_PER_TOPIC = 3


class InsightGenerationError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class InsightClient(Protocol):
    def generate(self, prompt: str) -> str:
        pass


@dataclass(frozen=True)
class Insight:
    id: int
    text: str
    label: str = ""
    chunk_id: int = 1


@dataclass(frozen=True)
class InsightArtifacts:
    insights: list[Insight]
    json_path: Path
    md_path: Path


@dataclass(frozen=True)
class TopicPlan:
    id: int
    title: str
    summary: str
    excerpt: str
    question_count: int


def generate_insights_from_markdown(
    markdown: str,
    output_dir: Path,
    output_stem: str,
    client: InsightClient,
    splitter: MarkdownSplitter | None = None,
) -> InsightArtifacts:
    chunks = (splitter or MarkdownSplitter()).split(markdown)
    if not chunks:
        raise InsightGenerationError("INSIGHTFLOW_EMPTY_TRANSCRIPT", "Transcript is empty.")

    insights = _generate_questions_from_topic_plan(markdown, client)
    if not insights:
        insights = _generate_questions_from_chunks(chunks, client)

    return write_insight_files(insights, output_dir=output_dir, output_stem=output_stem)


def _generate_questions_from_topic_plan(
    markdown: str,
    client: InsightClient,
) -> list[Insight]:
    plan_prompt = build_topic_plan_prompt(
        markdown,
        max_topics=MAX_TOPIC_PLANS,
        max_questions=MAX_INSIGHTS,
    )
    parsed = extract_json_from_llm_output(client.generate(plan_prompt))
    topic_plans = _normalize_topic_plans(parsed)
    if not topic_plans:
        return []

    insights: list[Insight] = []
    seen: set[str] = set()
    for topic in topic_plans:
        prompt = build_question_prompt(
            _format_topic_plan_text(topic),
            number=topic.question_count,
            question_prompt="请只围绕当前话题段生成问题，不要扩展到其他话题段。",
        )
        parsed = extract_json_from_llm_output(client.generate(prompt))
        _append_unique_questions(
            insights,
            seen,
            _normalize_questions(parsed),
            chunk_id=topic.id,
        )
        if len(insights) >= MAX_INSIGHTS:
            break

    return insights[:MAX_INSIGHTS]


def _generate_questions_from_chunks(
    chunks: list[object],
    client: InsightClient,
) -> list[Insight]:
    insights: list[Insight] = []
    seen: set[str] = set()
    for chunk in chunks:
        content = str(getattr(chunk, "content", "")).strip()
        if not content:
            continue
        number = calculate_question_count(content)
        prompt = build_question_prompt(content, number=number)
        parsed = extract_json_from_llm_output(client.generate(prompt))
        _append_unique_questions(
            insights,
            seen,
            _normalize_questions(parsed),
            chunk_id=int(getattr(chunk, "id", len(insights) + 1)),
        )
        if len(insights) >= MAX_INSIGHTS:
            break

    return insights[:MAX_INSIGHTS]


def calculate_question_count(
    text: str,
    question_generation_length: int = QUESTION_GENERATION_LENGTH,
) -> int:
    if question_generation_length <= 0:
        return 1
    return max(1, len(text) // question_generation_length)


def _normalize_topic_plans(parsed: object | None) -> list[TopicPlan]:
    if not isinstance(parsed, list):
        return []

    topic_plans: list[TopicPlan] = []
    remaining_questions = MAX_INSIGHTS
    for item in parsed:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title") or "").strip()
        summary = str(item.get("summary") or "").strip()
        excerpt = str(item.get("excerpt") or "").strip()
        if not title or not (summary or excerpt):
            continue

        question_count = _coerce_question_count(item.get("question_count"))
        question_count = min(question_count, remaining_questions)
        if question_count < MIN_QUESTIONS_PER_TOPIC:
            break

        topic_plans.append(
            TopicPlan(
                id=len(topic_plans) + 1,
                title=title,
                summary=summary,
                excerpt=excerpt,
                question_count=question_count,
            )
        )
        remaining_questions -= question_count
        if len(topic_plans) >= MAX_TOPIC_PLANS or remaining_questions <= 0:
            break

    return topic_plans


def _coerce_question_count(raw_value: object) -> int:
    try:
        question_count = int(str(raw_value).strip())
    except (TypeError, ValueError):
        question_count = MIN_QUESTIONS_PER_TOPIC

    return max(
        MIN_QUESTIONS_PER_TOPIC,
        min(MAX_QUESTIONS_PER_TOPIC, question_count),
    )


def _format_topic_plan_text(topic: TopicPlan) -> str:
    return f"""# {topic.title}

## 话题摘要
{topic.summary}

## 原文片段
{topic.excerpt}
"""


def write_insight_files(
    insights: list[Insight],
    output_dir: Path,
    output_stem: str,
) -> InsightArtifacts:
    if not insights:
        raise InsightGenerationError(
            "INSIGHTFLOW_EMPTY_RESULT",
            "InsightFlow returned no insights.",
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    if output_stem:
        json_path = output_dir / f"{output_stem}_insights.json"
        md_path = output_dir / f"{output_stem}_insights.md"
    else:
        json_path = output_dir / "insights.json"
        md_path = output_dir / "insights.md"

    payload = {
        "file_id": output_stem,
        "insights": [asdict(insight) for insight in insights],
    }
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    md_path.write_text(_format_insights_markdown(insights), encoding="utf-8")

    return InsightArtifacts(insights=insights, json_path=json_path, md_path=md_path)


def _normalize_questions(parsed: object | None) -> list[str]:
    if not isinstance(parsed, list):
        return []

    questions: list[str] = []
    for item in parsed:
        if isinstance(item, str):
            text = item.strip()
        elif isinstance(item, dict):
            text = str(item.get("question") or item.get("text") or "").strip()
        else:
            text = ""
        if text:
            questions.append(text)
    return questions


def _append_unique_questions(
    insights: list[Insight],
    seen: set[str],
    questions: list[str],
    chunk_id: int,
) -> None:
    for question in questions:
        if len(insights) >= MAX_INSIGHTS:
            break
        dedupe_key = question.strip()
        if dedupe_key and dedupe_key not in seen:
            seen.add(dedupe_key)
            insights.append(
                Insight(id=len(insights) + 1, text=dedupe_key, chunk_id=chunk_id)
            )


def _format_insights_markdown(insights: list[Insight]) -> str:
    lines = ["# 启发话题点", ""]
    for insight in insights:
        lines.append(f"{insight.id}. {insight.text}")
    lines.append("")
    return "\n".join(lines)
