import json
from pathlib import Path

import pytest
from frameq_worker.asr import Transcript, TranscriptSegment
from frameq_worker.desktop_contract import OUTPUT_DIR_ENV
from frameq_worker.media_preparation import MediaPreparationError, MediaPreparationFacade
from frameq_worker.models import ProcessRequest
from frameq_worker.pipeline import (
    run_asr_transcript_step,
    run_insight_generation_step,
    run_prepared_subtitle_transcript_step,
    run_worker_pipeline,
    write_prepared_subtitle_stage,
)
from frameq_worker.requests import parse_preference_snapshot
from frameq_worker.source_identity import SourceIdentity, SourceIdentityError
from frameq_worker.source_resolution import SourceRequest
from frameq_worker.subtitles import SubtitleTranscript
from frameq_worker.task_store import TaskContext, TaskPaths, UrlTaskSource


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


def test_empty_prepared_subtitle_returns_none_for_asr_fallback(tmp_path: Path) -> None:
    result = run_prepared_subtitle_transcript_step(
        subtitle=SubtitleTranscript(text=" ", language="zh-Hans", segments=()),
        output_dir=tmp_path / "task" / "transcript",
        output_stem="",
        source_identity=SourceIdentity(
            platform="youtube",
            stable_id="dQw4w9WgXcQ",
            canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        ),
    )

    assert result is None


def test_missing_official_transcript_returns_safe_not_found(tmp_path: Path) -> None:
    result = run_insight_generation_step(
        transcript_txt_path=tmp_path / "task" / "transcript" / "transcript.txt",
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=FakeInsightClient(),
        output_language="en-US",
    ).to_dict()

    assert result["status"] == "partial_completed"
    assert result["text"] == ""
    assert result["error"] == {
        "code": "TRANSCRIPT_TEXT_NOT_FOUND",
        "message": "Official transcript text could not be read.",
        "stage": "insights_generating",
    }


def test_source_identity_failure_creates_no_task(tmp_path: Path) -> None:
    def reject_source(_url: str) -> SourceRequest:
        raise SourceIdentityError("must not be echoed")

    result = run_worker_pipeline(
        request=ProcessRequest(
            url="https://example.test/review-secret",
            asr_model="iic/SenseVoiceSmall",
        ),
        project_root=tmp_path,
        command_runner=lambda _command: pytest.fail("media must not run"),
        transcriber=None,
        allow_real_asr=False,
        environ={},
        source_request_resolver=reject_source,
    ).to_dict()

    assert result == {
        "status": "failed",
        "task_id": None,
        "task_dir": None,
        "artifacts": {},
        "text": "",
        "summary": "",
        "insights": [],
        "transcript": None,
        "error": {
            "code": "SOURCE_IDENTITY_UNAVAILABLE",
            "message": "Could not identify a supported stable video source.",
            "stage": "video_extracting",
        },
    }
    assert not (tmp_path / "outputs").exists()


def test_task_storage_failure_returns_safe_error_without_task(tmp_path: Path) -> None:
    blocked_output = tmp_path / "blocked-output"
    blocked_output.write_text("ordinary file", encoding="utf-8")
    identity = SourceIdentity(
        platform="douyin",
        stable_id="7524373044106677544",
        canonical_url="https://www.douyin.com/video/7524373044106677544",
    )
    source_request = SourceRequest(identity.canonical_url, identity)

    result = run_worker_pipeline(
        request=ProcessRequest(
            url=identity.canonical_url,
            asr_model="iic/SenseVoiceSmall",
        ),
        project_root=tmp_path,
        command_runner=lambda _command: pytest.fail("media must not run"),
        transcriber=None,
        allow_real_asr=False,
        environ={OUTPUT_DIR_ENV: blocked_output.as_posix()},
        source_request_resolver=lambda _url: source_request,
    ).to_dict()

    assert result["task_id"] is None
    assert result["task_dir"] is None
    assert result["error"] == {
        "code": "TASK_STORAGE_UNAVAILABLE",
        "message": "Task storage could not be prepared.",
        "stage": "video_extracting",
    }


