from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

from frameq_worker.atomic_files import AtomicFileCommitError, staged_file
from frameq_worker.desktop_contract import ProgressCallback
from frameq_worker.media import (
    CommandExecutionError,
    CommandRunner,
    download_video,
    extract_audio,
    probe_media_file,
)
from frameq_worker.models import JobStage
from frameq_worker.progress_events import build_worker_progress_event
from frameq_worker.source_resolution import SourceRequest, sanitize_source_text
from frameq_worker.subtitles import SubtitleTranscript, find_subtitle_transcript
from frameq_worker.task_store import TaskContext

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}


@dataclass(frozen=True, slots=True)
class UrlMediaSource:
    request: SourceRequest


@dataclass(frozen=True, slots=True)
class PreparedMedia:
    video_path: Path | None
    audio_path: Path
    subtitle_candidate: SubtitleTranscript | None


class MediaPreparationError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.stage = JobStage.VIDEO_EXTRACTING


@dataclass(frozen=True, slots=True)
class MediaPreparationFacade:
    command_runner: CommandRunner
    progress_callback: ProgressCallback | None = None

    def prepare(
        self,
        source: UrlMediaSource,
        task_context: TaskContext,
    ) -> PreparedMedia:
        download_dir = task_context.paths.download_dir
        previous_snapshot = snapshot_video_files(download_dir)
        self._emit("video.download.preparing", 18)
        try:
            download_result = download_video(
                source.request.download_url,
                output_dir=download_dir,
                runner=self.command_runner,
                progress_callback=self.progress_callback,
            )
        except CommandExecutionError as exc:
            raise MediaPreparationError(
                "VIDEO_DOWNLOAD_FAILED",
                sanitize_source_text(str(exc), source.request),
            ) from exc

        self._emit("video.stream.validating", 34)
        video_path = find_video_from_download_stdout(download_result.stdout, download_dir)
        if video_path is None:
            video_path = find_video_by_stem(
                download_dir,
                source.request.identity.stable_id,
            )
        if video_path is None:
            video_path = find_new_or_updated_video(download_dir, previous_snapshot)
        if video_path is None:
            video_path = find_latest_video(download_dir)
        if video_path is None:
            raise MediaPreparationError(
                "VIDEO_DOWNLOAD_OUTPUT_MISSING",
                "Video download completed but no media file was found.",
            )

        try:
            media_info = probe_media_file(video_path, runner=self.command_runner)
        except (CommandExecutionError, ValueError) as exc:
            raise MediaPreparationError(
                "MEDIA_VALIDATION_FAILED",
                "Downloaded media could not be validated.",
            ) from exc
        if not media_info.is_valid:
            raise MediaPreparationError(
                "MEDIA_VALIDATION_FAILED",
                "Downloaded file must contain valid video and audio streams.",
            )

        self._commit_video(video_path, task_context.paths.video_path)
        audio_path = self._prepare_audio(task_context.paths.video_path, task_context)

        self._emit(
            "subtitle.detect.running",
            58,
            stage=JobStage.VIDEO_TRANSCRIBING,
        )
        subtitle_candidate = (
            None
            if download_result.command and download_result.command[0] == "bilibili-fallback"
            else find_subtitle_transcript(download_dir)
        )
        return PreparedMedia(
            video_path=task_context.paths.video_path,
            audio_path=audio_path,
            subtitle_candidate=subtitle_candidate,
        )

    def _commit_video(self, source_path: Path, destination_path: Path) -> None:
        try:
            with staged_file(
                destination_path,
                validator=self._validate_staged_video,
            ) as staging_path:
                shutil.copy2(source_path, staging_path)
        except AtomicFileCommitError as exc:
            raise MediaPreparationError(
                "MEDIA_VALIDATION_FAILED",
                "Prepared video could not be stored safely.",
            ) from exc

    def _validate_staged_video(self, video_path: Path) -> None:
        try:
            media_info = probe_media_file(video_path, runner=self.command_runner)
        except (CommandExecutionError, ValueError) as exc:
            raise MediaPreparationError(
                "MEDIA_VALIDATION_FAILED",
                "Prepared video could not be validated.",
            ) from exc
        if not media_info.is_valid:
            raise MediaPreparationError(
                "MEDIA_VALIDATION_FAILED",
                "Prepared video must contain valid video and audio streams.",
            )

    def _prepare_audio(self, video_path: Path, task_context: TaskContext) -> Path:
        self._emit("audio.extract.running", 48)
        audio_path = task_context.paths.audio_path
        if can_reuse_audio(audio_path, self.command_runner):
            self._emit("audio.extract.reused", 50)
            return audio_path
        try:
            with staged_file(
                audio_path,
                validator=self._validate_staged_audio,
            ) as staging_path:
                extract_audio(
                    video_path,
                    staging_path,
                    runner=self.command_runner,
                )
        except CommandExecutionError as exc:
            raise MediaPreparationError(
                "AUDIO_EXTRACTION_FAILED",
                "Audio extraction failed.",
            ) from exc
        except AtomicFileCommitError as exc:
            raise MediaPreparationError(
                "AUDIO_EXTRACTION_FAILED",
                "Extracted audio could not be stored safely.",
            ) from exc
        return audio_path

    def _validate_staged_audio(self, audio_path: Path) -> None:
        try:
            audio_info = probe_media_file(audio_path, runner=self.command_runner)
        except (CommandExecutionError, ValueError) as exc:
            raise MediaPreparationError(
                "AUDIO_EXTRACTION_FAILED",
                "Extracted audio could not be validated.",
            ) from exc
        if not audio_info.is_valid_audio:
            raise MediaPreparationError(
                "AUDIO_EXTRACTION_FAILED",
                "Extracted audio could not be validated.",
            )

    def _emit(
        self,
        message_code: str,
        progress: int,
        *,
        stage: JobStage = JobStage.VIDEO_EXTRACTING,
    ) -> None:
        if self.progress_callback is None:
            return
        self.progress_callback(
            build_worker_progress_event(
                message_code,
                stage=stage.value,
                progress=progress,
            )
        )


