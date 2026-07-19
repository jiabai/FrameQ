from __future__ import annotations

import importlib
import json
import re
from dataclasses import fields
from pathlib import Path

import pytest

WORKER_SPECS = {
    "video.download.preparing": ("video_extracting", 18, {}),
    "video.stream.validating": ("video_extracting", 34, {}),
    "audio.extract.running": ("video_extracting", 48, {}),
    "audio.extract.reused": ("video_extracting", 50, {}),
    "subtitle.detect.running": ("video_transcribing", 58, {}),
    "subtitle.detect.found": ("video_transcribing", 68, {"language": "zh-Hans"}),
    "asr.cache.preparing": (
        "video_transcribing",
        58,
        {"model": "iic/SenseVoiceSmall"},
    ),
    "asr.transcribe.starting": ("video_transcribing", 58, {}),
    "asr.transcribe.running": ("video_transcribing", 68, {}),
    "douyin.page.resolving": ("video_extracting", 22, {}),
    "douyin.stream.probing": ("video_extracting", 26, {}),
    "douyin.video.saving": ("video_extracting", 30, {}),
    "douyin.stream.retrying": (
        "video_extracting",
        30,
        {"attempt": 2, "total": 3},
    ),
    "xiaohongshu.page.resolving": ("video_extracting", 22, {}),
    "xiaohongshu.video.saving": ("video_extracting", 30, {}),
    "xiaohongshu.stream.retrying": (
        "video_extracting",
        30,
        {"attempt": 2, "total": 3},
    ),
    "bilibili.metadata.resolving": ("video_extracting", 22, {}),
    "bilibili.stream.probing": ("video_extracting", 26, {}),
    "bilibili.video.downloading": ("video_extracting", 30, {}),
    "bilibili.audio.downloading": ("video_extracting", 32, {}),
    "bilibili.media.merging": ("video_extracting", 34, {}),
}

