from __future__ import annotations

import json
from pathlib import Path

import pytest
from frameq_worker.asr import Transcript
from frameq_worker.desktop_contract import CACHE_DIR_ENV, OUTPUT_DIR_ENV
from frameq_worker.media import CommandResult
from frameq_worker.models import ProcessRequest
from frameq_worker.pipeline import run_worker_pipeline
from frameq_worker.worker_service import retry_insights_once


class FakeTranscriber:
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        return Transcript(text="task transcript", language=language)


class FakeInsightClient:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if "Mermaid mindmap" in prompt:
            return "mindmap\n  root((retry))"
        if "根据文字稿原文和 Mermaid 思维导图" in prompt:
            return "# summary\n\nretry summary"
        if "question_count" in prompt:
            return (
                '[{"title":"topic","summary":"user edited official transcript",'
                '"excerpt":"user edited official transcript","question_count":1}]'
            )
        return (
            '[{"topic":"retry question","matchReason":"matched",'
            '"followUpQuestions":["next"],"suitableUse":"content planning"}]'
        )


def valid_preference_snapshot() -> dict[str, object]:
    return {
        "profile": None,
        "profileSkipped": True,
        "generationPreferences": {
            "goal": "content_creation",
            "scenario": "short_video",
            "angles": ["topic_angle"],
            "audience": "fans_readers",
            "styles": ["grounded"],
            "avoid": [],
        },
        "labelSnapshot": {
            "profile": [],
            "generationPreferences": [
                {
                    "field": "goal",
                    "label": "本次目标",
                    "values": [{"id": "content_creation", "label": "内容创作"}],
                }
            ],
        },
    }


def test_worker_pipeline_writes_task_owned_artifacts_and_manifest(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            output_template = command[command.index("-o") + 1]
            video_path = Path(
                output_template.replace("%(id)s.%(ext)s", "7524373044106677544.mp4")
            )
            video_path.parent.mkdir(parents=True, exist_ok=True)
            video_path.write_bytes(b"fake video")
            return CommandResult(
                command=command,
                returncode=0,
                stdout=video_path.as_posix(),
                stderr="",
            )
        if command[0] == "ffprobe":
            return CommandResult(
                command=command,
                returncode=0,
                stdout=json.dumps(
                    {
                        "format": {"duration": "12.3", "size": "12345"},
                        "streams": [
                            {
                                "codec_type": "video",
                                "codec_name": "h264",
                                "width": 720,
                                "height": 1280,
                            },
                            {"codec_type": "audio", "codec_name": "aac"},
                        ],
                    }
                ),
                stderr="",
            )
        if command[0] == "ffmpeg":
            audio_path = Path(command[-1])
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"fake wav")
            return CommandResult(command=command, returncode=0, stdout="", stderr="")
        raise AssertionError(f"unexpected command: {command}")

    result = run_worker_pipeline(
        request=ProcessRequest(
            url="https://www.douyin.com/video/7524373044106677544",
            generate_insights=False,
        ),
        project_root=tmp_path,
        command_runner=runner,
        transcriber=FakeTranscriber(),
        insight_client=None,
        allow_real_asr=True,
        environ={
            OUTPUT_DIR_ENV: output_root.as_posix(),
            CACHE_DIR_ENV: cache_root.as_posix(),
        },
    ).to_dict()

    assert result["status"] == "completed"
    assert str(result["task_id"]).endswith("-douyin-7524373044106677544")
    assert result["transcript"] == {
        "source": "asr",
        "language": None,
        "engine": "iic/SenseVoiceSmall",
    }
    assert result["artifacts"] == {
        "video": "media/video.mp4",
        "audio": "media/audio.wav",
        "transcript_txt": "transcript/transcript.txt",
        "transcript_md": "transcript/transcript.md",
    }
    assert "preference_snapshot" not in result["artifacts"]

    task_dir = Path(str(result["task_dir"]))
    assert task_dir.parent == output_root / "tasks"
    assert (task_dir / "media" / "video.mp4").is_file()
    assert (task_dir / "media" / "audio.wav").is_file()
    transcript = (
        (task_dir / "transcript" / "transcript.txt")
        .read_text(encoding="utf-8")
        .strip()
    )
    assert transcript == "task transcript"
    assert not list(output_root.glob("*.mp4"))

    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 3
    assert manifest["task_id"] == result["task_id"]
    assert manifest["source_url"] == "https://www.douyin.com/video/7524373044106677544"
    assert manifest["source_identity"] == {
        "version": 1,
        "platform": "douyin",
        "stable_id": "7524373044106677544",
        "effective_part": None,
        "canonical_url": "https://www.douyin.com/video/7524373044106677544",
    }
    assert manifest["platform"] == "douyin"
    assert manifest["status"] == "completed"
    assert manifest["transcript"] == result["transcript"]
    assert manifest["artifacts"] == result["artifacts"]
    assert manifest["text_preview"] == "task transcript"


