from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from frameq_worker.atomic_files import atomic_write_text
from frameq_worker.models import (
    PreferenceSnapshot,
    ProcessRequest,
    ProcessResult,
    TranscriptMetadata,
)
from frameq_worker.source_identity import (
    SOURCE_PRIVACY_MIGRATION_VERSION,
    SourceIdentity,
    canonical_url_for_persistence,
    source_identity_from_manifest,
)

TASK_MANIFEST_FILE_NAME = "frameq-task.json"
TASK_SCHEMA_VERSION = 3


@dataclass(frozen=True)
class TaskPaths:
    output_root: Path
    cache_root: Path
    task_id: str

    @property
    def task_dir(self) -> Path:
        return self.output_root / "tasks" / self.task_id

    @property
    def cache_task_dir(self) -> Path:
        return self.cache_root / "tasks" / self.task_id

    @property
    def download_dir(self) -> Path:
        return self.cache_task_dir / "download"

    @property
    def media_dir(self) -> Path:
        return self.task_dir / "media"

    @property
    def transcript_dir(self) -> Path:
        return self.task_dir / "transcript"

    @property
    def transcript_original_dir(self) -> Path:
        return self.transcript_dir / "original"

    @property
    def ai_dir(self) -> Path:
        return self.task_dir / "ai"

    @property
    def manifest_path(self) -> Path:
        return self.task_dir / TASK_MANIFEST_FILE_NAME

    @property
    def video_path(self) -> Path:
        return self.media_dir / "video.mp4"

    @property
    def audio_path(self) -> Path:
        return self.media_dir / "audio.wav"

    @property
    def transcript_txt_path(self) -> Path:
        return self.transcript_dir / "transcript.txt"

    @property
    def transcript_md_path(self) -> Path:
        return self.transcript_dir / "transcript.md"

    @property
    def segments_path(self) -> Path:
        return self.transcript_dir / "segments.json"

    @property
    def summary_path(self) -> Path:
        return self.ai_dir / "summary.md"

    @property
    def mindmap_path(self) -> Path:
        return self.ai_dir / "mindmap.mmd"

    @property
    def insights_json_path(self) -> Path:
        return self.ai_dir / "insights.json"

    @property
    def insights_md_path(self) -> Path:
        return self.ai_dir / "insights.md"

    @property
    def preference_snapshot_path(self) -> Path:
        return self.ai_dir / "preference-snapshot.json"


@dataclass(frozen=True)
class TaskContext:
    paths: TaskPaths
    source_identity: SourceIdentity
    platform: str
    model: str
    created_at: str
    worker_version: str = "app"
    app_version: str = "app"

    @property
    def task_id(self) -> str:
        return self.paths.task_id


@dataclass(frozen=True)
class OpenedTask:
    context: TaskContext
    transcript: TranscriptMetadata | None


@dataclass(frozen=True)
class TaskStoreFacade:
    output_root: Path
    cache_root: Path

    def create(
        self,
        request: ProcessRequest,
        source_identity: SourceIdentity,
        now: datetime | None = None,
    ) -> TaskContext:
        context = create_task_context(
            request,
            source_identity=source_identity,
            output_root=self.output_root,
            cache_root=self.cache_root,
            now=now,
        )
        ensure_task_dirs(context.paths)
        return context

    def open(self, task_id: str) -> OpenedTask:
        manifest = load_task_manifest(self.output_root, task_id)
        context = task_context_from_loaded_manifest(
            self.output_root,
            self.cache_root,
            task_id,
            manifest,
        )
        ensure_task_dirs(context.paths)
        return OpenedTask(
            context=context,
            transcript=transcript_metadata_from_manifest(manifest),
        )

    def finalize(self, context: TaskContext, result: ProcessResult) -> ProcessResult:
        task_result = result_with_task(
            result,
            context,
            artifacts=task_artifacts_for_existing_files(context.paths),
        )
        write_task_manifest(context, task_result)
        return task_result

    def save_preference_snapshot(
        self,
        context: TaskContext,
        snapshot: PreferenceSnapshot,
    ) -> None:
        write_preference_snapshot_artifact(context.paths, snapshot)


