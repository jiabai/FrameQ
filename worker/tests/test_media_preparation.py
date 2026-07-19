from __future__ import annotations

import ast
import importlib
import json
from pathlib import Path

from frameq_worker.media import CommandResult
from frameq_worker.source_identity import SourceIdentity
from frameq_worker.source_resolution import SourceRequest
from frameq_worker.task_store import TaskContext, TaskPaths


def test_pipeline_enters_media_subsystem_only_through_facade() -> None:
    pipeline_path = Path(__file__).resolve().parents[1] / "frameq_worker" / "pipeline.py"
    tree = ast.parse(pipeline_path.read_text(encoding="utf-8"))
    imported_names = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == "frameq_worker.media"
        for alias in node.names
    }
    called_names = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }

    assert "MediaPreparationFacade" in pipeline_path.read_text(encoding="utf-8")
    assert imported_names.isdisjoint(
        {"download_video", "extract_audio", "probe_media_file"}
    )
    assert called_names.isdisjoint(
        {
            "download_video",
            "extract_audio",
            "find_subtitle_transcript",
            "probe_media_file",
        }
    )
    assert "find_subtitle_transcript" not in pipeline_path.read_text(encoding="utf-8")


def test_media_facade_excludes_asr_ai_and_task_persistence() -> None:
    facade_path = (
        Path(__file__).resolve().parents[1]
        / "frameq_worker"
        / "media_preparation.py"
    )
    source = facade_path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported_modules = {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module is not None
    }
    task_store_imports = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        and node.module == "frameq_worker.task_store"
        for alias in node.names
    }

    assert "frameq_worker.asr" not in imported_modules
    assert "frameq_worker.insightflow" not in imported_modules
    assert task_store_imports == {"TaskContext"}
    assert "TaskStoreFacade" not in source
    assert ".finalize(" not in source


def test_url_media_facade_prepares_task_owned_video_and_audio(tmp_path: Path) -> None:
    media_preparation = importlib.import_module("frameq_worker.media_preparation")
    paths = TaskPaths(
        output_root=tmp_path / "outputs",
        cache_root=tmp_path / "cache",
        task_id="url-media-facade",
    )
    paths.download_dir.mkdir(parents=True)
    paths.media_dir.mkdir(parents=True)
    context = TaskContext(
        paths=paths,
        source_identity=SourceIdentity(
            platform="youtube",
            stable_id="dQw4w9WgXcQ",
            canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        ),
        platform="youtube",
        model="iic/SenseVoiceSmall",
        created_at="2026-07-19T00:00:00Z",
    )
    source_request = SourceRequest(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        context.source_identity,
    )
    events: list[dict[str, object]] = []

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            output_template = command[command.index("-o") + 1]
            video_path = Path(
                output_template.replace("%(id)s.%(ext)s", "dQw4w9WgXcQ.mp4")
            )
            video_path.parent.mkdir(parents=True, exist_ok=True)
            video_path.write_bytes(b"fake video")
            return CommandResult(command, 0, video_path.as_posix(), "")
        if command[0] == "ffprobe":
            return CommandResult(
                command,
                0,
                json.dumps(
                    {
                        "format": {"duration": "12.3", "size": "12345"},
                        "streams": [
                            {"codec_type": "video", "codec_name": "h264"},
                            {"codec_type": "audio", "codec_name": "aac"},
                        ],
                    }
                ),
                "",
            )
        if command[0] == "ffmpeg":
            output_path = Path(command[-1])
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(b"fake wav")
            return CommandResult(command, 0, "", "")
        raise AssertionError(f"unexpected command: {command}")

    facade = media_preparation.MediaPreparationFacade(
        command_runner=runner,
        progress_callback=events.append,
    )

    prepared = facade.prepare(
        media_preparation.UrlMediaSource(source_request),
        context,
    )

    assert prepared.video_path == paths.video_path
    assert prepared.audio_path == paths.audio_path
    assert prepared.subtitle_candidate is None
    assert paths.video_path.read_bytes() == b"fake video"
    assert paths.audio_path.read_bytes() == b"fake wav"
    assert not paths.manifest_path.exists()
    assert [event["message_code"] for event in events] == [
        "video.download.preparing",
        "video.stream.validating",
        "audio.extract.running",
        "subtitle.detect.running",
    ]
    assert events[-1]["stage"] == "video_transcribing"
