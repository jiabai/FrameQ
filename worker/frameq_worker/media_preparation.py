from __future__ import annotations

import os
import secrets
import shutil
from dataclasses import dataclass
from pathlib import Path

from frameq_worker.atomic_files import AtomicFileCommitError, staged_file
from frameq_worker.desktop_contract import ProgressCallback
from frameq_worker.media import (
    CommandExecutionError,
    CommandRunner,
    MediaInfo,
    download_video,
    extract_audio,
    probe_media_file,
)
from frameq_worker.models import JobStage, ProcessLocalMediaRequest
from frameq_worker.progress_events import build_worker_progress_event
from frameq_worker.source_resolution import SourceRequest, sanitize_source_text
from frameq_worker.subtitles import SubtitleTranscript, find_subtitle_transcript
from frameq_worker.task_store import TaskContext

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}


@dataclass(frozen=True, slots=True)
class UrlMediaSource:
    request: SourceRequest


@dataclass(frozen=True, slots=True)
class LocalMediaSource:
    request: ProcessLocalMediaRequest


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
        source: UrlMediaSource | LocalMediaSource,
        task_context: TaskContext,
    ) -> PreparedMedia:
        if isinstance(source, UrlMediaSource):
            return self._prepare_url(source, task_context)
        if isinstance(source, LocalMediaSource):
            return self._prepare_local(source, task_context)
        raise TypeError("Unsupported media source.")

    def _prepare_url(
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

    def _prepare_local(
        self,
        source: LocalMediaSource,
        task_context: TaskContext,
    ) -> PreparedMedia:
        request = source.request
        self._emit("local.media.validating", 18)
        staging_path = self._stage_local_source(request, task_context)
        try:
            media_info = self._probe_local_source(staging_path)
            self._validate_local_streams(request, media_info)
            if request.media_kind == "video":
                self._emit("local.video.copying", 34)
                video_path = task_context.paths.video_path_for_extension(
                    request.source_extension
                )
                self._commit_local_video(staging_path, video_path)
                self._emit("audio.extract.running", 48)
                audio_path = self._normalize_local_audio(video_path, task_context)
                return PreparedMedia(
                    video_path=video_path,
                    audio_path=audio_path,
                    subtitle_candidate=None,
                )

            self._emit("local.audio.normalizing", 34)
            audio_path = self._normalize_local_audio(staging_path, task_context)
            return PreparedMedia(
                video_path=None,
                audio_path=audio_path,
                subtitle_candidate=None,
            )
        finally:
            _remove_file_best_effort(staging_path)

    def _stage_local_source(
        self,
        request: ProcessLocalMediaRequest,
        task_context: TaskContext,
    ) -> Path:
        task_context.paths.download_dir.mkdir(parents=True, exist_ok=True)
        staging_path = task_context.paths.download_dir / (
            f"local-source-{secrets.token_hex(8)}.{request.source_extension}"
        )
        error_code = (
            "LOCAL_VIDEO_COPY_FAILED"
            if request.media_kind == "video"
            else "AUDIO_NORMALIZATION_FAILED"
        )
        error_message = (
            "Local video could not be copied safely."
            if request.media_kind == "video"
            else "Local audio could not be prepared safely."
        )
        try:
            _copy_file_bounded(request.source_path, staging_path)
        except OSError:
            _remove_file_best_effort(staging_path)
            raise MediaPreparationError(error_code, error_message) from None
        return staging_path

    def _probe_local_source(self, staging_path: Path) -> MediaInfo:
        try:
            return probe_media_file(staging_path, runner=self.command_runner)
        except (CommandExecutionError, ValueError, OSError):
            raise MediaPreparationError(
                "LOCAL_MEDIA_VALIDATION_FAILED",
                "Local media could not be validated.",
            ) from None

    def _validate_local_streams(
        self,
        request: ProcessLocalMediaRequest,
        media_info: MediaInfo,
    ) -> None:
        has_video = media_info.has_video
        has_audio = media_info.has_audio
        is_valid_audio = media_info.is_valid_audio
        if request.media_kind == "video":
            if not has_video:
                code = (
                    "LOCAL_MEDIA_KIND_MISMATCH"
                    if has_audio
                    else "LOCAL_VIDEO_STREAM_MISSING"
                )
                raise MediaPreparationError(
                    code,
                    "Local video must contain a valid video stream.",
                )
            if not has_audio:
                raise MediaPreparationError(
                    "LOCAL_VIDEO_AUDIO_STREAM_MISSING",
                    "Local video must contain a valid audio stream.",
                )
            if not is_valid_audio:
                raise MediaPreparationError(
                    "LOCAL_MEDIA_VALIDATION_FAILED",
                    "Local video stream metadata is invalid.",
                )
            return

        if not has_audio:
            code = "LOCAL_MEDIA_KIND_MISMATCH" if has_video else "LOCAL_AUDIO_STREAM_MISSING"
            raise MediaPreparationError(
                code,
                "Local audio must contain a valid audio stream.",
            )
        if not is_valid_audio:
            raise MediaPreparationError(
                "LOCAL_MEDIA_VALIDATION_FAILED",
                "Local audio stream metadata is invalid.",
            )

    def _commit_local_video(self, source_path: Path, destination_path: Path) -> None:
        try:
            with staged_file(
                destination_path,
                validator=self._validate_local_video,
            ) as staging_path:
                _copy_file_bounded(source_path, staging_path)
        except MediaPreparationError:
            raise
        except (AtomicFileCommitError, OSError):
            raise MediaPreparationError(
                "LOCAL_VIDEO_COPY_FAILED",
                "Local video could not be copied safely.",
            ) from None

    def _validate_local_video(self, video_path: Path) -> None:
        media_info = self._probe_local_source(video_path)
        if not media_info.is_valid:
            raise MediaPreparationError(
                "LOCAL_MEDIA_VALIDATION_FAILED",
                "Local video must contain valid video and audio streams.",
            )

    def _normalize_local_audio(
        self,
        source_path: Path,
        task_context: TaskContext,
    ) -> Path:
        audio_path = task_context.paths.audio_path
        try:
            with staged_file(
                audio_path,
                validator=self._validate_local_normalized_audio,
            ) as staging_path:
                extract_audio(
                    source_path,
                    staging_path,
                    runner=self.command_runner,
                )
        except (CommandExecutionError, AtomicFileCommitError):
            raise MediaPreparationError(
                "AUDIO_NORMALIZATION_FAILED",
                "Local audio could not be normalized safely.",
            ) from None
        return audio_path

    def _validate_local_normalized_audio(self, audio_path: Path) -> None:
        try:
            audio_info = probe_media_file(audio_path, runner=self.command_runner)
        except (CommandExecutionError, ValueError, OSError):
            raise MediaPreparationError(
                "AUDIO_NORMALIZATION_FAILED",
                "Normalized audio could not be validated.",
            ) from None
        if not audio_info.is_normalized_pcm_wav:
            raise MediaPreparationError(
                "AUDIO_NORMALIZATION_FAILED",
                "Normalized audio must be 16 kHz mono 16-bit PCM WAV.",
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


def _copy_file_bounded(source_path: Path, destination_path: Path) -> None:
    with source_path.open("rb") as source, destination_path.open("xb") as destination:
        while chunk := source.read(1024 * 1024):
            destination.write(chunk)
        destination.flush()
        os.fsync(destination.fileno())


def _remove_file_best_effort(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
