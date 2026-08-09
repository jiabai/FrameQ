from __future__ import annotations

import json
import re
from dataclasses import FrozenInstanceError, fields
from pathlib import Path

import frameq_worker.diagnostic_events as diagnostic_events
import pytest
from frameq_worker.diagnostic_events import (
    DIAGNOSTIC_CODES,
    DIAGNOSTIC_PHASES,
    DiagnosticEvent,
    render_diagnostic_event,
    validate_diagnostic_event,
)


def load_diagnostic_contract() -> dict[str, object]:
    contract_path = Path(__file__).parents[2] / "contracts" / "desktop-worker-contract.json"
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    return contract["diagnosticEvents"]


def contract_event(contract: dict[str, object], **overrides: object) -> dict[str, object]:
    schemas = contract["fieldSchemas"]
    category_codes = contract["categoryCodes"]
    category = next(iter(category_codes))
    values: dict[str, object] = {
        "version": schemas["version"]["const"],
        "operation": contract["operation"][0],
        "phase": schemas["phase"]["enum"][0],
        "category": category,
        "code": category_codes[category][0],
    }
    values.update(overrides)
    return values


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


def test_python_validator_conforms_directly_to_canonical_contract() -> None:
    contract = load_diagnostic_contract()
    schemas = contract["fieldSchemas"]
    required_fields = contract["requiredFields"]
    optional_fields = contract["optionalFields"]
    category_codes = contract["categoryCodes"]
    base = contract_event(contract)

    assert contract["additionalProperties"] is False
    assert tuple(field.name for field in fields(DiagnosticEvent)) == tuple(
        [*required_fields, *optional_fields]
    )
    assert contract["operation"] == schemas["operation"]["enum"]
    assert tuple(schemas["phase"]["enum"]) == DIAGNOSTIC_PHASES
    assert list(category_codes) == schemas["category"]["enum"]
    assert [code for codes in category_codes.values() for code in codes] == schemas[
        "code"
    ]["enum"]
    assert {
        category: tuple(codes) for category, codes in category_codes.items()
    } == DIAGNOSTIC_CODES

    for operation in contract["operation"]:
        assert validate_diagnostic_event({**base, "operation": operation})["operation"] == operation
    with pytest.raises(ValueError):
        validate_diagnostic_event({**base, "operation": f"{contract['operation'][0]}_invalid"})

    for phase in schemas["phase"]["enum"]:
        assert validate_diagnostic_event({**base, "phase": phase})["phase"] == phase
    with pytest.raises(ValueError):
        validate_diagnostic_event({**base, "phase": f"{schemas['phase']['enum'][0]}_invalid"})

    all_codes = set(schemas["code"]["enum"])
    for category, codes in category_codes.items():
        for code in codes:
            event = {**base, "category": category, "code": code}
            assert validate_diagnostic_event(event)["code"] == code
        mismatched_code = next(iter(all_codes - set(codes)))
        with pytest.raises(ValueError):
            validate_diagnostic_event(
                {**base, "category": category, "code": mismatched_code}
            )

    exception_schema = schemas["exception_type"]
    exception_pattern = re.compile(exception_schema["pattern"])
    assert diagnostic_events._EXCEPTION_TYPE_PATTERN.pattern == exception_schema["pattern"]
    length_match = re.search(r"\{0,(\d+)\}", exception_schema["pattern"])
    assert length_match is not None
    maximum_exception_length = int(length_match.group(1)) + 1
    exception_candidates = [
        "Error_1",
        "A" * maximum_exception_length,
        "",
        "1Error",
        "A" * (maximum_exception_length + 1),
    ]
    for candidate in exception_candidates:
        event = {**base, "exception_type": candidate}
        if exception_pattern.fullmatch(candidate):
            assert validate_diagnostic_event(event)["exception_type"] == candidate
        else:
            with pytest.raises(ValueError):
                validate_diagnostic_event(event)

    constraints = contract["optionalFieldConstraints"]
    http_schema = schemas["http_status"]
    http_pairs = constraints["http_status"]["allowedCategoryCodes"]
    for category, codes in category_codes.items():
        for code in codes:
            event = {
                **base,
                "category": category,
                "code": code,
                "http_status": http_schema["minimum"],
            }
            if code in http_pairs.get(category, ()):
                assert validate_diagnostic_event(event)["http_status"] == http_schema["minimum"]
            else:
                with pytest.raises(ValueError):
                    validate_diagnostic_event(event)
    for status in (http_schema["minimum"], http_schema["maximum"]):
        category, codes = next(iter(http_pairs.items()))
        event = {**base, "category": category, "code": codes[0], "http_status": status}
        assert validate_diagnostic_event(event)["http_status"] == status
    for status in (http_schema["minimum"] - 1, http_schema["maximum"] + 1):
        category, codes = next(iter(http_pairs.items()))
        with pytest.raises(ValueError):
            validate_diagnostic_event(
                {**base, "category": category, "code": codes[0], "http_status": status}
            )

    os_schema = schemas["os_error_code"]
    os_pairs = constraints["os_error_code"]["allowedCategoryCodes"]
    for category, codes in category_codes.items():
        for code in codes:
            event = {
                **base,
                "category": category,
                "code": code,
                "os_error_code": os_schema["minimum"],
            }
            if code in os_pairs.get(category, ()):
                assert validate_diagnostic_event(event)["os_error_code"] == os_schema["minimum"]
            else:
                with pytest.raises(ValueError):
                    validate_diagnostic_event(event)
    os_category, os_codes = next(iter(os_pairs.items()))
    for error_code in (os_schema["minimum"], os_schema["maximum"]):
        event = {
            **base,
            "category": os_category,
            "code": os_codes[0],
            "os_error_code": error_code,
        }
        assert validate_diagnostic_event(event)["os_error_code"] == error_code
    for error_code in (os_schema["minimum"] - 1, os_schema["maximum"] + 1):
        with pytest.raises(ValueError):
            validate_diagnostic_event(
                {
                    **base,
                    "category": os_category,
                    "code": os_codes[0],
                    "os_error_code": error_code,
                }
            )

    assert contract["invalidEventPolicy"] == {
        "producer": "reject",
        "consumer": "drop_and_record_code",
    }
    assert "message" in contract["forbiddenContent"]
    for forbidden_field in contract["forbiddenContent"]:
        with pytest.raises(ValueError):
            validate_diagnostic_event({**base, forbidden_field: "forbidden"})


