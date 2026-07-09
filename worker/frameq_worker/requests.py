from __future__ import annotations

import re

from frameq_worker.asr import DEFAULT_ASR_MODEL, resolve_asr_model_name
from frameq_worker.desktop_contract import ASR_MODEL_ENV
from frameq_worker.models import (
    GenerationPreferences,
    InspirationProfile,
    PreferenceLabelSnapshot,
    PreferenceLabelSnapshotItem,
    PreferenceLabelValue,
    PreferenceSnapshot,
    ProcessRequest,
    RetryInsightsRequest,
)

PROFILE_FIELD_OPTIONS: dict[str, set[str]] = {
    "role": {
        "content_creator",
        "product_ops",
        "marketing_sales",
        "entrepreneur",
        "student_researcher",
        "teacher_trainer",
        "investor_business_analyst",
        "general_learner",
        "unspecified",
    },
    "domain": {
        "content_media",
        "product_operations",
        "marketing_sales",
        "education_training",
        "technology_rd",
        "management_consulting",
        "investment_business",
        "freelance",
        "general_perspective",
        "unspecified",
    },
    "stage": {
        "student",
        "early_career",
        "experienced_professional",
        "manager",
        "entrepreneur_operator",
        "retired",
        "unspecified",
    },
    "cityContext": {
        "tier1_city",
        "new_tier1_city",
        "lower_tier_city",
        "county_township",
        "overseas",
        "unspecified",
    },
    "genderPerspective": {
        "unspecified",
        "female_perspective",
        "male_perspective",
        "neutral_perspective",
    },
    "platforms": {
        "douyin",
        "xiaohongshu",
        "wechat_channels",
        "bilibili",
        "wechat_official_account",
        "podcast",
        "course_community",
        "internal_sharing",
    },
    "defaultStyles": {
        "direct_sharp",
        "gentle_inspiring",
        "professional_analysis",
        "grounded",
        "storytelling",
        "short_video_friendly",
        "long_form_friendly",
    },
    "defaultAvoid": {
        "chicken_soup",
        "academic",
        "vague",
        "clickbait",
        "commercialized",
        "negative",
        "grand_narrative",
    },
}

GENERATION_FIELD_OPTIONS: dict[str, set[str]] = {
    "goal": {
        "content_creation",
        "learning_understanding",
        "review_deconstruction",
        "business_insight",
        "controversy_discussion",
        "action_advice",
    },
    "scenario": {
        "personal_notes",
        "short_video",
        "article_official_account",
        "livestream_podcast",
        "team_sharing",
        "client_communication",
        "course_community",
    },
    "angles": {
        "topic_angle",
        "contrarian_view",
        "audience_pain_point",
        "practical_advice",
        "case_analogy",
        "risk_controversy",
        "trend_judgment",
        "reusable_method",
        "memorable_phrase",
        "cognitive_refresh",
    },
    "audience": {
        "self",
        "beginners",
        "peers",
        "clients",
        "boss_team",
        "fans_readers",
    },
    "styles": {
        "direct_sharp",
        "gentle_inspiring",
        "professional_analysis",
        "grounded",
        "storytelling",
        "short_video_friendly",
        "long_form_friendly",
    },
    "avoid": {
        "chicken_soup",
        "academic",
        "vague",
        "clickbait",
        "commercialized",
        "negative",
        "grand_narrative",
    },
}

TASK_ID_PATTERN = re.compile(r"^[0-9A-Za-z_-]+$")


def parse_process_request(payload: object) -> ProcessRequest:
    if not isinstance(payload, dict):
        raise ValueError("Request payload must be a JSON object.")

    url = payload.get("url")
    if not isinstance(url, str) or not url.strip():
        raise ValueError("Request payload must include a non-empty url.")

    output_formats = payload.get("output_formats", ("txt", "md"))
    if not isinstance(output_formats, list | tuple) or not all(
        isinstance(item, str) for item in output_formats
    ):
        raise ValueError("Request payload output_formats must be a list of strings.")

    return ProcessRequest(
        url=url.strip(),
        language=str(payload.get("language", "Chinese")),
        output_formats=tuple(output_formats),
        model=str(payload.get("model", DEFAULT_ASR_MODEL)),
        generate_insights=bool(payload.get("generate_insights", False)),
        insightflow_mode=str(payload.get("insightflow_mode", "embedded")),
    )


