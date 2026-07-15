from __future__ import annotations

import json
from io import BytesIO
from urllib.error import HTTPError
from urllib.request import Request

import pytest
from frameq_worker.draft_agent import resolve_draft_credentials
from frameq_worker.insightflow import InsightGenerationError
from frameq_worker.llm import (
    checkout_anysearch_config_once,
    checkout_llm_config_once,
    parse_anysearch_checkout_response,
)

LLM_CHECKOUT_URL = "http://127.0.0.1:8787/api/desktop/llm/checkouts"
ANYSEARCH_CHECKOUT_URL = "http://127.0.0.1:8787/api/desktop/anysearch/checkout"

# 对齐 /api/desktop/llm/checkouts 响应契约（含 quota_remaining，worker 端解析忽略它）。
LLM_CHECKOUT_RESPONSE = {
    "provider": "openai_compatible",
    "base_url": "https://llm.example/v1",
    "model": "dedicated-draft-model",
    "api_key": "server-llm-key",
    "timeout_seconds": 33,
    "quota_remaining": 19,
}


def _make_transport(*, llm_response=None, anysearch_response=None, recorded=None):
    """fake transport：按 checkout URL 返回固定 bytes；可注入 Exception 模拟失败；可选记录
    request。"""

    def transport(request: Request, timeout: float) -> bytes:
        if recorded is not None:
            recorded.append(request)
        if request.full_url == LLM_CHECKOUT_URL:
            if isinstance(llm_response, Exception):
                raise llm_response
            return json.dumps(llm_response).encode("utf-8")
        if request.full_url == ANYSEARCH_CHECKOUT_URL:
            if isinstance(anysearch_response, Exception):
                raise anysearch_response
            return json.dumps(anysearch_response).encode("utf-8")
        raise AssertionError(f"unexpected checkout URL: {request.full_url}")

    return transport


# --------------------------------------------------------------------------- #
# 4.1 resolve_draft_credentials
# --------------------------------------------------------------------------- #


def test_resolve_local_passthrough_does_not_touch_network() -> None:
    recorded: list[Request] = []
    transport = _make_transport(recorded=recorded)
    env = {
        "FRAMEQ_LLM_API_KEY": "local-key",
        "FRAMEQ_LLM_MODEL": "local-model",
        "ANYSEARCH_MCP_URL": "https://local.anysearch/mcp",
        "ANYSEARCH_API_KEY": "local-anys-key",
        "FRAMEQ_LLM_MAX_TOKENS": "4096",
    }

    merged = resolve_draft_credentials(env, transport)

    assert merged == env  # 无 *_SOURCE=server → 原样透传
    assert recorded == []  # → checkout 未被调用


def test_resolve_server_llm_flattens_five_fields_and_preserves_max_tokens() -> None:
    recorded: list[Request] = []
    transport = _make_transport(llm_response=LLM_CHECKOUT_RESPONSE, recorded=recorded)
    env = {
        "FRAMEQ_LLM_SOURCE": "server",
        "FRAMEQ_LLM_CHECKOUT_URL": LLM_CHECKOUT_URL,
        "FRAMEQ_LLM_SESSION_TOKEN": "desktop-token",
        "FRAMEQ_LLM_CHECKOUT_REQUEST_ID": "draft-abc-123",
        # 本地残留：均应被 checkout 结果覆盖（server 模式 checkout 优先于本地）。
        "FRAMEQ_LLM_API_KEY": "stale-local-key",
        "FRAMEQ_LLM_MODEL": "stale-model",
        "FRAMEQ_LLM_TIMEOUT_SECONDS": "5",
        "FRAMEQ_LLM_MAX_TOKENS": "4096",  # 非 server 托管 → 原样保留
    }

    merged = resolve_draft_credentials(env, transport)

    assert merged["FRAMEQ_LLM_API_KEY"] == "server-llm-key"
    assert merged["FRAMEQ_LLM_MODEL"] == "dedicated-draft-model"
    assert merged["FRAMEQ_LLM_BASE_URL"] == "https://llm.example/v1"
    assert merged["FRAMEQ_LLM_PROVIDER"] == "openai_compatible"
    assert merged["FRAMEQ_LLM_TIMEOUT_SECONDS"] == "33"
    assert merged["FRAMEQ_LLM_MAX_TOKENS"] == "4096"  # 保留

    # 一篇只 checkout 一次；鉴权头复用桌面端 session token。
    assert len(recorded) == 1
    assert recorded[0].full_url == LLM_CHECKOUT_URL
    assert recorded[0].get_header("Authorization") == "Bearer desktop-token"