def create_task_context(
    request: ProcessRequest,
    source_identity: SourceIdentity,
    output_root: Path,
    cache_root: Path,
    now: datetime | None = None,
) -> TaskContext:
    created = (now or datetime.now(UTC)).astimezone(UTC)
    canonical_url_for_persistence(source_identity)
    platform = source_identity.platform
    part_suffix = ""
    if source_identity.effective_part and source_identity.effective_part > 1:
        part_suffix = f"-p{source_identity.effective_part}"
    source_slug = f"{source_identity.stable_id[: 80 - len(part_suffix)]}{part_suffix}"
    timestamp = created.strftime("%Y%m%d-%H%M%S")
    task_id = f"{timestamp}-{platform}-{source_slug}"
    paths = TaskPaths(output_root=output_root, cache_root=cache_root, task_id=task_id)
    return TaskContext(
        paths=paths,
        source_identity=source_identity,
        platform=platform,
        model=request.asr_model,
        created_at=created.isoformat(timespec="seconds").replace("+00:00", "Z"),
    )


def ensure_task_dirs(paths: TaskPaths) -> None:
    for directory in [
        paths.media_dir,
        paths.transcript_dir,
        paths.ai_dir,
        paths.download_dir,
    ]:
        directory.mkdir(parents=True, exist_ok=True)


def task_artifacts_for_existing_files(paths: TaskPaths) -> dict[str, str]:
    candidates = {
        "video": paths.video_path,
        "audio": paths.audio_path,
        "transcript_txt": paths.transcript_txt_path,
        "transcript_md": paths.transcript_md_path,
        "segments": paths.segments_path,
        "summary": paths.summary_path,
        "mindmap": paths.mindmap_path,
        "insights": paths.insights_json_path,
        "insights_md": paths.insights_md_path,
        "preference_snapshot": paths.preference_snapshot_path,
    }
    return {
        key: path.relative_to(paths.task_dir).as_posix()
        for key, path in candidates.items()
        if _is_committed_regular_file(path)
    }


def _is_committed_regular_file(path: Path) -> bool:
    try:
        return path.is_file() and not _is_link_or_junction(path)
    except OSError:
        return False


def result_with_task(
    result: ProcessResult,
    context: TaskContext,
    artifacts: dict[str, str] | None = None,
) -> ProcessResult:
    return ProcessResult(
        status=result.status,
        task_id=context.task_id,
        task_dir=context.paths.task_dir.as_posix(),
        artifacts=(
            artifacts if artifacts is not None else task_artifacts_for_existing_files(context.paths)
        ),
        text=result.text,
        summary=result.summary,
        insights=result.insights,
        transcript=result.transcript,
        error=result.error,
    )


def write_task_manifest(context: TaskContext, result: ProcessResult) -> None:
    source_identity = context.source_identity
    canonical_url = canonical_url_for_persistence(source_identity)
    context.paths.task_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": TASK_SCHEMA_VERSION,
        "source_privacy_migration_version": SOURCE_PRIVACY_MIGRATION_VERSION,
        "source_privacy_quarantined": False,
        "task_id": context.task_id,
        "created_at": context.created_at,
        "updated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source_url": canonical_url or "",
        "source_identity": source_identity.to_manifest_dict(),
        "platform": context.platform,
        "status": result.status.value,
        "app_version": context.app_version,
        "worker_version": context.worker_version,
        "model": context.model,
        "transcript": result.transcript.to_dict() if result.transcript else None,
        "artifacts": result.artifacts,
        "error": result.error.to_dict() if result.error else None,
        "text_preview": result.text.strip()[:180],
        "insights_count": len(result.insights),
    }
    atomic_write_text(
        context.paths.manifest_path,
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    )


