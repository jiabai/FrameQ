import json
import sys
from pathlib import Path

import frameq_worker.media as media
import pytest
from frameq_worker.media import (
    CommandExecutionError,
    CommandResult,
    build_audio_extract_command,
    build_ffprobe_command,
    build_ytdlp_command,
    classify_youtube_download_failure,
    download_video,
    extract_audio,
    extract_xiaohongshu_note_id,
    parse_ffprobe_json,
    probe_media_file,
    sanitize_youtube_error,
    should_attempt_youtube_processing,
)


def assert_ytdlp_module_prefix(command: list[str]) -> None:
    assert command[:3] == [sys.executable, "-m", "yt_dlp"]


def test_build_ytdlp_command_downloads_single_video_to_outputs_template() -> None:
    command = build_ytdlp_command(
        "https://www.douyin.com/video/7524373044106677544",
        output_dir=Path("outputs"),
    )

    assert_ytdlp_module_prefix(command)
    assert command[3:] == [
        "--no-playlist",
        "-o",
        "outputs/%(id)s.%(ext)s",
        "https://www.douyin.com/video/7524373044106677544",
    ]


def test_build_ytdlp_command_uses_transcription_first_youtube_format_policy() -> None:
    command = build_ytdlp_command(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        output_dir=Path("outputs"),
    )

    assert_ytdlp_module_prefix(command)
    assert "--no-playlist" in command
    assert "-o" in command
    assert "outputs/%(id)s.%(ext)s" in command
    assert "https://www.youtube.com/watch?v=dQw4w9WgXcQ" in command
    assert "-f" in command
    format_selector = command[command.index("-f") + 1]
    assert "height<=720" in format_selector
    assert "mp4" in format_selector
    assert "m4a" in format_selector
    assert command[command.index("--merge-output-format") + 1] == "mp4"
    runtime_values = [
        command[index + 1]
        for index, value in enumerate(command)
        if value == "--js-runtimes"
    ]
    assert runtime_values == ["deno", "node", "quickjs", "bun"]
    assert "--write-subs" in command
    assert "--write-auto-subs" in command
    assert command[command.index("--sub-langs") + 1] == "zh-Hans,zh-CN,zh-Hant,en,ja,ko"
    assert command[command.index("--sub-format") + 1] == "best"
    assert "--convert-subs" not in command
    assert "--cookies" not in command
    assert "--cookies-from-browser" not in command
    assert "--proxy" not in command
    assert "--username" not in command
    assert "--password" not in command


def test_build_ytdlp_command_adds_subtitle_args_for_bilibili_only() -> None:
    command = build_ytdlp_command(
        "https://www.bilibili.com/video/BV1Aa411c7mD",
        output_dir=Path("outputs"),
    )

    assert_ytdlp_module_prefix(command)
    assert command[-1] == "https://www.bilibili.com/video/BV1Aa411c7mD"
    assert command[command.index("--sub-langs") + 1] == "zh-Hans,zh-CN,zh-Hant,en,ja,ko"
    assert "--write-subs" in command
    assert "--write-auto-subs" in command
    assert "--sub-format" in command
    assert "--convert-subs" not in command
    assert "--cookies" not in command
    assert "--cookies-from-browser" not in command


def test_build_ytdlp_command_does_not_add_subtitle_args_to_other_generic_urls() -> None:
    command = build_ytdlp_command(
        "https://www.douyin.com/video/7524373044106677544",
        output_dir=Path("outputs"),
    )

    assert "--write-subs" not in command
    assert "--write-auto-subs" not in command
    assert "--sub-langs" not in command
    assert "--sub-format" not in command


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
        Path("cache/7524373044106677544.wav"),
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
        "cache/7524373044106677544.wav",
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


def test_extract_douyin_video_id_from_note_slides_and_modal_links() -> None:
    assert (
        media.extract_douyin_video_id(
            "https://www.douyin.com/note/123?modal_id=7653372612151692594"
        )
        == "7653372612151692594"
    )
    assert (
        media.extract_douyin_video_id("https://www.douyin.com/share/slides/7653372612151692594")
        == "7653372612151692594"
    )


def test_should_attempt_douyin_fallback_detects_embedded_short_link() -> None:
    assert media.should_attempt_douyin_fallback(
        "复制打开抖音 https://v.douyin.com/abc123/ 看看这个视频",
        "Expecting value: line 1 column 1 (char 0)",
    )


def test_should_attempt_douyin_fallback_detects_supported_aweme_id_inputs() -> None:
    assert media.should_attempt_douyin_fallback(
        "https://www.douyin.com/note/123?modal_id=7653372612151692594",
        "ERROR: Unsupported URL",
    )
    assert media.should_attempt_douyin_fallback(
        "copy https://www.douyin.com/share/slides/7653372612151692594 more text",
        "ERROR: Unsupported URL",
    )
    assert media.should_attempt_douyin_fallback(
        "https://www.douyin.com/?aweme_id=7653372612151692594",
        "ERROR: Unsupported URL",
    )