def test_sensitive_xhs_download_url_never_crosses_persistence_or_prompt_boundary(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    note_id = "64a1b2c3d4e5f67890123456"
    secret = "review-secret"
    raw_url = (
        f"https://www.xiaohongshu.com/explore/{note_id}"
        f"?xsec_token={secret}&source=web#comments"
    )
    canonical_url = f"https://www.xiaohongshu.com/explore/{note_id}"
    download_commands: list[list[str]] = []

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            download_commands.append(command)
            output_template = command[command.index("-o") + 1]
            video_path = Path(output_template.replace("%(id)s.%(ext)s", f"{note_id}.mp4"))
            video_path.parent.mkdir(parents=True, exist_ok=True)
            video_path.write_bytes(b"fake video")
            return CommandResult(
                command=command,
                returncode=0,
                stdout=video_path.as_posix(),
                stderr="",
            )
        if command[0] == "ffprobe":
            return CommandResult(
                command=command,
                returncode=0,
                stdout=json.dumps(
                    {
                        "format": {"duration": "12.3", "size": "12345"},
                        "streams": [
                            {"codec_type": "video", "codec_name": "h264"},
                            {"codec_type": "audio", "codec_name": "aac"},
                        ],
                    }
                ),
                stderr="",
            )
        if command[0] == "ffmpeg":
            audio_path = Path(command[-1])
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"fake wav")
            return CommandResult(command=command, returncode=0, stdout="", stderr="")
        raise AssertionError(f"unexpected command: {command}")

    class CapturingInsightClient:
        def __init__(self) -> None:
            self.prompts: list[str] = []

        def generate(self, prompt: str) -> str:
            self.prompts.append(prompt)
            if "Mermaid mindmap" in prompt:
                return "mindmap\n  root((official body))"
            if "根据文字稿原文和 Mermaid 思维导图" in prompt:
                return "# summary\n\nofficial body summary"
            if "question_count" in prompt:
                return json.dumps(
                    [
                        {
                            "title": "topic",
                            "summary": "task transcript",
                            "excerpt": "task transcript",
                            "question_count": 1,
                        }
                    ]
                )
            return (
                '[{"topic":"question","matchReason":"matched",'
                '"followUpQuestions":["next"],"suitableUse":"content planning"}]'
            )

    insight_client = CapturingInsightClient()
    result = run_worker_pipeline(
        request=ProcessRequest(url=raw_url, generate_insights=True),
        project_root=tmp_path,
        command_runner=runner,
        transcriber=FakeTranscriber(),
        insight_client=insight_client,
        allow_real_asr=True,
        environ={
            OUTPUT_DIR_ENV: output_root.as_posix(),
            CACHE_DIR_ENV: cache_root.as_posix(),
        },
    ).to_dict()

    assert result["status"] == "completed"
    assert len(download_commands) == 1
    assert raw_url in download_commands[0]
    assert len(insight_client.prompts) == 4
    for prompt in insight_client.prompts:
        assert "task transcript" in prompt
        assert secret not in prompt
        assert "xsec_token" not in prompt
        assert raw_url not in prompt

    task_dir = Path(str(result["task_dir"]))
    transcript_md = (task_dir / "transcript" / "transcript.md").read_text(
        encoding="utf-8"
    )
    assert canonical_url in transcript_md
    assert raw_url not in transcript_md
    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["source_url"] == canonical_url
    assert manifest["source_identity"]["canonical_url"] == canonical_url
    persisted = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in task_dir.rglob("*")
        if path.is_file()
    )
    serialized_result = json.dumps(result, ensure_ascii=False)
    for value in (secret, "xsec_token", raw_url):
        assert value not in persisted
        assert value not in serialized_result