def test_diagnostic_codes_are_runtime_immutable() -> None:
    original = DIAGNOSTIC_CODES["network"]

    try:
        with pytest.raises(TypeError):
            DIAGNOSTIC_CODES["network"] = ("unexpected_failure",)  # type: ignore[index]
    finally:
        if DIAGNOSTIC_CODES["network"] != original:
            DIAGNOSTIC_CODES["network"] = original  # type: ignore[index]

    assert DIAGNOSTIC_CODES["network"] == original


def test_renders_frozen_valid_event_as_compact_ascii_json() -> None:
    event = DiagnosticEvent(**event_values(exception_type="ReadTimeout"))

    assert render_diagnostic_event(event) == (
        'FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model",'
        '"phase":"primary_model","category":"network","code":"connection_timeout",'
        '"exception_type":"ReadTimeout"}'
    )
    with pytest.raises(FrozenInstanceError):
        event.phase = "preparing"  # type: ignore[misc]


@pytest.mark.parametrize("required_field", load_diagnostic_contract()["requiredFields"])
def test_rejects_removal_of_each_required_field(required_field: str) -> None:
    values = contract_event(load_diagnostic_contract())
    del values[required_field]

    with pytest.raises(ValueError, match="^diagnostic_event_missing_field$"):
        validate_diagnostic_event(values)


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