def test_resolve_server_anysearch_with_key_overrides_local() -> None:
    recorded: list[Request] = []
    transport = _make_transport(
        anysearch_response={"mcp_url": "https://anysearch.example/mcp", "api_key": "anys-key"},
        recorded=recorded,
    )
    env = {
        "FRAMEQ_ANYSEARCH_SOURCE": "server",
        "FRAMEQ_ANYSEARCH_CHECKOUT_URL": ANYSEARCH_CHECKOUT_URL,
        "FRAMEQ_ANYSEARCH_SESSION_TOKEN": "desktop-token",
        "ANYSEARCH_MCP_URL": "https://stale.local/mcp",  # 被覆盖
    }

    merged = resolve_draft_credentials(env, transport)

    assert merged["ANYSEARCH_MCP_URL"] == "https://anysearch.example/mcp"
    assert merged["ANYSEARCH_API_KEY"] == "anys-key"

    # body 无 request_id（anysearch 无配额、无可幂等消费对象）。
    body = json.loads(recorded[0].data.decode("utf-8"))  # type: ignore[union-attr]
    assert body == {}


def test_resolve_server_anysearch_anonymous_removes_residual_key() -> None:
    transport = _make_transport(
        anysearch_response={"mcp_url": "https://anysearch.example/mcp", "api_key": None},
    )
    env = {
        "FRAMEQ_ANYSEARCH_SOURCE": "server",
        "FRAMEQ_ANYSEARCH_CHECKOUT_URL": ANYSEARCH_CHECKOUT_URL,
        "FRAMEQ_ANYSEARCH_SESSION_TOKEN": "desktop-token",
        "ANYSEARCH_MCP_URL": "https://stale.local/mcp",
        "ANYSEARCH_API_KEY": "stale-residual-key",  # server 匿名 → 应被移除
    }

    merged = resolve_draft_credentials(env, transport)

    assert merged["ANYSEARCH_MCP_URL"] == "https://anysearch.example/mcp"
    assert "ANYSEARCH_API_KEY" not in merged


def test_resolve_mixed_llm_server_anysearch_local() -> None:
    recorded: list[Request] = []
    transport = _make_transport(llm_response=LLM_CHECKOUT_RESPONSE, recorded=recorded)
    env = {
        "FRAMEQ_LLM_SOURCE": "server",
        "FRAMEQ_LLM_CHECKOUT_URL": LLM_CHECKOUT_URL,
        "FRAMEQ_LLM_SESSION_TOKEN": "desktop-token",
        "FRAMEQ_LLM_CHECKOUT_REQUEST_ID": "draft-mix",
        # anysearch local（不 checkout）
        "ANYSEARCH_MCP_URL": "https://local.anys/mcp",
        "ANYSEARCH_API_KEY": "local-anys",
    }

    merged = resolve_draft_credentials(env, transport)

    assert merged["FRAMEQ_LLM_API_KEY"] == "server-llm-key"
    assert merged["ANYSEARCH_MCP_URL"] == "https://local.anys/mcp"
    assert merged["ANYSEARCH_API_KEY"] == "local-anys"
    assert len(recorded) == 1  # 只打 LLM checkout，anysearch 未触网


def test_resolve_mixed_llm_local_anysearch_server() -> None:
    recorded: list[Request] = []
    transport = _make_transport(
        anysearch_response={"mcp_url": "https://anys.example/mcp"},
        recorded=recorded,
    )
    env = {
        # LLM local（不 checkout）
        "FRAMEQ_LLM_API_KEY": "local-llm-key",
        "FRAMEQ_LLM_MODEL": "local-model",
        # anysearch server
        "FRAMEQ_ANYSEARCH_SOURCE": "server",
        "FRAMEQ_ANYSEARCH_CHECKOUT_URL": ANYSEARCH_CHECKOUT_URL,
        "FRAMEQ_ANYSEARCH_SESSION_TOKEN": "desktop-token",
    }

    merged = resolve_draft_credentials(env, transport)

    assert merged["FRAMEQ_LLM_API_KEY"] == "local-llm-key"  # 未覆盖
    assert merged["ANYSEARCH_MCP_URL"] == "https://anys.example/mcp"
    assert "ANYSEARCH_API_KEY" not in merged  # 匿名
    assert len(recorded) == 1


def test_resolve_propagates_llm_checkout_exception() -> None:
    # LLM checkout 复用 _managed_checkout_http_error → InsightGenerationError
    # （姓 insight 但无害，经 retry_insights draft 分支兜为 DRAFT_GENERATION_FAILED）。
    boom = HTTPError(
        url=LLM_CHECKOUT_URL,
        code=403,
        msg="Forbidden",
        hdrs=None,
        fp=BytesIO(json.dumps({"error": "LLM_QUOTA_UNAVAILABLE"}).encode("utf-8")),
    )
    transport = _make_transport(llm_response=boom)
    env = {
        "FRAMEQ_LLM_SOURCE": "server",
        "FRAMEQ_LLM_CHECKOUT_URL": LLM_CHECKOUT_URL,
        "FRAMEQ_LLM_SESSION_TOKEN": "desktop-token",
        "FRAMEQ_LLM_CHECKOUT_REQUEST_ID": "draft-xyz",
    }

    with pytest.raises(InsightGenerationError) as exc_info:
        resolve_draft_credentials(env, transport)
    assert exc_info.value.code == "INSIGHTFLOW_LLM_QUOTA_UNAVAILABLE"


