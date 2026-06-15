import json
from pathlib import Path

from frameq_worker.media import (
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
