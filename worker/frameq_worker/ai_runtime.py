from __future__ import annotations

import asyncio
from collections.abc import Mapping

import agent_runtime.core  # noqa: F401 - 初始化运行器，避免依赖包的循环导入
from agent_runtime.core.runners.tool_loop_agent_runner import ToolLoopAgentRunner
from agent_runtime.provider.entities import LLMResponse
from agent_runtime.provider.provider import Provider
from agent_runtime.provider.sources.openai_source import ProviderOpenAIOfficial

from frameq_worker.insight_errors import InsightGenerationError
from frameq_worker.llm import (
    LLM_CHECKOUT_REQUEST_ID_ENV,
    LLM_CHECKOUT_URL_ENV,
    LLM_SESSION_TOKEN_ENV,
    LLM_SOURCE_ENV,
    Transport,
    checkout_llm_config_once,
    derive_per_call_request_id,
    parse_timeout,
)


class StrictInsightRunner(ToolLoopAgentRunner):
    EMPTY_OUTPUT_RETRY_ATTEMPTS = 1


_CHECKOUT_ERROR_MESSAGES = {
    "AI_LLM_AUTH_REQUIRED": "FrameQ login is required to use the managed LLM.",
    "AI_LLM_QUOTA_UNAVAILABLE": (
        "No cloud LLM API-call uses are available for this account."
    ),
    "AI_LLM_CONFIG_MISSING": "FrameQ managed LLM is not configured.",
    "AI_LLM_CHECKOUT_TIMEOUT": "FrameQ LLM checkout timed out. Please retry later.",
    "AI_LLM_CHECKOUT_FAILED": (
        "FrameQ LLM checkout failed before a usable response was returned."
    ),
    "AI_LLM_CHECKOUT_INVALID_RESPONSE": (
        "FrameQ LLM checkout did not return usable configuration."
    ),
}


class SingleCallInsightProvider(ProviderOpenAIOfficial):
    def __init__(self, config: dict) -> None:
        super().__init__(config, {})
        self.client.max_retries = 0

    async def _handle_api_error(self, error, *args, **kwargs):
        raise error


def _max_output_tokens(env: Mapping[str, str]) -> int | None:
    raw_value = env.get("FRAMEQ_LLM_MAX_TOKENS", "").strip()
    if not raw_value:
        return None
    try:
        value = int(raw_value)
    except ValueError:
        raise InsightGenerationError(
            "AI_CONFIG_MISSING", "Insight agent output token budget is invalid."
        ) from None
    if value < 1:
        raise InsightGenerationError(
            "AI_CONFIG_MISSING", "Insight agent output token budget is invalid."
        )
    return value


def _build_single_call_provider(env: Mapping[str, str]) -> SingleCallInsightProvider:
    config = {
        "id": "frameq_insights",
        "type": "openai_chat_completion",
        "key": [env["FRAMEQ_LLM_API_KEY"].strip()],
        "model": env["FRAMEQ_LLM_MODEL"].strip(),
        "api_base": env.get("FRAMEQ_LLM_BASE_URL", "").strip() or "https://api.openai.com/v1",
        "timeout": parse_timeout(env.get("FRAMEQ_LLM_TIMEOUT_SECONDS")),
    }
    max_tokens = _max_output_tokens(env)
    if max_tokens is not None:
        config["custom_extra_body"] = {"max_tokens": max_tokens}
    return SingleCallInsightProvider(config)


def insight_target_env(env: Mapping[str, str], target: str) -> dict[str, str]:
    result = dict(env)
    seed = result.get(LLM_CHECKOUT_REQUEST_ID_ENV, "").strip()
    if seed:
        result[LLM_CHECKOUT_REQUEST_ID_ENV] = f"{seed[:140]}-{target}"
    return result


class ServerManagedInsightProvider(Provider):
    def __init__(self, env: Mapping[str, str], transport: Transport | None = None) -> None:
        super().__init__({"id": "frameq_managed_insights", "type": "openai_chat_completion"}, {})
        self._env = dict(env)
        self._transport = transport
        self._call_index = 0

    def get_current_key(self) -> str:
        return ""

    def get_keys(self) -> list[str]:
        return []

    def set_key(self, key: str) -> None:
        raise RuntimeError("Managed credentials come from per-call checkout.")

    async def get_models(self) -> list[str]:
        raise RuntimeError("Managed insights do not expose model listing.")

    async def text_chat(self, *args, **kwargs) -> LLMResponse:
        self._call_index += 1
        checkout_env = {
            **self._env,
            LLM_CHECKOUT_REQUEST_ID_ENV: derive_per_call_request_id(
                self._env.get(LLM_CHECKOUT_REQUEST_ID_ENV, "").strip(), self._call_index
            ),
        }
        try:
            config = await asyncio.to_thread(
                checkout_llm_config_once, checkout_env, self._transport
            )
        except InsightGenerationError as exc:
            return LLMResponse(role="err", completion_text=exc.code)

        provider = _build_single_call_provider({
            **checkout_env,
            "FRAMEQ_LLM_API_KEY": str(config["api_key"]),
            "FRAMEQ_LLM_MODEL": str(config["model"]),
            "FRAMEQ_LLM_BASE_URL": str(config["base_url"]),
            "FRAMEQ_LLM_PROVIDER": str(config["provider"]),
            "FRAMEQ_LLM_TIMEOUT_SECONDS": str(config["timeout_seconds"]),
        })
        try:
            return await provider.text_chat(*args, **kwargs)
        finally:
            await provider.terminate()

    async def terminate(self) -> None:
        return None


def build_insight_provider(env: Mapping[str, str]) -> Provider:
    _max_output_tokens(env)
    if env.get(LLM_SOURCE_ENV, "").strip().lower() == "server":
        required = (LLM_CHECKOUT_URL_ENV, LLM_SESSION_TOKEN_ENV, LLM_CHECKOUT_REQUEST_ID_ENV)
        if any(not env.get(name, "").strip() for name in required):
            raise InsightGenerationError(
                "AI_CONFIG_MISSING", "Insight agent LLM is not configured."
            )
        return ServerManagedInsightProvider(env)
    if (
        not env.get("FRAMEQ_LLM_API_KEY", "").strip()
        or not env.get("FRAMEQ_LLM_MODEL", "").strip()
        or env.get("FRAMEQ_LLM_PROVIDER", "openai_compatible").strip().lower()
        not in {"openai", "openai_compatible"}
    ):
        raise InsightGenerationError(
            "AI_CONFIG_MISSING", "Insight agent LLM is not configured."
        )
    return _build_single_call_provider(env)


def agent_error(response: LLMResponse | None, label: str) -> InsightGenerationError:
    detail = (response.completion_text if response else "") or ""
    if detail in _CHECKOUT_ERROR_MESSAGES:
        return InsightGenerationError(detail, _CHECKOUT_ERROR_MESSAGES[detail])
    return InsightGenerationError(
        "AI_LLM_REQUEST_FAILED", f"{label} agent LLM request failed."
    )
