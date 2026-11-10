from __future__ import annotations

import asyncio
import io
import json
from pathlib import Path

import jsonschema
import pytest
import worker_core.cli as cli
import worker_core.llm_probe as llm_probe

CONTRACT_PATH = Path(__file__).parents[2] / "contracts" / "desktop-worker-contract.json"
SECRET = "sk-probe-secret-DO-NOT-LEAK-1234567890"
RAW_VENDOR_BODY = '{"error":{"message":"raw vendor body with the key"}}'
VALID_REQUEST = {
    "base_url": "https://api.example.test/v1",
    "api_key": SECRET,
    "model": "probe-model",
    "provider": "openai_compatible",
}


class _FakeResponse:
    def __init__(self, role: str = "assistant") -> None:
        self.role = role
        self.completion_text = "ok"


class _FakeProvider:
    def __init__(
        self,
        *,
        outcome: str = "success",
        raise_exc: BaseException | None = None,
    ) -> None:
        self.calls: list[dict[str, object]] = []
        self.terminated = False
        self._outcome = outcome
        self._raise_exc = raise_exc

    async def text_chat(self, **kwargs: object) -> _FakeResponse:
        self.calls.append(kwargs)
        if self._raise_exc is not None:
            raise self._raise_exc
        if self._outcome == "slow":
            await asyncio.sleep(5)
        return _FakeResponse(role="err" if self._outcome == "err" else "assistant")

    async def terminate(self) -> None:
        self.terminated = True


def _install(monkeypatch, provider: _FakeProvider) -> dict[str, str]:
    captured: dict[str, str] = {}

    def fake_builder(env):
        captured.update(env)
        return provider

    monkeypatch.setattr(llm_probe, "_build_single_call_provider", fake_builder)
    return captured


def _make_exc(name: str, status_code: int | None = None) -> Exception:
    exc = type(name, (Exception,), {})(f"{RAW_VENDOR_BODY} {SECRET}")
    if status_code is not None:
        exc.status_code = status_code
    return exc


def test_valid_request_calls_provider_with_minimal_tokens(monkeypatch) -> None:
    provider = _FakeProvider()
    env = _install(monkeypatch, provider)

    result = llm_probe.run_llm_probe(json.dumps(VALID_REQUEST))

    assert set(result) == {"ok", "error_code", "latency_ms"}
    assert result["ok"] is True
    assert result["error_code"] is None
    assert isinstance(result["latency_ms"], int)
    assert len(provider.calls) == 1
    assert provider.calls[0]["max_tokens"] == llm_probe.PROBE_MAX_TOKENS == 1
    assert provider.terminated is True
    assert env["APP_LLM_API_KEY"] == SECRET
    assert env["APP_LLM_BASE_URL"] == VALID_REQUEST["base_url"]
    assert env["APP_LLM_MODEL"] == VALID_REQUEST["model"]
    assert env["APP_LLM_PROVIDER"] == VALID_REQUEST["provider"]
    assert env["APP_LLM_MAX_TOKENS"] == "1"
    assert env["APP_LLM_TIMEOUT_SECONDS"] == str(llm_probe.PROBE_TIMEOUT_SECONDS)
    assert SECRET not in json.dumps(result)


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"base_url": "x", "api_key": SECRET, "model": "m"}, id="missing-field"),
        pytest.param({**VALID_REQUEST, "provider": "anthropic"}, id="bad-provider-enum"),
        pytest.param({**VALID_REQUEST, "extra": "boom"}, id="extra-field"),
        pytest.param({**VALID_REQUEST, "api_key": 123}, id="non-string-value"),
        pytest.param("not-json-at-all", id="non-json"),
        pytest.param("", id="empty-string"),
        pytest.param(None, id="no-stdin"),
    ],
)
def test_invalid_request_is_rejected_without_echo(monkeypatch, payload) -> None:
    monkeypatch.setattr(
        llm_probe,
        "_build_single_call_provider",
        lambda env: pytest.fail("network must not be called for invalid input"),
    )
    request_json = None if payload is None else (
        payload if isinstance(payload, str) else json.dumps(payload)
    )

    result = llm_probe.run_llm_probe(request_json)

    assert set(result) == {"ok", "error_code", "latency_ms"}
    assert result["ok"] is False
    assert result["error_code"] == llm_probe.ERROR_INVALID_REQUEST
    assert isinstance(result["latency_ms"], int)
    assert SECRET not in json.dumps(result)


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        pytest.param(_make_exc("AuthenticationError", 401), llm_probe.ERROR_AUTH, id="auth"),
        pytest.param(
            _make_exc("NotFoundError", 404), llm_probe.ERROR_MODEL_NOT_FOUND, id="model"
        ),
        pytest.param(
            _make_exc("RateLimitError", 429), llm_probe.ERROR_RATE_LIMIT, id="rate-limit"
        ),
        pytest.param(_make_exc("APITimeoutError"), llm_probe.ERROR_TIMEOUT, id="timeout"),
        pytest.param(_make_exc("APIConnectionError"), llm_probe.ERROR_NETWORK, id="network"),
        pytest.param(
            _make_exc("EmptyModelOutputError"), llm_probe.ERROR_INVALID_RESPONSE,
            id="invalid-response",
        ),
        pytest.param(
            RuntimeError(f"{RAW_VENDOR_BODY} {SECRET}"), llm_probe.ERROR_UNEXPECTED,
            id="unexpected",
        ),
    ],
)
def test_failures_map_to_fixed_codes(monkeypatch, exc, expected) -> None:
    provider = _FakeProvider(raise_exc=exc)
    _install(monkeypatch, provider)

    result = llm_probe.run_llm_probe(json.dumps(VALID_REQUEST))

    assert set(result) == {"ok", "error_code", "latency_ms"}
    assert result["ok"] is False
    assert result["error_code"] == expected
    assert isinstance(result["latency_ms"], int)
    assert SECRET not in json.dumps(result)
    assert "raw vendor body" not in json.dumps(result)