MODEL_SPECS = {
    "model.download.preparing": (
        "started",
        0,
        None,
        {"model": "iic/SenseVoiceSmall"},
    ),
    "model.download.completed": (
        "completed",
        100,
        None,
        {"model": "iic/SenseVoiceSmall"},
    ),
    "model.download.cancelled": ("cancelled", 50, None, {}),
    "model.primary.downloading": (
        "downloading",
        8,
        None,
        {"model": "iic/SenseVoiceSmall"},
    ),
    "model.vad.downloading": (
        "downloading",
        82,
        None,
        {"model": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"},
    ),
    "model.archive.extracting": ("extracting", 76, None, {}),
    "model.archive.reading": ("downloading", 20, None, {}),
    "model.archive.downloading": ("downloading", 20, None, {}),
    "model.file.downloading": ("downloading", 37, "model.pt", {}),
    "model.file.completed": ("downloading", 72, "model.pt", {}),
}


def progress_events_module():
    return importlib.import_module("frameq_worker.progress_events")


def load_contract() -> dict[str, object]:
    path = Path(__file__).parents[2] / "contracts" / "desktop-worker-contract.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_embedded_registries_match_the_shared_contract_exactly() -> None:
    progress_events = progress_events_module()
    contract = load_contract()["progressEvents"]

    assert [field.name for field in fields(progress_events.WorkerProgressSpec)] == [
        "allowed_args"
    ]
    assert [field.name for field in fields(progress_events.ModelProgressSpec)] == [
        "status",
        "current_file",
        "allowed_args",
    ]

    worker_view = {
        code: {"allowedArgs": list(spec.allowed_args)}
        for code, spec in progress_events.WORKER_PROGRESS_REGISTRY.items()
    }
    model_view = {
        code: {
            "status": spec.status,
            "current_file": spec.current_file,
            "allowedArgs": list(spec.allowed_args),
        }
        for code, spec in progress_events.MODEL_PROGRESS_REGISTRY.items()
    }

    assert worker_view == contract["worker"]["messageCodes"]
    assert model_view == contract["asrModelDownload"]["messageCodes"]
    assert sorted(progress_events.WORKER_PROGRESS_STAGES) == sorted(
        contract["fieldSchemas"]["stage"]["enum"]
    )


def test_runtime_registry_has_no_shared_contract_file_dependency() -> None:
    source = Path(progress_events_module().__file__).read_text(encoding="utf-8")

    assert "desktop-worker-contract" not in source
    assert "contracts/" not in source


def test_shared_contract_declares_integer_progress_and_retry_relationship() -> None:
    progress = load_contract()["progressEvents"]

    assert progress.get("fieldSchemas") == {
        "stage": {
            "type": "string",
            "enum": [
                "waiting_input",
                "video_extracting",
                "video_transcribing",
                "insights_generating",
                "completed",
                "partial_completed",
                "failed",
            ],
        },
        "progress": {"type": "integer", "minimum": 0, "maximum": 100}
    }
    assert progress["messageArgs"].get("constraints") == {
        "attemptMustNotExceedTotal": True
    }


def test_all_registered_worker_codes_build_closed_structured_events() -> None:
    progress_events = progress_events_module()

    for message_code, (stage, progress, message_args) in WORKER_SPECS.items():
        event = progress_events.build_worker_progress_event(
            message_code,
            stage=stage,
            progress=progress,
            message_args=message_args or None,
        )
        assert event == {
            "stage": stage,
            "progress": progress,
            "message_code": message_code,
            **({"message_args": message_args} if message_args else {}),
        }
        assert "message" not in event


@pytest.mark.parametrize(
    "stage,progress",
    [
        ("waiting_input", 0),
        ("video_transcribing", 19),
        ("completed", 100),
    ],
)
def test_worker_builder_accepts_any_legal_stage_and_integer_progress(
    stage: str,
    progress: int,
) -> None:
    progress_events = progress_events_module()

    assert progress_events.build_worker_progress_event(
        "video.download.preparing",
        stage=stage,
        progress=progress,
    ) == {
        "stage": stage,
        "progress": progress,
        "message_code": "video.download.preparing",
    }


def test_worker_builder_rejects_desktop_only_cancelling_stage() -> None:
    progress_events = progress_events_module()

    with pytest.raises(progress_events.ProgressEventValidationError):
        progress_events.build_worker_progress_event(
            "video.download.preparing",
            stage="cancelling",
            progress=1,
        )


def test_all_registered_model_codes_build_closed_structured_events() -> None:
    progress_events = progress_events_module()

    for message_code, (status, progress, current_file, message_args) in MODEL_SPECS.items():
        event = progress_events.build_model_progress_event(
            message_code,
            status=status,
            progress=progress,
            current_file=current_file,
            message_args=message_args or None,
        )
        assert event == {
            "status": status,
            "progress": progress,
            "message_code": message_code,
            **({"current_file": current_file} if current_file else {}),
            **({"message_args": message_args} if message_args else {}),
        }
        assert "message" not in event


def test_optional_contract_args_are_not_promoted_to_required() -> None:
    progress_events = progress_events_module()

    assert progress_events.build_worker_progress_event(
        "douyin.stream.retrying",
        stage="video_extracting",
        progress=30,
    )["message_code"] == "douyin.stream.retrying"
    assert progress_events.build_model_progress_event(
        "model.download.preparing",
        status="started",
        progress=57,
    ) == {
        "status": "started",
        "progress": 57,
        "message_code": "model.download.preparing",
    }


@pytest.mark.parametrize(
    "message_code,stage,progress,message_args",
    [
        ("unknown.code.value", "video_extracting", 18, None),
        ("video.download.preparing", "not-a-stage", 18, None),
        ("video.download.preparing", "video_extracting", -1, None),
        ("video.download.preparing", "video_extracting", 101, None),
        ("video.download.preparing", "video_extracting", True, None),
        ("video.download.preparing", "video_extracting", 18.5, None),
        ("video.download.preparing", "video_extracting", 18, {"url": "review-secret"}),
        ("subtitle.detect.found", "video_transcribing", 68, {"language": "../secret"}),
        (
            "asr.cache.preparing",
            "video_transcribing",
            58,
            {"model": "review-secret"},
        ),
        (
            "douyin.stream.retrying",
            "video_extracting",
            30,
            {"attempt": 0, "total": 2},
        ),
        (
            "douyin.stream.retrying",
            "video_extracting",
            30,
            {"attempt": 3, "total": 2},
        ),
    ],
)
def test_worker_builder_rejects_invalid_input_without_echoing(
    message_code: str,
    stage: str,
    progress: object,
    message_args: dict[str, object] | None,
) -> None:
    progress_events = progress_events_module()

    with pytest.raises(progress_events.ProgressEventValidationError) as error:
        progress_events.build_worker_progress_event(
            message_code,
            stage=stage,
            progress=progress,
            message_args=message_args,
        )

    assert str(error.value) == "Progress event was invalid."
    assert "review-secret" not in str(error.value)


@pytest.mark.parametrize(
    "message_code,status,progress,current_file,message_args",
    [
        ("unknown.code.value", "downloading", 10, None, None),
        ("model.download.preparing", "completed", 0, None, {"model": "iic/SenseVoiceSmall"}),
        ("model.file.downloading", "downloading", 20, None, None),
        (
            "model.download.completed",
            "completed",
            100,
            "secret.bin",
            {"model": "iic/SenseVoiceSmall"},
        ),
        ("model.file.completed", "downloading", 20, "../review-secret", None),
        (
            "model.file.completed",
            "downloading",
            20,
            "secret=review-secret.bin",
            None,
        ),
        ("model.file.completed", "downloading", 101, "model.pt", None),
    ],
)
def test_model_builder_rejects_invalid_input_without_echoing(
    message_code: str,
    status: str,
    progress: object,
    current_file: str | None,
    message_args: dict[str, object] | None,
) -> None:
    progress_events = progress_events_module()

    with pytest.raises(progress_events.ProgressEventValidationError) as error:
        progress_events.build_model_progress_event(
            message_code,
            status=status,
            progress=progress,
            current_file=current_file,
            message_args=message_args,
        )

    assert str(error.value) == "Progress event was invalid."
    assert "review-secret" not in str(error.value)


@pytest.mark.parametrize(
    "current_file",
    [
        "C:model.pt",
        "model.pt:stream",
        "https:model.pt",
        "model\u202e.pt",
        "model\u2028.pt",
        "model\u0085.pt",
        "model\u00a0file.pt",
        "model\u0600file.pt",
        "model\U0001d173file.pt",
        "model\U000e0001file.pt",
        "model.pt.",
        "model.pt ",
    ],
)
def test_model_builder_rejects_cross_layer_unsafe_basenames(
    current_file: str,
) -> None:
    progress_events = progress_events_module()

    with pytest.raises(progress_events.ProgressEventValidationError):
        progress_events.build_model_progress_event(
            "model.file.downloading",
            status="downloading",
            progress=20,
            current_file=current_file,
        )


@pytest.mark.parametrize(
    "current_file",
    [
        "model.pt",
        ".gitattributes",
        "configuration.json",
        "MODEL_VERSION.txt",
        "SenseVoice Small (v2)+fp16.bin",
    ],
)
def test_model_builder_accepts_portable_release_basenames(current_file: str) -> None:
    progress_events = progress_events_module()

    event = progress_events.build_model_progress_event(
        "model.file.downloading",
        status="downloading",
        progress=20,
        current_file=current_file,
    )

    assert event["current_file"] == current_file


@pytest.mark.parametrize("message_code", [{"unhashable": True}, ["unhashable"]])
def test_builders_use_fixed_errors_for_non_string_codes(message_code: object) -> None:
    progress_events = progress_events_module()

    with pytest.raises(progress_events.ProgressEventValidationError) as worker_error:
        progress_events.build_worker_progress_event(
            message_code,
            stage="video_extracting",
            progress=18,
        )
    with pytest.raises(progress_events.ProgressEventValidationError) as model_error:
        progress_events.build_model_progress_event(
            message_code,
            status="started",
            progress=0,
        )

    assert str(worker_error.value) == "Progress event was invalid."
    assert str(model_error.value) == "Progress event was invalid."


def test_wire_validators_reject_legacy_or_null_optional_fields() -> None:
    progress_events = progress_events_module()
    invalid_events = [
        {
            "stage": "video_extracting",
            "progress": 18,
            "message_code": "video.download.preparing",
            "message": "legacy text",
        },
        {
            "stage": "video_extracting",
            "progress": 18,
            "message_code": "video.download.preparing",
            "message_args": None,
        },
        {
            "status": "started",
            "progress": 0,
            "message_code": "model.download.preparing",
            "current_file": None,
            "message_args": {"model": "iic/SenseVoiceSmall"},
        },
    ]

    for event in invalid_events[:2]:
        with pytest.raises(progress_events.ProgressEventValidationError):
            progress_events.validate_worker_progress_event(event)
    with pytest.raises(progress_events.ProgressEventValidationError):
        progress_events.validate_model_progress_event(invalid_events[-1])


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("zh_Hans", "zh-Hans"),
        ("en_US", "en-US"),
        ("EN-us", "en-US"),
        ("zh-Hant-TW", "zh-Hant-TW"),
        ("en-419", "en-419"),
        ("und", "und"),
        ("unknown", None),
        ("secret", None),
        ("zh-Hant-TW-extra", None),
        ("../../secret", None),
        ("en-US?token=review-secret", None),
        ("x" * 36, None),
        (None, None),
    ],
)
def test_language_args_are_normalized_or_safely_dropped(
    raw: object,
    expected: str | None,
) -> None:
    progress_events = progress_events_module()

    assert progress_events.normalize_language_tag(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("iic/SenseVoiceSmall", "iic/SenseVoiceSmall"),
        (
            "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
            "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        ),
        ("Qwen/Qwen3-ASR-0.6B", None),
        ("review-secret", None),
        (None, None),
    ],
)
def test_model_args_use_the_closed_contract_allowlist(
    raw: object,
    expected: str | None,
) -> None:
    progress_events = progress_events_module()

    assert progress_events.normalize_model_arg(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("models/iic/model.pt", "model.pt"),
        (r"C:\cache\model.bin", "model.bin"),
        ("https://model.example/files/model.pt", "model.pt"),
        (r"C:\review-secret\model.pt", "model.pt"),
        ("mo\x00del.pt", "model.pt"),
        ("https://model.example/model.pt?token=review-secret", "model-file"),
        ("secret=review-secret.bin", "model-file"),
        ("..", "model-file"),
        ("", "model-file"),
        ("x" * 256, "model-file"),
        ("C:model.pt", "model-file"),
        ("model.pt:stream", "model-file"),
        ("https:model.pt", "model-file"),
        ("https://[::1/model.pt", "model-file"),
        ("model\u202e.pt", "model-file"),
        ("model\u2028.pt", "model-file"),
        ("model\u0085.pt", "model-file"),
        ("model\u00a0file.pt", "model-file"),
        ("model\u0600file.pt", "model-file"),
        ("model\U0001d173file.pt", "model-file"),
        ("model\U000e0001file.pt", "model-file"),
        ("model.pt.", "model-file"),
        (" model.pt ", "model.pt"),
    ],
)
def test_modelscope_filename_is_reduced_to_a_safe_cross_platform_basename(
    raw: str,
    expected: str,
) -> None:
    progress_events = progress_events_module()

    safe_name = progress_events.safe_current_file_basename(raw)

    assert safe_name == expected
    assert "review-secret" not in safe_name


