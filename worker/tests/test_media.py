import json
from pathlib import Path

import frameq_worker.media as media
import pytest
from frameq_worker.media import (
    CommandExecutionError,
    CommandResult,
    build_audio_extract_command,
    build_ffprobe_command,
    build_ytdlp_command,
    download_video,
    extract_audio,
    parse_ffprobe_json,
    probe_media_file,
)


def test_build_ytdlp_command_downloads_single_video_to_outputs_template() -> None:
    command = build_ytdlp_command(
        "https://www.douyin.com/video/7524373044106677544",
        output_dir=Path("outputs"),
    )

    assert command == [
        "yt-dlp",
        "--no-playlist",
        "-o",
        "outputs/%(id)s.%(ext)s",
        "https://www.douyin.com/video/7524373044106677544",
    ]


def test_build_ffprobe_command_outputs_json_for_media_file() -> None:
    command = build_ffprobe_command(Path("outputs/7524373044106677544.mp4"))

    assert command == [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,size:stream=index,codec_type,codec_name,width,height",
        "-of",
        "json",
        "outputs/7524373044106677544.mp4",
    ]


def test_build_audio_extract_command_outputs_asr_friendly_wav() -> None:
    command = build_audio_extract_command(
        Path("outputs/7524373044106677544.mp4"),
        Path("work/7524373044106677544.wav"),
    )

    assert command == [
        "ffmpeg",
        "-y",
        "-i",
        "outputs/7524373044106677544.mp4",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "work/7524373044106677544.wav",
    ]


def test_parse_ffprobe_json_extracts_video_audio_and_format_summary() -> None:
    payload = {
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "hevc",
                "width": 1024,
                "height": 576,
            },
            {"index": 1, "codec_type": "audio", "codec_name": "aac"},
        ],
        "format": {"duration": "271.300000", "size": "5437347"},
    }

    info = parse_ffprobe_json(json.dumps(payload))

    assert info.has_video is True
    assert info.has_audio is True
    assert info.video_codec == "hevc"
    assert info.audio_codec == "aac"
    assert info.width == 1024
    assert info.height == 576
    assert info.duration_seconds == 271.3
    assert info.size_bytes == 5437347
    assert info.is_valid is True


def test_parse_ffprobe_json_marks_missing_audio_as_invalid() -> None:
    payload = {
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "hevc",
                "width": 1024,
                "height": 576,
            }
        ],
        "format": {"duration": "10.0", "size": "1000"},
    }

    info = parse_ffprobe_json(json.dumps(payload))

    assert info.has_video is True
    assert info.has_audio is False
    assert info.is_valid is False


def test_extract_douyin_video_id_from_standard_video_url() -> None:
    assert (
        media.extract_douyin_video_id(
            "https://www.douyin.com/video/7646789377271647540?previous_page=app_code_link"
        )
        == "7646789377271647540"
    )


def test_audio_only_ffprobe_result_can_be_reused_for_asr_input() -> None:
    payload = {
        "streams": [{"index": 0, "codec_type": "audio", "codec_name": "pcm_s16le"}],
        "format": {"duration": "10.0", "size": "320000"},
    }

    info = parse_ffprobe_json(json.dumps(payload))

    assert info.has_audio is True
    assert info.is_valid_audio is True


def test_download_video_creates_output_dir_and_runs_ytdlp_command(tmp_path: Path) -> None:
    calls: list[list[str]] = []

    def fake_runner(command: list[str]) -> CommandResult:
        calls.append(command)
        return CommandResult(command=command, returncode=0, stdout="", stderr="")

    download_video(
        "https://www.douyin.com/video/7524373044106677544",
        output_dir=tmp_path / "outputs",
        runner=fake_runner,
    )

    assert (tmp_path / "outputs").is_dir()
    assert calls == [
        [
            "yt-dlp",
            "--no-playlist",
            "-o",
            (tmp_path / "outputs" / "%(id)s.%(ext)s").as_posix(),
            "https://www.douyin.com/video/7524373044106677544",
        ]
    ]


def test_download_video_uses_douyin_fallback_for_empty_web_detail_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []
    fallback_calls: list[tuple[str, Path]] = []

    def fake_runner(command: list[str]) -> CommandResult:
        calls.append(command)
        return CommandResult(
            command=command,
            returncode=1,
            stdout="",
            stderr="Expecting value: line 1 column 1 (char 0)",
        )

    def fake_fallback(
        url: str,
        output_dir: Path,
        progress_callback: object | None = None,
    ) -> Path:
        fallback_calls.append((url, output_dir))
        video_path = output_dir / "7653372612151692594.mp4"
        video_path.write_bytes(b"fallback mp4")
        return video_path

    monkeypatch.setattr(media, "download_douyin_video", fake_fallback)

    result = download_video(
        "https://www.douyin.com/video/7653372612151692594",
        output_dir=tmp_path / "outputs",
        runner=fake_runner,
    )

    assert result.command == [
        "douyin-fallback",
        "https://www.douyin.com/video/7653372612151692594",
    ]
    assert fallback_calls == [
        ("https://www.douyin.com/video/7653372612151692594", tmp_path / "outputs")
    ]
    assert calls[0][0] == "yt-dlp"


def test_download_video_preserves_non_douyin_ytdlp_failure(tmp_path: Path) -> None:
    def fake_runner(command: list[str]) -> CommandResult:
        return CommandResult(
            command=command,
            returncode=1,
            stdout="",
            stderr="ERROR: Unsupported URL",
        )

    with pytest.raises(CommandExecutionError):
        download_video("https://example.com/video/1", output_dir=tmp_path, runner=fake_runner)


def test_probe_media_file_runs_ffprobe_and_parses_stdout() -> None:
    payload = {
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1280,
                "height": 720,
            },
            {"index": 1, "codec_type": "audio", "codec_name": "aac"},
        ],
        "format": {"duration": "5.0", "size": "2000"},
    }

    def fake_runner(command: list[str]) -> CommandResult:
        return CommandResult(command=command, returncode=0, stdout=json.dumps(payload), stderr="")

    info = probe_media_file(Path("outputs/demo.mp4"), runner=fake_runner)

    assert info.is_valid is True
    assert info.video_codec == "h264"


def test_extract_audio_creates_parent_dir_and_runs_ffmpeg(tmp_path: Path) -> None:
    calls: list[list[str]] = []

    def fake_runner(command: list[str]) -> CommandResult:
        calls.append(command)
        return CommandResult(command=command, returncode=0, stdout="", stderr="")

    extract_audio(
        tmp_path / "outputs" / "demo.mp4",
        tmp_path / "work" / "demo.wav",
        runner=fake_runner,
    )

    assert (tmp_path / "work").is_dir()
    assert calls == [
        [
            "ffmpeg",
            "-y",
            "-i",
            (tmp_path / "outputs" / "demo.mp4").as_posix(),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            (tmp_path / "work" / "demo.wav").as_posix(),
        ]
    ]
