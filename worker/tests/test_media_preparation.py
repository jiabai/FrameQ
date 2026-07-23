from __future__ import annotations

import ast
import importlib
import json
from pathlib import Path

import pytest
from frameq_worker import atomic_files
from frameq_worker.media import CommandResult
from frameq_worker.source_identity import SourceIdentity
from frameq_worker.source_resolution import SourceRequest
from frameq_worker.task_store import TaskContext, TaskPaths, UrlTaskSource


def _build_context(tmp_path: Path, task_id: str) -> TaskContext:
    paths = TaskPaths(
        output_root=tmp_path / "outputs",
        cache_root=tmp_path / "cache",
        task_id=task_id,
    )
    paths.download_dir.mkdir(parents=True)
    paths.media_dir.mkdir(parents=True)
    return TaskContext(
        paths=paths,
        source=UrlTaskSource(
            SourceIdentity(
                platform="youtube",
                stable_id="dQw4w9WgXcQ",
                canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            )
        ),
        model="iic/SenseVoiceSmall",
        created_at="2026-07-19T00:00:00Z",
    )


def _source_request(context: TaskContext) -> SourceRequest:
    return SourceRequest(context.source_identity.canonical_url, context.source_identity)


def _probe_payload(*, include_video: bool, duration: str = "12.3") -> str:
    streams = [{"codec_type": "audio", "codec_name": "aac"}]
    if include_video:
        streams.insert(0, {"codec_type": "video", "codec_name": "h264"})
    return json.dumps(
        {
            "format": {"duration": duration, "size": "12345"},
            "streams": streams,
        }
    )


def test_pipeline_enters_media_subsystem_only_through_facade() -> None:
    orchestration_path = (
        Path(__file__).resolve().parents[1]
        / "frameq_worker"
        / "pipeline_runtime"
        / "orchestration.py"
    )
    source = orchestration_path.read_text(encoding="utf-8")
    tree = ast.parse(source)
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

    public_pipeline = importlib.import_module("frameq_worker.pipeline")
    private_orchestration = importlib.import_module(
        "frameq_worker.pipeline_runtime.orchestration"
    )

    assert public_pipeline.run_worker_pipeline is private_orchestration.run_worker_pipeline
    assert "MediaPreparationFacade" in source
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
    assert "find_subtitle_transcript" not in source


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
    context = _build_context(tmp_path, "url-media-facade")
    paths = context.paths
    source_request = _source_request(context)
    events: list[dict[str, object]] = []
    probed_paths: list[Path] = []
    ffmpeg_outputs: list[Path] = []

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
            probed_path = Path(command[-1])
            probed_paths.append(probed_path)
            return CommandResult(
                command,
                0,
                _probe_payload(include_video=probed_path.suffix != ".wav"),
                "",
            )
        if command[0] == "ffmpeg":
            output_path = Path(command[-1])
            ffmpeg_outputs.append(output_path)
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
    assert len(probed_paths) == 3
    assert probed_paths[1].name.startswith(".video.")
    assert probed_paths[1].name.endswith(".part.mp4")
    assert ffmpeg_outputs == [probed_paths[2]]
    assert ffmpeg_outputs[0].name.startswith(".audio.")
    assert ffmpeg_outputs[0].name.endswith(".part.wav")
    assert not list(paths.media_dir.glob(".*.part.*"))
    assert not paths.manifest_path.exists()
    assert [event["message_code"] for event in events] == [
        "video.download.preparing",
        "video.stream.validating",
        "audio.extract.running",
        "subtitle.detect.running",
    ]
    assert events[-1]["stage"] == "video_transcribing"


