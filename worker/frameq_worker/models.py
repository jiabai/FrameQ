from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class JobStage(StrEnum):
    WAITING_INPUT = "waiting_input"
    VIDEO_EXTRACTING = "video_extracting"
    VIDEO_TRANSCRIBING = "video_transcribing"
    INSIGHTS_GENERATING = "insights_generating"
    COMPLETED = "completed"
    PARTIAL_COMPLETED = "partial_completed"
    FAILED = "failed"


@dataclass(frozen=True)
class ProcessRequest:
    url: str
    language: str = "Chinese"
    output_formats: tuple[str, ...] = ("txt", "md")
    model: str = "Qwen/Qwen3-ASR-0.6B"
    generate_insights: bool = True
    insightflow_mode: str = "embedded"


@dataclass(frozen=True)
class WorkerError:
    code: str
    message: str
    stage: JobStage

    def to_dict(self) -> dict[str, str]:
        return {
            "code": self.code,
            "message": self.message,
            "stage": self.stage.value,
        }


@dataclass(frozen=True)
class ProcessResult:
    status: JobStage
    video_path: str | None = None
    audio_path: str | None = None
    transcript_path: str | None = None
    insights_path: str | None = None
    text: str = ""
    insights: list[str] = field(default_factory=list)
    error: WorkerError | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "status": self.status.value,
            "video_path": self.video_path,
            "audio_path": self.audio_path,
            "transcript_path": self.transcript_path,
            "insights_path": self.insights_path,
            "text": self.text,
            "insights": self.insights,
            "error": self.error.to_dict() if self.error else None,
        }
