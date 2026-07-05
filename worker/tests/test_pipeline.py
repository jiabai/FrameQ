from pathlib import Path

from frameq_worker.asr import Transcript
from frameq_worker.pipeline import run_asr_transcript_step, run_insight_generation_step


class FakeTranscriber:
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        return Transcript(text="transcript for insight generation", language=language)


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


class FakeInsightClient:
    def generate(self, prompt: str) -> str:
        if "Mermaid mindmap" in prompt:
            return "mindmap\n  root((pipeline))"
        if "Mermaid" in prompt and "Transcript" in prompt:
            return "# summary\n\npipeline summary"
        if "topic" in prompt.lower() or "question_count" in prompt:
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
        if "topic" in prompt.lower() or "question_count" in prompt:
            return '[{"title":"topic","summary":"summary","excerpt":"excerpt","question_count":1}]'
        return '["insight only"]'


def test_run_insight_generation_step_returns_task_style_artifacts(tmp_path: Path) -> None:
    transcript_path = tmp_path / "task" / "transcript" / "transcript.md"
    transcript_path.parent.mkdir(parents=True)
    transcript_path.write_text("# Transcript\n\ntranscript text", encoding="utf-8")

    result = run_insight_generation_step(
        transcript_path=transcript_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        transcript_text="transcript text",
        client=FakeInsightClient(),
    ).to_dict()

    assert result["status"] == "completed"
    assert result["summary"].startswith("#")
    assert result["insights"] == ["pipeline question"]
    assert result["artifacts"] == {
        "summary": "summary.md",
        "mindmap": "mindmap.mmd",
        "insights": "insights.json",
        "insights_md": "insights.md",
    }


def test_run_insight_generation_step_without_client_returns_partial_completed(
    tmp_path: Path,
) -> None:
    transcript_path = tmp_path / "task" / "transcript" / "transcript.md"
    transcript_path.parent.mkdir(parents=True)
    transcript_path.write_text("# Transcript\n\ntranscript text", encoding="utf-8")

    result = run_insight_generation_step(
        transcript_path=transcript_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        transcript_text="transcript text",
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
    transcript_path = tmp_path / "task" / "transcript" / "transcript.md"
    transcript_path.parent.mkdir(parents=True)
    transcript_path.write_text("# Transcript\n\ntranscript text", encoding="utf-8")

    result = run_insight_generation_step(
        transcript_path=transcript_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        transcript_text="transcript text",
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
    transcript_path = tmp_path / "task" / "transcript" / "transcript.md"
    transcript_path.parent.mkdir(parents=True)
    transcript_path.write_text("# Transcript\n\ntranscript text", encoding="utf-8")

    result = run_insight_generation_step(
        transcript_path=transcript_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        transcript_text="transcript text",
        client=InsightsOnlyClient(),
    ).to_dict()

    assert result["status"] == "partial_completed"
    assert result["artifacts"] == {
        "insights": "insights.json",
        "insights_md": "insights.md",
    }
    assert result["insights"] == ["insight only"]
    assert result["error"]["code"] == "INSIGHTFLOW_INVALID_MINDMAP"
