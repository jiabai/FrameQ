from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from urllib.request import Request

from frameq_worker.insight_errors import InsightGenerationError

DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1"
DEFAULT_LLM_TIMEOUT_SECONDS = 60.0

LLM_PROVIDER_ENV = "FRAMEQ_LLM_PROVIDER"
LLM_API_KEY_ENV = "FRAMEQ_LLM_API_KEY"
LLM_MODEL_ENV = "FRAMEQ_LLM_MODEL"
LLM_BASE_URL_ENV = "FRAMEQ_LLM_BASE_URL"
LLM_TIMEOUT_ENV = "FRAMEQ_LLM_TIMEOUT_SECONDS"
LLM_SOURCE_ENV = "FRAMEQ_LLM_SOURCE"
LLM_CHECKOUT_URL_ENV = "FRAMEQ_LLM_CHECKOUT_URL"
LLM_SESSION_TOKEN_ENV = "FRAMEQ_LLM_SESSION_TOKEN"
LLM_CHECKOUT_REQUEST_ID_ENV = "FRAMEQ_LLM_CHECKOUT_REQUEST_ID"

ANYSEARCH_SOURCE_ENV = "FRAMEQ_ANYSEARCH_SOURCE"
ANYSEARCH_CHECKOUT_URL_ENV = "FRAMEQ_ANYSEARCH_CHECKOUT_URL"
ANYSEARCH_SESSION_TOKEN_ENV = "FRAMEQ_ANYSEARCH_SESSION_TOKEN"

Transport = Callable[[Request, float], bytes]


def derive_per_call_request_id(request_id_seed: str, call_index: int) -> str:
    suffix = f"-call-{call_index:04d}"
    max_request_id_length = 160
    if len(request_id_seed) + len(suffix) <= max_request_id_length:
        return f"{request_id_seed}{suffix}"
    return f"{request_id_seed[: max_request_id_length - len(suffix)]}{suffix}"


def parse_managed_checkout_response(raw_response: bytes) -> dict[str, str | int]:
    try:
        payload = json.loads(raw_response.decode("utf-8"))
        provider = str(payload["provider"]).strip().lower()
        base_url = str(payload["base_url"]).strip()
        model = str(payload["model"]).strip()
        api_key = str(payload["api_key"]).strip()
        timeout_seconds = int(payload.get("timeout_seconds", DEFAULT_LLM_TIMEOUT_SECONDS))
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InsightGenerationError(
            "AI_LLM_CHECKOUT_INVALID_RESPONSE",
            "FrameQ LLM checkout did not return usable configuration.",
        ) from exc

    if provider not in {"openai", "openai_compatible"} or not base_url or not model or not api_key:
        raise InsightGenerationError(
            "AI_LLM_CHECKOUT_INVALID_RESPONSE",
            "FrameQ LLM checkout did not return usable configuration.",
        )
    return {
        "provider": provider,
        "base_url": base_url,
        "model": model,
        "api_key": api_key,
        "timeout_seconds": timeout_seconds,
    }


