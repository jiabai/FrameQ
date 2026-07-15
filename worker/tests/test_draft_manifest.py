"""Task 3.1 / 3.2 / 3.3: manifest projection of the draft artifact + seed id.

Pins four REQUIRED behaviors of ``write_task_manifest`` as driven by
``retry_insights_once`` across the three retry targets (``summary`` /
``insights`` / ``draft``):

1. **draft success** → manifest gains ``draft_path`` pointing at
   ``ai/draft.md``, ``has_draft == True``, ``draft_seed_insight_id`` equals
   the seed insight_id used.
2. **insights regen success** → ``draft_seed_insight_id`` is cleared
   (``null``) EVEN IF it was set in the pre-existing manifest; the draft
   file is left intact so ``has_draft`` / ``draft_path`` still reflect it
   (artifacts are independent / 互不覆盖).
3. **summary regen success** → ``draft_seed_insight_id`` is PRESERVED
   unchanged from the pre-existing manifest; ``has_draft`` / ``draft_path``
   reflect the draft file.
4. **backward-compat** → an old manifest on disk that has NONE of
   ``draft_path`` / ``has_draft`` / ``draft_seed_insight_id`` loads fine
   and the rewritten manifest gains the new fields with sensible defaults
   (``has_draft`` from file existence, ``draft_seed_insight_id`` null).

The seed-id preserve/clear rule is owned by the caller (``retry_insights_once``);
``write_task_manifest`` only carries forward whatever the caller hands it
(defaulting to the prior manifest's value so a pure manifest rewrite — e.g.
a future code path that doesn't know about drafts — preserves the seed).
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from frameq_worker.desktop_contract import CACHE_DIR_ENV, OUTPUT_DIR_ENV
from frameq_worker.models import JobStage, ProcessResult
from frameq_worker.source_identity import SourceIdentity
from frameq_worker.task_store import (
    TASK_SCHEMA_VERSION,
    TaskContext,
    TaskPaths,
    task_artifacts_for_existing_files,
    write_task_manifest,
)
from frameq_worker.worker_service import retry_insights_once

TASK_ID = "20260712-120000-douyin-7524373044106677544"
INSIGHT_ID = 5


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

_SOURCE_URL = "https://www.douyin.com/video/7524373044106677544"
_SOURCE_IDENTITY = SourceIdentity(
    platform="douyin",
    stable_id="7524373044106677544",
    canonical_url=_SOURCE_URL,
    effective_part=None,
    version=1,
)


def _build_task_context(tmp_path: Path) -> TaskContext:
    paths = TaskPaths(
        output_root=tmp_path / "outputs",
        cache_root=tmp_path / "cache",
        task_id=TASK_ID,
    )
    return TaskContext(
        paths=paths,
        source_identity=_SOURCE_IDENTITY,
        platform="douyin",
        model="iic/SenseVoiceSmall",
        created_at="2026-07-12T12:00:00Z",
    )


def _write_manifest(
    task_dir: Path,
    *,
    draft_seed_insight_id: int | None = None,
    with_draft_fields: bool = True,
) -> None:
    """Write a manifest that already has the draft_* fields (the frontend wrote them)."""
    payload: dict[str, object] = {
        "schema_version": TASK_SCHEMA_VERSION,
        "source_privacy_migration_version": 2,
        "source_privacy_quarantined": False,
        "task_id": TASK_ID,
        "created_at": "2026-07-12T12:00:00Z",
        "updated_at": "2026-07-12T12:00:00Z",
        "source_url": _SOURCE_URL,
        "source_identity": _SOURCE_IDENTITY.to_manifest_dict(),
        "platform": "douyin",
        "status": "partial_completed",
        "app_version": "app",
        "worker_version": "app",
        "model": "iic/SenseVoiceSmall",
        "transcript": None,
        "artifacts": {},
        "error": None,
        "text_preview": "preview",
        "insights_count": 1,
    }
    if with_draft_fields:
        payload["draft_path"] = "ai/draft.md"
        payload["has_draft"] = True
        payload["draft_seed_insight_id"] = draft_seed_insight_id
    (task_dir / "ai").mkdir(parents=True, exist_ok=True)
    task_dir.mkdir(parents=True, exist_ok=True)
    (task_dir / "frameq-task.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def _load_manifest(task_dir: Path) -> dict[str, object]:
    return json.loads((task_dir / "frameq-task.json").read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- #
# 3.1 — task_artifacts_for_existing_files includes draft
# --------------------------------------------------------------------------- #


def test_task_artifacts_includes_draft_when_present(tmp_path: Path) -> None:
    context = _build_task_context(tmp_path)
    paths = context.paths
    paths.task_dir.mkdir(parents=True, exist_ok=True)
    paths.ai_dir.mkdir(parents=True, exist_ok=True)
    # No draft file yet.
    assert "draft" not in task_artifacts_for_existing_files(paths)

    # Write the draft file → it shows up as a relative posix path.
    paths.draft_path.write_text("# draft", encoding="utf-8")
    artifacts = task_artifacts_for_existing_files(paths)
    assert artifacts["draft"] == "ai/draft.md"


# --------------------------------------------------------------------------- #
# 3.2 — write_task_manifest projects draft_path / has_draft / draft_seed_insight_id
# --------------------------------------------------------------------------- #


def test_write_manifest_with_draft_success_projects_all_three_fields(tmp_path: Path) -> None:
    """REQUIRED behavior #1: after a draft generation, manifest has draft_path,
    has_draft==True, draft_seed_insight_id == the seed used (passed by the caller)."""
    context = _build_task_context(tmp_path)
    paths = context.paths
    paths.task_dir.mkdir(parents=True, exist_ok=True)
    paths.ai_dir.mkdir(parents=True, exist_ok=True)
    paths.draft_path.write_text("# 完整稿子", encoding="utf-8")

    result = ProcessResult(status=JobStage.COMPLETED, draft="# 完整稿子")
    write_task_manifest(context, result, draft_seed_insight_id=INSIGHT_ID)

    manifest = _load_manifest(paths.task_dir)
    assert manifest["draft_path"] == "ai/draft.md"
    assert manifest["has_draft"] is True
    assert manifest["draft_seed_insight_id"] == INSIGHT_ID


def test_write_manifest_without_draft_file_has_null_path_and_false_flag(tmp_path: Path) -> None:
    """No draft on disk and no prior manifest → draft_path null, has_draft False,
    seed null (no prior manifest to preserve from)."""
    context = _build_task_context(tmp_path)
    paths = context.paths
    paths.task_dir.mkdir(parents=True, exist_ok=True)
    paths.ai_dir.mkdir(parents=True, exist_ok=True)

    result = ProcessResult(status=JobStage.COMPLETED)
    write_task_manifest(context, result)

    manifest = _load_manifest(paths.task_dir)
    assert manifest["draft_path"] is None
    assert manifest["has_draft"] is False
    assert manifest["draft_seed_insight_id"] is None


# --------------------------------------------------------------------------- #
# 3.2/3.3 — preserve rule across retries (write_task_manifest reads prior manifest)
# --------------------------------------------------------------------------- #


def test_write_manifest_preserves_prior_seed_id_by_default(tmp_path: Path) -> None:
    """REQUIRED behavior #3 (preserve): when the caller does NOT pass a seed id
    explicitly, write_task_manifest carries the prior manifest's seed forward
    unchanged. This is what summary regen relies on."""
    context = _build_task_context(tmp_path)
    paths = context.paths
    _write_manifest(paths.task_dir, draft_seed_insight_id=INSIGHT_ID)
    # A draft file on disk so has_draft stays True.
    paths.draft_path.write_text("# existing draft", encoding="utf-8")

    # Caller hands a result with NO draft_seed_insight_id → preserve.
    result = ProcessResult(status=JobStage.COMPLETED)
    write_task_manifest(context, result)

    manifest = _load_manifest(paths.task_dir)
    assert manifest["draft_seed_insight_id"] == INSIGHT_ID  # preserved
    assert manifest["has_draft"] is True
    assert manifest["draft_path"] == "ai/draft.md"


# --------------------------------------------------------------------------- #
# End-to-end through retry_insights_once — the four REQUIRED behaviors
# --------------------------------------------------------------------------- #


def _skeleton(
    tmp_path: Path,
    *,
    seed_id: int | None = INSIGHT_ID,
    with_draft_file: bool = False,
    with_draft_fields_in_manifest: bool = True,
) -> Path:
    """Build a full task dir: manifest + transcript.txt + insights.json + optional draft.md."""
    task_dir = tmp_path / "outputs" / "tasks" / TASK_ID
    ai_dir = task_dir / "ai"
    transcript_dir = task_dir / "transcript"
    ai_dir.mkdir(parents=True, exist_ok=True)
    transcript_dir.mkdir(parents=True, exist_ok=True)

    (transcript_dir / "transcript.txt").write_text("official transcript\n", encoding="utf-8")
    (transcript_dir / "transcript.md").write_text(
        "# Transcript\n\nofficial transcript\n", encoding="utf-8"
    )

    insight_payload = {
        "schemaVersion": 1,
        "insights": [
            {
                "id": INSIGHT_ID,
                "topic": "existing insight",
                "matchReason": "matched",
                "followUpQuestions": ["next"],
                "suitableUse": "content planning",
                "sourceChunkId": 1,
            }
        ],
    }
    (ai_dir / "insights.json").write_text(
        json.dumps(insight_payload, ensure_ascii=False), encoding="utf-8"
    )
    (ai_dir / "insights.md").write_text("# 启发灵感\n", encoding="utf-8")

    if with_draft_file:
        (ai_dir / "draft.md").write_text("# existing draft", encoding="utf-8")

    _write_manifest(
        task_dir,
        draft_seed_insight_id=seed_id,
        with_draft_fields=with_draft_fields_in_manifest,
    )
    return tmp_path


def _env(tmp_path: Path) -> dict[str, str]:
    return {
        OUTPUT_DIR_ENV: (tmp_path / "outputs").as_posix(),
        CACHE_DIR_ENV: (tmp_path / "cache").as_posix(),
    }


class _FakeInsightClient:
    """Returns one new insight so target=insights regen succeeds."""

    def generate(self, prompt: str) -> str:
        if "Mermaid mindmap" in prompt:
            return "mindmap\n  root((retry))"
        if "根据文字稿原文" in prompt:
            return "# retry summary"
        return (
            '[{"topic":"new insight","matchReason":"matched",'
            '"followUpQuestions":["next"],"suitableUse":"content planning"}]'
        )


def test_retry_draft_success_sets_seed_id_in_manifest(tmp_path: Path) -> None:
    """REQUIRED #1 (e2e): successful draft generation projects the seed id."""
    _skeleton(tmp_path, with_draft_file=False)

    with patch("frameq_worker.worker_service.run_draft", return_value="# 完整稿子"):
        result = retry_insights_once(
            json.dumps(
                {
                    "task_id": TASK_ID,
                    "target": "draft",
                    "insight_id": INSIGHT_ID,
                    "platform": "douyin",
                },
                ensure_ascii=False,
            ),
            project_root=tmp_path,
            environ=_env(tmp_path),
        )

    assert result["error"] is None
    assert result["draft"] == "# 完整稿子"

    manifest = _load_manifest(tmp_path / "outputs" / "tasks" / TASK_ID)
    assert manifest["draft_path"] == "ai/draft.md"
    assert manifest["has_draft"] is True
    assert manifest["draft_seed_insight_id"] == INSIGHT_ID


