from __future__ import annotations

import json
import os
import re
import secrets
import unicodedata
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path

from worker_core.atomic_files import atomic_write_text
from worker_core.desktop_contract import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS
from worker_core.models import (
    LocalMediaKind,
    PreferenceSnapshot,
    ProcessLocalMediaRequest,
    ProcessRequest,
    ProcessResult,
    TranscriptMetadata,
)
from worker_core.note_title_metadata import NoteTitleMetadata, parse_note_title_metadata
from worker_core.source_identity import (
    SOURCE_PRIVACY_MIGRATION_VERSION,
    SourceIdentity,
    canonical_url_for_persistence,
    source_identity_from_manifest,
)
from worker_core.task_transaction import (
    ARTIFACT_KEY_BY_RELATIVE_PATH,
    TaskArtifactCommitError,
    commit_task_artifacts,
    recover_task_artifacts,
)
from worker_core.web_page_contract import WebPageSource, validate_web_task_id

TASK_MANIFEST_FILE_NAME = "task.json"
TASK_SCHEMA_VERSION = 3
_LOCAL_TASK_RANDOM_ID_PATTERN = re.compile(r"^[a-z0-9]{6,32}$")

# Sentinel for ``write_task_manifest(draft_seed_insight_id=...)``: when the caller
# does not pass an explicit value, the seed id is carried forward from the prior
# manifest on disk (preserve-by-default). Pass ``None`` to clear it (insights
# regen) or an ``int`` to set it (draft generation). Keeping this distinct from
# ``None`` lets the caller signal "I don't care, keep what's there" vs "clear it".
DRAFT_SEED_UNSET: object = object()


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
    def article_txt_path(self) -> Path:
        return self.task_dir / "article" / "article.txt"

    @property
    def article_md_path(self) -> Path:
        return self.task_dir / "article" / "article.md"

    @property
    def transcript_original_dir(self) -> Path:
        return self.transcript_dir / "original"

    @property
    def ai_dir(self) -> Path:
        return self.task_dir / "ai"

    @property
    def draft_original_dir(self) -> Path:
        return self.ai_dir / "original"

    @property
    def draft_original_path(self) -> Path:
        return self.draft_original_dir / "draft.md"

    @property
    def manifest_path(self) -> Path:
        return self.task_dir / TASK_MANIFEST_FILE_NAME

    @property
    def video_path(self) -> Path:
        return self.video_path_for_extension("mp4")

    def video_path_for_extension(self, extension: str) -> Path:
        if extension not in VIDEO_EXTENSIONS:
            raise ValueError("Task video extension is unsupported.")
        return self.media_dir / f"video.{extension}"

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
    def transcript_polished_txt_path(self) -> Path:
        return self.transcript_dir / "polished.txt"

    @property
    def transcript_polished_meta_path(self) -> Path:
        return self.transcript_dir / "polished.meta.json"

    @property
    def summary_path(self) -> Path:
        return self.ai_dir / "summary.md"

    @property
    def draft_path(self) -> Path:
        return self.ai_dir / "draft.md"

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

    @property
    def dissection_json(self) -> Path:
        return self.ai_dir / "dissection.json"

    @property
    def dissection_markdown(self) -> Path:
        return self.ai_dir / "dissection.md"


@dataclass(frozen=True)
class UrlTaskSource:
    identity: SourceIdentity = field(repr=False)


@dataclass(frozen=True)
class LocalFileTaskSource:
    display_name: str = field(repr=False)
    media_kind: LocalMediaKind
    extension: str

    def __post_init__(self) -> None:
        if not _is_valid_local_source(
            self.display_name,
            self.media_kind,
            self.extension,
        ):
            raise ValueError("Local task source is invalid.")


TaskSource = UrlTaskSource | LocalFileTaskSource | WebPageSource


@dataclass(frozen=True)
class TaskContext:
    paths: TaskPaths
    source: TaskSource
    model: str | None
    created_at: str
    worker_version: str = "app"
    app_version: str = "app"

    @property
    def task_id(self) -> str:
        return self.paths.task_id

    @property
    def source_identity(self) -> SourceIdentity | None:
        if isinstance(self.source, UrlTaskSource):
            return self.source.identity
        return None

    @property
    def platform(self) -> str:
        if isinstance(self.source, UrlTaskSource):
            return self.source.identity.platform
        if isinstance(self.source, WebPageSource):
            return "web"
        return "local"


