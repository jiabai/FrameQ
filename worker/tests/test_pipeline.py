from pathlib import Path

from frameq_worker.asr import Transcript
from frameq_worker.pipeline import (
    CLOUD_LLM_AI_ORGANIZING_MESSAGE,
    LOCAL_AI_ORGANIZING_MESSAGE,
    run_asr_transcript_step,
    run_insight_generation_step,
)
from frameq_worker.requests import parse_preference_snapshot


class FakeTranscriber:
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        return Transcript(text="transcript for insight generation", language=language)


def preference_snapshot():
    snapshot = parse_preference_snapshot(
        {
            "profile": None,
            "profileSkipped": True,
            "generationPreferences": {
                "goal": "content_creation",
                "scenario": "short_video",
                "angles": ["topic_angle"],
                "audience": "fans_readers",
                "styles": ["grounded"],
                "avoid": [],
            },
            "labelSnapshot": {
                "profile": [],
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


def test_run_asr_transcript_step_returns_task_style_artifacts(tmp_path: Path) -> None:
    audio_path = tmp_path / "cache" / "demo.wav"
    audio_path.parent.mkdir()
    audio_path.write_bytes(b"fake wav")

    result = run_asr_transcript_step(
        audio_path=audio_path,
        output_dir=tmp_path / "task" / "transcript",
        output_stem="",
        transcriber=FakeTranscriber(),
    ).to_dict()

    assert result["status"] == "video_transcribing"
    assert result["text"] == "transcript for insight generation"
    assert result["artifacts"] == {
        "transcript_txt": "transcript.txt",
        "transcript_md": "transcript.md",
    }
    assert (tmp_path / "task" / "transcript" / "transcript.txt").read_text(encoding="utf-8").strip()
    assert (tmp_path / "task" / "transcript" / "transcript.md").read_text(encoding="utf-8").strip()


def test_run_asr_transcript_step_maps_asr_errors_to_worker_error(tmp_path: Path) -> None:
    class EmptyTranscriber:
        def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
            return Transcript(text=" ", language=language)

    audio_path = tmp_path / "cache" / "demo.wav"
    audio_path.parent.mkdir()
    audio_path.write_bytes(b"fake wav")

    result = run_asr_transcript_step(
        audio_path=audio_path,
        output_dir=tmp_path / "task" / "transcript",
        output_stem="",
        transcriber=EmptyTranscriber(),
    )

    assert result.to_dict()["error"] == {
        "code": "ASR_EMPTY_TRANSCRIPT",
        "message": "ASR returned an empty transcript.",
        "stage": "video_transcribing",
    }


def test_ai_organizing_progress_messages_do_not_describe_bundled_generation() -> None:
    assert "AI 结果" in CLOUD_LLM_AI_ORGANIZING_MESSAGE
    assert "AI 结果" in LOCAL_AI_ORGANIZING_MESSAGE
    assert "要点总结、Mermaid mindmap 和启发灵感" not in CLOUD_LLM_AI_ORGANIZING_MESSAGE
    assert "要点总结、Mermaid mindmap 和启发灵感" not in LOCAL_AI_ORGANIZING_MESSAGE
    assert "启发话题点" not in CLOUD_LLM_AI_ORGANIZING_MESSAGE
    assert "启发话题点" not in LOCAL_AI_ORGANIZING_MESSAGE


class FakeInsightClient:
    def generate(self, prompt: str) -> str:
        if "Mermaid mindmap" in prompt:
            return "mindmap\n  root((pipeline))"
        if "Mermaid" in prompt and "Transcript" in prompt:
            return "# summary\n\npipeline summary"
        if "question_count" in prompt:
            return (
                '[{"title":"pipeline","summary":"summary","excerpt":"excerpt",'
                '"question_count":1}]'
            )
        return '["pipeline question"]'


class SummaryOnlyClient:
    def generate(self, prompt: str) -> str:
        if "Mermaid mindmap" in prompt:
            return "mindmap\n  root((summary))"
        if "Mermaid" in prompt and "Transcript" in prompt:
            return "# summary\n\nsummary only"
        return "not json"


class InsightsOnlyClient:
    def generate(self, prompt: str) -> str:
        if "Mermaid mindmap" in prompt:
            return "graph TD\n  A-->B"
        if "question_count" in prompt:
            return '[{"title":"topic","summary":"summary","excerpt":"excerpt","question_count":1}]'
        return '["insight only"]'


class CapturingInsightClient:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if "Mermaid mindmap" in prompt:
            return "mindmap\n  root((pipeline))"
        if "Mermaid" in prompt and "Transcript" in prompt:
            return "# summary\n\npipeline summary"
        if "question_count" in prompt:
            return '[{"title":"topic","summary":"summary","excerpt":"excerpt","question_count":1}]'
        return (
            '[{"topic":"pipeline question","matchReason":"matched",'
            '"followUpQuestions":["next"],"suitableUse":"content planning"}]'
        )


def test_run_insight_generation_step_returns_task_style_artifacts(tmp_path: Path) -> None:
    transcript_txt_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_txt_path.parent.mkdir(parents=True)
    transcript_txt_path.write_text("transcript text", encoding="utf-8")

    result = run_insight_generation_step(
        transcript_txt_path=transcript_txt_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=FakeInsightClient(),
    ).to_dict()

    assert result["status"] == "completed"
    assert result["summary"].startswith("#")
    assert result["insights"][0]["topic"] == "pipeline question"
    assert result["insights"][0]["sourceChunkId"] == 1
    assert result["artifacts"] == {
        "summary": "summary.md",
        "mindmap": "mindmap.mmd",
        "insights": "insights.json",
        "insights_md": "insights.md",
    }


def test_run_insight_generation_step_rejects_transcript_markdown_without_prompt(
    tmp_path: Path,
) -> None:
    transcript_md_path = tmp_path / "task" / "transcript" / "transcript.md"
    transcript_md_path.parent.mkdir(parents=True)
    transcript_md_path.write_text(
        "# Transcript\n\n## Metadata\n\n- Source URL: https://example.test/?token=secret",
        encoding="utf-8",
    )
    client = CapturingInsightClient()

    result = run_insight_generation_step(
        transcript_txt_path=transcript_md_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=client,
    ).to_dict()

    assert result["status"] == "partial_completed"
    assert result["error"] == {
        "code": "TRANSCRIPT_TEXT_PATH_INVALID",
        "message": "Official transcript.txt is required for AI generation.",
        "stage": "insights_generating",
    }
    assert client.prompts == []


def test_run_insight_generation_step_rejects_same_named_nonofficial_file(
    tmp_path: Path,
) -> None:
    nonofficial_path = tmp_path / "metadata" / "transcript.txt"
    nonofficial_path.parent.mkdir(parents=True)
    nonofficial_path.write_text("Metadata: xsec_token=review-secret", encoding="utf-8")
    client = CapturingInsightClient()

    result = run_insight_generation_step(
        transcript_txt_path=nonofficial_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=client,
    ).to_dict()

    assert result["error"]["code"] == "TRANSCRIPT_TEXT_PATH_INVALID"
    assert client.prompts == []


def test_run_insight_generation_step_rejects_other_task_transcript(
    tmp_path: Path,
) -> None:
    nonofficial_path = tmp_path / "other-task" / "transcript" / "transcript.txt"
    nonofficial_path.parent.mkdir(parents=True)
    nonofficial_path.write_text("xsec_token=review-secret", encoding="utf-8")
    client = CapturingInsightClient()

    result = run_insight_generation_step(
        transcript_txt_path=nonofficial_path,
        output_dir=tmp_path / "expected-task" / "ai",
        output_stem="",
        client=client,
    ).to_dict()

    assert result["error"]["code"] == "TRANSCRIPT_TEXT_PATH_INVALID"
    assert result["text"] == ""
    assert client.prompts == []


def test_run_insight_generation_step_can_generate_only_summary(tmp_path: Path) -> None:
    transcript_txt_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_txt_path.parent.mkdir(parents=True)
    transcript_txt_path.write_text("transcript text", encoding="utf-8")
    client = CapturingInsightClient()

    result = run_insight_generation_step(
        transcript_txt_path=transcript_txt_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=client,
        target="summary",
    ).to_dict()

    assert result["status"] == "completed"
    assert result["summary"].startswith("#")
    assert result["insights"] == []
    assert result["artifacts"] == {
        "summary": "summary.md",
        "mindmap": "mindmap.mmd",
    }
    assert len(client.prompts) == 2


def test_run_insight_generation_step_can_generate_only_insights(tmp_path: Path) -> None:
    transcript_txt_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_txt_path.parent.mkdir(parents=True)
    transcript_txt_path.write_text("transcript text", encoding="utf-8")
    client = CapturingInsightClient()

    result = run_insight_generation_step(
        transcript_txt_path=transcript_txt_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=client,
        preference_snapshot=preference_snapshot(),
        target="insights",
    ).to_dict()

    assert result["status"] == "completed"
    assert result["summary"] == ""
    assert result["insights"][0]["topic"] == "pipeline question"
    assert result["artifacts"] == {
        "insights": "insights.json",
        "insights_md": "insights.md",
    }
    assert len(client.prompts) == 2
    assert "content_creation" in client.prompts[0]
    assert "content_creation" in client.prompts[1]


def test_run_insight_generation_step_scopes_preferences_to_insight_prompts(
    tmp_path: Path,
) -> None:
    transcript_txt_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_txt_path.parent.mkdir(parents=True)
    transcript_txt_path.write_text("transcript text", encoding="utf-8")
    client = CapturingInsightClient()

    run_insight_generation_step(
        transcript_txt_path=transcript_txt_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=client,
        preference_snapshot=preference_snapshot(),
    )

    assert "content_creation" not in client.prompts[0]
    assert "content_creation" not in client.prompts[1]
    assert "content_creation" in client.prompts[2]
    assert "content_creation" in client.prompts[3]


def test_run_insight_generation_step_without_client_returns_partial_completed(
    tmp_path: Path,
) -> None:
    transcript_txt_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_txt_path.parent.mkdir(parents=True)
    transcript_txt_path.write_text("transcript text", encoding="utf-8")

    result = run_insight_generation_step(
        transcript_txt_path=transcript_txt_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=None,
    ).to_dict()

    assert result["status"] == "partial_completed"
    assert result["text"] == "transcript text"
    assert result["error"] == {
        "code": "INSIGHTFLOW_CONFIG_MISSING",
        "message": "InsightFlow LLM client is not configured.",
        "stage": "insights_generating",
    }


def test_run_insight_generation_step_preserves_summary_when_insights_fail(
    tmp_path: Path,
) -> None:
    transcript_txt_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_txt_path.parent.mkdir(parents=True)
    transcript_txt_path.write_text("transcript text", encoding="utf-8")

    result = run_insight_generation_step(
        transcript_txt_path=transcript_txt_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=SummaryOnlyClient(),
    ).to_dict()

    assert result["status"] == "partial_completed"
    assert result["artifacts"] == {
        "summary": "summary.md",
        "mindmap": "mindmap.mmd",
    }
    assert result["error"]["code"] == "INSIGHTFLOW_EMPTY_RESULT"


def test_run_insight_generation_step_preserves_insights_when_summary_fails(
    tmp_path: Path,
) -> None:
    transcript_txt_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_txt_path.parent.mkdir(parents=True)
    transcript_txt_path.write_text("transcript text", encoding="utf-8")

    result = run_insight_generation_step(
        transcript_txt_path=transcript_txt_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=InsightsOnlyClient(),
    ).to_dict()

    assert result["status"] == "partial_completed"
    assert result["artifacts"] == {
        "insights": "insights.json",
        "insights_md": "insights.md",
    }
    assert result["insights"][0]["topic"] == "insight only"
    assert result["insights"][0]["matchReason"]
    assert result["error"]["code"] == "INSIGHTFLOW_INVALID_MINDMAP"