def test_retry_insights_success_clears_seed_id_even_if_preset(tmp_path: Path) -> None:
    """REQUIRED #2 (e2e): successful 启发灵感 regen clears draft_seed_insight_id
    even when the prior manifest had it set. The draft file is left intact
    so has_draft/draft_path still reflect it."""
    _skeleton(
        tmp_path,
        seed_id=INSIGHT_ID,  # prior manifest has a seed
        with_draft_file=True,  # draft.md exists on disk
    )

    result = retry_insights_once(
        json.dumps(
            {"task_id": TASK_ID, "target": "insights"},
            ensure_ascii=False,
        ),
        project_root=tmp_path,
        insight_client=_FakeInsightClient(),
        environ=_env(tmp_path),
    )
    assert result["error"] is None

    manifest = _load_manifest(tmp_path / "outputs" / "tasks" / TASK_ID)
    # Seed cleared because insights changed.
    assert manifest["draft_seed_insight_id"] is None
    # Draft file untouched (artifacts independent).
    assert (tmp_path / "outputs" / "tasks" / TASK_ID / "ai" / "draft.md").exists()
    assert manifest["has_draft"] is True
    assert manifest["draft_path"] == "ai/draft.md"


def test_retry_summary_success_preserves_seed_id(tmp_path: Path) -> None:
    """REQUIRED #3 (e2e): successful summary regen preserves draft_seed_insight_id
    from the prior manifest (summary doesn't change insights, so the seed stays valid)."""
    _skeleton(
        tmp_path,
        seed_id=INSIGHT_ID,
        with_draft_file=True,
    )

    result = retry_insights_once(
        json.dumps(
            {"task_id": TASK_ID, "target": "summary"},
            ensure_ascii=False,
        ),
        project_root=tmp_path,
        insight_client=_FakeInsightClient(),
        environ=_env(tmp_path),
    )
    assert result["error"] is None

    manifest = _load_manifest(tmp_path / "outputs" / "tasks" / TASK_ID)
    assert manifest["draft_seed_insight_id"] == INSIGHT_ID  # preserved
    assert manifest["has_draft"] is True
    assert manifest["draft_path"] == "ai/draft.md"


def test_retry_summary_on_old_manifest_without_draft_fields_loads_and_backfills(
    tmp_path: Path,
) -> None:
    """REQUIRED #4 (backward-compat): an old manifest with NONE of the draft_* fields
    loads fine, the retry succeeds, and the rewritten manifest gains the new fields
    with sensible defaults."""
    _skeleton(
        tmp_path,
        seed_id=INSIGHT_ID,
        with_draft_file=False,
        with_draft_fields_in_manifest=False,  # old manifest, no draft_* keys at all
    )

    result = retry_insights_once(
        json.dumps(
            {"task_id": TASK_ID, "target": "summary"},
            ensure_ascii=False,
        ),
        project_root=tmp_path,
        insight_client=_FakeInsightClient(),
        environ=_env(tmp_path),
    )
    assert result["error"] is None

    manifest = _load_manifest(tmp_path / "outputs" / "tasks" / TASK_ID)
    # New fields backfilled with sensible defaults.
    assert manifest["draft_seed_insight_id"] is None  # nothing to preserve → null
    assert manifest["has_draft"] is False  # no draft.md on disk
    assert manifest["draft_path"] is None
