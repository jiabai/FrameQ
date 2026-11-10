"""生成路径错误分类：SDK 异常 → 封闭错误码，供 agent_error 使用。"""

from __future__ import annotations

import asyncio

import agent_runtime.core  # noqa: F401 - 初始化运行器，避免依赖包的循环导入
import pytest
from agent_runtime.provider.entities import LLMResponse
from agent_runtime.provider.sources.openai_source import ProviderOpenAIOfficial
from worker_core.ai_runtime import (
    ServerManagedInsightProvider,
    SingleCallInsightProvider,
    agent_error,
    classify_provider_failure,
    generation_error_code_for,
)
from worker_core.llm import (
    LLM_CHECKOUT_REQUEST_ID_ENV,
    LLM_CHECKOUT_URL_ENV,
    LLM_SESSION_TOKEN_ENV,
)


class FakeAuthenticationError(Exception):
    status_code = 401


class FakeRateLimitError(Exception):
    status_code = 429


class FakeNotFoundError(Exception):
    status_code = 404


class FakeApiConnectionError(Exception):
    pass


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (FakeAuthenticationError("bad key"), "auth"),
        (FakeRateLimitError("slow down"), "rate_limit"),
        (FakeNotFoundError("no such model"), "model_not_found"),
        (TimeoutError("timed out"), "timeout"),
        (FakeApiConnectionError("connection reset"), "network"),
        (Exception("something odd"), "unexpected"),
    ],
)
def test_classify_provider_failure_maps_status_and_type_names(
    exc: Exception, expected: str
) -> None:
    assert classify_provider_failure(exc) == expected


def test_classify_provider_failure_detects_unknown_model_on_http_400() -> None:
    # 部分供应商对未知模型返回普通 400，只能按响应文本里的固定短语归类；
    # 文本只在分类器内部使用，不会进错误详情。
    assert classify_provider_failure(Exception("invalid model id")) == "model_not_found"


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (FakeAuthenticationError("bad key"), "AI_LLM_KEY_REJECTED"),
        (FakeRateLimitError("slow down"), "AI_LLM_RATE_LIMITED"),
        (FakeNotFoundError("no such model"), "AI_LLM_MODEL_UNAVAILABLE"),
        (TimeoutError("timed out"), "AI_LLM_REQUEST_TIMEOUT"),
        (FakeApiConnectionError("connection reset"), "AI_LLM_NETWORK_FAILED"),
        (Exception("something odd"), None),
    ],
)
def test_generation_error_code_for_maps_category(exc: Exception, expected: str | None) -> None:
    assert generation_error_code_for(exc) == expected


def _single_call_provider() -> SingleCallInsightProvider:
    return SingleCallInsightProvider({
        "id": "app_insights",
        "type": "openai_chat_completion",
        "key": ["sk-test"],
        "model": "test-model",
        "api_base": "https://api.example.com/v1",
        "timeout": 5.0,
    })


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (FakeAuthenticationError("bad key"), "AI_LLM_KEY_REJECTED"),
        (TimeoutError("timed out"), "AI_LLM_REQUEST_TIMEOUT"),
        (Exception("something odd"), None),
    ],
)
def test_single_call_provider_records_code_and_reraises(
    monkeypatch: pytest.MonkeyPatch, exc: Exception, expected: str | None
) -> None:
    async def raise_once(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        raise exc

    monkeypatch.setattr(ProviderOpenAIOfficial, "text_chat", raise_once)
    provider = _single_call_provider()
    with pytest.raises(Exception):  # noqa: B017 - 被测行为就是原样重抛任意异常
        asyncio.run(provider.text_chat(prompt="ping"))
    assert provider.last_error_code == expected


def test_managed_provider_copies_inner_code_before_reraising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def raise_once(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        raise FakeRateLimitError("slow down")

    def fake_checkout(env, transport=None):  # noqa: ANN001, ANN002
        return {
            "provider": "openai_compatible",
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "api_key": "sk-inner",
            "timeout_seconds": 5,
        }

    monkeypatch.setattr(ProviderOpenAIOfficial, "text_chat", raise_once)
    monkeypatch.setattr("worker_core.ai_runtime.checkout_llm_config_once", fake_checkout)
    provider = ServerManagedInsightProvider({
        LLM_CHECKOUT_URL_ENV: "https://server.example/api/desktop/llm/checkouts",
        LLM_SESSION_TOKEN_ENV: "token",
        LLM_CHECKOUT_REQUEST_ID_ENV: "req-1",
    })
    with pytest.raises(Exception):  # noqa: B017 - 被测行为就是原样重抛任意异常
        asyncio.run(provider.text_chat(prompt="ping"))
    assert provider.last_error_code == "AI_LLM_RATE_LIMITED"


def test_agent_error_uses_recorded_code_from_provider() -> None:
    provider = _single_call_provider()
    provider.last_error_code = "AI_LLM_KEY_REJECTED"
    error = agent_error(
        LLMResponse(role="err", completion_text="All chat models failed: ..."),
        "Summary",
        provider,
    )
    assert error.code == "AI_LLM_KEY_REJECTED"
    assert "All chat models failed" not in str(error)


def test_agent_error_keeps_generic_code_without_provider() -> None:
    error = agent_error(LLMResponse(role="err", completion_text="opaque failure"), "Summary")
    assert error.code == "AI_LLM_REQUEST_FAILED"


def test_agent_error_still_preserves_managed_checkout_codes() -> None:
    error = agent_error(
        LLMResponse(role="err", completion_text="AI_LLM_QUOTA_UNAVAILABLE"), "Summary"
    )
    assert error.code == "AI_LLM_QUOTA_UNAVAILABLE"


def test_agent_error_ignores_unknown_recorded_codes() -> None:
    provider = _single_call_provider()
    provider.last_error_code = "TOTALLY_UNKNOWN"
    error = agent_error(LLMResponse(role="err", completion_text="boom"), "Summary", provider)
    assert error.code == "AI_LLM_REQUEST_FAILED"


def test_new_generation_codes_never_echo_provider_prose() -> None:
    # 供应商原始响应体不能进错误详情（安全边界）：分类码对应的 message 是固定文案。
    provider = _single_call_provider()
    provider.last_error_code = "AI_LLM_MODEL_UNAVAILABLE"
    error = agent_error(LLMResponse(role="err", completion_text=""), "Summary", provider)
    assert error.code == "AI_LLM_MODEL_UNAVAILABLE"
    assert str(error) == "The configured model is not available from the provider."
