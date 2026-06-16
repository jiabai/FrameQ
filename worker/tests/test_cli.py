import json
from pathlib import Path

import frameq_worker.cli as cli
from frameq_worker.asr import Transcript
from frameq_worker.cli import (
    PROGRESS_EVENT_PREFIX,
    render_progress_event,
    render_result_json,
    retry_insights_once,
    run_worker_once,
)
from frameq_worker.media import CommandResult


class FakeMediaRunner:
    def __init__(self) -> None:
        self.commands: list[list[str]] = []

    def __call__(self, command: list[str]) -> CommandResult:
        self.commands.append(command)
        if command[0] == "yt-dlp":
            output_template = Path(command[3])
            (output_template.parent / "demo.mp4").write_bytes(b"fake video")
            return CommandResult(command=command, returncode=0, stdout="", stderr="")

        if command[0] == "ffprobe":
            return CommandResult(
                command=command,
                returncode=0,
                stdout=json.dumps(
                    {
                        "streams": [
                            {
                                "index": 0,
                                "codec_type": "video",
                                "codec_name": "hevc",
                                "width": 1280,
                                "height": 720,
                            },
                            {"index": 1, "codec_type": "audio", "codec_name": "aac"},
                        ],
                        "format": {"duration": "10.0", "size": "2000"},
                    }
                ),
                stderr="",
            )

        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"fake wav")
            return CommandResult(command=command, returncode=0, stdout="", stderr="")

        raise AssertionError(f"Unexpected command: {command}")


class FakeTranscriber:
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        return Transcript(text="这是一段用于桌面联调的文字稿。", language=language)


class FakeInsightClient:
    def generate(self, prompt: str) -> str:
        return '["为什么重试应该只重新生成话题点？"]'


def test_retry_insights_once_regenerates_topics_from_existing_transcript(
    tmp_path: Path,
) -> None:
    transcript_txt = tmp_path / "outputs" / "demo_transcript.txt"
    transcript_md = transcript_txt.with_suffix(".md")
    transcript_txt.parent.mkdir()
    transcript_txt.write_text("已经完成的文字稿。", encoding="utf-8")
    transcript_md.write_text("# 视频文字稿\n\n已经完成的文字稿。", encoding="utf-8")

    result = retry_insights_once(
        json.dumps(
            {
                "transcript_path": transcript_txt.as_posix(),
                "text": "已经完成的文字稿。",
            }
        ),
        insight_client=FakeInsightClient(),
    )

    assert result["status"] == "completed"
    assert result["text"] == "已经完成的文字稿。"
    assert result["transcript_path"] == transcript_txt.as_posix()
    assert result["insights"] == ["为什么重试应该只重新生成话题点？"]
    assert result["insights_path"] == (
        tmp_path / "outputs" / "demo_insights.json"
    ).as_posix()


def test_retry_insights_once_preserves_transcript_when_client_is_missing(
    tmp_path: Path,
) -> None:
    transcript_txt = tmp_path / "outputs" / "demo_transcript.txt"
    transcript_md = transcript_txt.with_suffix(".md")
    transcript_txt.parent.mkdir()
    transcript_txt.write_text("已经完成的文字稿。", encoding="utf-8")
    transcript_md.write_text("# 视频文字稿\n\n已经完成的文字稿。", encoding="utf-8")

    result = retry_insights_once(
        json.dumps(
            {
                "transcript_path": transcript_txt.as_posix(),
                "text": "已经完成的文字稿。",
            }
        ),
        project_root=tmp_path,
    )

    assert result["status"] == "partial_completed"
    assert result["text"] == "已经完成的文字稿。"
    assert result["transcript_path"] == transcript_txt.as_posix()
    assert result["error"] == {
        "code": "INSIGHTFLOW_CONFIG_MISSING",
        "message": "InsightFlow LLM client is not configured.",
        "stage": "insights_generating",
    }


