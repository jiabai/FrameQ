from __future__ import annotations

import json
import re
from pathlib import Path

import frameq_worker.cli as cli
from frameq_worker.asr import DEFAULT_ASR_MODEL
from frameq_worker.cli import (
    MODEL_DIR_ENV,
    MODEL_DOWNLOAD_EVENT_PREFIX,
    OUTPUT_DIR_ENV,
    PROGRESS_EVENT_PREFIX,
)
from frameq_worker.models import Insight, JobStage, ProcessResult


def load_contract() -> dict[str, object]:
    contract_path = Path(__file__).parents[2] / "contracts" / "desktop-worker-contract.json"
    return json.loads(contract_path.read_text(encoding="utf-8"))


def test_contract_version_is_strictly_v2() -> None:
    assert load_contract()["contractVersion"] == 2


def test_worker_constants_match_desktop_contract() -> None:
    contract = load_contract()

    assert PROGRESS_EVENT_PREFIX == contract["events"]["workerProgressPrefix"]
    assert MODEL_DOWNLOAD_EVENT_PREFIX == contract["events"]["asrModelDownloadPrefix"]
    assert DEFAULT_ASR_MODEL == contract["asr"]["defaultModel"]
    assert OUTPUT_DIR_ENV == contract["env"]["outputDir"]
    assert contract["env"].get("cacheDir") == "FRAMEQ_CACHE_DIR"
    assert getattr(cli, "CACHE_DIR_ENV", None) == contract["env"]["cacheDir"]
    assert MODEL_DIR_ENV == contract["env"]["modelDir"]


def test_worker_result_keys_match_desktop_contract() -> None:
    contract = load_contract()

    result_keys = set(ProcessResult(status=JobStage.COMPLETED).to_dict().keys())

    assert result_keys == set(contract["workerResultKeys"])


def test_worker_result_contract_includes_task_artifacts() -> None:
    contract = load_contract()

    assert "summary" in contract["workerResultKeys"]
    assert "artifacts" in contract["workerResultKeys"]
    assert "transcript" in contract["workerResultKeys"]


def test_process_video_contract_is_transcript_only_and_retry_insights_is_ai_path() -> None:
    contract = load_contract()

    assert contract["processVideo"] == {
        "serverManagedLlmCheckout": False,
    }
    assert contract["aiGeneration"]["command"] == "retry_insights"
    assert contract["aiGeneration"]["serverManagedLlmCheckout"] is True


def test_retry_insights_request_schema_is_closed_and_machine_readable() -> None:
    request_contract = load_contract()["aiGeneration"]["request"]

    assert request_contract == {
        "type": "object",
        "required": ["task_id", "target", "output_language"],
        "properties": {
            "task_id": {"type": "string"},
            "target": {"type": "string", "enum": ["summary", "insights"]},
            "output_language": {
                "type": "string",
                "enum": ["zh-CN", "zh-TW", "en-US"],
            },
            "preference_snapshot": {"type": "object"},
        },
        "additionalProperties": False,
        "allOf": [
            {
                "if": {"required": ["preference_snapshot"]},
                "then": {"properties": {"target": {"const": "insights"}}},
            }
        ],
    }

    required = request_contract["required"]
    properties = request_contract["properties"]
    assert len(required) == len(set(required))
    assert set(required) <= set(properties)
    assert list(properties) == [*required, "preference_snapshot"]


