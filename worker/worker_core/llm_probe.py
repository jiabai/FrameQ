"""Minimal BYOK LLM chat probe.

The API key exists only in memory: it is read from stdin, placed into the
provider env mapping, and never printed, logged, or embedded in any result.
stdout carries only the closed ``{ok, error_code, latency_ms}`` object.
"""

from __future__ import annotations

import asyncio
import json
import time

from worker_core.ai_runtime import (
    _build_single_call_provider,
    classify_provider_failure,
)

PROBE_MAX_TOKENS = 1
PROBE_TIMEOUT_SECONDS = 15.0
_PROBE_PROMPT = "ping"

ERROR_INVALID_REQUEST = "LLM_PROBE_INVALID_REQUEST"
ERROR_NETWORK = "LLM_PROBE_NETWORK_ERROR"
ERROR_AUTH = "LLM_PROBE_AUTH_FAILED"
ERROR_MODEL_NOT_FOUND = "LLM_PROBE_MODEL_NOT_FOUND"
ERROR_TIMEOUT = "LLM_PROBE_TIMEOUT"
ERROR_RATE_LIMIT = "LLM_PROBE_RATE_LIMITED"
ERROR_INVALID_RESPONSE = "LLM_PROBE_INVALID_RESPONSE"
ERROR_UNEXPECTED = "LLM_PROBE_UNEXPECTED_ERROR"

ERROR_CODES = frozenset({
    ERROR_INVALID_REQUEST,
    ERROR_NETWORK,
    ERROR_AUTH,
    ERROR_MODEL_NOT_FOUND,
    ERROR_TIMEOUT,
    ERROR_RATE_LIMIT,
    ERROR_INVALID_RESPONSE,
    ERROR_UNEXPECTED,
})

_REQUIRED_FIELDS = frozenset({"base_url", "api_key", "model", "provider"})
_ALLOWED_PROVIDERS = frozenset({"openai", "openai_compatible"})


def _parse_and_validate(request_json: str | None) -> dict[str, str] | None:
    if not request_json:
        return None
    try:
        payload = json.loads(request_json)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    if not isinstance(payload, dict) or set(payload) != _REQUIRED_FIELDS:
        return None
    if any(not isinstance(payload[field], str) for field in _REQUIRED_FIELDS):
        return None
    if payload["provider"] not in _ALLOWED_PROVIDERS:
        return None
    return payload


def _build_env(request: dict[str, str]) -> dict[str, str]:
    return {
        "APP_LLM_PROVIDER": request["provider"],
        "APP_LLM_BASE_URL": request["base_url"],
        "APP_LLM_API_KEY": request["api_key"],
        "APP_LLM_MODEL": request["model"],
        "APP_LLM_TIMEOUT_SECONDS": str(PROBE_TIMEOUT_SECONDS),
        "APP_LLM_MAX_TOKENS": str(PROBE_MAX_TOKENS),
    }


async def _probe_call(env: dict[str, str]):
    provider = _build_single_call_provider(env)
    try:
        return await asyncio.wait_for(
            provider.text_chat(prompt=_PROBE_PROMPT, max_tokens=PROBE_MAX_TOKENS),
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    finally:
        await provider.terminate()


# 分类在 ai_runtime.classify_provider_failure（生成路径与探针共用一份逻辑），
# 这里只负责把语义类别翻译成探针自己的封闭错误码。
PROBE_ERROR_CODE_BY_CATEGORY = {
    "timeout": ERROR_TIMEOUT,
    "auth": ERROR_AUTH,
    "model_not_found": ERROR_MODEL_NOT_FOUND,
    "rate_limit": ERROR_RATE_LIMIT,
    "network": ERROR_NETWORK,
    "invalid_response": ERROR_INVALID_RESPONSE,
    "unexpected": ERROR_UNEXPECTED,
}


def _probe_error_code(exc: BaseException) -> str:
    return PROBE_ERROR_CODE_BY_CATEGORY[classify_provider_failure(exc)]


def _result(ok: bool, error_code: str | None, started: float) -> dict[str, object]:
    return {
        "ok": ok,
        "error_code": error_code,
        "latency_ms": int((time.monotonic() - started) * 1000),
    }


def run_llm_probe(request_json: str | None) -> dict[str, object]:
    started = time.monotonic()
    request = _parse_and_validate(request_json)
    if request is None:
        return _result(False, ERROR_INVALID_REQUEST, started)
    try:
        response = asyncio.run(_probe_call(_build_env(request)))
    except Exception as exc:
        return _result(False, _probe_error_code(exc), started)
    if response is None or getattr(response, "role", None) == "err":
        return _result(False, ERROR_INVALID_RESPONSE, started)
    return _result(True, None, started)