def write_preference_snapshot_artifact(
    paths: TaskPaths,
    snapshot: PreferenceSnapshot,
) -> None:
    paths.ai_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_text(
        paths.preference_snapshot_path,
        json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2) + "\n",
    )


def load_task_manifest(output_root: Path, task_id: str) -> dict[str, object]:
    manifest_path = _validated_task_manifest_path(output_root, task_id)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_identity = source_identity_from_manifest(manifest.get("source_identity"))
    if source_identity is None:
        raise ValueError("Task is unavailable in the current history format.")
    if (
        manifest.get("schema_version") != TASK_SCHEMA_VERSION
        or manifest.get("source_privacy_migration_version")
        != SOURCE_PRIVACY_MIGRATION_VERSION
        or manifest.get("source_privacy_quarantined") is True
        or source_identity is None
        or manifest.get("source_url") != source_identity.canonical_url
    ):
        raise ValueError("Task is unavailable in the current history format.")
    return manifest


def _validated_task_manifest_path(output_root: Path, task_id: str) -> Path:
    task_id_path = Path(task_id)
    if (
        task_id_path.is_absolute()
        or len(task_id_path.parts) != 1
        or task_id_path.name != task_id
        or task_id in {"", ".", ".."}
    ):
        raise ValueError("Task id must be a single directory name.")

    tasks_root = (output_root / "tasks").resolve()
    task_dir = output_root / "tasks" / task_id
    manifest_path = task_dir / TASK_MANIFEST_FILE_NAME
    if (
        _is_link_or_junction(task_dir)
        or _is_link_or_junction(manifest_path)
        or not task_dir.is_dir()
        or not manifest_path.is_file()
    ):
        raise ValueError("Task storage is unavailable or linked.")
    try:
        if not task_dir.resolve().is_relative_to(tasks_root):
            raise ValueError("Task storage is outside the configured output root.")
    except OSError as exc:
        raise ValueError("Task storage could not be resolved.") from exc
    return manifest_path


def _is_link_or_junction(path: Path) -> bool:
    is_junction = getattr(os.path, "isjunction", lambda _path: False)
    return path.is_symlink() or bool(is_junction(path))


def task_context_from_manifest(output_root: Path, cache_root: Path, task_id: str) -> TaskContext:
    manifest = load_task_manifest(output_root, task_id)
    return task_context_from_loaded_manifest(
        output_root,
        cache_root,
        task_id,
        manifest,
    )


def task_context_from_loaded_manifest(
    output_root: Path,
    cache_root: Path,
    task_id: str,
    manifest: dict[str, object],
) -> TaskContext:
    source_identity = source_identity_from_manifest(manifest.get("source_identity"))
    source_url = manifest.get("source_url")
    if source_identity is not None:
        if source_url != source_identity.canonical_url:
            raise ValueError("Task source identity is inconsistent.")
    elif source_url != "" or "source_identity" in manifest:
        raise ValueError("Task source identity is unavailable or invalid.")
    model = str(manifest.get("model") or "iic/SenseVoiceSmall")
    platform = (
        source_identity.platform
        if source_identity
        else str(manifest.get("platform") or "source")
    )
    created_at = str(
        manifest.get("created_at")
        or datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    return TaskContext(
        paths=TaskPaths(output_root=output_root, cache_root=cache_root, task_id=task_id),
        source_identity=source_identity,
        platform=platform,
        model=model,
        created_at=created_at,
        app_version=str(manifest.get("app_version") or "app"),
        worker_version=str(manifest.get("worker_version") or "app"),
    )


def transcript_metadata_from_manifest(
    manifest: dict[str, object],
) -> TranscriptMetadata | None:
    raw_transcript = manifest.get("transcript")
    if not isinstance(raw_transcript, dict):
        return None
    source = raw_transcript.get("source")
    if source not in {"asr", "subtitle"}:
        return None
    language = raw_transcript.get("language")
    engine = raw_transcript.get("engine")
    return TranscriptMetadata(
        source=source,
        language=language if isinstance(language, str) else None,
        engine=engine if isinstance(engine, str) else None,
    )
