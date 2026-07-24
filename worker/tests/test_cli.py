import inspect
import io
import json
from pathlib import Path
from types import SimpleNamespace

import frameq_worker.cli as cli
import frameq_worker.media_preparation as media_preparation
import frameq_worker.pipeline as pipeline
import pytest
from frameq_worker import platform_source_resolvers as platform_resolvers_module
from frameq_worker.asr import Transcript
from frameq_worker.cli import (
    MODEL_DOWNLOAD_EVENT_PREFIX,
    PROGRESS_EVENT_PREFIX,
    render_model_download_event,
    render_progress_event,
    render_result_json,
    resolve_source_identity_once,
    run_local_media_once,
    run_worker_once,
)
from frameq_worker.desktop_contract import (
    LOCAL_MEDIA_CONTRACT_VERSION,
    PROCESS_VIDEO_CONTRACT_VERSION,
)
from frameq_worker.media import CommandResult
from frameq_worker.worker_application import defaults as worker_defaults

DEFAULT_ASR_MODEL = "iic/SenseVoiceSmall"


def process_request_json(
    url: str,
    *,
    asr_model: str = DEFAULT_ASR_MODEL,
) -> str:
    return json.dumps(
        {
            "contract_version": PROCESS_VIDEO_CONTRACT_VERSION,
            "url": url,
            "asr_model": asr_model,
        }
    )


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
                streams[0].update(
                    {
                        "sample_fmt": "s16",
                        "sample_rate": "16000",
                        "channels": 1,
                    }
                )
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

    monkeypatch.setattr(cli.sys, "stdin", io.StringIO("{}"))
    exit_code = cli.main(["--request-stdin"])

    assert exit_code == 0
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "failed"
    assert output["error"]["code"] == "ASR_MODEL_NOT_DOWNLOADED"


def test_main_reads_process_request_from_stdin(monkeypatch, capsys) -> None:
    payload = process_request_json(
        "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
        "?xsec_token=review-secret"
    )
    captured: dict[str, object] = {}

    def fake_run_worker_once(
        request_json: str,
        **kwargs: object,
    ) -> dict[str, object]:
        captured["request_json"] = request_json
        captured.update(kwargs)
        return {"status": "completed"}

    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(payload))
    monkeypatch.setattr(cli, "run_worker_once", fake_run_worker_once)

    exit_code = cli.main(["--request-stdin"])

    assert exit_code == 0
    assert json.loads(captured["request_json"])["url"].endswith(
        "?xsec_token=review-secret"
    )
    assert captured["project_root"] == Path.cwd()
    assert captured["progress_callback"] is cli.print_progress_event
    assert "review-secret" not in capsys.readouterr().err


def test_main_reads_local_media_request_from_dedicated_stdin_mode(
    monkeypatch,
    capsys,
) -> None:
    payload = json.dumps(
        {
            "contract_version": LOCAL_MEDIA_CONTRACT_VERSION,
            "source_path": "C:/Users/review-secret/Podcast.mp3",
            "media_kind": "audio",
            "safe_display_name": "Podcast.mp3",
            "source_extension": "mp3",
            "asr_model": DEFAULT_ASR_MODEL,
        }
    )
    captured: dict[str, object] = {}

    def fake_run_local_media_once(
        request_json: str,
        **kwargs: object,
    ) -> dict[str, object]:
        captured["request_json"] = request_json
        captured.update(kwargs)
        return {"status": "completed"}

    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(payload))
    monkeypatch.setattr(cli, "run_local_media_once", fake_run_local_media_once)

    exit_code = cli.main(["--process-local-media-stdin"])

    assert exit_code == 0
    assert json.loads(captured["request_json"])["media_kind"] == "audio"
    assert captured["project_root"] == Path.cwd()
    assert captured["progress_callback"] is cli.print_progress_event
    captured_output = capsys.readouterr()
    assert "review-secret" not in captured_output.out + captured_output.err


