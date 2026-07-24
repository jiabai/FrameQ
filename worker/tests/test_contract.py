from __future__ import annotations

import json
import re
from pathlib import Path

from frameq_worker.asr import DEFAULT_ASR_MODEL
from frameq_worker.desktop_contract import (
    AUDIO_EXTENSIONS,
    CACHE_DIR_ENV,
    DESKTOP_WORKER_CONTRACT_VERSION,
    LOCAL_MEDIA_CONTRACT_VERSION,
    MODEL_DIR_ENV,
    MODEL_DOWNLOAD_EVENT_PREFIX,
    OUTPUT_DIR_ENV,
    PROCESS_VIDEO_CONTRACT_VERSION,
    PROGRESS_EVENT_PREFIX,
    VIDEO_EXTENSIONS,
)
from frameq_worker.models import Insight, JobStage, ProcessResult


def load_contract() -> dict[str, object]:
    contract_path = Path(__file__).parents[2] / "contracts" / "desktop-worker-contract.json"
    return json.loads(contract_path.read_text(encoding="utf-8"))


def test_contract_version_is_strictly_v4_while_process_video_stays_v3() -> None:
    contract = load_contract()

    assert DESKTOP_WORKER_CONTRACT_VERSION == contract["contractVersion"] == 4
    assert LOCAL_MEDIA_CONTRACT_VERSION == 4
    assert PROCESS_VIDEO_CONTRACT_VERSION == 3
    assert (
        contract["processVideo"]["workerRequest"]["properties"]["contract_version"]
        ["const"]
        == PROCESS_VIDEO_CONTRACT_VERSION
    )


def test_local_media_contract_is_closed_source_typed_and_non_echoing() -> None:
    contract = load_contract()
    local_media = contract["localMedia"]
    all_extensions = [
        "mp4",
        "m4v",
        "mov",
        "mkv",
        "avi",
        "wmv",
        "webm",
        "mp3",
        "wav",
        "m4a",
        "aac",
        "flac",
        "ogg",
        "opus",
        "wma",
    ]

    assert local_media["workerMode"] == "--process-local-media-stdin"
    assert local_media["mediaKinds"] == ["video", "audio"]
    assert local_media["extensionsByKind"] == {
        "video": ["mp4", "m4v", "mov", "mkv", "avi", "wmv", "webm"],
        "audio": ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"],
    }
    assert VIDEO_EXTENSIONS == frozenset(local_media["extensionsByKind"]["video"])
    assert AUDIO_EXTENSIONS == frozenset(local_media["extensionsByKind"]["audio"])
    assert local_media["frontendSelection"] == {
        "type": "object",
        "required": [
            "selectionToken",
            "displayName",
            "mediaKind",
            "extension",
            "sizeBytes",
        ],
        "properties": {
            "selectionToken": {"type": "string", "format": "uuid"},
            "displayName": {"type": "string", "minLength": 1, "maxLength": 160},
            "mediaKind": {"type": "string", "enum": ["video", "audio"]},
            "extension": {"type": "string", "enum": all_extensions},
            "sizeBytes": {"type": "integer", "minimum": 1},
        },
        "additionalProperties": False,
        "constraints": {
            "displayNameMustBeSafeBasename": True,
            "displayNameExtensionMustMatch": True,
            "extensionMustMatchMediaKind": True,
        },
    }
    assert local_media["ipcRequest"] == {
        "type": "object",
        "required": ["selectionToken"],
        "properties": {
            "selectionToken": {"type": "string", "format": "uuid"},
        },
        "additionalProperties": False,
    }
    assert local_media["workerRequest"] == {
        "type": "object",
        "required": [
            "contract_version",
            "source_path",
            "media_kind",
            "safe_display_name",
            "source_extension",
            "asr_model",
        ],
        "properties": {
            "contract_version": {"const": 4},
            "source_path": {"type": "string", "minLength": 1},
            "media_kind": {"type": "string", "enum": ["video", "audio"]},
            "safe_display_name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160,
            },
            "source_extension": {"type": "string", "enum": all_extensions},
            "asr_model": {"type": "string", "enum": ["iic/SenseVoiceSmall"]},
        },
        "additionalProperties": False,
        "constraints": {
            "sourcePathMustBeAbsolute": True,
            "sourcePathExtensionMustMatch": True,
            "safeDisplayNameMustBeSafeBasename": True,
            "safeDisplayNameExtensionMustMatch": True,
            "extensionMustMatchMediaKind": True,
        },
    }


