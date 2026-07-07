import json
from io import BytesIO
from urllib.error import HTTPError
from urllib.request import Request

import pytest
from frameq_worker.insightflow import InsightGenerationError
from frameq_worker.llm import (
    OpenAICompatibleInsightClient,
    ServerManagedInsightClient,
    build_insight_client_from_env,
)


def test_build_insight_client_from_env_requires_key_and_model() -> None:
    assert build_insight_client_from_env({}) is None
    assert build_insight_client_from_env({"FRAMEQ_LLM_API_KEY": "secret"}) is None
    assert build_insight_client_from_env({"FRAMEQ_LLM_MODEL": "demo-model"}) is None


def test_openai_compatible_client_posts_prompt_and_returns_message_content() -> None:
    calls: list[tuple[Request, float]] = []

    def fake_transport(request: Request, timeout: float) -> bytes:
        calls.append((request, timeout))
        return json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": '["为什么配置入口应该和密钥隔离？"]',
                        }
                    }
                ]
            }
        ).encode("utf-8")

    client = OpenAICompatibleInsightClient(
        api_key="secret-key",
        model="demo-model",
        base_url="https://llm.example/v1/",
        timeout_seconds=12,
        transport=fake_transport,
    )

    content = client.generate("请生成话题点")

    request, timeout = calls[0]
    assert content == '["为什么配置入口应该和密钥隔离？"]'
    assert request.full_url == "https://llm.example/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer secret-key"
    assert request.get_header("Content-type") == "application/json"
    assert timeout == 12
    payload = json.loads(request.data.decode("utf-8"))  # type: ignore[union-attr]
    assert payload == {
        "model": "demo-model",
        "messages": [{"role": "user", "content": "请生成话题点"}],
        "temperature": 0.7,
    }


def test_openai_compatible_client_rejects_unusable_response() -> None:
    client = OpenAICompatibleInsightClient(
        api_key="secret-key",
        model="demo-model",
        transport=lambda request, timeout: b'{"choices": []}',
    )

    with pytest.raises(InsightGenerationError) as exc_info:
        client.generate("请生成话题点")

    assert exc_info.value.code == "INSIGHTFLOW_LLM_INVALID_RESPONSE"


def test_openai_compatible_client_reports_timeout_with_actionable_message() -> None:
    def timeout_transport(request: Request, timeout: float) -> bytes:
        raise TimeoutError("read timed out")

    client = OpenAICompatibleInsightClient(
        api_key="secret-key",
        model="demo-model",
        timeout_seconds=12,
        transport=timeout_transport,
    )

    with pytest.raises(InsightGenerationError) as exc_info:
        client.generate("请生成话题点")

    assert exc_info.value.code == "INSIGHTFLOW_LLM_REQUEST_TIMEOUT"
    assert str(exc_info.value) == (
        "LLM request timed out after 12 seconds. "
        "Ask the administrator to increase the server-managed timeout and retry."
    )


def test_openai_compatible_client_classifies_provider_content_filter_errors() -> None:
    def blocked_transport(request: Request, timeout: float) -> bytes:
        raise HTTPError(
            url=request.full_url,
            code=400,
            msg="Bad Request",
            hdrs=None,
            fp=BytesIO(
                json.dumps(
                    {
                        "error": {
                            "code": "content_policy_violation",
                            "message": "The transcript was rejected by the content safety filter.",
                        }
                    }
                ).encode("utf-8")
            ),
        )

    client = OpenAICompatibleInsightClient(
        api_key="secret-key",
        model="demo-model",
        transport=blocked_transport,
    )

    with pytest.raises(InsightGenerationError) as exc_info:
        client.generate("请根据文字稿生成话题点")

    assert exc_info.value.code == "INSIGHTFLOW_LLM_CONTENT_BLOCKED"
    assert str(exc_info.value) == (
        "LLM provider blocked the request with its content safety policy. "
        "Provider detail: content_policy_violation: "
        "The transcript was rejected by the content safety filter."
    )


def test_server_managed_client_checkouts_each_generate_with_per_call_ids() -> None:
    calls: list[Request] = []
    checkout_ids: list[str] = []

    def fake_transport(request: Request, timeout: float) -> bytes:
        calls.append(request)
        if request.full_url == "http://127.0.0.1:8787/api/desktop/llm/checkouts":
            assert request.get_header("Authorization") == "Bearer desktop-token"
            checkout_payload = json.loads(request.data.decode("utf-8"))  # type: ignore[union-attr]
            checkout_ids.append(checkout_payload["request_id"])
            return json.dumps(
                {
                    "provider": "openai_compatible",
                    "base_url": "https://llm.example/v1",
                    "model": "dedicated-model",
                    "api_key": "client-secret",
                    "timeout_seconds": 33,
                    "quota_remaining": 19,
                }
            ).encode("utf-8")
        assert request.full_url == "https://llm.example/v1/chat/completions"
        assert request.get_header("Authorization") == "Bearer client-secret"
        return b'{"choices":[{"message":{"content":"[\\"topic\\"]"}}]}'

    client = ServerManagedInsightClient(
        checkout_url="http://127.0.0.1:8787/api/desktop/llm/checkouts",
        session_token="desktop-token",
        request_id="run-12345678",
        transport=fake_transport,
    )

    assert client.generate("first prompt") == '["topic"]'
    assert client.generate("second prompt") == '["topic"]'
    assert checkout_ids == [
        "run-12345678-call-0001",
        "run-12345678-call-0002",
    ]


def test_build_insight_client_from_env_supports_server_managed_mode() -> None:
    client = build_insight_client_from_env(
        {
            "FRAMEQ_LLM_SOURCE": "server",
            "FRAMEQ_LLM_CHECKOUT_URL": "http://127.0.0.1:8787/api/desktop/llm/checkouts",
            "FRAMEQ_LLM_SESSION_TOKEN": "desktop-token",
            "FRAMEQ_LLM_CHECKOUT_REQUEST_ID": "run-12345678",
        }
    )

    assert isinstance(client, ServerManagedInsightClient)
