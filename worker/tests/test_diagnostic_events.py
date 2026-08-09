from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest
from frameq_worker.diagnostic_events import (
    DIAGNOSTIC_CODES,
    DIAGNOSTIC_PHASES,
    DiagnosticEvent,
    render_diagnostic_event,
    validate_diagnostic_event,
)


def event_values(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "version": 1,
        "operation": "download_asr_model",
        "phase": "primary_model",
        "category": "network",
        "code": "connection_timeout",
    }
    values.update(overrides)
    return values


def test_closed_values_match_contract_v8() -> None:
    assert DIAGNOSTIC_PHASES == (
        "preparing",
        "primary_model",
        "vad_model",
        "bpe_model",
        "archive_download",
        "archive_validate",
        "cache_validate",
        "cache_promote",
    )
    assert DIAGNOSTIC_CODES == {
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


def test_renders_frozen_valid_event_as_compact_ascii_json() -> None:
    event = DiagnosticEvent(**event_values(exception_type="ReadTimeout"))

    assert render_diagnostic_event(event) == (
        'FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model",'
        '"phase":"primary_model","category":"network","code":"connection_timeout",'
        '"exception_type":"ReadTimeout"}'
    )
    with pytest.raises(FrozenInstanceError):
        event.phase = "preparing"  # type: ignore[misc]


@pytest.mark.parametrize(
    ("category", "code"),
    [
        (category, code)
        for category, codes in {
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
        }.items()
        for code in codes
    ],
)
def test_accepts_every_closed_category_code_pair(category: str, code: str) -> None:
    assert validate_diagnostic_event(event_values(category=category, code=code))["code"] == code


@pytest.mark.parametrize(
    "overrides",
    [
        {"phase": "other"},
        {"category": "network", "code": "permission_denied"},
        {"category": "other", "code": "unexpected_failure"},
        {"version": True},
        {"operation": "process_video"},
        {"message": "secret"},
        {"metadata": {}},
    ],
)
def test_rejects_unknown_fields_and_invalid_required_values(
    overrides: dict[str, object],
) -> None:
    with pytest.raises(ValueError):
        validate_diagnostic_event(event_values(**overrides))


@pytest.mark.parametrize(
    "overrides",
    [
        {"category": ["network"]},
        {"code": ["connection_failed"]},
        {"exception_type": None},
        {"http_status": None},
        {"os_error_code": None},
    ],
)
def test_rejects_wrong_types_and_explicit_null_optional_fields(
    overrides: dict[str, object],
) -> None:
    with pytest.raises(ValueError):
        validate_diagnostic_event(event_values(**overrides))


@pytest.mark.parametrize(
    "exception_type",
    ["", "1Error", "Bad.Type", "Error-Name", "A" * 81, "Érror", 4],
)
def test_rejects_invalid_exception_type(exception_type: object) -> None:
    with pytest.raises(ValueError):
        validate_diagnostic_event(event_values(exception_type=exception_type))


@pytest.mark.parametrize("http_status", [100, 204, 599])
def test_accepts_bounded_http_status_only_for_http_failure(http_status: int) -> None:
    values = event_values(
        category="http", code="http_status_failed", http_status=http_status
    )
    assert validate_diagnostic_event(values)["http_status"] == http_status


@pytest.mark.parametrize("http_status", [99, 600, True, 200.0])
def test_rejects_invalid_http_status(http_status: object) -> None:
    with pytest.raises(ValueError):
        validate_diagnostic_event(
            event_values(category="http", code="http_status_failed", http_status=http_status)
        )


def test_rejects_http_status_for_non_http_event() -> None:
    with pytest.raises(ValueError):
        validate_diagnostic_event(event_values(http_status=408))


@pytest.mark.parametrize("os_error_code", [-2147483648, -1, 0, 2147483647])
@pytest.mark.parametrize(
    ("category", "code"),
    [("network", "connection_failed"), ("filesystem", "filesystem_io_failed")],
)
def test_accepts_signed_32_bit_os_error_for_approved_codes(
    category: str, code: str, os_error_code: int
) -> None:
    values = event_values(category=category, code=code, os_error_code=os_error_code)
    assert validate_diagnostic_event(values)["os_error_code"] == os_error_code


@pytest.mark.parametrize("os_error_code", [-2147483649, 2147483648, True, 5.0])
def test_rejects_invalid_os_error_code(os_error_code: object) -> None:
    with pytest.raises(ValueError):
        validate_diagnostic_event(event_values(os_error_code=os_error_code))


def test_rejects_os_error_code_for_unapproved_classification() -> None:
    with pytest.raises(ValueError):
        validate_diagnostic_event(
            event_values(category="tls", code="tls_handshake_failed", os_error_code=1)
        )