def test_run_local_media_once_processes_audio_without_url_resolution_or_path_echo(
    tmp_path: Path,
) -> None:
    private_root = tmp_path / "review-secret"
    private_root.mkdir()
    source_path = private_root / "Podcast.mp3"
    source_path.write_bytes(b"local audio")
    runner = FakeMediaRunner()

    result = run_local_media_once(
        json.dumps(
            {
                "contract_version": LOCAL_MEDIA_CONTRACT_VERSION,
                "source_path": str(source_path),
                "media_kind": "audio",
                "safe_display_name": "Podcast.mp3",
                "source_extension": "mp3",
                "asr_model": DEFAULT_ASR_MODEL,
            }
        ),
        project_root=tmp_path,
        command_runner=runner,
        transcriber=FakeTranscriber(),
        allow_real_asr=False,
        environ={},
    )
    task_dir = task_dir_from_result(result)
    manifest = manifest_from_result(result)
    serialized = json.dumps(result) + json.dumps(manifest)

    assert result["status"] == "completed"
    assert result["artifacts"] == {
        "audio": "media/audio.wav",
        "transcript_txt": "transcript/transcript.txt",
        "transcript_md": "transcript/transcript.md",
    }
    assert not list((task_dir / "media").glob("video.*"))
    assert manifest["source_kind"] == "local_file"
    assert all(not is_ytdlp_command(command) for command in runner.commands)
    assert all(
        "review-secret" not in argument and "Podcast.mp3" not in argument
        for command in runner.commands
        for argument in command
    )
    assert "review-secret" not in serialized


@pytest.mark.parametrize(
    "request_json",
    [
        '{"source_path":"C:/Users/review-secret/Podcast.mp3"',
        json.dumps(
            {
                "contract_version": LOCAL_MEDIA_CONTRACT_VERSION,
                "source_path": "C:/Users/review-secret/Podcast.mp3",
                "media_kind": "video",
                "safe_display_name": "Podcast.mp3",
                "source_extension": "mp3",
                "asr_model": DEFAULT_ASR_MODEL,
            }
        ),
    ],
)
def test_run_local_media_once_rejects_invalid_payload_without_path_echo(
    request_json: str,
) -> None:
    result = run_local_media_once(request_json)

    assert result["status"] == "failed"
    assert result["error"] == {
        "code": "LOCAL_MEDIA_VALIDATION_FAILED",
        "message": "Local media request payload was invalid.",
        "stage": "waiting_input",
    }
    assert "review-secret" not in json.dumps(result)


def test_main_rejects_invalid_stdin_without_echoing_payload(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        cli.sys,
        "stdin",
        io.StringIO('{"url":"https://example.test/?xsec_token=review-secret"'),
    )

    exit_code = cli.main(["--request-stdin"])

    assert exit_code == 1
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "WORKER_STDIN_INVALID"
    assert "review-secret" not in captured.out + captured.err
    assert "xsec_token" not in captured.out + captured.err


def test_source_identity_stdin_failure_uses_closed_source_result_without_echo(
    monkeypatch,
    capsys,
) -> None:
    monkeypatch.setattr(
        cli.sys,
        "stdin",
        io.StringIO(
            '{"url":"https://example.test/?xsec_token=review-secret"'
        ),
    )

    exit_code = cli.main(["--resolve-source-stdin"])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert json.loads(captured.out) == {
        "status": "failed",
        "error": {"code": "WORKER_STDIN_INVALID"},
    }
    assert "review-secret" not in captured.out + captured.err
    assert "xsec_token" not in captured.out + captured.err


def test_main_resolves_source_identity_from_stdin_without_echoing_secret(
    monkeypatch,
    capsys,
) -> None:
    monkeypatch.setattr(
        cli.sys,
        "stdin",
        io.StringIO(
            json.dumps(
                {
                    "url": (
                        "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
                        "?xsec_token=review-secret#comments"
                    )
                }
            )
        ),
    )

    exit_code = cli.main(["--resolve-source-stdin"])

    assert exit_code == 0
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["status"] == "completed"
    assert result["source_identity"]["canonical_url"].endswith(
        "/64a1b2c3d4e5f67890123456"
    )
    assert "review-secret" not in captured.out + captured.err
    assert "xsec_token" not in captured.out + captured.err


