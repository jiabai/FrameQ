from __future__ import annotations

import asyncio
from collections.abc import Mapping

import agent_runtime.core  # noqa: F401 - 初始化运行器，避免依赖包的循环导入
from agent_runtime.core.runners.tool_loop_agent_runner import ToolLoopAgentRunner
from agent_runtime.provider.entities import LLMResponse
from agent_runtime.provider.provider import Provider
from agent_runtime.provider.sources.openai_source import ProviderOpenAIOfficial

from worker_core.insight_errors import InsightGenerationError
from worker_core.llm import (
    LLM_CHECKOUT_REQUEST_ID_ENV,
    LLM_CHECKOUT_URL_ENV,
    LLM_SESSION_TOKEN_ENV,
    LLM_SOURCE_ENV,
    Transport,
    checkout_llm_config_once,
    derive_per_call_request_id,
    parse_timeout,
)

from .brand import PRODUCT_NAME


class StrictInsightRunner(ToolLoopAgentRunner):
    EMPTY_OUTPUT_RETRY_ATTEMPTS = 1


_CHECKOUT_ERROR_MESSAGES = {
    "AI_CONFIG_MISSING": "Insight agent LLM is not configured.",
    "AI_LLM_AUTH_REQUIRED": f"{PRODUCT_NAME} login is required to use the managed LLM.",
    "AI_LLM_QUOTA_UNAVAILABLE": (
        "No cloud LLM API-call uses are available for this account."
    ),
    "AI_LLM_CONFIG_MISSING": f"{PRODUCT_NAME} managed LLM is not configured.",
    "AI_LLM_CHECKOUT_TIMEOUT": f"{PRODUCT_NAME} LLM checkout timed out. Please retry later.",
    "AI_LLM_CHECKOUT_FAILED": (
        f"{PRODUCT_NAME} LLM checkout failed before a usable response was returned."
    ),
    "AI_LLM_CHECKOUT_INVALID_RESPONSE": (
        f"{PRODUCT_NAME} LLM checkout did not return usable configuration."
    ),
}


def _exception_chain(exc: BaseException) -> list[BaseException]:
    chain: list[BaseException] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or current.__context__
    return chain


def _status_codes(chain: list[BaseException]) -> set[int]:
    codes: set[int] = set()
    for exc in chain:
        for attribute in ("status_code", "code"):
            value = getattr(exc, attribute, None)
            if isinstance(value, int) and not isinstance(value, bool):
                codes.add(value)
            elif isinstance(value, str) and value.isdigit():
                codes.add(int(value))
    return codes


def _looks_like_unknown_model(detail: str) -> bool:
    """Detect unknown-model failures some vendors report as HTTP 400, not 404.

    Some vendors (e.g. SiliconFlow) answer an unknown model name with a plain
    HTTP 400 instead of 404, so status codes alone would misclassify it as a
    generic invalid request. The vendor body never leaves this module: only
    the fixed category is used, so provider prose cannot leak into the UI.
    """

    if not detail:
        return False
    if "model" not in detail:
        return False
    return any(
        phrase in detail
        for phrase in (
            "invalid model",
            "model is invalid",
            "does not exist",
            "doesn't exist",
            "not exist",
            "not found",
            "notfound",
            "not_found",
            "unknown",
            "unsupported",
            "not available",
            "no such",
        )
    )


