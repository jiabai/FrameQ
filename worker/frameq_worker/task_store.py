from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from frameq_worker.models import ProcessRequest, ProcessResult

TASK_MANIFEST_FILE_NAME = "frameq-task.json"
TASK_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class TaskPaths:
    output_root: Path
    work_root: Path
    task_id: str

    @property
    def task_dir(self) -> Path:
        return self.output_root / "tasks" / self.task_id

    @property
    def work_task_dir(self) -> Path:
        return self.work_root / "tasks" / self.task_id

    @property
    def download_dir(self) -> Path:
        return self.work_task_dir / "download"

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


@dataclass(frozen=True)
class TaskContext:
    request: ProcessRequest
    paths: TaskPaths
    platform: str
    created_at: str
    worker_version: str = "app"
    app_version: str = "app"

    @property
    def task_id(self) -> str:
        return self.paths.task_id


def create_task_context(
    request: ProcessRequest,
    output_root: Path,
    work_root: Path,
    now: datetime | None = None,
) -> TaskContext:
    created = (now or datetime.now(UTC)).astimezone(UTC)
    platform, source_slug = detect_platform_and_source_slug(request.url)
    timestamp = created.strftime("%Y%m%d-%H%M%S")
    task_id = f"{timestamp}-{platform}-{source_slug}"
    paths = TaskPaths(output_root=output_root, work_root=work_root, task_id=task_id)
    return TaskContext(
        request=request,
        paths=paths,
        platform=platform,
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


def detect_platform_and_source_slug(source: str) -> tuple[str, str]:
    parsed = urlparse(source if "://" in source else f"https://{source}")
    host = parsed.hostname.lower() if parsed.hostname else ""
    path = parsed.path
    if host.endswith("douyin.com"):
        match = re.search(r"/(?:video|note|share/slides)/(\d+)", path)
        source_id = match.group(1) if match else parse_first_numeric_query(parsed.query)
        return "douyin", safe_slug(source_id or short_hash(source))
    if (
        host.endswith("xiaohongshu.com")
        or host.endswith("xhslink.com")
        or re.fullmatch(r"[0-9a-fA-F]{24}", source)
    ):
        match = re.search(r"([0-9a-fA-F]{24})", source)
        return "xiaohongshu", safe_slug(match.group(1).lower() if match else short_hash(source))
    if host.endswith("bilibili.com") or host.endswith("b23.tv"):
        match = re.search(r"/video/(BV[0-9A-Za-z]+|av\d+)", path, re.IGNORECASE)
        return "bilibili", safe_slug(match.group(1) if match else short_hash(source))
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}:
        source_id = ""
        if host in {"youtu.be", "www.youtu.be"}:
            source_id = path.strip("/").split("/")[0]
        elif path.rstrip("/") == "/watch":
            source_id = parse_qs(parsed.query).get("v", [""])[0]
        else:
            match = re.search(r"/shorts/([A-Za-z0-9_-]+)", path)
            source_id = match.group(1) if match else ""
        return "youtube", safe_slug(source_id or short_hash(source))
    return "source", short_hash(source)


def parse_first_numeric_query(query: str) -> str | None:
    values = parse_qs(query)
    for key in ["modal_id", "aweme_id"]:
        value = values.get(key, [""])[0]
        if value.isdigit():
            return value
    return None


def safe_slug(value: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-z_-]+", "-", value.strip())
    normalized = normalized.strip("-_")
    return normalized[:80] or "source"


def short_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


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
    }
    return {
        key: path.relative_to(paths.task_dir).as_posix()
        for key, path in candidates.items()
        if path.exists()
    }


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
        error=result.error,
    )


def write_task_manifest(context: TaskContext, result: ProcessResult) -> None:
    context.paths.task_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": TASK_SCHEMA_VERSION,
        "task_id": context.task_id,
        "created_at": context.created_at,
        "updated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source_url": context.request.url,
        "platform": context.platform,
        "status": result.status.value,
        "app_version": context.app_version,
        "worker_version": context.worker_version,
        "model": context.request.model,
        "artifacts": result.artifacts,
        "error": result.error.to_dict() if result.error else None,
        "text_preview": result.text.strip()[:180],
        "insights_count": len(result.insights),
    }
    context.paths.manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_task_manifest(output_root: Path, task_id: str) -> dict[str, object]:
    manifest_path = output_root / "tasks" / task_id / TASK_MANIFEST_FILE_NAME
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def task_context_from_manifest(output_root: Path, work_root: Path, task_id: str) -> TaskContext:
    manifest = load_task_manifest(output_root, task_id)
    source_url = str(manifest.get("source_url") or "")
    model = str(manifest.get("model") or "iic/SenseVoiceSmall")
    platform = str(manifest.get("platform") or "source")
    created_at = str(
        manifest.get("created_at")
        or datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    return TaskContext(
        request=ProcessRequest(url=source_url, model=model),
        paths=TaskPaths(output_root=output_root, work_root=work_root, task_id=task_id),
        platform=platform,
        created_at=created_at,
        app_version=str(manifest.get("app_version") or "app"),
        worker_version=str(manifest.get("worker_version") or "app"),
    )
