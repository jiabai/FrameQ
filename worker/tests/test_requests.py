from __future__ import annotations

import pytest
from frameq_worker.requests import (
    parse_process_request,
    parse_retry_insights_request,
)


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


# ---------------------------------------------------------------------------
# Task 2.2: target="draft"
# ---------------------------------------------------------------------------


def test_retry_request_accepts_draft_target_with_insight_id() -> None:
    request = parse_retry_insights_request(
        {
            "task_id": "20260705-153012-douyin-demo",
            "target": "draft",
            "insight_id": 7,
            "platform": "douyin",
        }
    )

    assert request.target == "draft"
    assert request.insight_id == 7
    assert request.platform == "douyin"
    # preference_snapshot is rejected on draft — and absent here.
    assert request.preference_snapshot is None


def test_retry_draft_target_requires_insight_id() -> None:
    with pytest.raises(ValueError, match="insight_id"):
        parse_retry_insights_request(
            {"task_id": "20260705-153012-douyin-demo", "target": "draft"}
        )


def test_retry_draft_target_rejects_null_insight_id() -> None:
    with pytest.raises(ValueError, match="insight_id"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "draft",
                "insight_id": None,
            }
        )


def test_retry_draft_target_rejects_preference_snapshot() -> None:
    # preference_snapshot MUST NOT be sent for draft (read from disk instead).
    with pytest.raises(ValueError, match="preference_snapshot"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "draft",
                "insight_id": 7,
                "preference_snapshot": valid_preference_snapshot(),
            }
        )


def test_retry_draft_target_rejects_non_int_insight_id() -> None:
    with pytest.raises(ValueError, match="insight_id"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "draft",
                "insight_id": "not-an-int",
            }
        )


# ---------------------------------------------------------------------------
# Task 2: draft target — platform validation (9-id vocabulary)
# ---------------------------------------------------------------------------


def test_retry_draft_target_requires_platform() -> None:
    # platform 是请求级字段，draft 必须携带；缺失在 checkout 前失败、不扣额度。
    with pytest.raises(ValueError, match="platform"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "draft",
                "insight_id": 7,
            }
        )


@pytest.mark.parametrize(
    "platform",
    [
        "podcast",  # 档案词表项，但不在 draft 9-id 词表内
        "wechat",  # 拼写错误（合法 id 是 wechat_official_account / wechat_channels）
        "",  # 空串
        "   ",  # 纯空白 → strip 后为空
        "DOUYIN",  # 大小写不匹配（id 大小写敏感）
        "unknown_platform",  # 完全不存在的 id
    ],
)
def test_retry_draft_target_rejects_invalid_platform(platform: str) -> None:
    with pytest.raises(ValueError, match="platform"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": "draft",
                "insight_id": 7,
                "platform": platform,
            }
        )


@pytest.mark.parametrize(
    "platform,expected",
    [
        ("wechat_official_account", "wechat_official_account"),
        ("xiaohongshu", "xiaohongshu"),
        ("wechat_channels", "wechat_channels"),
        ("douyin", "douyin"),
        ("tiktok", "tiktok"),
        ("twitter", "twitter"),
        ("bilibili", "bilibili"),
        ("youtube", "youtube"),
        ("other", "other"),
        ("  douyin  ", "douyin"),  # 前后空白被 strip
    ],
)
def test_retry_draft_target_accepts_valid_platform(platform: str, expected: str) -> None:
    request = parse_retry_insights_request(
        {
            "task_id": "20260705-153012-douyin-demo",
            "target": "draft",
            "insight_id": 7,
            "platform": platform,
        }
    )
    assert request.target == "draft"
    assert request.platform == expected


@pytest.mark.parametrize("target", ["summary", "insights"])
def test_retry_non_draft_target_rejects_platform(target: str) -> None:
    # platform 仅 target="draft" 携带；其余 target 出现即非法。
    with pytest.raises(ValueError, match="platform"):
        parse_retry_insights_request(
            {
                "task_id": "20260705-153012-douyin-demo",
                "target": target,
                "platform": "douyin",
            }
        )


@pytest.mark.parametrize("target", ["summary", "insights"])
def test_retry_non_draft_target_without_platform_parses_with_none(
    target: str,
) -> None:
    request = parse_retry_insights_request(
        {"task_id": "20260705-153012-douyin-demo", "target": target}
    )
    assert request.target == target
    assert request.platform is None


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
