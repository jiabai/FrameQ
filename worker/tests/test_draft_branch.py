"""``retry_insights_once`` draft branch.

Covers the absorbed ``generate_draft_once`` semantics (credential resolution happens
inside ``run_draft``; persistence + empty/failure handling now lives in the draft
branch of ``retry_insights_once``) plus the seed-validation contract (invalid
seed MUST NOT consume an LLM call / checkout).
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from frameq_worker.desktop_contract import CACHE_DIR_ENV, OUTPUT_DIR_ENV
from frameq_worker.models import (
    GenerationPreferences,
    Insight,
    PreferenceLabelSnapshot,
    PreferenceSnapshot,
)
from frameq_worker.worker_service import retry_insights_once

TASK_ID = "20260709-120000-douyin-demo"
INSIGHT_ID = 5


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #


def _snapshot_dict() -> dict[str, object]:
    return {
        "profile": None,
        "profileSkipped": True,
        "generationPreferences": {
            "goal": "content_creation",
            "scenario": "short_video",
            "angles": ["topic_angle"],
            "audience": "fans_readers",
            "styles": ["grounded"],
            "avoid": [],
        },
        "labelSnapshot": {"profile": [], "generationPreferences": []},
    }


def _preference_snapshot() -> PreferenceSnapshot:
    return PreferenceSnapshot(
        profile=None,
        profile_skipped=True,
        generation_preferences=GenerationPreferences(
            goal="content_creation",
            scenario="short_video",
            angles=("topic_angle",),
            audience="fans_readers",
            styles=("grounded",),
            avoid=(),
        ),
        label_snapshot=PreferenceLabelSnapshot(profile=(), generation_preferences=()),
    )


def _insight_dict(
    *,
    id_: int = INSIGHT_ID,
    topic: str = "如何把长视频拆成短视频",
    suitable_use: str = "xiaohongshu",
) -> dict[str, object]:
    return {
        "id": id_,
        "topic": topic,
        "matchReason": "match reason",
        "followUpQuestions": ["q1?", "q2?"],
        "suitableUse": suitable_use,
        "sourceChunkId": 3,
    }


def _seed_insight() -> Insight:
    return Insight(
        id=INSIGHT_ID,
        topic="如何把长视频拆成短视频",
        match_reason="match reason",
        follow_up_questions=("q1?", "q2?"),
        suitable_use="xiaohongshu",
        source_chunk_id=3,
    )


def _write_task_skeleton(
    tmp_path: Path,
    *,
    with_insights: bool = True,
    with_summary: bool = False,
    with_preference_snapshot: bool = False,
    insight_id: int = INSIGHT_ID,
) -> Path:
    """Write a minimal task manifest + optional ai/ artifacts under tmp_path/outputs."""

    output_root = tmp_path / "outputs"
    task_dir = output_root / "tasks" / TASK_ID
    ai_dir = task_dir / "ai"
    ai_dir.mkdir(parents=True, exist_ok=True)

    (task_dir / "frameq-task.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "source_privacy_migration_version": 2,
                "source_privacy_quarantined": False,
                "task_id": TASK_ID,
                "created_at": "2026-07-09T12:00:00Z",
                "source_url": "https://www.douyin.com/video/7524373044106677544",
                "source_identity": {
                    "version": 1,
                    "platform": "douyin",
                    "stable_id": "7524373044106677544",
                    "effective_part": None,
                    "canonical_url": "https://www.douyin.com/video/7524373044106677544",
                },
                "platform": "douyin",
                "status": "partial_completed",
                "app_version": "app",
                "worker_version": "app",
                "model": "iic/SenseVoiceSmall",
                "artifacts": {},
                "error": None,
                "text_preview": "preview",
                "insights_count": 1,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    if with_insights:
        (ai_dir / "insights.json").write_text(
            json.dumps(
                {"schemaVersion": 1, "insights": [_insight_dict(id_=insight_id)]},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    if with_summary:
        (ai_dir / "summary.md").write_text("# 要点总结\n- 要点一", encoding="utf-8")

    if with_preference_snapshot:
        (ai_dir / "preference-snapshot.json").write_text(
            json.dumps(_snapshot_dict(), ensure_ascii=False),
            encoding="utf-8",
        )

    return tmp_path


def _draft_request(insight_id: int | None = INSIGHT_ID) -> str:
    payload: dict[str, object] = {
        "task_id": TASK_ID,
        "target": "draft",
        "platform": "douyin",
    }
    if insight_id is not None:
        payload["insight_id"] = insight_id
    return json.dumps(payload, ensure_ascii=False)


def _env(tmp_path: Path) -> dict[str, str]:
    return {
        OUTPUT_DIR_ENV: (tmp_path / "outputs").as_posix(),
        CACHE_DIR_ENV: (tmp_path / "cache").as_posix(),
    }


def _task_dir(tmp_path: Path) -> Path:
    return tmp_path / "outputs" / "tasks" / TASK_ID


def _draft_path(tmp_path: Path) -> Path:
    return _task_dir(tmp_path) / "ai" / "draft.md"


# --------------------------------------------------------------------------- #
# 2.6 success path
# --------------------------------------------------------------------------- #


def test_draft_branch_success_writes_draft_md_and_populates_process_result(
    tmp_path: Path,
) -> None:
    _write_task_skeleton(tmp_path, with_summary=True, with_preference_snapshot=True)

    captured: dict[str, object] = {}

    def fake_run_draft(insight, preference_snapshot, summary, platform, env):
        captured["insight"] = insight
        captured["snapshot"] = preference_snapshot
        captured["summary"] = summary
        captured["platform"] = platform
        captured["env"] = env
        return "# 完整稿子\n\n正文"

    with patch("frameq_worker.worker_service.run_draft", side_effect=fake_run_draft) as mock_run:
        result = retry_insights_once(
            _draft_request(),
            project_root=tmp_path,
            environ=_env(tmp_path),
        )

    assert mock_run.call_count == 1
    # Seed comes from insights.json by insight_id.
    seed: Insight = captured["insight"]  # type: ignore[assignment]
    assert seed.id == INSIGHT_ID
    assert seed.topic == "如何把长视频拆成短视频"
    # platform 是请求级字段，原样透传给 runner（来自 _draft_request 的 "douyin"）。
    assert captured["platform"] == "douyin"
    # Preference snapshot read from disk — not sent over the wire.
    assert isinstance(captured["snapshot"], PreferenceSnapshot)
    # Summary read from disk (optional grounding).
    assert captured["summary"] == "# 要点总结\n- 要点一"
    # runtime_env carries OUTPUT_DIR_ENV / CACHE_DIR_ENV.
    assert captured["env"][OUTPUT_DIR_ENV] == _env(tmp_path)[OUTPUT_DIR_ENV]

    # draft.md is written verbatim.
    assert _draft_path(tmp_path).read_text(encoding="utf-8") == "# 完整稿子\n\n正文"

    # ProcessResult carries draft text + status.
    assert result["draft"] == "# 完整稿子\n\n正文"
    assert result["error"] is None
    # Insights and summary preserved (no regression on ai artifacts).
    assert result["summary"] == "# 要点总结\n- 要点一"
    assert isinstance(result["insights"], list) and len(result["insights"]) == 1


# --------------------------------------------------------------------------- #
# 2.4 / 2.6 empty result
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("empty_text", ["", "   ", "\n\t  \n"])
def test_draft_branch_empty_result_fails_without_writing_disk(
    tmp_path: Path,
    empty_text: str,
) -> None:
    _write_task_skeleton(tmp_path)

    with patch("frameq_worker.worker_service.run_draft", return_value=empty_text):
        result = retry_insights_once(
            _draft_request(),
            project_root=tmp_path,
            environ=_env(tmp_path),
        )

    assert result["error"]["code"] == "DRAFT_EMPTY_RESULT"
    assert result["error"]["stage"] == "draft_generating"
    # Empty string MUST NOT be written to disk.
    assert not _draft_path(tmp_path).exists()
    # draft field stays empty on failure.
    assert result["draft"] == ""


# --------------------------------------------------------------------------- #
# 2.6 seed invalid (MUST NOT consume checkout / LLM call)
# --------------------------------------------------------------------------- #


def test_draft_branch_seed_not_in_insights_json_fails_without_running_draft(
    tmp_path: Path,
) -> None:
    # insights.json has id=5; request asks for a non-existent id=999.
    _write_task_skeleton(tmp_path, insight_id=INSIGHT_ID)

    with patch("frameq_worker.worker_service.run_draft") as mock_run, patch(
        "frameq_worker.draft_agent.resolve_draft_credentials"
    ) as mock_creds:
        result = retry_insights_once(
            _draft_request(insight_id=999),
            project_root=tmp_path,
            environ=_env(tmp_path),
        )

    assert result["error"]["code"] == "DRAFT_SEED_INVALID"
    assert result["error"]["stage"] == "draft_generating"
    # invalid seed MUST NOT consume an LLM call / checkout.
    mock_run.assert_not_called()
    mock_creds.assert_not_called()
    assert not _draft_path(tmp_path).exists()


def test_draft_branch_missing_insights_json_fails_with_seed_invalid(tmp_path: Path) -> None:
    # No insights.json at all → seed cannot be resolved → DRAFT_SEED_INVALID.
    _write_task_skeleton(tmp_path, with_insights=False)

    with patch("frameq_worker.worker_service.run_draft") as mock_run:
        result = retry_insights_once(
            _draft_request(),
            project_root=tmp_path,
            environ=_env(tmp_path),
        )

    assert result["error"]["code"] == "DRAFT_SEED_INVALID"
    mock_run.assert_not_called()


# --------------------------------------------------------------------------- #
# 2.6 preference snapshot missing → None degrade
# --------------------------------------------------------------------------- #


def test_draft_branch_missing_preference_snapshot_degrades_to_none(tmp_path: Path) -> None:
    _write_task_skeleton(
        tmp_path,
        with_insights=True,
        with_summary=False,
        with_preference_snapshot=False,
    )

    captured: dict[str, object] = {}

    def fake_run_draft(insight, preference_snapshot, summary, platform, env):
        captured["snapshot"] = preference_snapshot
        captured["summary"] = summary
        captured["platform"] = platform
        return "# 稿子正文"

    with patch("frameq_worker.worker_service.run_draft", side_effect=fake_run_draft):
        result = retry_insights_once(
            _draft_request(),
            project_root=tmp_path,
            environ=_env(tmp_path),
        )

    # No-personalization degrade — does not block.
    assert captured["snapshot"] is None
    # Missing summary → None too.
    assert captured["summary"] is None
    # platform 仍透传（请求级字段，与磁盘态无关）。
    assert captured["platform"] == "douyin"
    assert result["draft"] == "# 稿子正文"
    assert result["error"] is None


# --------------------------------------------------------------------------- #
# 2.6 exception wrapping
# --------------------------------------------------------------------------- #


def test_draft_branch_run_draft_exception_wraps_as_generation_failed(tmp_path: Path) -> None:
    _write_task_skeleton(tmp_path)

    def boom(insight, preference_snapshot, summary, platform, env):
        raise RuntimeError("missing FRAMEQ_LLM_API_KEY")

    with patch("frameq_worker.worker_service.run_draft", side_effect=boom):
        result = retry_insights_once(
            _draft_request(),
            project_root=tmp_path,
            environ=_env(tmp_path),
        )

    assert result["error"]["code"] == "DRAFT_GENERATION_FAILED"
    assert result["error"]["stage"] == "draft_generating"
    assert "missing FRAMEQ_LLM_API_KEY" in result["error"]["message"]
    assert not _draft_path(tmp_path).exists()
    assert result["draft"] == ""


# --------------------------------------------------------------------------- #
# 2.6 partial-completed semantics on draft failure (spec)
# --------------------------------------------------------------------------- #


def test_draft_branch_failure_keeps_existing_ai_artifacts(tmp_path: Path) -> None:
    """Draft fails but summary/insights are preserved (partial_completed)."""

    _write_task_skeleton(tmp_path, with_summary=True)

    with patch("frameq_worker.worker_service.run_draft", return_value=""):
        result = retry_insights_once(
            _draft_request(),
            project_root=tmp_path,
            environ=_env(tmp_path),
        )

    # Draft failed.
    assert result["error"]["code"] == "DRAFT_EMPTY_RESULT"
    # Other artifacts survive.
    assert result["summary"] == "# 要点总结\n- 要点一"
    assert isinstance(result["insights"], list) and len(result["insights"]) == 1