def test_should_attempt_xiaohongshu_fallback_detects_embedded_short_link() -> None:
    assert media.should_attempt_xiaohongshu_fallback(
        "share text https://xhslink.com/demo more text",
        "ERROR: Unsupported URL",
    )


def test_should_attempt_bilibili_fallback_detects_supported_links() -> None:
    assert media.should_attempt_bilibili_fallback(
        "https://www.bilibili.com/video/BV1Aa411c7mD?p=2",
        "ERROR: Unsupported URL",
    )
    assert media.should_attempt_bilibili_fallback(
        "copy https://b23.tv/demo more text",
        "ERROR: Unsupported URL",
    )
    assert not media.should_attempt_bilibili_fallback(
        "https://bilibili.com.evil/video/BV1Aa411c7mD",
        "ERROR: Unsupported URL",
    )


def test_should_attempt_youtube_processing_detects_single_public_video_links() -> None:
    assert should_attempt_youtube_processing("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert should_attempt_youtube_processing("https://youtu.be/dQw4w9WgXcQ")
    assert should_attempt_youtube_processing("https://www.youtube.com/shorts/abcDEF_123-")
    assert should_attempt_youtube_processing(
        "copy https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123 more text"
    )
    assert not should_attempt_youtube_processing("https://www.youtube.com/playlist?list=PL123")
    assert not should_attempt_youtube_processing("https://www.youtube.com/channel/UC123")
    assert not should_attempt_youtube_processing("https://www.youtube.com/@frameq")
    assert not should_attempt_youtube_processing("https://youtu.be/")
    assert not should_attempt_youtube_processing("https://youtube.com.evil/watch?v=dQw4w9WgXcQ")
    assert not should_attempt_youtube_processing(
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ"
    )


def test_classify_youtube_download_failure_maps_common_ytdlp_errors() -> None:
    cases = [
        (
            "Sign in to confirm you are not a bot. Use --cookies.",
            "YOUTUBE_LOGIN_REQUIRED:",
        ),
        ("This video is age-restricted.", "YOUTUBE_AGE_RESTRICTED:"),
        ("Private video. Video unavailable.", "YOUTUBE_PRIVATE_OR_UNAVAILABLE:"),
        (
            "No video formats found. Requested format is not available.",
            "YOUTUBE_NO_PLAYABLE_STREAM:",
        ),
        ("ERROR: extractor failed.", "YOUTUBE_DOWNLOAD_FAILED:"),
    ]

    for stderr, expected_prefix in cases:
        result = classify_youtube_download_failure(
            CommandResult(command=["yt-dlp"], returncode=1, stdout="", stderr=stderr)
        )

        assert result.stderr.startswith(expected_prefix)


def test_sanitize_youtube_error_removes_signed_media_urls_and_cookie_hints() -> None:
    sanitized = sanitize_youtube_error(
        "ERROR https://rr1---sn.googlevideo.com/videoplayback?expire=1&sig=SECRET "
        "Use --cookies-from-browser chrome or --cookies cookies.txt."
    )

    assert "googlevideo.com" not in sanitized
    assert "videoplayback" not in sanitized
    assert "sig=SECRET" not in sanitized
    assert "--cookies" not in sanitized
    assert "--cookies-from-browser" not in sanitized
    assert "[youtube media url removed]" in sanitized


def test_extract_xiaohongshu_note_id_from_full_url_and_share_text() -> None:
    assert (
        extract_xiaohongshu_note_id(
            "https://www.xiaohongshu.com/explore/0123456789abcdef01234568?xsec_token=tok"
        )
        == "0123456789abcdef01234568"
    )
    assert (
        extract_xiaohongshu_note_id(
            "share https://www.xiaohongshu.com/explore/ABCDEFabcdef012345678901?xsec_token=tok"
        )
        == "abcdefabcdef012345678901"
    )
    assert extract_xiaohongshu_note_id("https://xhslink.com/o/jQzXcxNapU") is None


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
    assert len(calls) == 1
    assert_ytdlp_module_prefix(calls[0])
    assert calls[0][3:] == [
        "--no-playlist",
        "-o",
        (tmp_path / "outputs" / "%(id)s.%(ext)s").as_posix(),
        "https://www.douyin.com/video/7524373044106677544",
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
    assert_ytdlp_module_prefix(calls[0])


def test_download_video_uses_xiaohongshu_fallback_for_supported_link_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fallback_calls: list[tuple[str, Path]] = []

    def fake_runner(command: list[str]) -> CommandResult:
        return CommandResult(
            command=command,
            returncode=1,
            stdout="",
            stderr="ERROR: Unsupported URL",
        )

    def fake_fallback(
        url: str,
        output_dir: Path,
        progress_callback: object | None = None,
    ) -> Path:
        fallback_calls.append((url, output_dir))
        video_path = output_dir / "0123456789abcdef01234568.mp4"
        video_path.write_bytes(b"xhs fallback mp4")
        return video_path

    monkeypatch.setattr(media, "download_xiaohongshu_video", fake_fallback)

    result = download_video(
        "share text https://xhslink.com/demo more text",
        output_dir=tmp_path / "outputs",
        runner=fake_runner,
    )

    assert result.command == [
        "xiaohongshu-fallback",
        "share text https://xhslink.com/demo more text",
    ]
    assert fallback_calls == [
        ("share text https://xhslink.com/demo more text", tmp_path / "outputs")
    ]


def test_download_video_uses_bilibili_fallback_for_supported_link_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fallback_calls: list[tuple[str, Path]] = []

    def fake_runner(command: list[str]) -> CommandResult:
        return CommandResult(
            command=command,
            returncode=1,
            stdout="",
            stderr="ERROR: Unsupported URL",
        )

    def fake_fallback(
        url: str,
        output_dir: Path,
        command_runner: object,
        progress_callback: object | None = None,
    ) -> Path:
        fallback_calls.append((url, output_dir))
        video_path = output_dir / "BV1Aa411c7mD.mp4"
        video_path.write_bytes(b"bilibili fallback mp4")
        return video_path

    monkeypatch.setattr(media, "download_bilibili_video", fake_fallback)

    result = download_video(
        "https://www.bilibili.com/video/BV1Aa411c7mD",
        output_dir=tmp_path / "outputs",
        runner=fake_runner,
    )

    assert result.command == [
        "bilibili-fallback",
        "https://www.bilibili.com/video/BV1Aa411c7mD",
    ]
    assert fallback_calls == [
        ("https://www.bilibili.com/video/BV1Aa411c7mD", tmp_path / "outputs")
    ]


def test_download_video_classifies_youtube_failure_without_cookie_guidance(
    tmp_path: Path,
) -> None:
    def fake_runner(command: list[str]) -> CommandResult:
        return CommandResult(
            command=command,
            returncode=1,
            stdout="",
            stderr="ERROR: Sign in to confirm you are not a bot. Use --cookies.",
        )

    with pytest.raises(CommandExecutionError) as error:
        download_video(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            output_dir=tmp_path,
            runner=fake_runner,
        )

    assert error.value.result.stderr.startswith("YOUTUBE_LOGIN_REQUIRED:")
    assert "--cookies" not in error.value.result.stderr


def test_download_video_keeps_youtube_media_when_subtitle_download_fails(
    tmp_path: Path,
) -> None:
    def fake_runner(command: list[str]) -> CommandResult:
        video_path = tmp_path / "dQw4w9WgXcQ.mp4"
        video_path.write_bytes(b"downloaded mp4")
        return CommandResult(
            command=command,
            returncode=1,
            stdout="",
            stderr=(
                "WARNING: The extractor specified to use impersonation for this download, "
                "but no impersonate target is available. "
                "ERROR: Unable to download video subtitles for 'zh-Hans': "
                "HTTP Error 429: Too Many Requests"
            ),
        )

    result = download_video(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        output_dir=tmp_path,
        runner=fake_runner,
    )

    assert result.returncode == 0
    assert result.stdout == (tmp_path / "dQw4w9WgXcQ.mp4").as_posix()


def test_download_video_retries_youtube_without_subtitles_after_subtitle_failure(
    tmp_path: Path,
) -> None:
    calls: list[list[str]] = []

    def fake_runner(command: list[str]) -> CommandResult:
        calls.append(command)
        if len(calls) == 1:
            return CommandResult(
                command=command,
                returncode=1,
                stdout="",
                stderr=(
                    "ERROR: Unable to download video subtitles for 'zh-Hans': "
                    "HTTP Error 429: Too Many Requests"
                ),
            )

        video_path = tmp_path / "dQw4w9WgXcQ.mp4"
        video_path.write_bytes(b"downloaded mp4")
        return CommandResult(
            command=command,
            returncode=0,
            stdout=video_path.as_posix(),
            stderr="",
        )

    result = download_video(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        output_dir=tmp_path,
        runner=fake_runner,
    )

    assert result.returncode == 0
    assert result.stdout == (tmp_path / "dQw4w9WgXcQ.mp4").as_posix()
    assert len(calls) == 2
    assert "--write-subs" in calls[0]
    assert "--write-auto-subs" in calls[0]
    assert "--write-subs" not in calls[1]
    assert "--write-auto-subs" not in calls[1]


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
        tmp_path / "cache" / "demo.wav",
        runner=fake_runner,
    )

    assert (tmp_path / "cache").is_dir()
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
            (tmp_path / "cache" / "demo.wav").as_posix(),
        ]
    ]