def test_main_dispatches_normalized_source_identity_request(
    monkeypatch,
    capsys,
) -> None:
    captured: dict[str, object] = {}

    def fake_resolve_source_identity_once(
        request_json: str,
    ) -> dict[str, object]:
        captured["request_json"] = request_json
        return {"status": "completed"}

    monkeypatch.setattr(
        cli.sys,
        "stdin",
        io.StringIO('{\n  "url": "https://example.test/video"\n}'),
    )
    monkeypatch.setattr(
        cli,
        "resolve_source_identity_once",
        fake_resolve_source_identity_once,
    )

    exit_code = cli.main(["--resolve-source-stdin"])

    assert exit_code == 0
    assert captured["request_json"] == (
        '{"url": "https://example.test/video"}'
    )
    assert json.loads(capsys.readouterr().out) == {"status": "completed"}


def test_main_reads_retry_request_from_stdin(monkeypatch, capsys) -> None:
    payload = json.dumps(
        {
            "task_id": "safe-task",
            "target": "summary",
            "output_language": "en-US",
        }
    )
    captured: dict[str, object] = {}

    def fake_retry_insights_once(
        request_json: str,
        **kwargs: object,
    ) -> dict[str, object]:
        captured["request_json"] = request_json
        captured.update(kwargs)
        return {"status": "completed"}

    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(payload))
    monkeypatch.setattr(cli, "retry_insights_once", fake_retry_insights_once)

    exit_code = cli.main(["--retry-insights-stdin"])

    assert exit_code == 0
    assert json.loads(captured["request_json"]) == {
        "task_id": "safe-task",
        "target": "summary",
        "output_language": "en-US",
    }
    assert captured["project_root"] == Path.cwd()
    assert "safe-task" not in capsys.readouterr().err


def test_main_rejects_oversized_stdin_without_echoing_secret(monkeypatch, capsys) -> None:
    oversized = json.dumps(
        {
            "url": "https://example.test/?xsec_token=review-secret",
            "padding": "x" * cli.MAX_STDIN_REQUEST_BYTES,
        }
    )
    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(oversized))

    exit_code = cli.main(["--request-stdin"])

    assert exit_code == 1
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["error"]["code"] == "WORKER_STDIN_INVALID"
    assert "review-secret" not in captured.out + captured.err
    assert "xsec_token" not in captured.out + captured.err


def test_main_returns_nonzero_for_failed_model_download(monkeypatch, capsys) -> None:
    captured: dict[str, object] = {}

    def fake_run_asr_model_download_once(
        **kwargs: object,
    ) -> dict[str, object]:
        captured.update(kwargs)
        return {
            "status": "failed",
            "code": "ASR_MODEL_DOWNLOAD_FAILED",
            "message": "download failed",
        }

    monkeypatch.setattr(
        cli,
        "run_asr_model_download_once",
        fake_run_asr_model_download_once,
    )

    exit_code = cli.main(["--download-asr-model"])

    assert exit_code == 1
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "failed"
    assert output["code"] == "ASR_MODEL_DOWNLOAD_FAILED"
    assert captured["project_root"] == Path.cwd()
    assert captured["progress_callback"] is cli.print_model_download_event


def test_render_helpers_emit_json_and_progress_prefix() -> None:
    assert json.loads(render_result_json({"status": "completed"})) == {"status": "completed"}
    rendered = render_progress_event(
        {
            "stage": "video_extracting",
            "progress": 18,
            "message_code": "video.download.preparing",
        }
    )

    assert rendered.startswith(PROGRESS_EVENT_PREFIX)
    assert json.loads(rendered.removeprefix(PROGRESS_EVENT_PREFIX)) == {
        "stage": "video_extracting",
        "progress": 18,
        "message_code": "video.download.preparing",
    }

    model_rendered = render_model_download_event(
        {
            "status": "started",
            "progress": 0,
            "message_code": "model.download.preparing",
            "message_args": {"model": "iic/SenseVoiceSmall"},
        }
    )
    assert model_rendered.startswith(MODEL_DOWNLOAD_EVENT_PREFIX)
    assert json.loads(model_rendered.removeprefix(MODEL_DOWNLOAD_EVENT_PREFIX)) == {
        "status": "started",
        "progress": 0,
        "message_code": "model.download.preparing",
        "message_args": {"model": "iic/SenseVoiceSmall"},
    }