def classify_provider_failure(exc: BaseException) -> str:
    """Map a provider exception to a closed category.

    Returns one of: timeout / auth / model_not_found / rate_limit / network /
    invalid_response / unexpected. Classification inspects the exception chain
    (type names and status codes only) — never vendor response bodies, which
    must not reach logs or the UI.
    """

    chain = _exception_chain(exc)
    names = " ".join(type(item).__name__.lower() for item in chain)
    statuses = _status_codes(chain)
    detail = " ".join(str(item) for item in chain).lower()

    if "timeout" in names or "timedout" in names:
        return "timeout"
    if {401, 403} & statuses or any(
        token in names
        for token in ("authentication", "unauthorized", "permissiondenied", "forbidden")
    ):
        return "auth"
    if 404 in statuses or "notfound" in names or _looks_like_unknown_model(detail):
        return "model_not_found"
    if 429 in statuses or "ratelimit" in names:
        return "rate_limit"
    if any(
        token in names
        for token in (
            "connection",
            "connecterror",
            "dns",
            "socket",
            "network",
            "apiconnection",
            "proxyerror",
            "gaierror",
        )
    ):
        return "network"
    if any(
        token in names
        for token in (
            "empty",
            "invalidresponse",
            "validation",
            "jsondecode",
            "decode",
            "parse",
        )
    ):
        return "invalid_response"
    return "unexpected"


# 生成路径（相对探针）的错误码：auth / model / rate / network 是 BYOK 用户自己
# 能修的配置问题，值得从笼统的 AI_LLM_REQUEST_FAILED 拆出来；timeout 与
# invalid_response 复用前端早已预留文案的 AI_LLM_REQUEST_TIMEOUT /
# AI_LLM_INVALID_RESPONSE，不新增三语文案。托管的 checkout 错误码走上面
# _CHECKOUT_ERROR_MESSAGES 的精确匹配，与此表无关。
GENERATION_ERROR_CODE_BY_CATEGORY = {
    "timeout": "AI_LLM_REQUEST_TIMEOUT",
    "auth": "AI_LLM_KEY_REJECTED",
    "model_not_found": "AI_LLM_MODEL_UNAVAILABLE",
    "rate_limit": "AI_LLM_RATE_LIMITED",
    "network": "AI_LLM_NETWORK_FAILED",
    "invalid_response": "AI_LLM_INVALID_RESPONSE",
}

_GENERATION_ERROR_MESSAGES = {
    "AI_LLM_REQUEST_TIMEOUT": "The model request timed out before a usable response.",
    "AI_LLM_KEY_REJECTED": "The model provider rejected the configured API key.",
    "AI_LLM_MODEL_UNAVAILABLE": "The configured model is not available from the provider.",
    "AI_LLM_RATE_LIMITED": "The model provider temporarily rate-limited the request.",
    "AI_LLM_NETWORK_FAILED": (
        "Could not reach the model provider; check the network or base URL."
    ),
    "AI_LLM_INVALID_RESPONSE": "The model provider returned an unreadable response.",
}


def generation_error_code_for(exc: BaseException) -> str | None:
    """Generation-path error code for a provider exception, or None to keep
    the generic AI_LLM_REQUEST_FAILED (e.g. truly unexpected failures)."""

    return GENERATION_ERROR_CODE_BY_CATEGORY.get(classify_provider_failure(exc))


class SingleCallInsightProvider(ProviderOpenAIOfficial):
    def __init__(self, config: dict) -> None:
        super().__init__(config, {})
        self.client.max_retries = 0
        self.last_error_code: str | None = None

    async def _handle_api_error(self, error, *args, **kwargs):
        raise error

    async def text_chat(self, *args, **kwargs) -> LLMResponse:
        try:
            return await super().text_chat(*args, **kwargs)
        except Exception as exc:
            self.last_error_code = generation_error_code_for(exc)
            raise


# 三个 agent（要点总结、启发灵感、文字稿解剖）共用的输出预算默认值。
# 解剖报告按「每段约 940 字符 × 10 段 + 非段落约 1800 字符」估算约 11.2k 字符、
# 约 7.3k token，8192 是整份报告还能装下的临界值。此前不设，等于退化为服务商
# 默认上限（DeepSeek 系常为 4096），长文字稿的报告会被截断成半截 JSON，工具校验
# 必然失败并触发重试；每次重试都重新 checkout 扣一个 AI Credit，用户却拿不到产物。
# 单次模型能写多少仍以服务商上限为准，管理员可用 APP_LLM_MAX_TOKENS 覆盖。
DEFAULT_MAX_OUTPUT_TOKENS = 8192