def test_worker_pipeline_uses_platform_subtitle_before_asr_model_ready(
    tmp_path: Path,
) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"

    def runner(command: list[str]) -> CommandResult:
        if "-m" in command and "yt_dlp" in command:
            output_template = command[command.index("-o") + 1]
            video_path = Path(output_template.replace("%(id)s.%(ext)s", "dQw4w9WgXcQ.mp4"))
            video_path.parent.mkdir(parents=True, exist_ok=True)
            video_path.write_bytes(b"fake video")
            (video_path.parent / "dQw4w9WgXcQ.zh-Hans.srt").write_text(
                "1\n00:00:01,000 --> 00:00:02,000\n字幕第一句\n\n"
                "2\n00:00:02,500 --> 00:00:03,000\n字幕第二句\n",
                encoding="utf-8",
            )
            return CommandResult(
                command=command,
                returncode=0,
                stdout=video_path.as_posix(),
                stderr="",
            )
        if command[0] == "ffprobe":
            return CommandResult(
                command=command,
                returncode=0,
                stdout=json.dumps(
                    {
                        "format": {"duration": "12.3", "size": "12345"},
                        "streams": [
                            {"codec_type": "video", "codec_name": "h264"},
                            {"codec_type": "audio", "codec_name": "aac"},
                        ],
                    }
                ),
                stderr="",
            )
        if command[0] == "ffmpeg":
            audio_path = Path(command[-1])
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"fake wav")
            return CommandResult(command=command, returncode=0, stdout="", stderr="")
        raise AssertionError(f"unexpected command: {command}")

    result = run_worker_pipeline(
        request=ProcessRequest(
            url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            generate_insights=False,
        ),
        project_root=tmp_path,
        command_runner=runner,
        transcriber=None,
        insight_client=None,
        allow_real_asr=False,
        environ={
            OUTPUT_DIR_ENV: output_root.as_posix(),
            CACHE_DIR_ENV: cache_root.as_posix(),
        },
    ).to_dict()

    assert result["status"] == "completed"
    assert result["text"] == "字幕第一句\n字幕第二句"
    assert result["transcript"] == {
        "source": "subtitle",
        "language": "zh-Hans",
        "engine": None,
    }

    task_dir = Path(str(result["task_dir"]))
    transcript_md = (task_dir / "transcript" / "transcript.md").read_text(encoding="utf-8")
    assert "Transcript Source: Platform subtitle" in transcript_md
    assert "Model:" not in transcript_md
    assert (task_dir / "media" / "audio.wav").is_file()

    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 3
    assert manifest["model"] == "iic/SenseVoiceSmall"
    assert manifest["transcript"] == result["transcript"]


def test_retry_insights_target_uses_task_manifest_and_updates_same_task(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    task_id = "20260705-153012-douyin-7524373044106677544"
    task_dir = output_root / "tasks" / task_id
    transcript_dir = task_dir / "transcript"
    transcript_dir.mkdir(parents=True)
    (transcript_dir / "transcript.txt").write_text(
        "user edited official transcript\n",
        encoding="utf-8",
    )
    (transcript_dir / "transcript.md").write_text(
        "# Transcript\n\n## Metadata\n\n"
        "- Source URL: https://example.test/video?xsec_token=review-secret\n\n"
        "stale markdown transcript\n",
        encoding="utf-8",
    )
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "task_id": task_id,
                "created_at": "2026-07-05T15:30:12Z",
                "source_url": "https://www.douyin.com/video/7524373044106677544",
                "platform": "douyin",
                "status": "partial_completed",
                "app_version": "app",
                "worker_version": "app",
                "model": "iic/SenseVoiceSmall",
                "artifacts": {
                    "transcript_txt": "transcript/transcript.txt",
                    "transcript_md": "transcript/transcript.md",
                },
                "error": None,
                "text_preview": "saved transcript",
                "insights_count": 0,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    insight_client = FakeInsightClient()
    result = retry_insights_once(
        json.dumps(
            {
                "task_id": task_id,
                "target": "insights",
                "preference_snapshot": valid_preference_snapshot(),
            },
            ensure_ascii=False,
        ),
        project_root=tmp_path,
        insight_client=insight_client,
        environ={
            OUTPUT_DIR_ENV: output_root.as_posix(),
            CACHE_DIR_ENV: cache_root.as_posix(),
        },
    )

    assert result["status"] == "completed"
    assert result["task_id"] == task_id
    assert "summary" not in result["artifacts"]
    assert "mindmap" not in result["artifacts"]
    assert result["artifacts"]["insights"] == "ai/insights.json"
    assert result["artifacts"]["preference_snapshot"] == "ai/preference-snapshot.json"
    assert not (task_dir / "ai" / "summary.md").exists()
    assert not (task_dir / "ai" / "mindmap.mmd").exists()
    assert (task_dir / "ai" / "insights.json").is_file()
    preference_snapshot = json.loads(
        (task_dir / "ai" / "preference-snapshot.json").read_text(encoding="utf-8")
    )
    assert preference_snapshot["generationPreferences"]["goal"] == "content_creation"
    assert preference_snapshot["profileSkipped"] is True
    assert insight_client.prompts
    for prompt in insight_client.prompts:
        assert "user edited official transcript" in prompt
        assert "stale markdown transcript" not in prompt
        assert "review-secret" not in prompt
        assert "xsec_token" not in prompt

    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "completed"
    assert manifest["artifacts"] == result["artifacts"]
    assert manifest["artifacts"]["preference_snapshot"] == "ai/preference-snapshot.json"
    assert manifest["insights_count"] == 1


def test_retry_quarantined_task_never_returns_sensitive_task_id(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    task_id = "legacy-xiaohongshu-review-secret"
    task_dir = output_root / "tasks" / task_id
    task_dir.mkdir(parents=True)
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "source_privacy_migration_version": 2,
                "source_privacy_quarantined": True,
                "task_id": task_id,
                "source_url": "",
                "platform": "xiaohongshu",
                "status": "completed",
                "artifacts": {},
                "error": None,
            }
        ),
        encoding="utf-8",
    )

    result = retry_insights_once(
        json.dumps({"task_id": task_id, "target": "insights"}),
        project_root=tmp_path,
        insight_client=None,
        environ={OUTPUT_DIR_ENV: output_root.as_posix()},
    )

    assert result["task_id"] is None
    assert result["error"]["code"] == "TASK_MANIFEST_NOT_FOUND"
    serialized = json.dumps(result)
    assert "review-secret" not in serialized
    assert task_id not in serialized


