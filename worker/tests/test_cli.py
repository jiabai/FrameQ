import json
from pathlib import Path

import frameq_worker.cli as cli
import frameq_worker.pipeline as pipeline
import pytest
from frameq_worker.asr import Transcript
from frameq_worker.cli import (
    PROGRESS_EVENT_PREFIX,
    render_progress_event,
    render_result_json,
    run_worker_once,
)
from frameq_worker.media import CommandResult


def is_ytdlp_command(command: list[str]) -> bool:
    return len(command) >= 3 and command[1:3] == ["-m", "yt_dlp"]


def command_name(command: list[str]) -> str:
    return "yt-dlp" if is_ytdlp_command(command) else command[0]


def ytdlp_output_template(command: list[str]) -> Path:
    return Path(command[command.index("-o") + 1])


class FakeMediaRunner:
    def __init__(self) -> None:
        self.commands: list[list[str]] = []

    def __call__(self, command: list[str]) -> CommandResult:
        self.commands.append(command)
        if is_ytdlp_command(command):
            output_template = ytdlp_output_template(command)
            output_template.parent.mkdir(parents=True, exist_ok=True)
            (output_template.parent / "demo.mp4").write_bytes(b"fake video")
            return CommandResult(command=command, returncode=0, stdout="", stderr="")

        if command[0] == "ffprobe":
            media_path = Path(command[-1])
            if media_path.suffix == ".wav":
                streams = [{"index": 0, "codec_type": "audio", "codec_name": "pcm_s16le"}]
                format_payload = {"duration": "10.0", "size": "320000"}
            else:
                streams = [
                    {
                        "index": 0,
                        "codec_type": "video",
                        "codec_name": "h264",
                        "width": 1280,
                        "height": 720,
                    },
                    {"index": 1, "codec_type": "audio", "codec_name": "aac"},
                ]
                format_payload = {"duration": "10.0", "size": "2000"}
            return CommandResult(
                command=command,
                returncode=0,
                stdout=json.dumps({"streams": streams, "format": format_payload}),
                stderr="",
            )

        if command[0] == "ffmpeg":
            audio_path = Path(command[-1])
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"fake wav")
            return CommandResult(command=command, returncode=0, stdout="", stderr="")

        raise AssertionError(f"Unexpected command: {command}")


class FakeTranscriber:
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        return Transcript(text="desktop transcript", language=language)


class FakeInsightClient:
    def __init__(self) -> None:
        self.calls = 0

    def generate(self, prompt: str) -> str:
        self.calls += 1
        if self.calls == 1:
            return "mindmap\n  root((desktop))"
        if self.calls == 2:
            return "# summary\n\ndesktop summary"
        if self.calls == 3:
            return (
                '[{"title":"desktop","summary":"summary","excerpt":"excerpt",'
                '"question_count":1}]'
            )
        return '["desktop question"]'


def create_valid_asr_cache(root: Path) -> None:
    sensevoice_dir = root / "models" / "iic" / "SenseVoiceSmall"
    vad_dir = root / "models" / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
    sensevoice_dir.mkdir(parents=True)
    vad_dir.mkdir(parents=True)
    (sensevoice_dir / "model.pt").write_bytes(b"sensevoice")
    (vad_dir / "model.pt").write_bytes(b"vad")
    (root / "MODEL_VERSION.txt").write_text(
        "model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n",
        encoding="utf-8",
    )


def task_dir_from_result(result: dict[str, object]) -> Path:
    return Path(str(result["task_dir"]))


def manifest_from_result(result: dict[str, object]) -> dict[str, object]:
    manifest_path = task_dir_from_result(result) / "frameq-task.json"
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def test_main_returns_zero_for_structured_worker_failures(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        cli,
        "run_worker_once",
        lambda *args, **kwargs: {
            "status": "failed",
            "error": {
                "code": "ASR_MODEL_NOT_DOWNLOADED",
                "message": "SenseVoice Small model is not downloaded yet.",
                "stage": "video_transcribing",
            },
        },
    )

    exit_code = cli.main(["--request-json", "{}"])

    assert exit_code == 0
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "failed"
    assert output["error"]["code"] == "ASR_MODEL_NOT_DOWNLOADED"


def test_main_returns_nonzero_for_failed_model_download(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        cli,
        "run_asr_model_download_once",
        lambda *args, **kwargs: {
            "status": "failed",
            "code": "ASR_MODEL_DOWNLOAD_FAILED",
            "message": "download failed",
        },
    )

    exit_code = cli.main(["--download-asr-model"])

    assert exit_code == 1
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "failed"
    assert output["code"] == "ASR_MODEL_DOWNLOAD_FAILED"


def test_render_helpers_emit_json_and_progress_prefix() -> None:
    assert json.loads(render_result_json({"status": "completed"})) == {"status": "completed"}
    assert render_progress_event({"stage": "video_extracting"}).startswith(PROGRESS_EVENT_PREFIX)