def find_latest_video(output_dir: Path) -> Path | None:
    if not output_dir.exists():
        return None
    candidates = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES
    ]
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def snapshot_video_files(output_dir: Path) -> dict[str, tuple[int, int]]:
    if not output_dir.exists():
        return {}
    snapshot: dict[str, tuple[int, int]] = {}
    for path in output_dir.iterdir():
        if not path.is_file() or path.suffix.lower() not in VIDEO_SUFFIXES:
            continue
        stat = path.stat()
        snapshot[path.as_posix()] = (stat.st_mtime_ns, stat.st_size)
    return snapshot


def find_new_or_updated_video(
    output_dir: Path,
    previous_snapshot: dict[str, tuple[int, int]],
) -> Path | None:
    if not output_dir.exists():
        return None
    candidates: list[Path] = []
    for path in output_dir.iterdir():
        if not path.is_file() or path.suffix.lower() not in VIDEO_SUFFIXES:
            continue
        stat = path.stat()
        if previous_snapshot.get(path.as_posix()) != (stat.st_mtime_ns, stat.st_size):
            candidates.append(path)
    return max(candidates, key=lambda path: path.stat().st_mtime_ns) if candidates else None


def find_video_by_stem(output_dir: Path, stem: str | None) -> Path | None:
    if stem is None or not output_dir.exists():
        return None
    candidates = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.stem == stem and path.suffix.lower() in VIDEO_SUFFIXES
    ]
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def find_video_from_download_stdout(stdout: str, output_dir: Path) -> Path | None:
    if not stdout.strip() or not output_dir.exists():
        return None
    try:
        output_root = output_dir.resolve()
    except OSError:
        return None
    for raw_line in reversed(stdout.splitlines()):
        raw_path = raw_line.strip().strip("\"'")
        if not raw_path:
            continue
        candidate = Path(raw_path)
        if not candidate.is_absolute():
            candidate = output_dir / candidate
        try:
            resolved_candidate = candidate.resolve()
        except OSError:
            continue
        if not resolved_candidate.is_relative_to(output_root):
            continue
        if candidate.is_file() and candidate.suffix.lower() in VIDEO_SUFFIXES:
            return candidate
    return None


def can_reuse_audio(audio_path: Path, runner: CommandRunner) -> bool:
    if not audio_path.exists():
        return False
    try:
        audio_info = probe_media_file(audio_path, runner=runner)
    except (CommandExecutionError, ValueError):
        return False
    return audio_info.is_valid_audio
