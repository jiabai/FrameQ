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
    model: str = "iic/SenseVoiceSmall"
    generate_insights: bool = True
    insightflow_mode: str = "embedded"


@dataclass(frozen=True)
class RetryInsightsRequest:
    task_id: str


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
    task_id: str | None = None
    task_dir: str | None = None
    artifacts: dict[str, str] = field(default_factory=dict)
    text: str = ""
    summary: str = ""
    insights: list[str] = field(default_factory=list)
    error: WorkerError | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "status": self.status.value,
            "task_id": self.task_id,
            "task_dir": self.task_dir,
            "artifacts": self.artifacts,
            "text": self.text,
            "summary": self.summary,
            "insights": self.insights,
            "error": self.error.to_dict() if self.error else None,
        }
