import json
from pathlib import Path

from frameq_worker.asr import Transcript
from frameq_worker.cli import render_result_json, run_worker_once
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