def test_media_failure_finalizes_the_created_task(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = SourceIdentity(
        platform="douyin",
        stable_id="7524373044106677544",
        canonical_url="https://www.douyin.com/video/7524373044106677544",
    )
    source_request = SourceRequest(identity.canonical_url, identity)

    def fail_media(*_args: object, **_kwargs: object) -> object:
        raise MediaPreparationError("VIDEO_DOWNLOAD_FAILED", "safe media failure")

    monkeypatch.setattr(MediaPreparationFacade, "prepare", fail_media)
    result = run_worker_pipeline(
        request=ProcessRequest(
            url=identity.canonical_url,
            asr_model="iic/SenseVoiceSmall",
        ),
        project_root=tmp_path,
        command_runner=lambda _command: pytest.fail("runner must not be called"),
        transcriber=None,
        allow_real_asr=False,
        environ={},
        source_request_resolver=lambda _url: source_request,
    ).to_dict()

    assert result["status"] == "failed"
    assert result["task_id"] is not None
    assert result["error"] == {
        "code": "VIDEO_DOWNLOAD_FAILED",
        "message": "safe media failure",
        "stage": "video_extracting",
    }
    task_dir = Path(str(result["task_dir"]))
    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "failed"
    assert manifest["error"] == result["error"]


@pytest.mark.parametrize("subtitle_language", ["unknown", "secret"])
def test_subtitle_found_progress_always_uses_a_safe_language_arg(
    tmp_path: Path,
    subtitle_language: str,
) -> None:
    paths = TaskPaths(
        output_root=tmp_path / "outputs",
        cache_root=tmp_path / "cache",
        task_id="subtitle-language-test",
    )
    paths.transcript_dir.mkdir(parents=True)
    context = TaskContext(
        paths=paths,
        source=UrlTaskSource(
            SourceIdentity(
                platform="youtube",
                stable_id="dQw4w9WgXcQ",
                canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            )
        ),
        model="iic/SenseVoiceSmall",
        created_at="2026-07-15T00:00:00Z",
    )
    events: list[dict[str, object]] = []

    result = write_prepared_subtitle_stage(
        SubtitleTranscript(
            text="subtitle text",
            language=subtitle_language,
            segments=(
                TranscriptSegment(
                    id="subtitle-1",
                    start_ms=1_000,
                    end_ms=2_000,
                    text="subtitle text",
                ),
            ),
        ),
        context,
        events.append,
    )

    assert result is not None
    assert events[-1] == {
        "stage": "video_transcribing",
        "progress": 68,
        "message_code": "subtitle.detect.found",
        "message_args": {"language": "und"},
    }


class FakeInsightClient:
    def generate(self, prompt: str) -> str:
        if "organize logical mindmaps" in prompt:
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
        if "organize logical mindmaps" in prompt:
            return "mindmap\n  root((summary))"
        if "Mermaid" in prompt and "Transcript" in prompt:
            return "# summary\n\nsummary only"
        return "not json"


class InsightsOnlyClient:
    def generate(self, prompt: str) -> str:
        if "organize logical mindmaps" in prompt:
            return "graph TD\n  A-->B"
        if "question_count" in prompt:
            return '[{"title":"topic","summary":"summary","excerpt":"excerpt","question_count":1}]'
        return '["insight only"]'


class CapturingInsightClient:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if "organize logical mindmaps" in prompt:
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
        output_language="zh-CN",
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
        output_language="zh-CN",
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
        output_language="zh-CN",
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
        output_language="zh-CN",
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
        output_language="zh-CN",
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
        output_language="zh-CN",
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
        output_language="zh-CN",
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
        output_language="zh-CN",
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
        output_language="zh-CN",
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
        output_language="zh-CN",
    ).to_dict()

    assert result["status"] == "partial_completed"
    assert result["artifacts"] == {
        "insights": "insights.json",
        "insights_md": "insights.md",
    }
    assert result["insights"][0]["topic"] == "insight only"
    assert result["insights"][0]["matchReason"]
    assert result["error"]["code"] == "INSIGHTFLOW_INVALID_MINDMAP"