def test_contract_current_file_pattern_matches_portable_runtime_fixtures() -> None:
    current_file = load_contract()["progressEvents"]["asrModelDownload"][
        "fieldSchemas"
    ]["current_file"]
    pattern = re.compile(current_file["pattern"])
    valid = [
        "model.pt",
        ".gitattributes",
        "configuration.json",
        "MODEL_VERSION.txt",
        "SenseVoice Small (v2)+fp16.bin",
    ]
    invalid = [
        "",
        ".",
        "..",
        "dir/model.pt",
        r"dir\model.pt",
        "C:model.pt",
        "model.pt:stream",
        "model\u00a0file.pt",
        "model\u0600file.pt",
        "model\U0001d173file.pt",
        "model\U000e0001file.pt",
        "model.pt.",
        "model.pt ",
    ]

    assert all(pattern.fullmatch(value) is not None for value in valid)
    assert all(pattern.fullmatch(value) is None for value in invalid)


def test_every_python_producer_code_is_declared_at_its_actual_source() -> None:
    root = Path(__file__).parents[1] / "frameq_worker"
    source_expectations = {
        "media_preparation.py": list(WORKER_SPECS)[:5],
        "pipeline.py": list(WORKER_SPECS)[5:9],
        "douyin_fallback.py": [code for code in WORKER_SPECS if code.startswith("douyin.")],
        "xiaohongshu_fallback.py": [
            code for code in WORKER_SPECS if code.startswith("xiaohongshu.")
        ],
        "bilibili_fallback.py": [
            code for code in WORKER_SPECS if code.startswith("bilibili.")
        ],
        "model_download.py": [code for code in MODEL_SPECS if code != "model.download.cancelled"],
    }

    for filename, expected_codes in source_expectations.items():
        source = (root / filename).read_text(encoding="utf-8")
        for code in expected_codes:
            assert code in source, f"{code} is not emitted by {filename}"