@dataclass(frozen=True)
class OpenedTask:
    context: TaskContext
    transcript: TranscriptMetadata | None
    note_title: NoteTitleMetadata | None = None


@dataclass(frozen=True)
class TaskStoreFacade:
    output_root: Path
    cache_root: Path

    def create_web(
        self, source: WebPageSource, now: datetime | None = None, *, task_id: str | None = None,
    ) -> TaskContext:
        created = (now or datetime.now(UTC)).astimezone(UTC)
        task_id = validate_web_task_id(
            task_id if task_id is not None
            else f"{created:%Y%m%d-%H%M%S}-web-{secrets.token_hex(8)}"
        )
        context = TaskContext(
            TaskPaths(self.output_root, self.cache_root, task_id), source, None,
            created.isoformat(timespec="seconds").replace("+00:00", "Z"),
        )
        context.paths.task_dir.mkdir(parents=True, exist_ok=False)
        return context

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

    def create_local(
        self,
        request: ProcessLocalMediaRequest,
        now: datetime | None = None,
        random_id: str | None = None,
    ) -> TaskContext:
        context = create_local_task_context(
            request,
            output_root=self.output_root,
            cache_root=self.cache_root,
            now=now,
            random_id=random_id,
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
        if not isinstance(context.source, WebPageSource):
            ensure_task_dirs(context.paths)
        return OpenedTask(
            context=context,
            transcript=transcript_metadata_from_manifest(manifest),
            note_title=note_title_from_manifest(manifest),
        )

    def finalize(
        self,
        context: TaskContext,
        result: ProcessResult,
        *,
        draft_seed_insight_id: int | None | object = DRAFT_SEED_UNSET,
    ) -> ProcessResult:
        recover_task_artifacts(context.paths.task_dir)
        if result.note_title is None and context.paths.manifest_path.exists():
            prior = load_task_manifest(self.output_root, context.task_id)
            result = replace(result, note_title=note_title_from_manifest(prior))
        artifact_payloads = result.artifact_payloads
        article_paths = {"article/article.txt", "article/article.md"}
        media_paths = {
            "transcript/transcript.txt", "transcript/transcript.md", "transcript/segments.json",
        }
        if isinstance(context.source, WebPageSource):
            if (result.transcript is not None or result.note_title is not None
                    or set(artifact_payloads) & media_paths):
                raise TaskArtifactCommitError()
        elif set(artifact_payloads) & article_paths:
            raise TaskArtifactCommitError()
        artifacts = (
            _artifacts_after_payloads(context, artifact_payloads)
            if artifact_payloads
            else task_artifacts_for_existing_files(context.paths, context.source)
        )
        task_result = result_with_task(
            result,
            context,
            artifacts=artifacts,
        )
        if artifact_payloads:
            commit_task_artifacts(
                context.paths.task_dir,
                {
                    **artifact_payloads,
                    TASK_MANIFEST_FILE_NAME: serialize_task_manifest(
                        context,
                        task_result,
                        draft_seed_insight_id=draft_seed_insight_id,
                    ),
                },
            )
        else:
            write_task_manifest(
                context,
                task_result,
                draft_seed_insight_id=draft_seed_insight_id,
            )
        return task_result

    def read_note_title_transcript(self, context: TaskContext) -> str:
        if isinstance(context.source, WebPageSource):
            raise ValueError("Web page title generation is unavailable.")
        manifest = load_task_manifest(self.output_root, context.task_id)
        current = task_context_from_loaded_manifest(
            self.output_root, self.cache_root, context.task_id, manifest,
        )
        if current != context or manifest.get("task_id") != context.task_id:
            raise ValueError("Task identity changed.")
        if (
            not isinstance(manifest.get("artifacts"), dict)
            or manifest["artifacts"].get("transcript_txt") != "transcript/transcript.txt"
        ):
            raise ValueError("An authoritative saved transcript is required.")
        path = context.paths.transcript_txt_path
        if (
            _is_link_or_junction(path.parent)
            or not _is_committed_regular_file(path)
            or path.stat().st_nlink != 1
        ):
            raise ValueError("Authoritative transcript storage is invalid.")
        body = path.read_text(encoding="utf-8")
        if not body.strip():
            raise ValueError("The authoritative transcript is empty.")
        return body

    def save_note_title(
        self, context: TaskContext, metadata: NoteTitleMetadata,
        *, _fault_hook: Callable[[str], None] | None = None,
    ) -> None:
        manifest = load_task_manifest(self.output_root, context.task_id)
        self.read_note_title_transcript(context)
        manifest["note_title"] = parse_note_title_metadata(metadata.to_dict()).to_dict()
        manifest["updated_at"] = (
            datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        )
        commit_task_artifacts(
            context.paths.task_dir, {
                TASK_MANIFEST_FILE_NAME: (
                    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
                ).encode("utf-8"),
            }, _fault_hook=_fault_hook,
        )

    def save_preference_snapshot(
        self,
        context: TaskContext,
        snapshot: PreferenceSnapshot,
    ) -> None:
        recover_task_artifacts(context.paths.task_dir)
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
        source=UrlTaskSource(source_identity),
        model=request.asr_model,
        created_at=created.isoformat(timespec="seconds").replace("+00:00", "Z"),
    )


