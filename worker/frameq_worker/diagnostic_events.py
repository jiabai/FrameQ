from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from frameq_worker.desktop_contract import DIAGNOSTIC_EVENT_PREFIX

DIAGNOSTIC_PHASES = (
    "preparing",
    "primary_model",
    "vad_model",
    "bpe_model",
    "archive_download",
    "archive_validate",
    "cache_validate",
    "cache_promote",
)

DIAGNOSTIC_CODES: Mapping[str, tuple[str, ...]] = MappingProxyType({
    "network": (
        "dns_resolution_failed",
        "connection_timeout",
        "connection_failed",
    ),
    "tls": ("tls_verification_failed", "tls_handshake_failed"),
    "proxy": ("proxy_configuration_failed", "proxy_connection_failed"),
    "http": ("http_status_failed",),
    "filesystem": ("permission_denied", "disk_full", "filesystem_io_failed"),
    "integrity": ("checksum_mismatch", "archive_invalid", "cache_invalid"),
    "dependency": ("dependency_unavailable",),
    "unexpected": ("unexpected_failure",),
})

_REQUIRED_FIELDS = ("version", "operation", "phase", "category", "code")
_OPTIONAL_FIELDS = ("exception_type", "http_status", "os_error_code")
_ALLOWED_FIELDS = frozenset((*_REQUIRED_FIELDS, *_OPTIONAL_FIELDS))
_EXCEPTION_TYPE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,79}$")
_OS_ERROR_CODE_MINIMUM = -(2**31)
_OS_ERROR_CODE_MAXIMUM = 2**31 - 1
_OS_ERROR_CODE_CATEGORIES = frozenset(("network", "filesystem"))


@dataclass(frozen=True)
class DiagnosticEvent:
    version: int
    operation: str
    phase: str
    category: str
    code: str
    exception_type: str | None = None
    http_status: int | None = None
    os_error_code: int | None = None

    def to_dict(self) -> dict[str, object]:
        values: dict[str, object] = {
            "version": self.version,
            "operation": self.operation,
            "phase": self.phase,
            "category": self.category,
            "code": self.code,
        }
        if self.exception_type is not None:
            values["exception_type"] = self.exception_type
        if self.http_status is not None:
            values["http_status"] = self.http_status
        if self.os_error_code is not None:
            values["os_error_code"] = self.os_error_code
        return values


def validate_diagnostic_event(value: Mapping[str, object]) -> dict[str, object]:
    if set(value) != _ALLOWED_FIELDS.intersection(value):
        raise ValueError("diagnostic_event_unknown_field")
    if any(field not in value for field in _REQUIRED_FIELDS):
        raise ValueError("diagnostic_event_missing_field")

    version = value["version"]
    operation = value["operation"]
    phase = value["phase"]
    category = value["category"]
    code = value["code"]
    if type(version) is not int or version != 1:
        raise ValueError("diagnostic_event_invalid_version")
    if not isinstance(operation, str) or operation != "download_asr_model":
        raise ValueError("diagnostic_event_invalid_operation")
    if not isinstance(phase, str) or phase not in DIAGNOSTIC_PHASES:
        raise ValueError("diagnostic_event_invalid_phase")
    if not isinstance(category, str) or category not in DIAGNOSTIC_CODES:
        raise ValueError("diagnostic_event_invalid_category")
    if not isinstance(code, str) or code not in DIAGNOSTIC_CODES[category]:
        raise ValueError("diagnostic_event_invalid_code")

    exception_type = value.get("exception_type")
    if "exception_type" in value and (
        not isinstance(exception_type, str)
        or _EXCEPTION_TYPE_PATTERN.fullmatch(exception_type) is None
    ):
        raise ValueError("diagnostic_event_invalid_exception_type")

    http_status = value.get("http_status")
    if "http_status" in value:
        if (
            type(http_status) is not int
            or not 100 <= http_status <= 599
            or category != "http"
            or code != "http_status_failed"
        ):
            raise ValueError("diagnostic_event_invalid_http_status")

    os_error_code = value.get("os_error_code")
    if "os_error_code" in value:
        if (
            type(os_error_code) is not int
            or not _OS_ERROR_CODE_MINIMUM <= os_error_code <= _OS_ERROR_CODE_MAXIMUM
            or category not in _OS_ERROR_CODE_CATEGORIES
        ):
            raise ValueError("diagnostic_event_invalid_os_error_code")

    validated = {field: value[field] for field in _REQUIRED_FIELDS}
    validated.update(
        (field, value[field]) for field in _OPTIONAL_FIELDS if field in value
    )
    return validated


def render_diagnostic_event(event: DiagnosticEvent) -> str:
    validated = validate_diagnostic_event(event.to_dict())
    payload = json.dumps(validated, ensure_ascii=True, separators=(",", ":"))
    return f"{DIAGNOSTIC_EVENT_PREFIX}{payload}"