def test_retry_rejects_linked_transcript_before_reading_or_persisting_target(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    task_id = "20260710-120000-douyin-7524373044106677544"
    task_dir = output_root / "tasks" / task_id
    transcript_path = task_dir / "transcript" / "transcript.txt"
    transcript_path.parent.mkdir(parents=True)
    transcript_path.write_text("linked target review-secret\n", encoding="utf-8")
    manifest_path = task_dir / "frameq-task.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 3,
                "source_privacy_migration_version": 2,
                "source_privacy_quarantined": False,
                "task_id": task_id,
                "created_at": "2026-07-10T12:00:00Z",
                "source_url": "https://www.douyin.com/video/7524373044106677544",
                "source_identity": {
                    "version": 1,
                    "platform": "douyin",
                    "stable_id": "7524373044106677544",
                    "effective_part": None,
                    "canonical_url": "https://www.douyin.com/video/7524373044106677544",
                },
                "platform": "douyin",
                "status": "partial_completed",
                "model": "iic/SenseVoiceSmall",
                "artifacts": {"transcript_txt": "transcript/transcript.txt"},
                "error": None,
                "text_preview": "safe preview",
                "insights_count": 0,
            }
        ),
        encoding="utf-8",
    )
    real_is_symlink = Path.is_symlink

    def simulated_link(path: Path) -> bool:
        return path == transcript_path or real_is_symlink(path)

    monkeypatch.setattr(Path, "is_symlink", simulated_link)

    result = retry_insights_once(
        json.dumps({"task_id": task_id, "target": "summary"}),
        project_root=tmp_path,
        insight_client=FakeInsightClient(),
        environ={
            OUTPUT_DIR_ENV: output_root.as_posix(),
            CACHE_DIR_ENV: cache_root.as_posix(),
        },
    )

    serialized_result = json.dumps(result)
    persisted_manifest = manifest_path.read_text(encoding="utf-8")
    assert result["error"]["code"] == "TRANSCRIPT_TEXT_PATH_INVALID"
    assert "review-secret" not in serialized_result
    assert "review-secret" not in persisted_manifest


