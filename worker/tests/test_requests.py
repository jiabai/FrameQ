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


def valid_process_request() -> dict[str, object]:
    return {
        "contract_version": 3,
        "url": "https://www.douyin.com/video/7524373044106677544",
        "asr_model": "iic/SenseVoiceSmall",
    }


def test_process_request_parses_exact_v3_execution_input() -> None:
    request = parse_process_request(valid_process_request())

    assert request.url == "https://www.douyin.com/video/7524373044106677544"
    assert request.asr_model == "iic/SenseVoiceSmall"


@pytest.mark.parametrize(
    "mutation",
    [
        {"remove": "contract_version"},
        {"remove": "url"},
        {"remove": "asr_model"},
        {"contract_version": 2},
        {"contract_version": "3"},
        {"url": "   "},
        {"asr_model": "Qwen/Qwen3-ASR-0.6B"},
        {"language": "Chinese"},
        {"output_formats": ["txt", "md"]},
        {"insightflow_mode": "embedded"},
        {"model": "iic/SenseVoiceSmall"},
        {"preference_snapshot": valid_preference_snapshot()},
        {"generate_insights": True},
    ],
)
def test_process_request_rejects_non_v3_payloads(mutation: dict[str, object]) -> None:
    payload = valid_process_request()
    removed = mutation.get("remove")
    if isinstance(removed, str):
        payload.pop(removed)
    else:
        payload.update(mutation)

    with pytest.raises(ValueError, match="^Process request payload was invalid\\.$"):
        parse_process_request(payload)


def test_process_request_rejects_additional_fields_without_echoing_input() -> None:
    payload = valid_process_request()
    payload["url"] = "https://user:review-secret@www.example.com/private"
    payload["language"] = "Chinese"

    with pytest.raises(ValueError) as error:
        parse_process_request(payload)

    assert str(error.value) == "Process request payload was invalid."
    assert "review-secret" not in str(error.value)
    assert "https://" not in str(error.value)


def test_process_request_does_not_accept_preference_snapshot() -> None:
    payload = valid_process_request()
    payload["preference_snapshot"] = valid_preference_snapshot()

    with pytest.raises(ValueError, match="^Process request payload was invalid\\.$"):
        parse_process_request(payload)


def test_process_request_has_no_ai_generation_field() -> None:
    payload = valid_process_request()
    payload["generate_insights"] = True

    with pytest.raises(ValueError, match="^Process request payload was invalid\\.$"):
        parse_process_request(payload)


def test_process_request_rejects_retired_ai_generation_field_without_echoing_input() -> None:
    payload = valid_process_request()
    payload["url"] = "https://user:review-secret@www.example.com/private"
    payload["generate_insights"] = True

    with pytest.raises(ValueError) as error:
        parse_process_request(payload)

    assert str(error.value) == "Process request payload was invalid."
    assert "review-secret" not in str(error.value)
    assert "https://" not in str(error.value)


def test_retry_request_parses_preference_snapshot() -> None:
    request = parse_retry_insights_request(
        {
            "task_id": "20260705-153012-douyin-demo",
            "target": "insights",
            "output_language": "zh-CN",
            "preference_snapshot": valid_preference_snapshot(),
        }
    )

    assert request.target == "insights"
    assert request.output_language == "zh-CN"
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

    with pytest.raises(ValueError, match="^Retry request payload was invalid\\.$"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "insights",
                "output_language": "zh-CN",
                "preference_snapshot": snapshot,
            }
        )


def test_retry_request_requires_generation_target() -> None:
    with pytest.raises(ValueError, match="^Retry request payload was invalid\\.$"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "output_language": "zh-CN",
            }
        )


def test_retry_request_rejects_unknown_generation_target() -> None:
    with pytest.raises(ValueError, match="^Retry request payload was invalid\\.$"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "both",
                "output_language": "zh-CN",
            }
        )


def test_retry_summary_request_rejects_preference_snapshot() -> None:
    with pytest.raises(ValueError, match="^Retry request payload was invalid\\.$"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "summary",
                "output_language": "zh-CN",
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
    with pytest.raises(ValueError, match="^Retry request payload was invalid\\.$"):
        parse_retry_insights_request(
            {
                "task_id": task_id,
                "target": "insights",
                "output_language": "zh-CN",
            }
        )
