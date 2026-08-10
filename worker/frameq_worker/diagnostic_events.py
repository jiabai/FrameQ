from __future__ import annotations

import errno
import json
import re
import socket
import ssl
import urllib.error
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType

from frameq_worker.desktop_contract import DIAGNOSTIC_EVENT_PREFIX
from frameq_worker.model_download import ARCHIVE_INVALID_ERROR_CODE, ModelDownloadError

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

DIAGNOSTIC_CODES: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {
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
    }
)

_REQUIRED_FIELDS = ("version", "operation", "phase", "category", "code")
_OPTIONAL_FIELDS = ("exception_type", "http_status", "os_error_code")
_ALLOWED_FIELDS = frozenset((*_REQUIRED_FIELDS, *_OPTIONAL_FIELDS))
_EXCEPTION_TYPE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,79}$")
_OS_ERROR_CODE_MINIMUM = -(2**31)
_OS_ERROR_CODE_MAXIMUM = 2**31 - 1
_OS_ERROR_CODE_CATEGORIES = frozenset(("network", "filesystem"))
_SAFE_EXCEPTION_ATTRIBUTES = frozenset(("errno", "status", "code", "reason"))
_MAX_EXCEPTION_CHAIN_DEPTH = 8
_TIMEOUT_EXCEPTION_NAMES = frozenset(
    {
        "ConnectTimeout",
        "ConnectionTimeout",
        "ReadTimeout",
        "ReadTimeoutError",
        "SocketTimeout",
        "Timeout",
        "TimeoutError",
    }
)
_CONNECTION_EXCEPTION_NAMES = frozenset(
    {
        "ConnectError",
        "ConnectionError",
        "MaxRetryError",
        "NetworkError",
        "NewConnectionError",
        "ProtocolError",
        "RemoteDisconnected",
    }
)
_PROXY_CONFIGURATION_EXCEPTION_NAMES = frozenset(
    {
        "InvalidProxyURL",
        "ProxyConfigurationError",
    }
)
_PROXY_CONNECTION_EXCEPTION_NAMES = frozenset(
    {
        "ProxyConnectionError",
        "ProxyError",
    }
)


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


DiagnosticCallback = Callable[[DiagnosticEvent], None]


def classify_model_download_exception(
    exception: BaseException,
    phase: str,
) -> DiagnosticEvent:
    try:
        for candidate in _walk_exception_chain(exception):
            classification = _classify_exception(candidate)
            if classification is None:
                continue
            category, code, http_status, os_error_code = classification
            return _diagnostic_event(
                candidate,
                phase,
                category,
                code,
                http_status=http_status,
                os_error_code=os_error_code,
            )
    except BaseException:
        pass
    return _diagnostic_event(
        exception,
        phase,
        "unexpected",
        "unexpected_failure",
    )


def _walk_exception_chain(exception: BaseException) -> tuple[BaseException, ...]:
    pending = [exception]
    seen: set[int] = set()
    ordered: list[BaseException] = []
    while pending and len(ordered) < _MAX_EXCEPTION_CHAIN_DEPTH:
        candidate = pending.pop(0)
        identity = id(candidate)
        if identity in seen:
            continue
        seen.add(identity)
        ordered.append(candidate)

        cause = _safe_exception_link(candidate, BaseException.__cause__)
        context = _safe_exception_link(candidate, BaseException.__context__)
        for related in (cause, context):
            if isinstance(related, BaseException):
                pending.append(related)
        if isinstance(candidate, urllib.error.URLError):
            reason = _safe_exception_attribute(candidate, "reason")
            if isinstance(reason, BaseException):
                pending.append(reason)
    return tuple(ordered)


