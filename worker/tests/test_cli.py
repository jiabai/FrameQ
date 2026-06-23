import json
import os
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


class ExistingMediaRunner:
    def __init__(self) -> None:
        self.commands: list[list[str]] = []

    def __call__(self, command: list[str]) -> CommandResult:
        self.commands.append(command)
        if command[0] == "yt-dlp":
            return CommandResult(command=command, returncode=0, stdout="", stderr="")

        if command[0] == "ffprobe":
            media_path = Path(command[-1])
            if media_path.suffix == ".wav":
                return CommandResult(
                    command=command,
                    returncode=0,
                    stdout=json.dumps(
                        {
                            "streams": [
                                {
                                    "index": 0,
                                    "codec_type": "audio",
                                    "codec_name": "pcm_s16le",
                                }
                            ],
                            "format": {"duration": "10.0", "size": "320000"},
                        }
                    ),
                    stderr="",
                )

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
            raise AssertionError("ffmpeg should not run when existing WAV is valid")

        raise AssertionError(f"Unexpected command: {command}")


class XiaohongshuMediaRunner:
    def __init__(self, downloaded_stem: str) -> None:
        self.commands: list[list[str]] = []
        self.downloaded_stem = downloaded_stem

    def __call__(self, command: list[str]) -> CommandResult:
        self.commands.append(command)
        if command[0] == "yt-dlp":
            output_template = Path(command[3])
            downloaded_video = output_template.parent / f"{self.downloaded_stem}.mp4"
            downloaded_video.write_bytes(b"xhs video")
            os.utime(downloaded_video, (2, 2))
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
                                "codec_name": "h264",
                                "width": 1080,
                                "height": 1920,
                            },
                            {"index": 1, "codec_type": "audio", "codec_name": "aac"},
                        ],
                        "format": {"duration": "12.0", "size": "2400"},
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


def create_valid_legacy_asr_cache(root: Path) -> None:
    sensevoice_dir = root / "iic" / "SenseVoiceSmall"
    vad_dir = root / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch"
    sensevoice_dir.mkdir(parents=True)
    vad_dir.mkdir(parents=True)
    (sensevoice_dir / "model.pt").write_bytes(b"sensevoice")
    (vad_dir / "model.pt").write_bytes(b"vad")
    (root / "MODEL_VERSION.txt").write_text(
        "model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n",
        encoding="utf-8",
    )


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