def test_retry_summary_target_preserves_existing_insights_count(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    task_id = "20260705-153012-douyin-7524373044106677544"
    task_dir = output_root / "tasks" / task_id
    transcript_dir = task_dir / "transcript"
    ai_dir = task_dir / "ai"
    transcript_dir.mkdir(parents=True)
    ai_dir.mkdir()
    (transcript_dir / "transcript.txt").write_text("saved transcript\n", encoding="utf-8")
    (transcript_dir / "transcript.md").write_text(
        "# Transcript\n\nsaved transcript\n",
        encoding="utf-8",
    )
    (ai_dir / "insights.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "insights": [
                    {
                        "id": 1,
                        "topic": "existing insight",
                        "matchReason": "matched",
                        "followUpQuestions": ["next"],
                        "suitableUse": "content planning",
                        "sourceChunkId": 1,
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (ai_dir / "insights.md").write_text("# 启发灵感\n", encoding="utf-8")
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": task_id,
                "created_at": "2026-07-05T15:30:12Z",
                "source_url": "https://www.douyin.com/video/7524373044106677544",
                "platform": "douyin",
                "status": "completed",
                "app_version": "app",
                "worker_version": "app",
                "model": "iic/SenseVoiceSmall",
                "artifacts": {
                    "transcript_txt": "transcript/transcript.txt",
                    "transcript_md": "transcript/transcript.md",
                    "insights": "ai/insights.json",
                    "insights_md": "ai/insights.md",
                },
                "error": None,
                "text_preview": "saved transcript",
                "insights_count": 1,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = retry_insights_once(
        json.dumps(
            {
                "task_id": task_id,
                "target": "summary",
            },
            ensure_ascii=False,
        ),
        project_root=tmp_path,
        insight_client=FakeInsightClient(),
        environ={
            OUTPUT_DIR_ENV: output_root.as_posix(),
            CACHE_DIR_ENV: cache_root.as_posix(),
        },
    )

    assert result["status"] == "completed"
    assert result["summary"].startswith("# summary")
    assert result["insights"][0]["topic"] == "existing insight"
    assert result["artifacts"]["summary"] == "ai/summary.md"
    assert result["artifacts"]["mindmap"] == "ai/mindmap.mmd"
    assert result["artifacts"]["insights"] == "ai/insights.json"
    assert "preference_snapshot" not in result["artifacts"]

    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "completed"
    assert manifest["artifacts"] == result["artifacts"]
    assert manifest["insights_count"] == 1


def test_retry_insights_target_preserves_existing_summary(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    task_id = "20260705-153012-douyin-7524373044106677544"
    task_dir = output_root / "tasks" / task_id
    transcript_dir = task_dir / "transcript"
    ai_dir = task_dir / "ai"
    transcript_dir.mkdir(parents=True)
    ai_dir.mkdir()
    (transcript_dir / "transcript.txt").write_text("saved transcript\n", encoding="utf-8")
    (transcript_dir / "transcript.md").write_text(
        "# Transcript\n\nsaved transcript\n",
        encoding="utf-8",
    )
    (ai_dir / "summary.md").write_text("# existing summary\n", encoding="utf-8")
    (ai_dir / "mindmap.mmd").write_text("mindmap\n  root((existing))\n", encoding="utf-8")
    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "task_id": task_id,
                "created_at": "2026-07-05T15:30:12Z",
                "source_url": "https://www.douyin.com/video/7524373044106677544",
                "platform": "douyin",
                "status": "completed",
                "app_version": "app",
                "worker_version": "app",
                "model": "iic/SenseVoiceSmall",
                "artifacts": {
                    "transcript_txt": "transcript/transcript.txt",
                    "transcript_md": "transcript/transcript.md",
                    "summary": "ai/summary.md",
                    "mindmap": "ai/mindmap.mmd",
                },
                "error": None,
                "text_preview": "saved transcript",
                "insights_count": 0,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = retry_insights_once(
        json.dumps(
            {
                "task_id": task_id,
                "target": "insights",
                "preference_snapshot": valid_preference_snapshot(),
            },
            ensure_ascii=False,
        ),
        project_root=tmp_path,
        insight_client=FakeInsightClient(),
        environ={
            OUTPUT_DIR_ENV: output_root.as_posix(),
            CACHE_DIR_ENV: cache_root.as_posix(),
        },
    )

    assert result["status"] == "completed"
    assert result["summary"] == "# existing summary"
    assert result["insights"][0]["topic"] == "retry question"
    assert result["artifacts"]["summary"] == "ai/summary.md"
    assert result["artifacts"]["mindmap"] == "ai/mindmap.mmd"
    assert result["artifacts"]["insights"] == "ai/insights.json"
    assert result["artifacts"]["preference_snapshot"] == "ai/preference-snapshot.json"

    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "completed"
    assert manifest["artifacts"] == result["artifacts"]
    assert manifest["insights_count"] == 1