def _max_output_tokens(env: Mapping[str, str]) -> int:
    raw_value = env.get("APP_LLM_MAX_TOKENS", "").strip()
    if not raw_value:
        return DEFAULT_MAX_OUTPUT_TOKENS
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
        "id": "app_insights",
        "type": "openai_chat_completion",
        "key": [env["APP_LLM_API_KEY"].strip()],
        "model": env["APP_LLM_MODEL"].strip(),
        "api_base": env.get("APP_LLM_BASE_URL", "").strip() or "https://api.openai.com/v1",
        "timeout": parse_timeout(env.get("APP_LLM_TIMEOUT_SECONDS")),
    }
    max_tokens = _max_output_tokens(env)
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
        super().__init__({"id": "app_managed_insights", "type": "openai_chat_completion"}, {})
        self._env = dict(env)
        self._transport = transport
        self._call_index = 0
        self.last_error_code: str | None = None

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
            "APP_LLM_API_KEY": str(config["api_key"]),
            "APP_LLM_MODEL": str(config["model"]),
            "APP_LLM_BASE_URL": str(config["base_url"]),
            "APP_LLM_PROVIDER": str(config["provider"]),
            "APP_LLM_TIMEOUT_SECONDS": str(config["timeout_seconds"]),
        })
        try:
            return await provider.text_chat(*args, **kwargs)
        except Exception:
            # 每次调用都是临时 inner provider，异常向上抛给 runner 前把已分类的
            # 错误码拷回自己，agent 层的 agent_error 才能读到。
            self.last_error_code = getattr(provider, "last_error_code", None)
            raise
        finally:
            await provider.terminate()

    async def terminate(self) -> None:
        return None


def build_insight_provider(env: Mapping[str, str]) -> Provider:
    # 先校验 APP_LLM_MAX_TOKENS：非法值在任何 checkout 之前失败，不扣额度。
    _max_output_tokens(env)
    if env.get(LLM_SOURCE_ENV, "").strip().lower() == "server":
        required = (LLM_CHECKOUT_URL_ENV, LLM_SESSION_TOKEN_ENV, LLM_CHECKOUT_REQUEST_ID_ENV)
        if any(not env.get(name, "").strip() for name in required):
            raise InsightGenerationError(
                "AI_CONFIG_MISSING", "Insight agent LLM is not configured."
            )
        return ServerManagedInsightProvider(env)
    if (
        not env.get("APP_LLM_API_KEY", "").strip()
        or not env.get("APP_LLM_MODEL", "").strip()
        or env.get("APP_LLM_PROVIDER", "openai_compatible").strip().lower()
        not in {"openai", "openai_compatible"}
    ):
        raise InsightGenerationError(
            "AI_CONFIG_MISSING", "Insight agent LLM is not configured."
        )
    return _build_single_call_provider(env)


def agent_error(
    response: LLMResponse | None,
    label: str,
    provider: Provider | None = None,
) -> InsightGenerationError:
    detail = (response.completion_text if response else "") or ""
    if detail in _CHECKOUT_ERROR_MESSAGES:
        return InsightGenerationError(detail, _CHECKOUT_ERROR_MESSAGES[detail])
    code = getattr(provider, "last_error_code", None)
    if code and code in _GENERATION_ERROR_MESSAGES:
        # runner 把 SDK 异常吞成 "All chat models failed: ..." 的 err 响应，
        # 供应商原文进不了这里；分类码在 provider 捕获异常时已记下，用它给
        # BYOK 用户一个可操作的错误码，而不是笼统的请求失败。
        return InsightGenerationError(code, _GENERATION_ERROR_MESSAGES[code])
    return InsightGenerationError(
        "AI_LLM_REQUEST_FAILED", f"{label} agent LLM request failed."
    )