def test_progress_events_use_structured_codes_and_safe_args() -> None:
    progress_contract = load_contract()["progressEvents"]
    worker_contract = progress_contract["worker"]
    model_contract = progress_contract["asrModelDownload"]

    assert progress_contract.get("invalidEventPolicy") == {
        "producer": "reject",
        "consumer": "drop_and_record_code",
    }
    assert progress_contract["fieldSchemas"] == {
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
    assert worker_contract["requiredFields"] == ["stage", "progress", "message_code"]
    assert worker_contract["optionalFields"] == ["message_args"]
    assert model_contract["requiredFields"] == ["status", "progress", "message_code"]
    assert model_contract["optionalFields"] == ["current_file", "message_args"]
    assert model_contract["fieldSchemas"] == {
        "status": {
            "type": "string",
            "enum": ["started", "downloading", "extracting", "completed", "cancelled"],
        },
        "current_file": {
            "type": "string",
            "minLength": 1,
            "maxLength": 255,
            "pattern": (
                r"^(?!\.{1,2}$)(?=[A-Za-z0-9._+() -]{1,255}$)(?=.*[A-Za-z0-9])"
                r"[A-Za-z0-9._+()-](?:[A-Za-z0-9._+() -]{0,253}[A-Za-z0-9_+()-])?$"
            ),
        },
    }


def test_progress_argument_schemas_are_closed_and_safe() -> None:
    progress_contract = load_contract()["progressEvents"]
    message_args = progress_contract["messageArgs"]

    assert message_args == {
        "type": "object",
        "properties": {
            "model": {
                "type": "string",
                "enum": [
                    "iic/SenseVoiceSmall",
                    "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
                ],
            },
            "language": {
                "type": "string",
                "minLength": 2,
                "maxLength": 35,
                "pattern": r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$",
            },
            "attempt": {"type": "integer", "minimum": 1, "maximum": 100},
            "total": {"type": "integer", "minimum": 1, "maximum": 100},
        },
        "additionalProperties": False,
        "constraints": {"attemptMustNotExceedTotal": True},
        "forbiddenContent": [
            "url",
            "full_path",
            "cookie",
            "credential",
            "transcript_content",
            "prompt",
            "generated_content",
            "request_headers",
            "preference_prose",
        ],
    }

    language_pattern = re.compile(message_args["properties"]["language"]["pattern"])
    assert language_pattern.fullmatch("zh-Hans")
    assert language_pattern.fullmatch("en-US")
    assert not language_pattern.fullmatch("zh_Hans")
    assert not language_pattern.fullmatch("../../secret")

    current_file_schema = progress_contract["asrModelDownload"]["fieldSchemas"]["current_file"]
    current_file_pattern = re.compile(current_file_schema["pattern"])
    assert current_file_pattern.fullmatch("model.pt")
    for invalid in (
        "",
        ".",
        "..",
        "dir/file",
        r"dir\file",
        "bad\0name",
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
    ):
        assert not current_file_pattern.fullmatch(invalid)


def test_progress_registry_covers_every_current_worker_and_model_message() -> None:
    progress_contract = load_contract()["progressEvents"]
    worker_codes = progress_contract["worker"]["messageCodes"]
    model_codes = progress_contract["asrModelDownload"]["messageCodes"]

    assert list(worker_codes) == [
        "video.download.preparing",
        "video.stream.validating",
        "audio.extract.running",
        "audio.extract.reused",
        "subtitle.detect.running",
        "subtitle.detect.found",
        "asr.cache.preparing",
        "asr.transcribe.starting",
        "asr.transcribe.running",
        "douyin.page.resolving",
        "douyin.stream.probing",
        "douyin.video.saving",
        "douyin.stream.retrying",
        "xiaohongshu.page.resolving",
        "xiaohongshu.video.saving",
        "xiaohongshu.stream.retrying",
        "bilibili.metadata.resolving",
        "bilibili.stream.probing",
        "bilibili.video.downloading",
        "bilibili.audio.downloading",
        "bilibili.media.merging",
    ]
    assert list(model_codes) == [
        "model.download.preparing",
        "model.download.completed",
        "model.download.cancelled",
        "model.primary.downloading",
        "model.vad.downloading",
        "model.archive.extracting",
        "model.archive.reading",
        "model.archive.downloading",
        "model.file.downloading",
        "model.file.completed",
    ]

    allowed_args = set(progress_contract["messageArgs"].get("properties", {}))
    for code, definition in {**worker_codes, **model_codes}.items():
        assert len(code.split(".")) == 3
        assert set(definition["allowedArgs"]) <= allowed_args

    assert model_codes == {
        "model.download.preparing": {
            "status": "started",
            "current_file": "forbidden",
            "allowedArgs": ["model"],
        },
        "model.download.completed": {
            "status": "completed",
            "current_file": "forbidden",
            "allowedArgs": ["model"],
        },
        "model.download.cancelled": {
            "status": "cancelled",
            "current_file": "forbidden",
            "allowedArgs": [],
        },
        "model.primary.downloading": {
            "status": "downloading",
            "current_file": "forbidden",
            "allowedArgs": ["model"],
        },
        "model.vad.downloading": {
            "status": "downloading",
            "current_file": "forbidden",
            "allowedArgs": ["model"],
        },
        "model.archive.extracting": {
            "status": "extracting",
            "current_file": "forbidden",
            "allowedArgs": [],
        },
        "model.archive.reading": {
            "status": "downloading",
            "current_file": "forbidden",
            "allowedArgs": [],
        },
        "model.archive.downloading": {
            "status": "downloading",
            "current_file": "forbidden",
            "allowedArgs": [],
        },
        "model.file.downloading": {
            "status": "downloading",
            "current_file": "required",
            "allowedArgs": [],
        },
        "model.file.completed": {
            "status": "downloading",
            "current_file": "required",
            "allowedArgs": [],
        },
    }

    assert worker_codes["subtitle.detect.found"]["allowedArgs"] == ["language"]
    assert worker_codes["asr.cache.preparing"]["allowedArgs"] == ["model"]
    assert worker_codes["douyin.stream.retrying"]["allowedArgs"] == ["attempt", "total"]

    allowed_statuses = set(progress_contract["asrModelDownload"]["fieldSchemas"]["status"]["enum"])
    for code, definition in model_codes.items():
        assert definition["status"] in allowed_statuses
        expected_current_file = "required" if code.startswith("model.file.") else "forbidden"
        assert definition["current_file"] == expected_current_file


def test_structured_insight_contract_keys_match_worker_model() -> None:
    contract = load_contract()
    insight = Insight(
        id=1,
        topic="topic",
        match_reason="matched",
        follow_up_questions=("next",),
        suitable_use="content planning",
        source_chunk_id=1,
    )

    insight_contract = contract["insightResult"]
    assert isinstance(insight_contract, dict)
    assert insight_contract["schemaVersion"] == 1
    assert set(insight.to_dict().keys()) == set(insight_contract["itemKeys"])
    assert insight_contract["preferenceSnapshotArtifact"] == "preference_snapshot"