def parse_retry_insights_request(payload: object) -> RetryInsightsRequest:
    if not isinstance(payload, dict):
        raise ValueError("Retry payload must be a JSON object.")

    task_id = payload.get("task_id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("Retry payload must include a non-empty task_id.")
    task_id = task_id.strip()
    if not TASK_ID_PATTERN.fullmatch(task_id):
        raise ValueError("Retry payload task_id must be a single task directory name.")

    target = payload.get("target")
    if not isinstance(target, str) or not target.strip():
        raise ValueError("Retry payload must include target.")
    target = target.strip()
    if target not in {"summary", "insights"}:
        raise ValueError("Retry payload target must be summary or insights.")
    if target == "summary" and payload.get("preference_snapshot") is not None:
        raise ValueError("preference_snapshot is only allowed for insights target.")

    return RetryInsightsRequest(
        task_id=task_id,
        target=target,
        preference_snapshot=parse_preference_snapshot(payload.get("preference_snapshot")),
    )


def parse_preference_snapshot(payload: object) -> PreferenceSnapshot | None:
    if payload is None:
        return None
    if not isinstance(payload, dict):
        raise ValueError("preference_snapshot must be a JSON object.")

    profile_skipped = payload.get("profileSkipped")
    if not isinstance(profile_skipped, bool):
        raise ValueError("preference_snapshot.profileSkipped must be a boolean.")

    generation_preferences = _parse_generation_preferences(
        payload.get("generationPreferences")
    )
    label_snapshot = _parse_label_snapshot(payload.get("labelSnapshot"))
    profile_payload = payload.get("profile")
    profile = None if profile_payload is None else _parse_inspiration_profile(profile_payload)

    return PreferenceSnapshot(
        profile=profile,
        profile_skipped=profile_skipped,
        generation_preferences=generation_preferences,
        label_snapshot=label_snapshot,
    )


def _parse_inspiration_profile(payload: object) -> InspirationProfile:
    if not isinstance(payload, dict):
        raise ValueError("preference_snapshot.profile must be a JSON object or null.")

    return InspirationProfile(
        role=_read_single_option(payload, "role", PROFILE_FIELD_OPTIONS),
        domain=_read_single_option(payload, "domain", PROFILE_FIELD_OPTIONS),
        stage=_read_single_option(payload, "stage", PROFILE_FIELD_OPTIONS),
        city_context=_read_single_option(payload, "cityContext", PROFILE_FIELD_OPTIONS),
        gender_perspective=_read_single_option(
            payload,
            "genderPerspective",
            PROFILE_FIELD_OPTIONS,
        ),
        platforms=_read_multi_option(payload, "platforms", PROFILE_FIELD_OPTIONS, 0, 3),
        default_styles=_read_multi_option(
            payload,
            "defaultStyles",
            PROFILE_FIELD_OPTIONS,
            0,
            3,
        ),
        default_avoid=_read_multi_option(
            payload,
            "defaultAvoid",
            PROFILE_FIELD_OPTIONS,
            0,
            3,
        ),
    )


def _parse_generation_preferences(payload: object) -> GenerationPreferences:
    if not isinstance(payload, dict):
        raise ValueError("preference_snapshot.generationPreferences must be a JSON object.")

    return GenerationPreferences(
        goal=_read_single_option(payload, "goal", GENERATION_FIELD_OPTIONS),
        scenario=_read_single_option(payload, "scenario", GENERATION_FIELD_OPTIONS),
        angles=_read_multi_option(payload, "angles", GENERATION_FIELD_OPTIONS, 1, 3),
        audience=_read_single_option(payload, "audience", GENERATION_FIELD_OPTIONS),
        styles=_read_multi_option(payload, "styles", GENERATION_FIELD_OPTIONS, 1, 2),
        avoid=_read_multi_option(payload, "avoid", GENERATION_FIELD_OPTIONS, 0, 3),
    )


def _parse_label_snapshot(payload: object) -> PreferenceLabelSnapshot:
    if not isinstance(payload, dict):
        raise ValueError("preference_snapshot.labelSnapshot must be a JSON object.")

    return PreferenceLabelSnapshot(
        profile=_parse_label_snapshot_items(payload.get("profile"), "profile"),
        generation_preferences=_parse_label_snapshot_items(
            payload.get("generationPreferences"),
            "generationPreferences",
        ),
    )


def _parse_label_snapshot_items(
    payload: object,
    section: str,
) -> tuple[PreferenceLabelSnapshotItem, ...]:
    if not isinstance(payload, list):
        raise ValueError(f"preference_snapshot.labelSnapshot.{section} must be a list.")

    return tuple(_parse_label_snapshot_item(item, section) for item in payload)


def _parse_label_snapshot_item(
    payload: object,
    section: str,
) -> PreferenceLabelSnapshotItem:
    if not isinstance(payload, dict):
        raise ValueError(f"preference_snapshot.labelSnapshot.{section} items must be objects.")

    field = payload.get("field")
    label = payload.get("label")
    values = payload.get("values")
    if not isinstance(field, str) or not field.strip():
        raise ValueError("preference_snapshot.labelSnapshot item field must be a string.")
    if not isinstance(label, str):
        raise ValueError("preference_snapshot.labelSnapshot item label must be a string.")
    if not isinstance(values, list):
        raise ValueError("preference_snapshot.labelSnapshot item values must be a list.")

    return PreferenceLabelSnapshotItem(
        field=field,
        label=label,
        values=tuple(_parse_label_value(value) for value in values),
    )


def _parse_label_value(payload: object) -> PreferenceLabelValue:
    if not isinstance(payload, dict):
        raise ValueError("preference_snapshot.labelSnapshot values must be objects.")

    value_id = payload.get("id")
    label = payload.get("label")
    if not isinstance(value_id, str) or not value_id.strip():
        raise ValueError("preference_snapshot.labelSnapshot value id must be a string.")
    if not isinstance(label, str):
        raise ValueError("preference_snapshot.labelSnapshot value label must be a string.")

    return PreferenceLabelValue(id=value_id, label=label)


def _read_single_option(
    payload: dict[object, object],
    field: str,
    allowed_options: dict[str, set[str]],
) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or value not in allowed_options[field]:
        raise ValueError(f"preference_snapshot.{field} has an invalid option id.")
    return value


def _read_multi_option(
    payload: dict[object, object],
    field: str,
    allowed_options: dict[str, set[str]],
    min_count: int,
    max_count: int,
) -> tuple[str, ...]:
    values = payload.get(field)
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise ValueError(f"preference_snapshot.{field} must be a list of option ids.")
    if len(values) < min_count or len(values) > max_count:
        raise ValueError(
            f"preference_snapshot.{field} must include between {min_count} and {max_count} ids."
        )
    if len(set(values)) != len(values):
        raise ValueError(f"preference_snapshot.{field} must not contain duplicate ids.")
    if any(value not in allowed_options[field] for value in values):
        raise ValueError(f"preference_snapshot.{field} has an invalid option id.")
    return tuple(values)


def resolve_configured_asr_model(
    request_model: str,
    environ: dict[str, str] | None = None,
) -> str:
    env = environ if environ is not None else {}
    configured_model = env.get(ASR_MODEL_ENV, "").strip()
    return resolve_asr_model_name(configured_model or request_model)


def optional_env(env: dict[str, str], key: str) -> str | None:
    value = env.get(key, "").strip()
    return value or None