def test_resolve_propagates_anysearch_checkout_error_as_neutral_runtime_error() -> None:
    # anysearch checkout 不复用 insight 码 → 中性 RuntimeError。
    boom = HTTPError(
        url=ANYSEARCH_CHECKOUT_URL,
        code=401,
        msg="Unauthorized",
        hdrs=None,
        fp=BytesIO(json.dumps({"error": "AUTH_REQUIRED"}).encode("utf-8")),
    )
    transport = _make_transport(anysearch_response=boom)
    env = {
        "FRAMEQ_ANYSEARCH_SOURCE": "server",
        "FRAMEQ_ANYSEARCH_CHECKOUT_URL": ANYSEARCH_CHECKOUT_URL,
        "FRAMEQ_ANYSEARCH_SESSION_TOKEN": "desktop-token",
    }

    with pytest.raises(RuntimeError) as exc_info:
        resolve_draft_credentials(env, transport)
    assert "401" in str(exc_info.value)


# --------------------------------------------------------------------------- #
# 4.2 checkout_llm_config_once（无 per-call 后缀）/ parse_anysearch_checkout_response
# --------------------------------------------------------------------------- #


def test_checkout_llm_config_once_uses_request_id_verbatim_no_per_call_suffix() -> None:
    recorded: list[Request] = []
    transport = _make_transport(llm_response=LLM_CHECKOUT_RESPONSE, recorded=recorded)
    env = {
        "FRAMEQ_LLM_CHECKOUT_URL": LLM_CHECKOUT_URL,
        "FRAMEQ_LLM_SESSION_TOKEN": "desktop-token",
        "FRAMEQ_LLM_CHECKOUT_REQUEST_ID": "draft-seed-12345",
    }

    config = checkout_llm_config_once(env, transport)

    assert config == {
        "provider": "openai_compatible",
        "base_url": "https://llm.example/v1",
        "model": "dedicated-draft-model",
        "api_key": "server-llm-key",
        "timeout_seconds": 33,
    }
    body = json.loads(recorded[0].data.decode("utf-8"))  # type: ignore[union-attr]
    # request_id verbatim——无 -call-NNNN 后缀（区别于
    # ServerManagedInsightClient.derive_per_call_request_id）。
    assert body == {"request_id": "draft-seed-12345"}


def test_checkout_llm_config_once_missing_env_raises() -> None:
    transport = _make_transport(llm_response=LLM_CHECKOUT_RESPONSE)
    # 缺 session token / request_id（server 模式必需 env）。
    with pytest.raises(RuntimeError):
        checkout_llm_config_once({"FRAMEQ_LLM_CHECKOUT_URL": LLM_CHECKOUT_URL}, transport)


def test_checkout_anysearch_config_once_returns_mcp_url_and_key() -> None:
    recorded: list[Request] = []
    transport = _make_transport(
        anysearch_response={"mcp_url": "https://anys.example/mcp", "api_key": "k"},
        recorded=recorded,
    )
    env = {
        "FRAMEQ_ANYSEARCH_CHECKOUT_URL": ANYSEARCH_CHECKOUT_URL,
        "FRAMEQ_ANYSEARCH_SESSION_TOKEN": "desktop-token",
    }

    config = checkout_anysearch_config_once(env, transport)

    assert config == {"mcp_url": "https://anys.example/mcp", "api_key": "k"}
    body = json.loads(recorded[0].data.decode("utf-8"))  # type: ignore[union-attr]
    assert body == {}  # 无 request_id


def test_parse_anysearch_checkout_response_valid_with_key() -> None:
    raw = json.dumps({"mcp_url": "https://anys.example/mcp", "api_key": "k"}).encode("utf-8")
    assert parse_anysearch_checkout_response(raw) == {
        "mcp_url": "https://anys.example/mcp",
        "api_key": "k",
    }


def test_parse_anysearch_checkout_response_anonymous_omits_key() -> None:
    explicit_null = json.dumps(
        {"mcp_url": "https://anys.example/mcp", "api_key": None}
    ).encode("utf-8")
    assert parse_anysearch_checkout_response(explicit_null) == {"mcp_url": "https://anys.example/mcp"}

    missing_key = json.dumps({"mcp_url": "https://anys.example/mcp"}).encode("utf-8")
    assert parse_anysearch_checkout_response(missing_key) == {"mcp_url": "https://anys.example/mcp"}


@pytest.mark.parametrize(
    "raw",
    [
        json.dumps({"nope": 1}).encode("utf-8"),  # 缺 mcp_url
        b"not json",  # 非法 JSON
        json.dumps({"mcp_url": "   "}).encode("utf-8"),  # 空 url
    ],
)
def test_parse_anysearch_checkout_response_invalid_shape_raises(raw: bytes) -> None:
    with pytest.raises(RuntimeError):
        parse_anysearch_checkout_response(raw)
