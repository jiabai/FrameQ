import asyncio
import json
import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError

import pytest
from frameq_worker.ai_runtime import (
    ServerManagedInsightProvider,
    SingleCallInsightProvider,
    build_insight_provider,
    insight_target_env,
)
from frameq_worker.insight_errors import InsightGenerationError
from frameq_worker.llm import (
    DEFAULT_LLM_TIMEOUT_SECONDS,
    _managed_checkout_http_error,
    checkout_llm_config_once,
    derive_per_call_request_id,
    parse_managed_checkout_response,
    parse_timeout,
)


def test_managed_checkout_response_preserves_provider_configuration() -> None:
    raw = json.dumps(
        {
            "provider": " openai_compatible ",
            "base_url": " https://llm.example/v1 ",
            "model": " dedicated-model ",
            "api_key": " managed-key ",
            "timeout_seconds": 33,
            "quota_remaining": 19,
        }
    ).encode("utf-8")

    assert parse_managed_checkout_response(raw) == {
        "provider": "openai_compatible",
        "base_url": "https://llm.example/v1",
        "model": "dedicated-model",
        "api_key": "managed-key",
        "timeout_seconds": 33,
    }


def test_managed_checkout_response_defaults_timeout() -> None:
    raw = json.dumps(
        {
            "provider": "openai",
            "base_url": "https://llm.example/v1",
            "model": "model",
            "api_key": "key",
        }
    ).encode("utf-8")

    assert parse_managed_checkout_response(raw)["timeout_seconds"] == 60


@pytest.mark.parametrize(
    "raw",
    [
        b"invalid json",
        b"\xff",
        b"{}",
        b'{"provider":"unsupported","base_url":"url","model":"model","api_key":"key"}',
        b'{"provider":"openai","base_url":" ","model":"model","api_key":"key"}',
        b'{"provider":"openai","base_url":"url","model":" ","api_key":"key"}',
        b'{"provider":"openai","base_url":"url","model":"model","api_key":" "}',
        b'{"provider":"openai","base_url":"url","model":"model","api_key":"key","timeout_seconds":"invalid"}',
    ],
)
def test_managed_checkout_response_rejects_unusable_configuration(raw: bytes) -> None:
    with pytest.raises(InsightGenerationError) as captured:
        parse_managed_checkout_response(raw)

    assert captured.value.code == "AI_LLM_CHECKOUT_INVALID_RESPONSE"


@pytest.mark.parametrize(
    ("status", "body", "expected_code"),
    [
        (401, {}, "AI_LLM_AUTH_REQUIRED"),
        (403, {}, "AI_LLM_QUOTA_UNAVAILABLE"),
        (503, {"error": "LLM_CONFIG_MISSING"}, "AI_LLM_CONFIG_MISSING"),
        (500, {}, "AI_LLM_CHECKOUT_FAILED"),
    ],
)
def test_checkout_http_error_maps_to_existing_contract(
    status: int,
    body: dict[str, str],
    expected_code: str,
) -> None:
    error = HTTPError(
        "https://frameq.example/api/desktop/llm/checkouts",
        status,
        "checkout failed",
        None,
        BytesIO(json.dumps(body).encode("utf-8")),
    )

    translated = _managed_checkout_http_error(error)

    assert translated.code == expected_code
    assert "frameq.example" not in str(translated)


def test_checkout_rejects_missing_configuration_before_network_request() -> None:
    with pytest.raises(RuntimeError, match="FRAMEQ_LLM_CHECKOUT_URL"):
        checkout_llm_config_once({})


def test_request_id_tracks_each_call_and_stays_within_limit() -> None:
    assert derive_per_call_request_id("run-12345678", 1) == "run-12345678-call-0001"
    assert derive_per_call_request_id("run-12345678", 2) == "run-12345678-call-0002"
    first = derive_per_call_request_id("x" * 160, 1)
    second = derive_per_call_request_id("x" * 160, 2)
    assert len(first) == len(second) == 160
    assert first.endswith("-call-0001")
    assert second.endswith("-call-0002")
    assert first != second


@pytest.mark.parametrize("raw", [None, "invalid", "0", "-2", ""])
def test_timeout_defaults_for_missing_or_unusable_values(raw: str | None) -> None:
    assert parse_timeout(raw) == DEFAULT_LLM_TIMEOUT_SECONDS


def test_timeout_keeps_positive_fractional_seconds() -> None:
    assert parse_timeout("12.5") == 12.5