def test_retry_insights_once_builds_client_from_project_dotenv(
    tmp_path: Path,
    monkeypatch,
) -> None:
    captured_env: dict[str, str] = {}
    transcript_txt = tmp_path / "outputs" / "demo_transcript.txt"
    transcript_md = transcript_txt.with_suffix(".md")
    transcript_txt.parent.mkdir()
    transcript_txt.write_text("已经完成的文字稿。", encoding="utf-8")
    transcript_md.write_text("# 视频文字稿\n\n已经完成的文字稿。", encoding="utf-8")
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "FRAMEQ_LLM_PROVIDER=openai_compatible",
                "FRAMEQ_LLM_API_KEY=secret",
                "FRAMEQ_LLM_MODEL=demo-model",
            ]
        ),
        encoding="utf-8",
    )

    def fake_build_insight_client_from_env(env: dict[str, str]) -> FakeInsightClient:
        captured_env.update(env)
        return FakeInsightClient()

    monkeypatch.setattr(
        cli,
        "build_insight_client_from_env",
        fake_build_insight_client_from_env,
    )

    result = retry_insights_once(
        json.dumps(
            {
                "transcript_path": transcript_txt.as_posix(),
                "text": "已经完成的文字稿。",
            }
        ),
        project_root=tmp_path,
    )

    assert result["status"] == "completed"
    assert result["insights"] == ["为什么重试应该只重新生成话题点？"]
    assert captured_env["FRAMEQ_LLM_API_KEY"] == "secret"
    assert captured_env["FRAMEQ_LLM_MODEL"] == "demo-model"


def test_retry_insights_once_reports_missing_markdown_when_dotenv_client_exists(
    tmp_path: Path,
    monkeypatch,
) -> None:
    transcript_txt = tmp_path / "outputs" / "demo_transcript.txt"
    transcript_txt.parent.mkdir()
    transcript_txt.write_text("已经完成的文字稿。", encoding="utf-8")
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "FRAMEQ_LLM_API_KEY=secret",
                "FRAMEQ_LLM_MODEL=demo-model",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        cli,
        "build_insight_client_from_env",
        lambda env: FakeInsightClient(),
    )

    result = retry_insights_once(
        json.dumps(
            {
                "transcript_path": transcript_txt.as_posix(),
                "text": "已经完成的文字稿。",
            }
        ),
        project_root=tmp_path,
    )

    assert result["status"] == "partial_completed"
    assert result["text"] == "已经完成的文字稿。"
    assert result["transcript_path"] == transcript_txt.as_posix()
    assert result["error"] == {
        "code": "TRANSCRIPT_MARKDOWN_NOT_FOUND",
        "message": "Transcript markdown file is required to regenerate insights.",
        "stage": "insights_generating",
    }


def test_run_worker_once_returns_model_not_ready_without_real_asr(
    tmp_path: Path,
) -> None:
    runner = FakeMediaRunner()

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=runner,
    )

    assert result["status"] == "failed"
    assert result["error"] == {
        "code": "ASR_MODEL_NOT_READY",
        "message": "Real ASR is disabled until model cache handling is configured.",
        "stage": "video_transcribing",
    }
    assert result["video_path"] == (tmp_path / "outputs" / "demo.mp4").as_posix()
    assert result["audio_path"] == (tmp_path / "work" / "demo.wav").as_posix()
    assert result["text"] == ""
    assert result["insights"] == []
    assert [command[0] for command in runner.commands] == ["yt-dlp", "ffprobe", "ffmpeg"]


def test_run_worker_once_runs_to_partial_completion_with_injected_transcriber(
    tmp_path: Path,
) -> None:
    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
    )

    assert result["status"] == "partial_completed"
    assert result["text"] == "这是一段用于桌面联调的文字稿。"
    assert result["transcript_path"] == (
        tmp_path / "outputs" / "demo_transcript.txt"
    ).as_posix()
    assert result["error"] == {
        "code": "INSIGHTFLOW_CONFIG_MISSING",
        "message": "InsightFlow LLM client is not configured.",
        "stage": "insights_generating",
    }


