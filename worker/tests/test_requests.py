from __future__ import annotations

import pytest
from frameq_worker.requests import parse_process_request, parse_retry_insights_request


def valid_preference_snapshot() -> dict[str, object]:
    return {
        "profile": {
            "role": "content_creator",
            "domain": "content_media",
            "stage": "experienced_professional",
            "cityContext": "new_tier1_city",
            "genderPerspective": "neutral_perspective",
            "platforms": ["douyin"],
            "defaultStyles": ["grounded"],
            "defaultAvoid": ["clickbait"],
        },
        "profileSkipped": False,
        "generationPreferences": {
            "goal": "content_creation",
            "scenario": "short_video",
            "angles": ["topic_angle"],
            "audience": "fans_readers",
            "styles": ["grounded"],
            "avoid": ["clickbait"],
        },
        "labelSnapshot": {
            "profile": [
                {
                    "field": "role",
                    "label": "我的角色",
                    "values": [{"id": "content_creator", "label": "内容创作者"}],
                }
            ],
            "generationPreferences": [
                {
                    "field": "goal",
                    "label": "本次目标",
                    "values": [{"id": "content_creation", "label": "内容创作"}],
                }
            ],
        },
    }


def test_process_request_does_not_accept_preference_snapshot() -> None:
    request = parse_process_request(
        {
            "url": "https://www.douyin.com/video/7524373044106677544",
            "preference_snapshot": valid_preference_snapshot(),
        }
    )

    assert not hasattr(request, "preference_snapshot")


def test_process_request_has_no_ai_generation_field() -> None:
    request = parse_process_request(
        {
            "url": "https://www.douyin.com/video/7524373044106677544",
        }
    )

    assert not hasattr(request, "generate_insights")


def test_process_request_rejects_retired_ai_generation_field_without_echoing_input() -> None:
    with pytest.raises(ValueError) as error:
        parse_process_request(
            {
                "url": "https://user:review-secret@www.example.com/private",
                "generate_insights": True,
            }
        )

    assert str(error.value) == "Process request contains an unsupported field."
    assert "review-secret" not in str(error.value)
    assert "https://" not in str(error.value)


def test_retry_request_parses_preference_snapshot() -> None:
    request = parse_retry_insights_request(
        {
            "task_id": "20260705-153012-douyin-demo",
            "target": "insights",
            "preference_snapshot": valid_preference_snapshot(),
        }
    )

    assert request.target == "insights"
    assert request.preference_snapshot is not None
    assert request.preference_snapshot.profile is not None
    assert request.preference_snapshot.profile.role == "content_creator"
    assert request.preference_snapshot.profile_skipped is False
    assert request.preference_snapshot.generation_preferences.goal == "content_creation"
    assert request.preference_snapshot.generation_preferences.angles == ("topic_angle",)
    assert request.preference_snapshot.label_snapshot.generation_preferences[0].field == "goal"


def test_retry_request_rejects_invalid_preference_snapshot_options() -> None:
    snapshot = valid_preference_snapshot()
    generation_preferences = snapshot["generationPreferences"]
    assert isinstance(generation_preferences, dict)
    generation_preferences["angles"] = ["topic_angle", "not_a_real_angle"]

    with pytest.raises(ValueError, match="preference_snapshot"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "insights",
                "preference_snapshot": snapshot,
            }
        )


def test_retry_request_requires_generation_target() -> None:
    with pytest.raises(ValueError, match="target"):
        parse_retry_insights_request({"task_id": "20260705-153012-douyin-demo"})


def test_retry_request_rejects_unknown_generation_target() -> None:
    with pytest.raises(ValueError, match="target"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "both",
            }
        )


def test_retry_summary_request_rejects_preference_snapshot() -> None:
    with pytest.raises(ValueError, match="preference_snapshot"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "summary",
                "preference_snapshot": valid_preference_snapshot(),
            }
        )


@pytest.mark.parametrize(
    "task_id",
    [
        "../outside",
        "nested/task",
        "nested\\task",
        "C:/FrameQ/task",
        "20260705-153012-douyin-demo/../outside",
    ],
)
def test_retry_request_rejects_task_id_path_traversal(task_id: str) -> None:
    with pytest.raises(ValueError, match="task_id"):
        parse_retry_insights_request({"task_id": task_id, "target": "insights"})