def test_shared_runtime_imports_independently_in_fresh_python_process() -> None:
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    completed = subprocess.run(
        [sys.executable, "-c", "from frameq_worker.ai_runtime import build_insight_provider"],
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr


def test_local_provider_disables_http_retries_and_keeps_generation_configuration() -> None:
    provider = build_insight_provider(
        {
            "FRAMEQ_LLM_API_KEY": "configuration-only-key",
            "FRAMEQ_LLM_MODEL": "configuration-only-model",
            "FRAMEQ_LLM_BASE_URL": "https://llm.example/v1",
            "FRAMEQ_LLM_TIMEOUT_SECONDS": "12.5",
            "FRAMEQ_LLM_MAX_TOKENS": "4096",
        }
    )
    try:
        assert isinstance(provider, SingleCallInsightProvider)
        assert provider.client.max_retries == 0
        assert provider.timeout == 12.5
        assert str(provider.client.base_url) == "https://llm.example/v1/"
        assert provider.provider_config["model"] == "configuration-only-model"
        assert provider.provider_config["custom_extra_body"] == {"max_tokens": 4096}
    finally:
        asyncio.run(provider.terminate())


def test_local_provider_propagates_original_request_error_without_recovery() -> None:
    provider = build_insight_provider(
        {
            "FRAMEQ_LLM_API_KEY": "configuration-only-key",
            "FRAMEQ_LLM_MODEL": "configuration-only-model",
        }
    )
    error = RuntimeError("request failed")
    try:
        with pytest.raises(RuntimeError) as captured:
            asyncio.run(provider._handle_api_error(error))
        assert captured.value is error
    finally:
        asyncio.run(provider.terminate())


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"FRAMEQ_LLM_API_KEY": "configuration-only-key"},
        {"FRAMEQ_LLM_MODEL": "configuration-only-model"},
        {"FRAMEQ_LLM_SOURCE": "server"},
        {
            "FRAMEQ_LLM_API_KEY": "configuration-only-key",
            "FRAMEQ_LLM_MODEL": "configuration-only-model",
            "FRAMEQ_LLM_PROVIDER": "unsupported",
        },
    ],
)
def test_provider_rejects_missing_configuration_before_constructing_client(
    environment: dict[str, str],
) -> None:
    with pytest.raises(InsightGenerationError) as captured:
        build_insight_provider(environment)

    assert captured.value.code == "AI_CONFIG_MISSING"


def test_managed_provider_construction_requires_no_checkout_request() -> None:
    provider = build_insight_provider(
        {
            "FRAMEQ_LLM_SOURCE": "server",
            "FRAMEQ_LLM_CHECKOUT_URL": "https://frameq.example/api/desktop/llm/checkouts",
            "FRAMEQ_LLM_SESSION_TOKEN": "configuration-only-session",
            "FRAMEQ_LLM_CHECKOUT_REQUEST_ID": "operation-1",
        }
    )
    assert isinstance(provider, ServerManagedInsightProvider)
    assert provider.get_current_key() == ""
    assert provider.get_keys() == []
    asyncio.run(provider.terminate())


@pytest.mark.parametrize("seed", ["operation-12345678", "x" * 200])
def test_target_request_ids_stay_unique_within_server_limit(seed: str) -> None:
    environment = {"FRAMEQ_LLM_CHECKOUT_REQUEST_ID": seed, "OTHER": "preserved"}
    requests = {
        derive_per_call_request_id(
            insight_target_env(environment, target)["FRAMEQ_LLM_CHECKOUT_REQUEST_ID"], call
        )
        for target in ("summary", "insights", "dissection")
        for call in (1, 2)
    }

    assert len(requests) == 6
    assert all(len(request) <= 160 for request in requests)
    assert environment["FRAMEQ_LLM_CHECKOUT_REQUEST_ID"] == seed
    assert insight_target_env(environment, "summary")["OTHER"] == "preserved"


@pytest.mark.parametrize("value", ["invalid", "0", "-1"])
def test_managed_token_budget_is_validated_before_checkout(value: str) -> None:
    with pytest.raises(InsightGenerationError, match="token budget is invalid") as error:
        build_insight_provider({
            "FRAMEQ_LLM_SOURCE": "server",
            "FRAMEQ_LLM_CHECKOUT_URL": "https://frameq.example/api/desktop/llm/checkouts",
            "FRAMEQ_LLM_SESSION_TOKEN": "configuration-only-session",
            "FRAMEQ_LLM_CHECKOUT_REQUEST_ID": "operation-1",
            "FRAMEQ_LLM_MAX_TOKENS": value,
        })
    assert error.value.code == "AI_CONFIG_MISSING"