def test_video_commit_failure_preserves_previous_official_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    media_preparation = importlib.import_module("frameq_worker.media_preparation")
    context = _build_context(tmp_path, "video-commit-failure")
    context.paths.video_path.write_bytes(b"previous video")
    original_replace = atomic_files.os.replace

    def fail_video_replace(source: Path, destination: Path) -> None:
        if destination == context.paths.video_path:
            raise OSError("D:/private/output/video.mp4 is locked")
        original_replace(source, destination)

    monkeypatch.setattr(atomic_files.os, "replace", fail_video_replace)

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            output_template = command[command.index("-o") + 1]
            downloaded = Path(
                output_template.replace("%(id)s.%(ext)s", "dQw4w9WgXcQ.mp4")
            )
            downloaded.write_bytes(b"replacement video")
            return CommandResult(command, 0, downloaded.as_posix(), "")
        if command[0] == "ffprobe":
            return CommandResult(command, 0, _probe_payload(include_video=True), "")
        if command[0] == "ffmpeg":
            raise AssertionError("audio extraction must not start before video commit")
        raise AssertionError(f"unexpected command: {command}")

    facade = media_preparation.MediaPreparationFacade(command_runner=runner)

    with pytest.raises(media_preparation.MediaPreparationError) as captured:
        facade.prepare(media_preparation.UrlMediaSource(_source_request(context)), context)

    assert captured.value.code == "MEDIA_VALIDATION_FAILED"
    assert str(captured.value) == "Prepared video could not be stored safely."
    assert captured.value.__cause__ is not None
    assert captured.value.__cause__.__cause__ is None
    assert context.paths.video_path.read_bytes() == b"previous video"
    assert not list(context.paths.media_dir.glob(".video.*.part.mp4"))
    assert not context.paths.audio_path.exists()


def test_failed_ffmpeg_removes_partial_audio_and_returns_safe_error(
    tmp_path: Path,
) -> None:
    media_preparation = importlib.import_module("frameq_worker.media_preparation")
    context = _build_context(tmp_path, "audio-command-failure")

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            output_template = command[command.index("-o") + 1]
            downloaded = Path(
                output_template.replace("%(id)s.%(ext)s", "dQw4w9WgXcQ.mp4")
            )
            downloaded.write_bytes(b"downloaded video")
            return CommandResult(command, 0, downloaded.as_posix(), "")
        if command[0] == "ffprobe":
            return CommandResult(command, 0, _probe_payload(include_video=True), "")
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"partial wav")
            return CommandResult(
                command,
                1,
                "",
                "D:/private/input/video.mp4 could not be decoded",
            )
        raise AssertionError(f"unexpected command: {command}")

    facade = media_preparation.MediaPreparationFacade(command_runner=runner)

    with pytest.raises(media_preparation.MediaPreparationError) as captured:
        facade.prepare(media_preparation.UrlMediaSource(_source_request(context)), context)

    assert captured.value.code == "AUDIO_EXTRACTION_FAILED"
    assert str(captured.value) == "Audio extraction failed."
    assert context.paths.video_path.read_bytes() == b"downloaded video"
    assert not context.paths.audio_path.exists()
    assert not list(context.paths.media_dir.glob(".audio.*.part.wav"))


