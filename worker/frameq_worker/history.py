from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from frameq_worker.models import ProcessRequest, ProcessResult, WorkerError

HISTORY_FILE_NAME = "history.json"


def append_history_item(
    project_root: Path,
    request: ProcessRequest,
    result: ProcessResult,
    output_dir: Path,
    work_dir: Path | None = None,
) -> None:
    resolved_work_dir = work_dir or project_root / "work"
    history_path = resolved_work_dir / HISTORY_FILE_NAME
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history = load_history(history_path)
    items = history.setdefault("items", [])
    if not isinstance(items, list):
        items = []
        history["items"] = items

    items.insert(0, build_history_item(request, result, output_dir))
    history_path.write_text(
        json.dumps(history, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def update_history_item_after_insight_retry(
    project_root: Path,
    transcript_path: Path,
    result: ProcessResult,
    work_dir: Path | None = None,
) -> None:
    resolved_work_dir = work_dir or project_root / "work"
    history_path = resolved_work_dir / HISTORY_FILE_NAME
    if not history_path.exists():
        return

    history = load_history(history_path)
    items = history.get("items")
    if not isinstance(items, list):
        return

    target_path = normalize_history_path(transcript_path, project_root)
    for item in items:
        if not isinstance(item, dict):
            continue
        stored_transcript_path = item.get("transcript_path")
        if not isinstance(stored_transcript_path, str):
            continue
        if normalize_history_path(stored_transcript_path, project_root) != target_path:
            continue

        item["status"] = result.status.value
        item["transcript_path"] = result.transcript_path
        item["insights_path"] = result.insights_path
        item["error"] = build_history_error(result.error)
        item["text_preview"] = result.text.strip()[:180]
        item["insights_count"] = len(result.insights)
        history_path.write_text(
            json.dumps(history, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return


def normalize_history_path(path: str | Path, project_root: Path) -> str:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = project_root / candidate
    normalized = candidate.resolve(strict=False).as_posix()
    return normalized.lower() if os.name == "nt" else normalized


def load_history(history_path: Path) -> dict[str, object]:
    if not history_path.exists():
        return {"items": []}

    try:
        loaded = json.loads(history_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"items": []}

    if isinstance(loaded, dict) and isinstance(loaded.get("items"), list):
        return loaded
    return {"items": []}


def build_history_item(
    request: ProcessRequest,
    result: ProcessResult,
    output_dir: Path,
) -> dict[str, object]:
    return {
        "id": f"{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "url": request.url,
        "status": result.status.value,
        "output_dir": output_dir.as_posix(),
        "video_path": result.video_path,
        "audio_path": result.audio_path,
        "transcript_path": result.transcript_path,
        "insights_path": result.insights_path,
        "error": build_history_error(result.error),
        "text_preview": result.text.strip()[:180],
        "insights_count": len(result.insights),
    }


def build_history_error(error: WorkerError | None) -> dict[str, str] | None:
    if error is None:
        return None

    return {
        "code": error.code,
        "message": error.message,
        "stage": error.stage.value,
    }