def checkout_llm_config_once(
    env: Mapping[str, str], transport: Transport | None = None
) -> dict[str, str | int]:
    checkout_url = env.get(LLM_CHECKOUT_URL_ENV, "").strip()
    session_token = env.get(LLM_SESSION_TOKEN_ENV, "").strip()
    request_id = env.get(LLM_CHECKOUT_REQUEST_ID_ENV, "").strip()
    if not checkout_url or not session_token or not request_id:
        raise RuntimeError(
            "FRAMEQ_LLM_SOURCE=server 但缺少 FRAMEQ_LLM_CHECKOUT_URL / "
            "_SESSION_TOKEN / _CHECKOUT_REQUEST_ID 之一，无法 checkout 成稿 LLM 凭证。",
        )

    payload = {"request_id": request_id}
    request = Request(
        url=checkout_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {session_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        raw_response = (transport or urlopen_transport)(
            request,
            parse_timeout(env.get(LLM_TIMEOUT_ENV)),
        )
    except urllib.error.HTTPError as exc:
        raise _managed_checkout_http_error(exc) from exc
    except TimeoutError as exc:
        raise InsightGenerationError(
            "AI_LLM_CHECKOUT_TIMEOUT",
            "FrameQ LLM checkout timed out. Please retry later.",
        ) from exc
    except (urllib.error.URLError, OSError) as exc:
        raise InsightGenerationError(
            "AI_LLM_CHECKOUT_FAILED",
            "FrameQ LLM checkout failed before a usable response was returned.",
        ) from exc

    return parse_managed_checkout_response(raw_response)


def parse_anysearch_checkout_response(raw_response: bytes) -> dict[str, str]:
    """解析 anysearch checkout 响应 ``{mcp_url, api_key?}``（shape 与 LLM checkout
    不同，独立解析）。

    ``api_key`` 缺 / null → 返回值**不含**该键（匿名访问）。调用方据此决定是否设
    ``ANYSEARCH_API_KEY``。
    """
    try:
        payload = json.loads(raw_response.decode("utf-8"))
        mcp_url = str(payload["mcp_url"]).strip()
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("anysearch checkout 未返回可用配置（缺少 mcp_url）。") from exc
    if not mcp_url:
        raise RuntimeError("anysearch checkout 未返回可用配置（mcp_url 为空）。")

    result: dict[str, str] = {"mcp_url": mcp_url}
    api_key = payload.get("api_key")
    if isinstance(api_key, str) and api_key.strip():
        result["api_key"] = api_key.strip()
    return result


def checkout_anysearch_config_once(
    env: Mapping[str, str], transport: Transport | None = None
) -> dict[str, str]:
    checkout_url = env.get(ANYSEARCH_CHECKOUT_URL_ENV, "").strip()
    session_token = env.get(ANYSEARCH_SESSION_TOKEN_ENV, "").strip()
    if not checkout_url or not session_token:
        raise RuntimeError(
            "FRAMEQ_ANYSEARCH_SOURCE=server 但缺少 FRAMEQ_ANYSEARCH_CHECKOUT_URL / "
            "_SESSION_TOKEN 之一，无法 checkout anysearch 凭证。",
        )

    request = Request(
        url=checkout_url,
        data=b"{}",
        headers={
            "Authorization": f"Bearer {session_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        raw_response = (transport or urlopen_transport)(request, DEFAULT_LLM_TIMEOUT_SECONDS)
    except urllib.error.HTTPError as exc:
        raise _anysearch_checkout_http_error(exc) from exc
    except TimeoutError as exc:
        raise RuntimeError("anysearch checkout 超时，请稍后重试。") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise RuntimeError("anysearch checkout 请求失败，未返回可用响应。") from exc

    return parse_anysearch_checkout_response(raw_response)


def _anysearch_checkout_http_error(error: urllib.error.HTTPError) -> RuntimeError:
    """anysearch checkout HTTP 错误翻译：``_extract_error_code`` 抠 code、raise 中性
    ``RuntimeError``。"""
    code = _extract_error_code(error)
    if error.code == 401:
        return RuntimeError("anysearch checkout 需要登录（鉴权失败，401）。")
    if code == "ANYSEARCH_CONFIG_MISSING":
        return RuntimeError("服务端未配置 anysearch（FRAMEQ_ANYSEARCH_MCP_URL 缺失）。")
    return RuntimeError(f"anysearch checkout 失败，HTTP {error.code}。")


def _managed_checkout_http_error(error: urllib.error.HTTPError) -> InsightGenerationError:
    detail = _extract_error_code(error)
    if error.code == 401:
        return InsightGenerationError(
            "AI_LLM_AUTH_REQUIRED",
            "FrameQ login is required to use the managed LLM.",
        )
    if error.code == 403:
        return InsightGenerationError(
            "AI_LLM_QUOTA_UNAVAILABLE",
            "No cloud LLM API-call uses are available for this account.",
        )
    if detail == "LLM_CONFIG_MISSING":
        return InsightGenerationError(
            "AI_LLM_CONFIG_MISSING",
            "FrameQ managed LLM is not configured.",
        )
    return InsightGenerationError(
        "AI_LLM_CHECKOUT_FAILED",
        f"FrameQ LLM checkout failed with HTTP {error.code}.",
    )


def _extract_error_code(error: urllib.error.HTTPError) -> str:
    try:
        payload = json.loads(error.read().decode("utf-8"))
        code = payload.get("error")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return ""
    return code if isinstance(code, str) else ""


def parse_timeout(raw_value: str | None) -> float:
    if raw_value is None:
        return DEFAULT_LLM_TIMEOUT_SECONDS

    try:
        timeout = float(raw_value)
    except ValueError:
        return DEFAULT_LLM_TIMEOUT_SECONDS

    return timeout if timeout > 0 else DEFAULT_LLM_TIMEOUT_SECONDS


def urlopen_transport(request: Request, timeout: float) -> bytes:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()