def test_copy_failure_removes_staging_and_preserves_previous_video(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    media_preparation = importlib.import_module("frameq_worker.media_preparation")
    context = _build_context(tmp_path, "video-copy-failure")
    context.paths.video_path.write_bytes(b"previous video")

    def fail_copy(_source: Path, destination: Path) -> None:
        destination.write_bytes(b"partial replacement")
        raise OSError("D:/private/output/video.mp4 ran out of disk space")

    monkeypatch.setattr(media_preparation.shutil, "copy2", fail_copy)

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            output_template = command[command.index("-o") + 1]
            downloaded = Path(
                output_template.replace("%(id)s.%(ext)s", "dQw4w9WgXcQ.mp4")
            )
            downloaded.write_bytes(b"replacement video")
            return CommandResult(command, 0, downloaded.as_posix(), "")
        if command[0] == "ffprobe":
            return CommandResult(command, 0, _probe_payload(include_video=True), "")
        raise AssertionError(f"unexpected command: {command}")

    facade = media_preparation.MediaPreparationFacade(command_runner=runner)

    with pytest.raises(media_preparation.MediaPreparationError) as captured:
        facade.prepare(media_preparation.UrlMediaSource(_source_request(context)), context)

    assert captured.value.code == "MEDIA_VALIDATION_FAILED"
    assert str(captured.value) == "Prepared video could not be stored safely."
    assert context.paths.video_path.read_bytes() == b"previous video"
    assert not list(context.paths.media_dir.glob(".video.*.part.mp4"))


def test_audio_commit_failure_preserves_previous_official_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    media_preparation = importlib.import_module("frameq_worker.media_preparation")
    context = _build_context(tmp_path, "audio-commit-failure")
    context.paths.audio_path.write_bytes(b"previous audio")
    original_replace = atomic_files.os.replace

    monkeypatch.setattr(media_preparation, "can_reuse_audio", lambda *_args: False)

    def fail_audio_replace(source: Path, destination: Path) -> None:
        if destination == context.paths.audio_path:
            raise OSError("D:/private/output/audio.wav is locked")
        original_replace(source, destination)

    monkeypatch.setattr(atomic_files.os, "replace", fail_audio_replace)

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            output_template = command[command.index("-o") + 1]
            downloaded = Path(
                output_template.replace("%(id)s.%(ext)s", "dQw4w9WgXcQ.mp4")
            )
            downloaded.write_bytes(b"downloaded video")
            return CommandResult(command, 0, downloaded.as_posix(), "")
        if command[0] == "ffprobe":
            media_path = Path(command[-1])
            return CommandResult(
                command,
                0,
                _probe_payload(include_video=media_path.suffix != ".wav"),
                "",
            )
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"replacement audio")
            return CommandResult(command, 0, "", "")
        raise AssertionError(f"unexpected command: {command}")

    facade = media_preparation.MediaPreparationFacade(command_runner=runner)

    with pytest.raises(media_preparation.MediaPreparationError) as captured:
        facade.prepare(media_preparation.UrlMediaSource(_source_request(context)), context)

    assert captured.value.code == "AUDIO_EXTRACTION_FAILED"
    assert str(captured.value) == "Extracted audio could not be stored safely."
    assert context.paths.audio_path.read_bytes() == b"previous audio"
    assert not list(context.paths.media_dir.glob(".audio.*.part.wav"))


def test_invalid_extracted_audio_is_not_committed(tmp_path: Path) -> None:
    media_preparation = importlib.import_module("frameq_worker.media_preparation")
    context = _build_context(tmp_path, "audio-validation-failure")

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            output_template = command[command.index("-o") + 1]
            downloaded = Path(
                output_template.replace("%(id)s.%(ext)s", "dQw4w9WgXcQ.mp4")
            )
            downloaded.write_bytes(b"downloaded video")
            return CommandResult(command, 0, downloaded.as_posix(), "")
        if command[0] == "ffprobe":
            media_path = Path(command[-1])
            return CommandResult(
                command,
                0,
                _probe_payload(
                    include_video=media_path.suffix != ".wav",
                    duration="0" if media_path.suffix == ".wav" else "12.3",
                ),
                "",
            )
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"invalid wav")
            return CommandResult(command, 0, "", "")
        raise AssertionError(f"unexpected command: {command}")

    facade = media_preparation.MediaPreparationFacade(command_runner=runner)

    with pytest.raises(media_preparation.MediaPreparationError) as captured:
        facade.prepare(media_preparation.UrlMediaSource(_source_request(context)), context)

    assert captured.value.code == "AUDIO_EXTRACTION_FAILED"
    assert str(captured.value) == "Extracted audio could not be validated."
    assert not context.paths.audio_path.exists()
    assert not list(context.paths.media_dir.glob(".audio.*.part.wav"))