def _classify_exception(
    exception: BaseException,
) -> tuple[str, str, int | None, int | None] | None:
    exception_name = type(exception).__name__
    os_error_code = _os_error_code(exception)

    if (
        isinstance(exception, ModelDownloadError)
        and _safe_exception_attribute(exception, "code") == ARCHIVE_INVALID_ERROR_CODE
    ):
        return "integrity", "archive_invalid", None, None
    if isinstance(exception, urllib.error.HTTPError):
        http_status = _safe_integer_attribute(exception, "code", 100, 599)
        if http_status is None:
            http_status = _safe_integer_attribute(exception, "status", 100, 599)
        if http_status is not None:
            return "http", "http_status_failed", http_status, None
    if isinstance(exception, urllib.error.URLError) and isinstance(
        _safe_exception_attribute(exception, "reason"), BaseException
    ):
        return None
    if exception_name in _PROXY_CONFIGURATION_EXCEPTION_NAMES:
        return "proxy", "proxy_configuration_failed", None, None
    if exception_name in _PROXY_CONNECTION_EXCEPTION_NAMES:
        return "proxy", "proxy_connection_failed", None, None
    if isinstance(exception, ssl.SSLCertVerificationError):
        return "tls", "tls_verification_failed", None, None
    if isinstance(exception, ssl.SSLError) or "SSL" in exception_name or "TLS" in exception_name:
        return "tls", "tls_handshake_failed", None, None
    if isinstance(exception, socket.gaierror):
        return "network", "dns_resolution_failed", None, os_error_code
    if isinstance(exception, TimeoutError) or exception_name in _TIMEOUT_EXCEPTION_NAMES:
        return "network", "connection_timeout", None, os_error_code
    if (
        isinstance(exception, ConnectionError)
        or isinstance(exception, urllib.error.URLError)
        or exception_name in _CONNECTION_EXCEPTION_NAMES
    ):
        return "network", "connection_failed", None, os_error_code
    if isinstance(exception, (ImportError, ModuleNotFoundError)):
        return "dependency", "dependency_unavailable", None, None
    if isinstance(exception, OSError):
        if isinstance(exception, PermissionError) or os_error_code in {errno.EACCES, errno.EPERM}:
            return "filesystem", "permission_denied", None, os_error_code
        if os_error_code == errno.ENOSPC:
            return "filesystem", "disk_full", None, os_error_code
        return "filesystem", "filesystem_io_failed", None, os_error_code
    return None


def _diagnostic_event(
    exception: BaseException,
    phase: str,
    category: str,
    code: str,
    *,
    http_status: int | None = None,
    os_error_code: int | None = None,
) -> DiagnosticEvent:
    exception_name = _safe_exception_type_name(exception)
    exception_type = (
        exception_name
        if exception_name is not None
        and _EXCEPTION_TYPE_PATTERN.fullmatch(exception_name) is not None
        else None
    )
    return DiagnosticEvent(
        version=1,
        operation="download_asr_model",
        phase=phase,
        category=category,
        code=code,
        exception_type=exception_type,
        http_status=http_status,
        os_error_code=os_error_code,
    )


def _os_error_code(exception: BaseException) -> int | None:
    return _safe_integer_attribute(
        exception,
        "errno",
        _OS_ERROR_CODE_MINIMUM,
        _OS_ERROR_CODE_MAXIMUM,
    )


def _safe_integer_attribute(
    exception: BaseException,
    name: str,
    minimum: int,
    maximum: int,
) -> int | None:
    return _bounded_integer(
        _safe_exception_attribute(exception, name),
        minimum,
        maximum,
    )


def _safe_exception_attribute(exception: BaseException, name: str) -> object | None:
    if name not in _SAFE_EXCEPTION_ATTRIBUTES:
        return None
    try:
        return object.__getattribute__(exception, name)
    except BaseException:
        return None


def _safe_exception_link(
    exception: BaseException,
    descriptor: object,
) -> BaseException | None:
    try:
        related = descriptor.__get__(exception, type(exception))
    except BaseException:
        return None
    return related if isinstance(related, BaseException) else None


def _safe_exception_type_name(exception: BaseException) -> str | None:
    try:
        name = type.__getattribute__(type(exception), "__name__")
    except BaseException:
        return None
    return name if isinstance(name, str) else None


def _bounded_integer(value: object, minimum: int, maximum: int) -> int | None:
    if type(value) is int and minimum <= value <= maximum:
        return value
    return None


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
    validated.update((field, value[field]) for field in _OPTIONAL_FIELDS if field in value)
    return validated


def render_diagnostic_event(event: DiagnosticEvent) -> str:
    validated = validate_diagnostic_event(event.to_dict())
    payload = json.dumps(validated, ensure_ascii=True, separators=(",", ":"))
    return f"{DIAGNOSTIC_EVENT_PREFIX}{payload}"