def test_source_identity_preflight_returns_only_safe_identity() -> None:
    result = resolve_source_identity_once(
        json.dumps(
            {
                "url": (
                    "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
                    "?xsec_token=review-secret&source=web#comments"
                )
            }
        )
    )

    assert result["status"] == "completed"
    assert result["source_url"] == (
        "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
    )
    serialized = json.dumps(result)
    assert "review-secret" not in serialized
    assert "xsec_token" not in serialized


def test_source_identity_preflight_uses_cli_platform_resolver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        platform_resolvers_module,
        "parse_bilibili_input",
        lambda _source: SimpleNamespace(
            full_url="https://www.bilibili.com/video/BV1Aa411c7mD?p=2"
        ),
    )

    result = resolve_source_identity_once(
        json.dumps({"url": "https://b23.tv/review-short"})
    )

    assert result["status"] == "completed"
    assert result["source_url"] == (
        "https://www.bilibili.com/video/BV1Aa411c7mD?p=2"
    )


def test_run_worker_once_uses_cli_platform_resolver_for_short_links(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parsed_sources: list[str] = []

    def fake_parse_bilibili_input(source: str) -> SimpleNamespace:
        parsed_sources.append(source)
        return SimpleNamespace(
            full_url="https://www.bilibili.com/video/BV1Aa411c7mD?p=2"
        )

    monkeypatch.setattr(
        platform_resolvers_module,
        "parse_bilibili_input",
        fake_parse_bilibili_input,
    )

    result = run_worker_once(
        process_request_json("https://b23.tv/review-short"),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
    )

    assert result["status"] == "completed"
    assert parsed_sources == ["https://b23.tv/review-short"]


def test_migration_cli_mode_is_not_supported() -> None:
    with pytest.raises(SystemExit):
        cli.main(["--migrate-source-data"])


def test_run_worker_once_returns_model_not_ready_with_task_manifest(tmp_path: Path) -> None:
    runner = FakeMediaRunner()

    result = run_worker_once(
        process_request_json(
            "https://www.douyin.com/video/7524373044106677544"
        ),
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
    assert [command_name(command) for command in runner.commands] == [
        "yt-dlp",
        "ffprobe",
        "ffprobe",
        "ffmpeg",
        "ffprobe",
    ]


def test_run_worker_once_defaults_to_transcript_only_with_injected_transcriber(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[dict[str, object]] = []

    def fail_if_ai_client_is_built(_env: dict[str, str]) -> object:
        raise AssertionError("process_video must not construct an AI client")

    monkeypatch.setattr(
        worker_defaults,
        "build_insight_client_from_env",
        fail_if_ai_client_is_built,
    )
    result = run_worker_once(
        process_request_json(
            "https://www.douyin.com/video/7524373044106677544"
        ),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
        progress_callback=events.append,
    )

    assert result["status"] == "completed"
    assert result["text"] == "desktop transcript"
    assert result["summary"] == ""
    assert result["insights"] == []
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
    assert events == [
        {
            "stage": "video_extracting",
            "progress": 18,
            "message_code": "video.download.preparing",
        },
        {
            "stage": "video_extracting",
            "progress": 34,
            "message_code": "video.stream.validating",
        },
        {
            "stage": "video_extracting",
            "progress": 48,
            "message_code": "audio.extract.running",
        },
        {
            "stage": "video_transcribing",
            "progress": 58,
            "message_code": "subtitle.detect.running",
        },
        {
            "stage": "video_transcribing",
            "progress": 58,
            "message_code": "asr.transcribe.starting",
        },
        {
            "stage": "video_transcribing",
            "progress": 68,
            "message_code": "asr.transcribe.running",
        },
    ]
    assert all("message" not in event for event in events)


def test_run_worker_once_rejects_retired_ai_field_without_echoing_request(
    tmp_path: Path,
) -> None:
    raw_url = "https://user:review-secret@example.com/private"
    result = run_worker_once(
        json.dumps(
            {
                "contract_version": PROCESS_VIDEO_CONTRACT_VERSION,
                "url": raw_url,
                "asr_model": DEFAULT_ASR_MODEL,
                "generate_insights": True,
            }
        ),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
    )

    serialized = json.dumps(result, ensure_ascii=False)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "INVALID_REQUEST_PAYLOAD"
    assert result["error"]["message"] == "Process request payload was invalid."
    assert "review-secret" not in serialized
    assert raw_url not in serialized


def test_process_video_service_and_pipeline_expose_no_ai_client_parameters() -> None:
    service_parameters = inspect.signature(
        cli.worker_service_module.run_worker_once
    ).parameters
    assert "insight_client" not in service_parameters
    assert "insight_client_factory" not in service_parameters
    assert "insight_client" not in inspect.signature(pipeline.run_worker_pipeline).parameters


def test_run_worker_once_uses_configured_output_and_cache_roots(tmp_path: Path) -> None:
    custom_cache_dir = tmp_path / "app-data" / "cache"
    custom_output_dir = tmp_path / "app-data" / "outputs"

    result = run_worker_once(
        process_request_json(
            "https://www.douyin.com/video/7524373044106677544"
        ),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber=FakeTranscriber(),
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

    monkeypatch.setattr(media_preparation, "download_video", fake_download_video)
    runner = FakeMediaRunner()

    result = run_worker_once(
        process_request_json(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        ),
        project_root=tmp_path,
        command_runner=runner,
        transcriber=FakeTranscriber(),
    )

    assert result["status"] == "completed"
    assert (task_dir_from_result(result) / "media" / "video.mp4").is_file()
    assert [command_name(command) for command in runner.commands] == [
        "ffprobe",
        "ffprobe",
        "ffmpeg",
        "ffprobe",
    ]


def test_run_worker_once_reports_missing_downloaded_asr_model_after_audio_extraction(
    tmp_path: Path,
) -> None:
    events: list[dict[str, object]] = []

    def fail_build_asr_transcriber(model_name: str, cache_dir: Path) -> FakeTranscriber:
        raise AssertionError("ASR model should be validated before loading")

    result = run_worker_once(
        process_request_json(
            "https://www.douyin.com/video/7524373044106677544"
        ),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber_factory=fail_build_asr_transcriber,
        allow_real_asr=True,
        progress_callback=events.append,
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
    assert events[-1] == {
        "stage": "video_transcribing",
        "progress": 58,
        "message_code": "asr.cache.preparing",
        "message_args": {"model": "iic/SenseVoiceSmall"},
    }


def test_run_worker_once_uses_explicit_asr_model_instead_of_user_data_env(
    tmp_path: Path,
) -> None:
    captured: dict[str, object] = {}
    user_data_dir = tmp_path / "user-data"
    user_data_dir.mkdir()
    create_valid_asr_cache(tmp_path / "models")
    (user_data_dir / ".env").write_text(
        "FRAMEQ_ASR_MODEL=Qwen/Qwen3-ASR-0.6B\n",
        encoding="utf-8",
    )

    def fake_build_asr_transcriber(model_name: str, cache_dir: Path) -> FakeTranscriber:
        captured["model_name"] = model_name
        captured["cache_dir"] = cache_dir
        return FakeTranscriber()

    result = run_worker_once(
        process_request_json(
            "https://www.douyin.com/video/7524373044106677544"
        ),
        project_root=tmp_path,
        command_runner=FakeMediaRunner(),
        transcriber_factory=fake_build_asr_transcriber,
        allow_real_asr=True,
        environ={"FRAMEQ_USER_DATA_DIR": user_data_dir.as_posix()},
    )

    transcript_md = task_dir_from_result(result) / "transcript" / "transcript.md"

    assert result["status"] == "completed"
    assert captured == {
        "model_name": "iic/SenseVoiceSmall",
        "cache_dir": tmp_path / "models",
    }
    assert "- Model: iic/SenseVoiceSmall" in transcript_md.read_text(encoding="utf-8")


def test_worker_request_rejects_model_outside_release_contract(
    tmp_path: Path,
) -> None:
    runner = FakeMediaRunner()
    result = run_worker_once(
        process_request_json(
            "https://www.douyin.com/video/7524373044106677544",
            asr_model="Qwen/Qwen3-ASR-0.6B",
        ),
        project_root=tmp_path,
        command_runner=runner,
    )

    assert result["status"] == "failed"
    assert result["error"] == {
        "code": "INVALID_REQUEST_PAYLOAD",
        "message": "Process request payload was invalid.",
        "stage": "waiting_input",
    }
    assert runner.commands == []