def create_local_task_context(
    request: ProcessLocalMediaRequest,
    output_root: Path,
    cache_root: Path,
    now: datetime | None = None,
    random_id: str | None = None,
) -> TaskContext:
    created = (now or datetime.now(UTC)).astimezone(UTC)
    source = LocalFileTaskSource(
        display_name=request.safe_display_name,
        media_kind=request.media_kind,
        extension=request.source_extension,
    )
    safe_random_id = random_id or secrets.token_hex(8)
    if _LOCAL_TASK_RANDOM_ID_PATTERN.fullmatch(safe_random_id) is None:
        raise ValueError("Local task random id is invalid.")
    timestamp = created.strftime("%Y%m%d-%H%M%S")
    task_id = f"{timestamp}-local-{safe_random_id}"
    return TaskContext(
        paths=TaskPaths(
            output_root=output_root,
            cache_root=cache_root,
            task_id=task_id,
        ),
        source=source,
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


def task_artifacts_for_existing_files(
    paths: TaskPaths,
    source: TaskSource | None = None,
) -> dict[str, str]:
    video_path = (
        paths.video_path_for_extension(source.extension)
        if isinstance(source, LocalFileTaskSource) and source.media_kind == "video"
        else paths.video_path
    )
    candidates = {
        "video": video_path,
        "audio": paths.audio_path,
        "transcript_txt": paths.transcript_txt_path,
        "transcript_md": paths.transcript_md_path,
        "segments": paths.segments_path,
        "summary": paths.summary_path,
        "mindmap": paths.mindmap_path,
        "insights": paths.insights_json_path,
        "insights_md": paths.insights_md_path,
        "preference_snapshot": paths.preference_snapshot_path,
        "dissection": paths.dissection_json,
        "dissection_md": paths.dissection_markdown,
        "draft": paths.draft_path,
    }
    if isinstance(source, WebPageSource):
        candidates = {
            key: path for key, path in candidates.items()
            if key not in {"video", "audio", "transcript_txt", "transcript_md", "segments"}
        }
        candidates.update(article_txt=paths.article_txt_path, article_md=paths.article_md_path)
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
    article = isinstance(context.source, WebPageSource)
    if article:
        from worker_core.source_text import read_source_text

        source_text = read_source_text(context.paths.output_root, context.task_id)
    return ProcessResult(
        status=result.status,
        task_id=context.task_id,
        task_dir=context.paths.task_dir.as_posix(),
        artifacts=(
            artifacts
            if artifacts is not None
            else task_artifacts_for_existing_files(context.paths, context.source)
        ),
        text=source_text.text if article else result.text,
        summary=result.summary,
        insights=result.insights,
        transcript=result.transcript,
        dissection=result.dissection,
        error=result.error,
        artifact_payloads=result.artifact_payloads,
        draft=result.draft,
        note_title=result.note_title,
        task_created=result.task_created,
        source=context.source if article else None,
        markdown=_read_article_markdown(context.paths) if article else "",
    )


def write_task_manifest(
    context: TaskContext,
    result: ProcessResult,
    *,
    draft_seed_insight_id: int | None | object = DRAFT_SEED_UNSET,
) -> None:
    """Rebuild and persist the task manifest (``task.json``).

    The manifest payload is rebuilt from scratch on every retry, so any field the
    frontend owns (notably ``draft_seed_insight_id`` — the Insight the user picked
    as the draft seed) would be CLOBBERED unless we explicitly preserve it.

    ``draft_seed_insight_id`` preserve/clear rule:

    - ``DRAFT_SEED_UNSET`` (default): carry the value forward from the prior
      manifest on disk. Used by ``target="summary"`` regen (summary doesn't
      change insights → the seed stays valid) and by any caller that doesn't
      know about drafts.
    - ``None``: write ``null`` (clear the seed). Used by ``target="insights"``
      regen — insights changed, the old seed id is now invalid.
    - ``int``: write that id. Used by ``target="draft"`` generation
      (``request.insight_id``).

    ``draft_path`` / ``has_draft`` always reflect the current state of
    ``ai/draft.md`` on disk (artifacts are independent — insights regen does
    NOT delete the draft file, only clears the seed link).
    """
    atomic_write_text(
        context.paths.manifest_path,
        serialize_task_manifest(
            context, result, draft_seed_insight_id=draft_seed_insight_id
        ).decode("utf-8"),
    )


def serialize_task_manifest(
    context: TaskContext,
    result: ProcessResult,
    *,
    draft_seed_insight_id: int | None | object = DRAFT_SEED_UNSET,
) -> bytes:
    context.paths.task_dir.mkdir(parents=True, exist_ok=True)
    source_fields = _manifest_source_fields(context.source)

    if draft_seed_insight_id is DRAFT_SEED_UNSET:
        prior_seed = _read_prior_draft_seed_insight_id(context.paths.manifest_path)
    else:
        prior_seed = draft_seed_insight_id  # explicit None (clear) or int (set)

    draft_exists = (
        result.artifact_payloads["ai/draft.md"] is not None
        if "ai/draft.md" in result.artifact_payloads
        else _is_committed_regular_file(context.paths.draft_path)
    )
    draft_path = (
        context.paths.draft_path.relative_to(context.paths.task_dir).as_posix()
        if draft_exists
        else None
    )

    payload = {
        "schema_version": 4 if isinstance(context.source, WebPageSource) else TASK_SCHEMA_VERSION,
        "source_privacy_migration_version": SOURCE_PRIVACY_MIGRATION_VERSION,
        "source_privacy_quarantined": False,
        "task_id": context.task_id,
        "created_at": context.created_at,
        "updated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        **source_fields,
        "status": result.status.value,
        "app_version": context.app_version,
        "worker_version": context.worker_version,
        "model": context.model,
        "transcript": result.transcript.to_dict() if result.transcript else None,
        "artifacts": result.artifacts,
        "error": result.error.to_dict() if result.error else None,
        "text_preview": result.text.strip()[:180],
        "insights_count": len(result.insights),
        "draft_path": draft_path,
        "has_draft": draft_exists,
        "draft_seed_insight_id": prior_seed,
    }
    title = result.note_title
    if title is None and context.paths.manifest_path.exists():
        title = note_title_from_manifest(
            load_task_manifest(context.paths.output_root, context.task_id),
        )
    if title is not None and not isinstance(context.source, WebPageSource):
        payload["note_title"] = title.to_dict()
    _task_source_from_manifest(payload)
    _validate_manifest_artifacts(payload)
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _read_prior_draft_seed_insight_id(manifest_path: Path) -> int | None:
    """Best-effort read of ``draft_seed_insight_id`` from the existing manifest.

    Returns ``None`` when the manifest is missing, unreadable, or the field is
    absent (backward-compat with old manifests). Never raises — manifest rewrite
    must not fail because of a stale prior manifest.
    """
    if not manifest_path.is_file():
        return None
    try:
        prior = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(prior, dict):
        return None
    value = prior.get("draft_seed_insight_id")
    if isinstance(value, bool) or not isinstance(value, int):
        # ``bool`` is an ``int`` subclass — exclude it explicitly so True/False
        # on disk (from a buggy prior write) doesn't masquerade as 1/0.
        return None
    return value


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
    recover_task_artifacts(manifest_path.parent)
    from worker_core.source_text import read_source_file

    manifest = json.loads(read_source_file(manifest_path, 1024 * 1024).decode("utf-8"))
    if (
        not isinstance(manifest, dict)
        or manifest.get("task_id") != task_id
        or type(manifest.get("schema_version")) is not int
        or manifest.get("schema_version") not in {TASK_SCHEMA_VERSION, 4}
        or manifest.get("source_privacy_migration_version")
        != SOURCE_PRIVACY_MIGRATION_VERSION
        or manifest.get("source_privacy_quarantined") is True
    ):
        raise ValueError("Task is unavailable in the current history format.")
    try:
        _task_source_from_manifest(manifest)
        note_title_from_manifest(manifest)
        _validate_manifest_artifacts(manifest)
    except ValueError:
        raise ValueError("Task is unavailable in the current history format.") from None
    return manifest


def note_title_from_manifest(manifest: Mapping[str, object]) -> NoteTitleMetadata | None:
    return parse_note_title_metadata(manifest["note_title"]) if "note_title" in manifest else None


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
        or manifest_path.stat().st_nlink != 1
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


def _read_article_markdown(paths: TaskPaths) -> str:
    from worker_core.source_text import read_source_file
    from worker_core.web_page_contract import MAX_ARTICLE_MARKDOWN_BYTES

    return read_source_file(paths.article_md_path, MAX_ARTICLE_MARKDOWN_BYTES).decode("utf-8")


def _validate_manifest_artifacts(manifest: Mapping[str, object]) -> None:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ValueError("Task artifacts are invalid.")
    article = manifest.get("source_kind") == "web_page"
    fixed = {key: relative for relative, key in ARTIFACT_KEY_BY_RELATIVE_PATH.items()}
    if article:
        if any(artifacts.get(key) != fixed[key] for key in ("article_txt", "article_md")):
            raise ValueError("Web page body artifacts are required.")
        if set(artifacts) & {"video", "audio", "transcript_txt", "transcript_md", "segments"}:
            raise ValueError("Web page artifacts contain media.")
    elif set(artifacts) & {"article_txt", "article_md"}:
        raise ValueError("Media artifacts contain a web page.")
    for key, relative in artifacts.items():
        if key in fixed and relative != fixed[key]:
            raise ValueError("Task artifact path is invalid.")
        if key not in {*fixed, "video", "audio", "preference_snapshot"}:
            raise ValueError("Task artifact kind is invalid.")
        if key == "video" and relative not in {f"media/video.{ext}" for ext in VIDEO_EXTENSIONS}:
            raise ValueError("Task video path is invalid.")
        if key == "audio" and relative != "media/audio.wav":
            raise ValueError("Task audio path is invalid.")
        if key == "preference_snapshot" and relative != "ai/preference-snapshot.json":
            raise ValueError("Task preference snapshot path is invalid.")


def _artifacts_after_payloads(
    context: TaskContext,
    payloads: Mapping[str, bytes | None],
) -> dict[str, str]:
    artifacts = task_artifacts_for_existing_files(context.paths, context.source)
    for relative_path, content in payloads.items():
        artifact_key = ARTIFACT_KEY_BY_RELATIVE_PATH.get(relative_path)
        if artifact_key is None:
            if relative_path == "ai/original/draft.md" and content is None:
                continue
            raise TaskArtifactCommitError() from None
        if content is None:
            artifacts.pop(artifact_key, None)
        else:
            artifacts[artifact_key] = relative_path
    return artifacts


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
    source = _task_source_from_manifest(manifest)
    model = (
        None if isinstance(source, WebPageSource)
        else str(manifest.get("model") or "iic/SenseVoiceSmall")
    )
    created_at = str(
        manifest.get("created_at")
        or datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    return TaskContext(
        paths=TaskPaths(output_root=output_root, cache_root=cache_root, task_id=task_id),
        source=source,
        model=model,
        created_at=created_at,
        app_version=str(manifest.get("app_version") or "app"),
        worker_version=str(manifest.get("worker_version") or "app"),
    )


def _manifest_source_fields(source: TaskSource) -> dict[str, object]:
    if isinstance(source, WebPageSource):
        return {
            "source_kind": "web_page", "source_url": source.url, "source_identity": None,
            "platform": "web",
            "web_source": {"title": source.title, "extracted_at": source.extracted_at},
        }
    if isinstance(source, UrlTaskSource):
        canonical_url = canonical_url_for_persistence(source.identity)
        return {
            "source_url": canonical_url or "",
            "source_identity": source.identity.to_manifest_dict(),
            "platform": source.identity.platform,
        }
    if isinstance(source, LocalFileTaskSource):
        return {
            "source_kind": "local_file",
            "source_url": "",
            "source_identity": None,
            "local_source": {
                "display_name": source.display_name,
                "media_kind": source.media_kind,
                "extension": source.extension,
            },
            "platform": "local",
        }
    raise TypeError("Unsupported task source.")


def _task_source_from_manifest(manifest: Mapping[str, object]) -> TaskSource:
    source_kind = manifest.get("source_kind")
    if source_kind == "web_page":
        metadata = manifest.get("web_source")
        if (manifest.get("schema_version") != 4 or manifest.get("platform") != "web"
                or "source_identity" not in manifest or manifest["source_identity"] is not None
                or "model" not in manifest or manifest["model"] is not None
                or "transcript" not in manifest or manifest["transcript"] is not None
                or "local_source" in manifest or "note_title" in manifest
                or not isinstance(metadata, dict) or set(metadata) != {"title", "extracted_at"}
                or any(not isinstance(value, str) for value in metadata.values())
                or not isinstance(manifest.get("source_url"), str)):
            raise ValueError("Web page source is invalid.")
        return WebPageSource(manifest["source_url"], metadata["title"], metadata["extracted_at"])
    if manifest.get("schema_version") != 3 or "web_source" in manifest:
        raise ValueError("Media source version is invalid.")
    if source_kind in {None, "url"}:
        if "local_source" in manifest:
            raise ValueError("URL task cannot contain a local source.")
        source_identity = source_identity_from_manifest(manifest.get("source_identity"))
        if (
            source_identity is None
            or manifest.get("source_url") != source_identity.canonical_url
        ):
            raise ValueError("Task source identity is unavailable or invalid.")
        return UrlTaskSource(source_identity)

    if source_kind != "local_file":
        raise ValueError("Task source kind is unsupported.")
    if (
        "source_url" not in manifest
        or "source_identity" not in manifest
        or manifest.get("source_url") != ""
        or manifest.get("source_identity") is not None
        or manifest.get("platform") != "local"
    ):
        raise ValueError("Local task source boundary is invalid.")
    raw_local_source = manifest.get("local_source")
    if not isinstance(raw_local_source, dict) or set(raw_local_source) != {
        "display_name",
        "media_kind",
        "extension",
    }:
        raise ValueError("Local task source is unavailable or invalid.")
    display_name = raw_local_source.get("display_name")
    media_kind = raw_local_source.get("media_kind")
    extension = raw_local_source.get("extension")
    if (
        not isinstance(display_name, str)
        or media_kind not in {"video", "audio"}
        or not isinstance(extension, str)
    ):
        raise ValueError("Local task source is unavailable or invalid.")
    return LocalFileTaskSource(
        display_name=display_name,
        media_kind=media_kind,
        extension=extension,
    )


def _is_valid_local_source(
    display_name: str,
    media_kind: LocalMediaKind,
    extension: str,
) -> bool:
    allowed_extensions = VIDEO_EXTENSIONS if media_kind == "video" else AUDIO_EXTENSIONS
    return (
        media_kind in {"video", "audio"}
        and extension in allowed_extensions
        and bool(display_name.strip())
        and display_name not in {".", ".."}
        and len(display_name) <= 160
        and display_name.lower().endswith(f".{extension}")
        and not any(_is_unsafe_basename_character(value) for value in display_name)
    )


def _is_unsafe_basename_character(value: str) -> bool:
    codepoint = ord(value)
    return (
        value in {"/", "\\"}
        or unicodedata.category(value) == "Cc"
        or codepoint in {0x061C, 0x200E, 0x200F}
        or 0x202A <= codepoint <= 0x202E
        or 0x2066 <= codepoint <= 0x2069
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