def test_run_worker_once_builds_real_asr_with_project_model_cache(
    tmp_path: Path,
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_build_qwen_asr_transcriber(model_name: str, cache_dir: Path) -> FakeTranscriber:
        captured["model_name"] = model_name
        captured["cache_dir"] = cache_dir
        return FakeTranscriber()

    monkeypatch.setattr(
        cli,
        "build_qwen_asr_transcriber",
        fake_build_qwen_asr_transcriber,
    )

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        allow_real_asr=True,
    )

    assert result["status"] == "partial_completed"
    assert captured == {
        "model_name": "Qwen/Qwen3-ASR-0.6B",
        "cache_dir": tmp_path / "models",
    }


def test_run_worker_once_emits_progress_events_for_model_startup(
    tmp_path: Path,
    monkeypatch,
) -> None:
    events: list[dict[str, object]] = []

    monkeypatch.setattr(
        cli,
        "build_qwen_asr_transcriber",
        lambda model_name, cache_dir: FakeTranscriber(),
    )

    run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        allow_real_asr=True,
        progress_callback=events.append,
    )

    assert events == [
        {
            "stage": "video_extracting",
            "message": "正在下载视频并准备媒体文件。",
            "progress": 18,
        },
        {
            "stage": "video_extracting",
            "message": "正在校验视频和音频流。",
            "progress": 34,
        },
        {
            "stage": "video_extracting",
            "message": "正在提取 16 kHz 单声道音频。",
            "progress": 48,
        },
        {
            "stage": "video_transcribing",
            "message": "正在准备 Qwen3-ASR-0.6B 模型缓存。",
            "progress": 58,
        },
        {
            "stage": "video_transcribing",
            "message": "正在加载模型并开始转写。",
            "progress": 68,
        },
        {
            "stage": "insights_generating",
            "message": "正在生成启发话题点。",
            "progress": 88,
        },
    ]


def test_run_worker_once_warns_when_configured_llm_receives_transcript(
    tmp_path: Path,
) -> None:
    events: list[dict[str, object]] = []

    run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
        insight_client=FakeInsightClient(),
        progress_callback=events.append,
    )

    assert events[-1] == {
        "stage": "insights_generating",
        "message": "正在使用配置的 LLM 生成启发话题点，文字稿会发送到该服务。",
        "progress": 88,
    }


def test_run_worker_once_rejects_invalid_json_with_structured_error() -> None:
    result = run_worker_once("{bad json")

    assert result["status"] == "failed"
    assert result["error"] == {
        "code": "INVALID_REQUEST_JSON",
        "message": "Request payload must be valid JSON.",
        "stage": "waiting_input",
    }


def test_run_worker_once_rejects_missing_url_with_structured_error() -> None:
    result = run_worker_once(json.dumps({"language": "Chinese"}))

    assert result["status"] == "failed"
    assert result["error"] == {
        "code": "INVALID_REQUEST_PAYLOAD",
        "message": "Request payload must include a non-empty url.",
        "stage": "waiting_input",
    }


def test_render_result_json_is_ascii_safe_for_subprocess_stdout() -> None:
    raw_json = render_result_json({"status": "completed", "text": "中文文字稿"})

    assert "\\u4e2d\\u6587" in raw_json
    assert json.loads(raw_json)["text"] == "中文文字稿"


def test_render_progress_event_uses_prefixed_json_line() -> None:
    raw_line = render_progress_event(
        {
            "stage": "video_transcribing",
            "message": "正在加载模型并开始转写。",
            "progress": 68,
        }
    )

    assert raw_line.startswith(PROGRESS_EVENT_PREFIX)
    payload = json.loads(raw_line.removeprefix(PROGRESS_EVENT_PREFIX))
    assert payload == {
        "stage": "video_transcribing",
        "message": "正在加载模型并开始转写。",
        "progress": 68,
    }