def test_local_media_contract_registers_progress_errors_and_sensitive_content() -> None:
    contract = load_contract()
    local_media = contract["localMedia"]

    assert {
        "local.media.validating",
        "local.video.copying",
        "local.audio.normalizing",
    } <= set(contract["progressEvents"]["worker"]["messageCodes"])
    assert local_media["errorCodes"] == [
        "LOCAL_MEDIA_SELECTION_INVALID",
        "LOCAL_MEDIA_SELECTION_CHANGED",
        "LOCAL_MEDIA_UNSUPPORTED_FORMAT",
        "LOCAL_MEDIA_UNAVAILABLE",
        "LOCAL_MEDIA_LINKED",
        "LOCAL_MEDIA_VALIDATION_FAILED",
        "LOCAL_MEDIA_KIND_MISMATCH",
        "LOCAL_VIDEO_STREAM_MISSING",
        "LOCAL_VIDEO_AUDIO_STREAM_MISSING",
        "LOCAL_AUDIO_STREAM_MISSING",
        "LOCAL_VIDEO_COPY_FAILED",
        "AUDIO_NORMALIZATION_FAILED",
    ]
    assert local_media["sensitiveContent"] == {
        "full_path": {
            "allowedOnlyIn": [
                "rust_selection_memory",
                "worker_stdin",
                "worker_memory",
            ],
            "forbiddenFrom": [
                "frontend",
                "ipc_request",
                "ipc_response",
                "argv",
                "environment",
                "worker_result",
                "progress",
                "error",
                "log",
                "manifest",
                "transcript",
                "ai_prompt",
                "cloud_request",
            ],
        },
        "selection_token": {
            "allowedOnlyIn": [
                "rust_selection_memory",
                "frontend",
                "ipc_request",
                "ipc_response",
            ],
            "forbiddenFrom": [
                "worker_stdin",
                "argv",
                "environment",
                "worker_result",
                "progress",
                "error",
                "log",
                "manifest",
                "transcript",
                "ai_prompt",
                "cloud_request",
            ],
        },
    }


def test_process_video_contract_separates_ipc_intent_from_worker_execution() -> None:
    process_video = load_contract()["processVideo"]

    assert process_video == {
        "serverManagedLlmCheckout": False,
        "configurationOwner": "desktop_rust",
        "ipcRequest": {
            "type": "object",
            "required": ["url"],
            "properties": {"url": {"type": "string", "minLength": 1}},
            "additionalProperties": False,
        },
        "workerRequest": {
            "type": "object",
            "required": ["contract_version", "url", "asr_model"],
            "properties": {
                "contract_version": {"const": 3},
                "url": {"type": "string", "minLength": 1},
                "asr_model": {"type": "string", "enum": ["iic/SenseVoiceSmall"]},
            },
            "additionalProperties": False,
        },
    }


def test_worker_constants_match_desktop_contract() -> None:
    contract = load_contract()

    assert PROGRESS_EVENT_PREFIX == contract["events"]["workerProgressPrefix"]
    assert MODEL_DOWNLOAD_EVENT_PREFIX == contract["events"]["asrModelDownloadPrefix"]
    assert DEFAULT_ASR_MODEL == contract["asr"]["defaultModel"]
    assert OUTPUT_DIR_ENV == contract["env"]["outputDir"]
    assert CACHE_DIR_ENV == contract["env"]["cacheDir"]
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


def test_terminal_result_contract_closes_framing_operations_and_nested_shapes() -> None:
    terminal = load_contract()["terminalResults"]

    assert terminal["stdout"] == {
        "encoding": "utf-8",
        "nonEmptyLineCount": 1,
        "diagnosticsChannel": "stderr",
        "invalidPayloadPolicy": "reject_without_echo",
    }
    assert terminal["operations"] == {
        "process_video": "task",
        "process_local_media": "task",
        "retry_insights": "task",
        "resolve_source_identity": "sourceIdentity",
        "download_asr_model": "modelDownload",
    }
    assert terminal["safeErrorCode"] == {
        "type": "string",
        "minLength": 1,
        "maxLength": 64,
        "pattern": r"^[A-Z][A-Z0-9_]{0,63}$",
    }

    schemas = terminal["schemas"]
    task = schemas["task"]
    assert task["required"] == load_contract()["workerResultKeys"]
    assert task["additionalProperties"] is False
    assert task["properties"]["status"]["enum"] == [
        "completed",
        "partial_completed",
        "failed",
    ]
    assert set(task["properties"]["artifacts"]["properties"]) == {
        "video",
        "audio",
        "transcript_txt",
        "transcript_md",
        "segments",
        "summary",
        "mindmap",
        "insights",
        "insights_md",
        "preference_snapshot",
    }
    assert task["properties"]["artifacts"]["additionalProperties"] is False
    insight_object = task["properties"]["insights"]["items"]
    assert list(insight_object["properties"]) == load_contract()["insightResult"][
        "itemKeys"
    ]
    assert insight_object["additionalProperties"] is False
    assert task["properties"]["transcript"]["oneOf"][1][
        "additionalProperties"
    ] is False
    assert task["properties"]["error"]["oneOf"][1][
        "additionalProperties"
    ] is False
    assert task["constraints"] == {
        "completedRequiresNullError": True,
        "nonCompletedRequiresStructuredError": True,
    }

    source = schemas["sourceIdentity"]
    model = schemas["modelDownload"]
    assert len(source["oneOf"]) == 2
    assert len(model["oneOf"]) == 2
    assert all(variant["additionalProperties"] is False for variant in source["oneOf"])
    assert all(variant["additionalProperties"] is False for variant in model["oneOf"])
    assert model["oneOf"][1]["properties"]["message"]["enum"] == [
        "ASR model download failed.",
        "Downloaded ASR model archive was invalid.",
    ]


def test_process_video_contract_is_transcript_only_and_retry_insights_is_ai_path() -> None:
    contract = load_contract()

    assert contract["processVideo"]["serverManagedLlmCheckout"] is False
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
            "selection_token",
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
        "local.media.validating",
        "local.video.copying",
        "local.audio.normalizing",
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