@pytest.mark.parametrize(
    "message",
    [
        '{"code":20012,"message":"Model does not exist. Please check it carefully."}',
        '{"error":{"message":"Model not found"}}',
        "invalid model: deepseek-ai/nope",
        "The model `nope` does not exist",
        "model_not_found",
    ],
)
def test_vendor_model_errors_with_http_400_map_to_model_not_found(
    monkeypatch, message
) -> None:
    """Some OpenAI-compatible vendors answer HTTP 400, not 404, for a bad model."""

    exc = type("BadRequestError", (Exception,), {})(f"{message} {SECRET}")
    exc.status_code = 400
    provider = _FakeProvider(raise_exc=exc)
    _install(monkeypatch, provider)

    result = llm_probe.run_llm_probe(json.dumps(VALID_REQUEST))

    assert set(result) == {"ok", "error_code", "latency_ms"}
    assert result["ok"] is False
    assert result["error_code"] == llm_probe.ERROR_MODEL_NOT_FOUND
    assert SECRET not in json.dumps(result)
    assert "does not exist" not in json.dumps(result)


@pytest.mark.parametrize(
    "status_code, message",
    [
        (400, "invalid request format"),
        (422, "messages must not be empty"),
        (500, "internal error"),
    ],
)
def test_other_vendor_errors_stay_unexpected(monkeypatch, status_code, message) -> None:
    exc = type("VendorError", (Exception,), {})(message)
    exc.status_code = status_code
    provider = _FakeProvider(raise_exc=exc)
    _install(monkeypatch, provider)

    result = llm_probe.run_llm_probe(json.dumps(VALID_REQUEST))

    assert result["error_code"] == llm_probe.ERROR_UNEXPECTED


def test_error_role_response_is_invalid_response(monkeypatch) -> None:
    provider = _FakeProvider(outcome="err")
    _install(monkeypatch, provider)

    result = llm_probe.run_llm_probe(json.dumps(VALID_REQUEST))

    assert result["ok"] is False
    assert result["error_code"] == llm_probe.ERROR_INVALID_RESPONSE


def test_timeout_is_capped_by_module_constant(monkeypatch) -> None:
    monkeypatch.setattr(llm_probe, "PROBE_TIMEOUT_SECONDS", 0.05)
    provider = _FakeProvider(outcome="slow")
    _install(monkeypatch, provider)

    result = llm_probe.run_llm_probe(json.dumps(VALID_REQUEST))

    assert result["ok"] is False
    assert result["error_code"] == llm_probe.ERROR_TIMEOUT
    assert provider.terminated is True


def test_error_codes_form_a_stable_closed_set() -> None:
    codes = set(llm_probe.ERROR_CODES)
    assert len(codes) == len(llm_probe.ERROR_CODES)
    assert all(isinstance(code, str) and code.isupper() for code in codes)
    assert {
        llm_probe.ERROR_INVALID_REQUEST,
        llm_probe.ERROR_NETWORK,
        llm_probe.ERROR_AUTH,
        llm_probe.ERROR_MODEL_NOT_FOUND,
        llm_probe.ERROR_TIMEOUT,
        llm_probe.ERROR_RATE_LIMIT,
        llm_probe.ERROR_INVALID_RESPONSE,
        llm_probe.ERROR_UNEXPECTED,
    } <= codes


def test_cli_dispatches_probe_and_prints_single_line_json(monkeypatch, capsys) -> None:
    provider = _FakeProvider()
    _install(monkeypatch, provider)
    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(json.dumps(VALID_REQUEST)))

    exit_code = cli.main(["--probe-llm-stdin"])

    captured = capsys.readouterr()
    lines = captured.out.splitlines()
    assert len(lines) == 1
    result = json.loads(lines[0])
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    jsonschema.validate(result, contract["llmProbe"]["response"])
    assert result["ok"] is True
    assert result["error_code"] is None
    assert isinstance(result["latency_ms"], int)
    assert exit_code == 0
    assert SECRET not in captured.out + captured.err
    assert len(provider.calls) == 1
    assert provider.calls[0]["max_tokens"] == 1


@pytest.mark.parametrize("raw", ["", "{not json", "[]", "null", "42"])
def test_cli_invalid_raw_stdin_emits_structured_rejection(monkeypatch, capsys, raw) -> None:
    monkeypatch.setattr(
        llm_probe,
        "_build_single_call_provider",
        lambda env: pytest.fail("network must not be called for invalid stdin"),
    )
    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(raw))

    exit_code = cli.main(["--probe-llm-stdin"])

    captured = capsys.readouterr()
    lines = captured.out.splitlines()
    assert len(lines) == 1
    result = json.loads(lines[0])
    assert set(result) == {"ok", "error_code", "latency_ms"}
    assert result["ok"] is False
    assert result["error_code"] == llm_probe.ERROR_INVALID_REQUEST
    assert isinstance(result["latency_ms"], int)
    assert exit_code == 0


def test_cli_invalid_stdin_never_echoes_api_key(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        llm_probe,
        "_build_single_call_provider",
        lambda env: pytest.fail("network must not be called for invalid stdin"),
    )
    payload = json.dumps({**VALID_REQUEST, "unexpected": "field"})
    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(payload))

    cli.main(["--probe-llm-stdin"])

    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["error_code"] == llm_probe.ERROR_INVALID_REQUEST
    assert SECRET not in captured.out + captured.err