def test_retry_insights_once_updates_existing_partial_history_item(
    tmp_path: Path,
) -> None:
    output_dir = tmp_path / "outputs"
    work_dir = tmp_path / "work"
    transcript_txt = output_dir / "demo_transcript.txt"
    transcript_md = transcript_txt.with_suffix(".md")
    history_path = work_dir / "history.json"
    output_dir.mkdir()
    work_dir.mkdir()
    transcript_txt.write_text("ready transcript", encoding="utf-8")
    transcript_md.write_text("# Transcript\n\nready transcript", encoding="utf-8")
    history_path.write_text(
        json.dumps(
            {
                "items": [
                    {
                        "id": "history-1",
                        "created_at": "2026-06-21T16:13:24Z",
                        "url": "https://www.douyin.com/video/7524373044106677544",
                        "status": "partial_completed",
                        "output_dir": output_dir.as_posix(),
                        "video_path": (output_dir / "demo.mp4").as_posix(),
                        "audio_path": (work_dir / "demo.wav").as_posix(),
                        "transcript_path": transcript_txt.as_posix(),
                        "insights_path": None,
                        "error": {
                            "code": "INSIGHTFLOW_LLM_REQUEST_FAILED",
                            "message": "LLM request failed.",
                            "stage": "insights_generating",
                        },
                        "text_preview": "ready transcript",
                        "insights_count": 0,
                    }
                ]
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    result = retry_insights_once(
        json.dumps(
            {
                "transcript_path": transcript_txt.as_posix(),
                "text": "ready transcript",
            }
        ),
        project_root=tmp_path,
        insight_client=FakeInsightClient(),
    )

    assert result["status"] == "completed"
    saved_history = json.loads(history_path.read_text(encoding="utf-8"))
    saved_item = saved_history["items"][0]
    assert saved_item["id"] == "history-1"
    assert saved_item["status"] == "completed"
    assert saved_item["transcript_path"] == transcript_txt.as_posix()
    assert saved_item["insights_path"] == (output_dir / "demo_insights.json").as_posix()
    assert saved_item["error"] is None
    assert saved_item["insights_count"] == 1


def test_retry_insights_once_updates_transcript_only_history_item(
    tmp_path: Path,
) -> None:
    output_dir = tmp_path / "outputs"
    work_dir = tmp_path / "work"
    transcript_txt = output_dir / "demo_transcript.txt"
    transcript_md = transcript_txt.with_suffix(".md")
    history_path = work_dir / "history.json"
    output_dir.mkdir()
    work_dir.mkdir()
    transcript_txt.write_text("ready transcript", encoding="utf-8")
    transcript_md.write_text("# Transcript\n\nready transcript", encoding="utf-8")
    history_path.write_text(
        json.dumps(
            {
                "items": [
                    {
                        "id": "history-1",
                        "created_at": "2026-06-22T14:44:29Z",
                        "url": "https://v.douyin.com/LllWTdm3-Dg/",
                        "status": "completed",
                        "output_dir": output_dir.as_posix(),
                        "video_path": (output_dir / "demo.mp4").as_posix(),
                        "audio_path": (work_dir / "demo.wav").as_posix(),
                        "transcript_path": transcript_txt.as_posix(),
                        "insights_path": None,
                        "error": {
                            "code": "INSIGHTFLOW_LLM_REQUEST_TIMEOUT",
                            "message": "LLM request timed out.",
                            "stage": "insights_generating",
                        },
                        "text_preview": "ready transcript",
                        "insights_count": 0,
                    }
                ]
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    result = retry_insights_once(
        json.dumps(
            {
                "transcript_path": transcript_txt.as_posix(),
                "text": "ready transcript",
            }
        ),
        project_root=tmp_path,
        insight_client=FakeInsightClient(),
    )

    assert result["status"] == "completed"
    saved_history = json.loads(history_path.read_text(encoding="utf-8"))
    saved_item = saved_history["items"][0]
    assert saved_item["id"] == "history-1"
    assert saved_item["status"] == "completed"
    assert saved_item["transcript_path"] == transcript_txt.as_posix()
    assert saved_item["insights_path"] == (output_dir / "demo_insights.json").as_posix()
    assert saved_item["error"] is None
    assert saved_item["insights_count"] == 1


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


def test_retry_insights_once_ignores_project_dotenv_llm_config(
    tmp_path: Path,
    monkeypatch,
) -> None:
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

    def fake_build_insight_client_from_env(env: dict[str, str]) -> FakeInsightClient | None:
        assert "FRAMEQ_LLM_PROVIDER" not in env
        assert "FRAMEQ_LLM_API_KEY" not in env
        assert "FRAMEQ_LLM_MODEL" not in env
        return None

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

    assert result["status"] == "partial_completed"
    assert result["transcript_path"] == transcript_txt.as_posix()
    assert result["error"] == {
        "code": "INSIGHTFLOW_CONFIG_MISSING",
        "message": "InsightFlow LLM client is not configured.",
        "stage": "insights_generating",
    }


def test_retry_insights_once_reports_missing_markdown_when_process_env_client_exists(
    tmp_path: Path,
    monkeypatch,
) -> None:
    transcript_txt = tmp_path / "outputs" / "demo_transcript.txt"
    transcript_txt.parent.mkdir()
    transcript_txt.write_text("已经完成的文字稿。", encoding="utf-8")

    def fake_build_insight_client_from_env(env: dict[str, str]) -> FakeInsightClient:
        assert env["FRAMEQ_LLM_API_KEY"] == "secret"
        assert env["FRAMEQ_LLM_MODEL"] == "demo-model"
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
        environ={
            "FRAMEQ_LLM_API_KEY": "secret",
            "FRAMEQ_LLM_MODEL": "demo-model",
        },
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


def test_run_worker_once_selects_video_by_url_id_and_reuses_valid_audio(
    tmp_path: Path,
) -> None:
    video_id = "7524373044106677544"
    output_dir = tmp_path / "outputs"
    work_dir = tmp_path / "work"
    output_dir.mkdir()
    work_dir.mkdir()
    matching_video = output_dir / f"{video_id}.mp4"
    newer_unrelated_video = output_dir / "9999999999999999999.mp4"
    existing_audio = work_dir / f"{video_id}.wav"
    matching_video.write_bytes(b"matching video")
    newer_unrelated_video.write_bytes(b"newer unrelated video")
    existing_audio.write_bytes(b"existing wav")
    os.utime(matching_video, (1, 1))
    os.utime(newer_unrelated_video, (2, 2))

    runner = ExistingMediaRunner()
    events: list[dict[str, object]] = []

    result = run_worker_once(
        json.dumps(
            {
                "url": f"https://www.douyin.com/video/{video_id}",
                "generate_insights": False,
            }
        ),
        project_root=tmp_path,
        command_runner=runner,
        transcriber=FakeTranscriber(),
        progress_callback=events.append,
    )

    assert result["status"] == "completed"
    assert result["video_path"] == matching_video.as_posix()
    assert result["audio_path"] == existing_audio.as_posix()
    assert [command[0] for command in runner.commands] == ["yt-dlp", "ffprobe", "ffprobe"]
    assert all(command[0] != "ffmpeg" for command in runner.commands)
    assert {
        "stage": "video_extracting",
        "message": "已复用本地音频，跳过音频提取。",
        "progress": 50,
    } in events


def test_run_worker_once_selects_xiaohongshu_downloaded_video_over_existing_newer_file(
    tmp_path: Path,
) -> None:
    downloaded_stem = "6a35face0000000008033914"
    output_dir = tmp_path / "outputs"
    output_dir.mkdir()
    stale_video = output_dir / "old-unrelated.mp4"
    stale_video.write_bytes(b"old video")
    os.utime(stale_video, (10, 10))
    runner = XiaohongshuMediaRunner(downloaded_stem)

    result = run_worker_once(
        json.dumps(
            {
                "url": "http://xhslink.com/o/jQzXcxNapU",
                "generate_insights": False,
            }
        ),
        project_root=tmp_path,
        command_runner=runner,
        transcriber=FakeTranscriber(),
    )

    downloaded_video = output_dir / f"{downloaded_stem}.mp4"
    assert result["status"] == "completed"
    assert result["video_path"] == downloaded_video.as_posix()
    assert result["audio_path"] == (tmp_path / "work" / f"{downloaded_stem}.wav").as_posix()
    assert runner.commands[0][-1] == "http://xhslink.com/o/jQzXcxNapU"


def test_run_worker_once_uses_configured_output_dir_for_user_artifacts(
    tmp_path: Path,
) -> None:
    custom_output_dir = tmp_path / "custom-results"
    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
        environ={"FRAMEQ_OUTPUT_DIR": custom_output_dir.as_posix()},
    )

    assert result["status"] == "partial_completed"
    assert result["video_path"] == (custom_output_dir / "demo.mp4").as_posix()
    assert result["audio_path"] == (tmp_path / "work" / "demo.wav").as_posix()
    assert result["transcript_path"] == (
        custom_output_dir / "demo_transcript.txt"
    ).as_posix()
    assert (custom_output_dir / "demo_transcript.md").is_file()


def test_run_worker_once_uses_configured_work_dir_for_audio_and_history(
    tmp_path: Path,
) -> None:
    custom_work_dir = tmp_path / "app-data" / "work"
    custom_output_dir = tmp_path / "app-data" / "outputs"

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
        insight_client=FakeInsightClient(),
        environ={
            "FRAMEQ_OUTPUT_DIR": custom_output_dir.as_posix(),
            "FRAMEQ_WORK_DIR": custom_work_dir.as_posix(),
        },
    )

    assert result["status"] == "completed"
    assert result["audio_path"] == (custom_work_dir / "demo.wav").as_posix()
    assert (custom_work_dir / "history.json").is_file()
    assert not (tmp_path / "work" / "history.json").exists()


def test_run_worker_once_records_history_with_actual_result_paths(
    tmp_path: Path,
) -> None:
    custom_output_dir = tmp_path / "custom-results"

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
        insight_client=FakeInsightClient(),
        environ={"FRAMEQ_OUTPUT_DIR": custom_output_dir.as_posix()},
    )

    history_path = tmp_path / "work" / "history.json"
    history = json.loads(history_path.read_text(encoding="utf-8"))

    assert result["status"] == "completed"
    assert len(history["items"]) == 1
    item = history["items"][0]
    assert item["url"] == "https://www.douyin.com/video/7524373044106677544"
    assert item["status"] == "completed"
    assert item["output_dir"] == custom_output_dir.as_posix()
    assert item["video_path"] == (custom_output_dir / "demo.mp4").as_posix()
    assert item["audio_path"] == (tmp_path / "work" / "demo.wav").as_posix()
    assert item["transcript_path"] == (
        custom_output_dir / "demo_transcript.txt"
    ).as_posix()
    assert item["insights_path"] == (custom_output_dir / "demo_insights.json").as_posix()
    assert item["error"] is None
    assert item["text_preview"] == "这是一段用于桌面联调的文字稿。"
    assert item["insights_count"] == 1
    assert item["created_at"].endswith("Z")
    assert item["id"]


def test_run_worker_once_builds_real_asr_with_project_model_cache(
    tmp_path: Path,
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}
    create_valid_asr_cache(tmp_path / "models")

    def fake_build_asr_transcriber(model_name: str, cache_dir: Path) -> FakeTranscriber:
        captured["model_name"] = model_name
        captured["cache_dir"] = cache_dir
        return FakeTranscriber()

    monkeypatch.setattr(
        cli,
        "build_asr_transcriber",
        fake_build_asr_transcriber,
    )

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        allow_real_asr=True,
    )

    assert result["status"] == "partial_completed"
    assert captured == {
        "model_name": "iic/SenseVoiceSmall",
        "cache_dir": tmp_path / "models",
    }


def test_run_worker_once_normalizes_legacy_asr_cache_before_model_load(
    tmp_path: Path,
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}
    model_root = tmp_path / "models"
    create_valid_legacy_asr_cache(model_root)

    def fake_build_asr_transcriber(model_name: str, cache_dir: Path) -> FakeTranscriber:
        captured["model_name"] = model_name
        captured["cache_dir"] = cache_dir
        return FakeTranscriber()

    monkeypatch.setattr(
        cli,
        "build_asr_transcriber",
        fake_build_asr_transcriber,
    )

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        allow_real_asr=True,
    )

    assert result["status"] == "partial_completed"
    assert captured == {
        "model_name": "iic/SenseVoiceSmall",
        "cache_dir": model_root,
    }
    assert (model_root / "models" / "iic" / "SenseVoiceSmall" / "model.pt").is_file()
    assert (
        model_root / "models" / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch" / "model.pt"
    ).is_file()
    assert not (model_root / "iic" / "SenseVoiceSmall").exists()
    assert not (model_root / "iic" / "speech_fsmn_vad_zh-cn-16k-common-pytorch").exists()


def test_run_worker_once_reports_missing_downloaded_asr_model_after_audio_extraction(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def fail_build_asr_transcriber(model_name: str, cache_dir: Path) -> FakeTranscriber:
        raise AssertionError("ASR model should be validated before loading")

    monkeypatch.setattr(
        cli,
        "build_asr_transcriber",
        fail_build_asr_transcriber,
    )

    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"}),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        allow_real_asr=True,
    )

    assert result["status"] == "failed"
    assert result["video_path"] == (tmp_path / "outputs" / "demo.mp4").as_posix()
    assert result["audio_path"] == (tmp_path / "work" / "demo.wav").as_posix()
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

    monkeypatch.setattr(
        cli,
        "build_asr_transcriber",
        fake_build_asr_transcriber,
    )

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

    transcript_md = tmp_path / "outputs" / "demo_transcript.md"

    assert result["status"] == "partial_completed"
    assert captured == {
        "model_name": "iic/SenseVoiceSmall",
        "cache_dir": tmp_path / "models",
    }
    assert "- Model: iic/SenseVoiceSmall" in transcript_md.read_text(encoding="utf-8")


def test_run_worker_once_emits_progress_events_for_model_startup(
    tmp_path: Path,
    monkeypatch,
) -> None:
    events: list[dict[str, object]] = []
    create_valid_asr_cache(tmp_path / "models")

    monkeypatch.setattr(
        cli,
        "build_asr_transcriber",
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
            "message": "正在准备 SenseVoice Small 模型缓存。",
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
