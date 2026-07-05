from __future__ import annotations

import json
from pathlib import Path

from frameq_worker.asr import Transcript
from frameq_worker.desktop_contract import OUTPUT_DIR_ENV, WORK_DIR_ENV
from frameq_worker.media import CommandResult
from frameq_worker.models import ProcessRequest
from frameq_worker.pipeline import run_worker_pipeline
from frameq_worker.worker_service import retry_insights_once


class FakeTranscriber:
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        return Transcript(text="task transcript", language=language)


class FakeInsightClient:
    def __init__(self) -> None:
        self.calls = 0

    def generate(self, prompt: str) -> str:
        self.calls += 1
        if self.calls == 1:
            return "mindmap\n  root((retry))"
        if self.calls == 2:
            return "# summary\n\nretry summary"
        if self.calls == 3:
            return '[{"title":"topic","summary":"summary","excerpt":"excerpt","question_count":1}]'
        return '["retry question"]'


def test_worker_pipeline_writes_task_owned_artifacts_and_manifest(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    work_root = tmp_path / "work"

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
            WORK_DIR_ENV: work_root.as_posix(),
        },
    ).to_dict()

    assert result["status"] == "completed"
    assert str(result["task_id"]).endswith("-douyin-7524373044106677544")
    assert result["artifacts"] == {
        "video": "media/video.mp4",
        "audio": "media/audio.wav",
        "transcript_txt": "transcript/transcript.txt",
        "transcript_md": "transcript/transcript.md",
    }

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
    assert manifest["schema_version"] == 1
    assert manifest["task_id"] == result["task_id"]
    assert manifest["source_url"] == "https://www.douyin.com/video/7524373044106677544"
    assert manifest["platform"] == "douyin"
    assert manifest["status"] == "completed"
    assert manifest["artifacts"] == result["artifacts"]
    assert manifest["text_preview"] == "task transcript"


def test_retry_insights_uses_task_manifest_and_updates_same_task(tmp_path: Path) -> None:
    output_root = tmp_path / "outputs"
    work_root = tmp_path / "work"
    task_id = "20260705-153012-douyin-7524373044106677544"
    task_dir = output_root / "tasks" / task_id
    transcript_dir = task_dir / "transcript"
    transcript_dir.mkdir(parents=True)
    (transcript_dir / "transcript.txt").write_text("saved transcript\n", encoding="utf-8")
    (transcript_dir / "transcript.md").write_text(
        "# Transcript\n\nsaved transcript\n",
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

    result = retry_insights_once(
        json.dumps({"task_id": task_id}),
        project_root=tmp_path,
        insight_client=FakeInsightClient(),
        environ={
            OUTPUT_DIR_ENV: output_root.as_posix(),
            WORK_DIR_ENV: work_root.as_posix(),
        },
    )

    assert result["status"] == "completed"
    assert result["task_id"] == task_id
    assert result["artifacts"]["summary"] == "ai/summary.md"
    assert result["artifacts"]["mindmap"] == "ai/mindmap.mmd"
    assert result["artifacts"]["insights"] == "ai/insights.json"
    assert (task_dir / "ai" / "summary.md").is_file()
    assert (task_dir / "ai" / "mindmap.mmd").is_file()
    assert (task_dir / "ai" / "insights.json").is_file()

    manifest = json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "completed"
    assert manifest["artifacts"] == result["artifacts"]
    assert manifest["insights_count"] == 1