def test_run_worker_once_returns_model_not_ready_with_task_manifest(tmp_path: Path) -> None:
    runner = FakeMediaRunner()

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=runner,
    )

    assert result["status"] == "failed"
    assert result["artifacts"] == {
        "video": "media/video.mp4",
        "audio": "media/audio.wav",
    }
    assert result["error"] == {
        "code": "ASR_MODEL_NOT_READY",
        "message": "Real ASR is disabled until model cache handling is configured.",
        "stage": "video_transcribing",
    }
    assert (task_dir_from_result(result) / "media" / "video.mp4").is_file()
    assert (task_dir_from_result(result) / "media" / "audio.wav").is_file()
    assert manifest_from_result(result)["status"] == "failed"
    assert [command_name(command) for command in runner.commands] == ["yt-dlp", "ffprobe", "ffmpeg"]


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
    assert result["text"] == "desktop transcript"
    assert result["artifacts"] == {
        "video": "media/video.mp4",
        "audio": "media/audio.wav",
        "transcript_txt": "transcript/transcript.txt",
        "transcript_md": "transcript/transcript.md",
    }
    transcript = (
        (task_dir_from_result(result) / "transcript" / "transcript.txt")
        .read_text(encoding="utf-8")
        .strip()
    )
    assert transcript == "desktop transcript"
    assert not (tmp_path / "cache" / "history.json").exists()


def test_run_worker_once_generates_ai_artifacts_in_same_task(tmp_path: Path) -> None:
    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
        insight_client=FakeInsightClient(),
    )

    assert result["status"] == "completed"
    assert result["summary"].startswith("#")
    assert result["insights"] == ["desktop question"]
    assert result["artifacts"]["summary"] == "ai/summary.md"
    assert result["artifacts"]["mindmap"] == "ai/mindmap.mmd"
    assert result["artifacts"]["insights"] == "ai/insights.json"
    assert (task_dir_from_result(result) / "ai" / "summary.md").is_file()
    assert manifest_from_result(result)["insights_count"] == 1


def test_run_worker_once_uses_configured_output_and_cache_roots(tmp_path: Path) -> None:
    custom_cache_dir = tmp_path / "app-data" / "cache"
    custom_output_dir = tmp_path / "app-data" / "outputs"

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
        insight_client=FakeInsightClient(),
        environ={
            "FRAMEQ_OUTPUT_DIR": custom_output_dir.as_posix(),
            "FRAMEQ_CACHE_DIR": custom_cache_dir.as_posix(),
        },
    )

    assert result["status"] == "completed"
    assert task_dir_from_result(result).parent == custom_output_dir / "tasks"
    assert (custom_cache_dir / "tasks" / str(result["task_id"]) / "download").is_dir()
    assert not (custom_cache_dir / "history.json").exists()


def test_run_worker_once_uses_download_stdout_inside_task_cache_dir(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_download_video(
        url: str,
        output_dir: Path,
        runner: object,
        progress_callback: object | None = None,
    ) -> CommandResult:
        downloaded_video = output_dir / "stdout-video.mp4"
        downloaded_video.parent.mkdir(parents=True, exist_ok=True)
        downloaded_video.write_bytes(b"stdout video")
        return CommandResult(
            command=["fake-download", url],
            returncode=0,
            stdout=downloaded_video.as_posix(),
            stderr="",
        )

    monkeypatch.setattr(pipeline, "download_video", fake_download_video)
    runner = FakeMediaRunner()

    result = run_worker_once(
        json.dumps(
            {
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "generate_insights": False,
            }
        ),
        project_root=tmp_path,
        command_runner=runner,
        transcriber=FakeTranscriber(),
    )

    assert result["status"] == "completed"
    assert (task_dir_from_result(result) / "media" / "video.mp4").is_file()
    assert [command_name(command) for command in runner.commands] == ["ffprobe", "ffmpeg"]


def test_run_worker_once_reports_missing_downloaded_asr_model_after_audio_extraction(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_build_asr_transcriber(model_name: str, cache_dir: Path) -> FakeTranscriber:
        raise AssertionError("ASR model should be validated before loading")

    monkeypatch.setattr(cli, "build_asr_transcriber", fail_build_asr_transcriber)

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        allow_real_asr=True,
    )

    assert result["status"] == "failed"
    assert result["artifacts"] == {
        "video": "media/video.mp4",
        "audio": "media/audio.wav",
    }
    assert result["error"] == {
        "code": "ASR_MODEL_NOT_DOWNLOADED",
        "message": "SenseVoice Small model is not downloaded yet.",
        "stage": "video_transcribing",
    }


def test_run_worker_once_uses_configured_asr_model_from_user_data_env(
    tmp_path: Path,
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}
    user_data_dir = tmp_path / "user-data"
    user_data_dir.mkdir()
    create_valid_asr_cache(tmp_path / "models")
    (user_data_dir / ".env").write_text(
        "FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall\n",
        encoding="utf-8",
    )

    def fake_build_asr_transcriber(model_name: str, cache_dir: Path) -> FakeTranscriber:
        captured["model_name"] = model_name
        captured["cache_dir"] = cache_dir
        return FakeTranscriber()

    monkeypatch.setattr(cli, "build_asr_transcriber", fake_build_asr_transcriber)

    result = run_worker_once(
        json.dumps(
            {
                "url": "https://www.douyin.com/video/7524373044106677544",
                "model": "Qwen/Qwen3-ASR-0.6B",
            }
        ),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        allow_real_asr=True,
        environ={"FRAMEQ_USER_DATA_DIR": user_data_dir.as_posix()},
    )

    transcript_md = task_dir_from_result(result) / "transcript" / "transcript.md"

    assert result["status"] == "partial_completed"
    assert captured == {
        "model_name": "iic/SenseVoiceSmall",
        "cache_dir": tmp_path / "models",
    }
    assert "- Model: iic/SenseVoiceSmall" in transcript_md.read_text(encoding="utf-8")
